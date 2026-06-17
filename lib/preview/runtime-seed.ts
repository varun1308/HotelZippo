/* On-the-fly preview seeding from chat (12i-C). When a user asks about a destination with NO hotels,
 * seed its preview hotels at runtime so cards can surface in the SAME turn.
 *
 * Architecture (resolved at build): a FAST seed — one `search-hotels` call, no per-hotel image loop
 * (the part that took ~45s) — fits inside the chat turn's 60s budget, so we seed INLINE and the same
 * runAssembly call then returns preview cards. No async/background work (and `unstable_after` isn't
 * available in Next 14.2.35).
 *
 * Cost/abuse controls:
 *   - Feature flag PREVIEW_RUNTIME_SEED (off by default) — the caller checks it.
 *   - Seed-ONCE: a `preview_seeds` latch row with status='done' means never re-seed.
 *   - Concurrency latch: claiming 'running' via an atomic INSERT; a racing request fails the insert →
 *     'in_progress' (no second paid seed).
 *
 * Same RouteStack-first, no-LLM, grounded pipeline as 12i-B — nothing fabricated. Server-side only. */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { seedPreviewFromRouteStack } from './verify';
import type { BookingDeps } from '@/lib/booking/routestack';

export type EnsureSeedOutcome =
  | { state: 'seeded'; staged: number } // we ran the seed; rows now exist
  | { state: 'already_seeded' } // a prior seed is done — rows already exist
  | { state: 'in_progress' } // another request is mid-seed — don't double-spend
  | { state: 'empty' } // RouteStack returned nothing for this destination
  | { state: 'failed'; reason: string };

/** True when runtime seeding is enabled (founder gate). Off by default. */
export function runtimeSeedEnabled(): boolean {
  return process.env.PREVIEW_RUNTIME_SEED === '1';
}

/** Ensure a destination has preview hotels, seeding on the fly (once) if not. Idempotent + race-safe
 * via the `preview_seeds` latch. Caller should only invoke this when the DB has 0 hotels for the
 * destination AND runtimeSeedEnabled(). */
export async function ensurePreviewSeed(
  client: SupabaseClient,
  destination: string,
  deps: BookingDeps,
  opts: { limit?: number } = {},
): Promise<EnsureSeedOutcome> {
  // Latch state first.
  const { data: existing } = await client
    .from('preview_seeds')
    .select('status')
    .eq('destination', destination)
    .maybeSingle();

  if (existing?.status === 'done') return { state: 'already_seeded' };
  if (existing?.status === 'running') return { state: 'in_progress' };

  // Claim the latch with an atomic INSERT. If another request already inserted (race), this errors on
  // the PK conflict → treat as in_progress (they're seeding; we don't double-spend).
  if (!existing) {
    const { error: claimErr } = await client.from('preview_seeds').insert({ destination, status: 'running' });
    if (claimErr) return { state: 'in_progress' };
  } else {
    // existing.status === 'failed' → retry: flip it back to running.
    const { error: claimErr } = await client
      .from('preview_seeds')
      .update({ status: 'running', error: null, started_at: new Date().toISOString(), finished_at: null })
      .eq('destination', destination)
      .eq('status', 'failed');
    if (claimErr) return { state: 'in_progress' };
  }

  // Run the FAST seed inline (one search call; images deferred → placeholder).
  try {
    const res = await seedPreviewFromRouteStack(client, destination, deps, { fast: true, limit: opts.limit });
    await client
      .from('preview_seeds')
      .update({ status: 'done', hotel_count: res.staged, finished_at: new Date().toISOString() })
      .eq('destination', destination);
    if (res.staged === 0) return { state: 'empty' };
    return { state: 'seeded', staged: res.staged };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    try {
      await client
        .from('preview_seeds')
        .update({ status: 'failed', error: reason, finished_at: new Date().toISOString() })
        .eq('destination', destination);
    } catch {
      /* best-effort — the seed already failed; don't mask the real reason */
    }
    return { state: 'failed', reason };
  }
}
