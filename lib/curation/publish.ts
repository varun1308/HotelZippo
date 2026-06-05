/* Publish-to-Hotels (12a + 12g): take APPROVED curation_hotels rows, store their hero
 * image to Storage, and upsert into public.hotels on (name, destination). Publish is
 * blocked per-row if validation fails (required fields + >=1 image + >=100 reviews).
 * Server-side only; service client.
 *
 * ATOMICITY INVARIANT (spec 01b/12g — "block publish if a hotel has 0 images"):
 *   a row is written to public.hotels ONLY when its hero image has been successfully
 *   stored. The image is fetched+uploaded FIRST; the hotel is then upserted in a single
 *   write that already carries `images: [storedUrl]`. If the hero fetch/upload fails the
 *   row is reported as `skipped` and NO row is committed — `published`/`skipped` always
 *   matches DB reality. (Previously the hotel was upserted before the image step, so a
 *   failed hero left an orphaned 0-image hotel in the DB while reporting "skipped".) */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canPublish } from './validator';
import { storeHeroImage } from './images';
import { curationRowSchema, type CurationRow } from './types';

export interface PublishResult {
  published: number;
  skipped: Array<{ name: string; destination: string; reasons: string[] }>;
  details: Array<{ name: string; destination: string; hotel_id: string }>;
}

/** Publish all approved rows for an optional destination (all if omitted). */
export async function publishApproved(
  supabase: SupabaseClient,
  destination?: string,
): Promise<PublishResult> {
  let query = supabase.from('curation_hotels').select('*').eq('status', 'approved');
  if (destination) query = query.eq('destination', destination);
  const { data, error } = await query;
  if (error) throw new Error(`failed to load approved rows: ${error.message}`);

  const result: PublishResult = { published: 0, skipped: [], details: [] };

  for (const raw of data ?? []) {
    const parsed = curationRowSchema.safeParse(raw);
    const row = (parsed.success ? parsed.data : (raw as CurationRow));

    const check = canPublish(row);
    if (!check.ok) {
      result.skipped.push({ name: row.name, destination: row.destination, reasons: check.errors });
      continue;
    }

    // Resolve a STABLE hotel id WITHOUT committing a row: reuse the existing hotel's id
    // (so re-publish overwrites the same Storage object) or mint a fresh UUID. The hotel
    // row is not written until the hero image is stored — see the atomicity invariant.
    const { data: existing } = await supabase
      .from('hotels')
      .select('id')
      .eq('name', row.name)
      .eq('destination', row.destination)
      .maybeSingle();
    const hotelId = existing?.id ?? crypto.randomUUID();

    // Store the hero image FIRST. If it fails, skip the row — and crucially, NO hotel
    // row has been written, so we never leave an orphaned 0-image hotel (12g).
    let storedUrl: string;
    try {
      storedUrl = await storeHeroImage(supabase, hotelId, row.images![0]);
    } catch (e) {
      result.skipped.push({
        name: row.name,
        destination: row.destination,
        reasons: [`hero image store failed: ${e instanceof Error ? e.message : String(e)}`],
      });
      continue;
    }

    // Now upsert the COMPLETE hotel (image included) in a single write.
    const { data: upserted, error: upErr } = await supabase
      .from('hotels')
      .upsert(
        {
          id: hotelId,
          name: row.name,
          destination: row.destination,
          star_rating: row.star_rating ?? null,
          brand: row.brand ?? null,
          tripadvisor_url: row.tripadvisor_url ?? null,
          google_place_id: row.google_place_id ?? null,
          price_tier: row.price_tier ?? null,
          images: [storedUrl],
        },
        { onConflict: 'name,destination' },
      )
      .select()
      .single();
    if (upErr || !upserted) {
      result.skipped.push({
        name: row.name,
        destination: row.destination,
        reasons: [`upsert failed: ${upErr?.message ?? 'unknown'}`],
      });
      continue;
    }

    result.published += 1;
    result.details.push({ name: row.name, destination: row.destination, hotel_id: upserted.id });
  }

  return result;
}
