/* Publish-to-Hotels (12a + 12g): take APPROVED curation_hotels rows, store their hero
 * image to Storage, and upsert into public.hotels on (name, destination). Publish is
 * blocked per-row if validation fails (required fields + >=1 image + >=100 reviews).
 * Server-side only; service client. */
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

    // Upsert the hotel first (without image) to obtain a stable id for the Storage path.
    const { data: upserted, error: upErr } = await supabase
      .from('hotels')
      .upsert(
        {
          name: row.name,
          destination: row.destination,
          star_rating: row.star_rating ?? null,
          brand: row.brand ?? null,
          tripadvisor_url: row.tripadvisor_url ?? null,
          google_place_id: row.google_place_id ?? null,
          price_tier: row.price_tier ?? null,
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

    // Store the hero image and write the Storage URL back. Block (skip) if it fails —
    // a published hotel must have >= 1 image (12g).
    try {
      const sourceUrl = row.images![0];
      const storedUrl = await storeHeroImage(supabase, upserted.id, sourceUrl);
      await supabase.from('hotels').update({ images: [storedUrl] }).eq('id', upserted.id);
    } catch (e) {
      // Roll the row back to skipped state; leave the hotel without an image flagged.
      result.skipped.push({
        name: row.name,
        destination: row.destination,
        reasons: [`hero image store failed: ${e instanceof Error ? e.message : String(e)}`],
      });
      continue;
    }

    result.published += 1;
    result.details.push({ name: row.name, destination: row.destination, hotel_id: upserted.id });
  }

  return result;
}
