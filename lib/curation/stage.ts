/* Curation staging (12a / 12h). Shared by the fetch path AND the ledger-ingest path:
 *   - mapDatasetItems: raw Apify dataset items → validated FetchedHotel[] (uses the 12a mapper +
 *     hotels-only guard, identical to lib/curation/fetch.ts's apify branch).
 *   - stageHotels: upsert FetchedHotel[] into curation_hotels on (name, destination), PRESERVING an
 *     existing row's curation status on re-stage (re-fetch/refresh/re-ingest never clobbers
 *     approve/reject decisions). This is the logic previously inline in the fetch-hotels route.
 *
 * Server-side; service client (curation_hotels is service-role only). Injectable client for tests. */
import type { SupabaseClient } from '@supabase/supabase-js';
import { mapSearchItem } from './apify-mapper';
import type { FetchedHotel } from './types';
import { DESTINATIONS } from '@/lib/db/schemas';

type Destination = (typeof DESTINATIONS)[number];

/** Map raw Apify dataset items (curation search actor) → FetchedHotel[] for a destination.
 * Mirrors lib/curation/fetch.ts fetchFromApify: map each item, drop nulls (non-hotel rows). */
export function mapDatasetItems(items: unknown[], destination: string): FetchedHotel[] {
  if (!(DESTINATIONS as readonly string[]).includes(destination)) {
    throw new Error(`unknown destination: ${destination}`);
  }
  return items
    .map((it) => mapSearchItem(it, destination as Destination))
    .filter((h): h is FetchedHotel => h !== null);
}

export interface StageResult {
  staged: number;
  /** Rows that could NOT be written (DB error). staged + failed === hotels.length. */
  failed: number;
  /** One "name: reason" line per failed row, for the route response / admin UI. */
  errors: string[];
}

/** Fields the founder can edit inline in the admin UI (the app/api/admin/hotels PATCH whitelist,
 * minus `status` which is never in a fetched row and `google_place_id` which has its own rule).
 * On re-stage an existing NON-NULL value WINS over the incoming fetch, so founder edits survive
 * Refresh/Ingest (12a: "re-fetch preserves prior decisions"). */
const FOUNDER_EDITABLE = ['brand', 'price_tier', 'latitude', 'longitude', 'address'] as const;

/** Enrichment a TA-search re-fetch cannot (re)produce — the paid Google place resolution
 * (google_place_id, PR #32) and a star class the actor may omit. Incoming wins ONLY when
 * non-null; a null incoming value must never wipe an existing one. */
const KEEP_UNLESS_INCOMING = ['google_place_id', 'star_rating'] as const;

/** Upsert candidates into curation_hotels on (name, destination), preserving existing status,
 * enrichment (google_place_id), and founder inline edits. Never throws on a per-row DB error —
 * failures are counted + reported so a partial write is visible (not silently "Ingested N"). */
export async function stageHotels(
  client: SupabaseClient,
  hotels: FetchedHotel[],
  fetchSource: string,
): Promise<StageResult> {
  let staged = 0;
  const errors: string[] = [];
  for (const h of hotels) {
    const { data: existing, error: selectError } = await client
      .from('curation_hotels')
      .select('id, google_place_id, star_rating, brand, price_tier, latitude, longitude, address')
      .eq('name', h.name)
      .eq('destination', h.destination)
      .maybeSingle();
    if (selectError) {
      errors.push(`${h.name}: lookup failed: ${selectError.message}`);
      continue;
    }

    const row: Record<string, unknown> = { ...h, fetch_source: fetchSource };
    let writeError: { message: string } | null;
    if (existing) {
      // Refresh fetched fields, KEEP the curation status (approve/reject decisions survive)
      // and never clobber enrichment / founder edits with a null-or-absent incoming value.
      for (const k of KEEP_UNLESS_INCOMING) row[k] = h[k] ?? existing[k];
      for (const k of FOUNDER_EDITABLE) row[k] = existing[k] ?? h[k] ?? null;
      ({ error: writeError } = await client.from('curation_hotels').update(row).eq('id', existing.id));
    } else {
      ({ error: writeError } = await client.from('curation_hotels').insert({ ...row, status: 'pending' }));
    }
    if (writeError) {
      errors.push(`${h.name}: write failed: ${writeError.message}`);
      continue;
    }
    staged += 1;
  }
  return { staged, failed: errors.length, errors };
}
