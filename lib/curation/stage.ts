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
}

/** Upsert candidates into curation_hotels on (name, destination), preserving existing status. */
export async function stageHotels(
  client: SupabaseClient,
  hotels: FetchedHotel[],
  fetchSource: string,
): Promise<StageResult> {
  let staged = 0;
  for (const h of hotels) {
    const { data: existing } = await client
      .from('curation_hotels')
      .select('id')
      .eq('name', h.name)
      .eq('destination', h.destination)
      .maybeSingle();

    const row = { ...h, fetch_source: fetchSource };
    if (existing) {
      // Refresh fetched fields, KEEP the curation status (approve/reject decisions survive).
      await client.from('curation_hotels').update(row).eq('id', existing.id);
    } else {
      await client.from('curation_hotels').insert({ ...row, status: 'pending' });
    }
    staged += 1;
  }
  return { staged };
}
