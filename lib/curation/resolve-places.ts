/* Resolve Google place ids for staged curation_hotels (12a). A SEPARATE, re-runnable step over
 * already-fetched rows (not bolted onto fetch) so it can be re-run, doesn't slow fetch, and a
 * failed/ambiguous match leaves google_place_id null without blocking anything. Server-side;
 * service client (curation_hotels is service-role only). See specs/12a-curation-tool.md. */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveGooglePlaceId, GooglePlacesError } from './google-places';
import { hasGeo, type PlaceQuery } from './google-places-mapper';

export interface ResolvePlacesResult {
  total: number;
  resolved: number;
  skipped: Array<{ name: string; reason: string }>;
  /** Resolved from name only (no lat/long) — worth a founder double-check. */
  lowConfidence: string[];
}

/** Injectable resolver (tests pass a stub so no key/network is needed). */
export type PlaceResolver = (q: PlaceQuery) => Promise<string | null>;

interface CurationRow {
  id: string;
  name: string;
  destination: string;
  latitude: number | null;
  longitude: number | null;
}

/** Resolve place ids for staged rows that don't have one yet. Optionally scoped to a destination.
 * `no_key` from the resolver aborts early with a clear reason (the whole batch would fail). */
export async function resolvePlaceIds(
  supabase: SupabaseClient,
  destination?: string,
  resolver: PlaceResolver = resolveGooglePlaceId,
): Promise<ResolvePlacesResult> {
  let query = supabase
    .from('curation_hotels')
    .select('id, name, destination, latitude, longitude')
    .is('google_place_id', null);
  if (destination) query = query.eq('destination', destination);
  const { data, error } = await query;
  if (error) throw new Error(`curation_hotels load failed: ${error.message}`);
  const rows = (data ?? []) as CurationRow[];

  const result: ResolvePlacesResult = { total: rows.length, resolved: 0, skipped: [], lowConfidence: [] };

  for (const row of rows) {
    const q: PlaceQuery = {
      name: row.name,
      destination: row.destination,
      latitude: row.latitude,
      longitude: row.longitude,
    };
    let placeId: string | null;
    try {
      placeId = await resolver(q);
    } catch (e) {
      // A missing key would fail every row — surface it and stop rather than spam skips.
      if (e instanceof GooglePlacesError && e.kind === 'no_key') throw e;
      result.skipped.push({ name: row.name, reason: e instanceof Error ? e.message : String(e) });
      continue;
    }
    if (!placeId) {
      result.skipped.push({ name: row.name, reason: 'no_match' });
      continue;
    }
    const { error: upErr } = await supabase
      .from('curation_hotels')
      .update({ google_place_id: placeId })
      .eq('id', row.id);
    if (upErr) {
      result.skipped.push({ name: row.name, reason: `update failed: ${upErr.message}` });
      continue;
    }
    result.resolved += 1;
    if (!hasGeo(q)) result.lowConfidence.push(row.name);
  }

  return result;
}
