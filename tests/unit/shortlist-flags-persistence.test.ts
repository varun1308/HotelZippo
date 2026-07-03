/* M14 — hard flags survive into the persisted shortlist (spec 05 §6 flag dots).
 * loadShortlistHotels re-hydrates flag severities from `hotel_intelligence` (the same
 * reference-readable source the assembly uses). Backward compatible: hotels without an
 * intelligence row — or a failed intelligence read — get no dots, never a broken row. */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadShortlistHotels, shortlistShareUrl } from '@/lib/db/persistence/shortlists';

const HOTEL_ROWS = [
  { id: 'h1', name: 'Anantara Mai Khao', destination: 'Phuket', area: 'Mai Khao', price_tier: 'luxury', images: [] },
  { id: 'h2', name: 'Komaneka Bisma', destination: 'Bali', area: null, price_tier: 'mid-range', images: [] },
];

/** Minimal stub of the three reads loadShortlistHotels performs. */
function stubClient(opts: { intelligence?: unknown[]; intelligenceError?: boolean }): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'shortlists') {
        return {
          select: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: { hotel_ids: ['h1', 'h2'] }, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'hotels') {
        return { select: () => ({ in: async () => ({ data: HOTEL_ROWS, error: null }) }) };
      }
      if (table === 'hotel_intelligence') {
        return {
          select: () => ({
            in: async () =>
              opts.intelligenceError
                ? { data: null, error: { message: 'nope' } }
                : { data: opts.intelligence ?? [], error: null },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe('loadShortlistHotels — hard-flag re-hydration', () => {
  it('carries flag severities from hotel_intelligence onto the saved rows', async () => {
    const client = stubClient({
      intelligence: [
        {
          hotel_id: 'h1',
          hard_flags: [
            { category: 'pool safety', description: 'unfenced pool', severity: 'severe' },
            { category: 'construction', description: 'wing refurb', severity: 'moderate' },
          ],
        },
      ],
    });
    const rows = await loadShortlistHotels(client);
    expect(rows).toHaveLength(2);
    expect(rows[0].hotelId).toBe('h1');
    expect(rows[0].hardFlags).toEqual([{ severity: 'severe' }, { severity: 'moderate' }]);
    // h2 has no intelligence row → no dots (legacy/clean compat).
    expect(rows[1].hardFlags).toEqual([]);
  });

  it('degrades warmly when the intelligence read fails — rows load, just no dots', async () => {
    const rows = await loadShortlistHotels(stubClient({ intelligenceError: true }));
    expect(rows).toHaveLength(2);
    expect(rows[0].hardFlags).toEqual([]);
    expect(rows[1].hardFlags).toEqual([]);
  });

  it('ignores malformed hard_flags payloads (never a broken shortlist)', async () => {
    const client = stubClient({
      intelligence: [
        { hotel_id: 'h1', hard_flags: 'not-an-array' },
        { hotel_id: 'h2', hard_flags: [{ severity: 'weird' }, null, { severity: 'moderate' }] },
      ],
    });
    const rows = await loadShortlistHotels(client);
    expect(rows[0].hardFlags).toEqual([]);
    expect(rows[1].hardFlags).toEqual([{ severity: 'moderate' }]);
  });
});

describe('shortlistShareUrl', () => {
  it('renders the canonical share link from the share_token capability', () => {
    expect(shortlistShareUrl('tok_abc', 'https://hotelzippo.example')).toBe(
      'https://hotelzippo.example/shortlist/shared/tok_abc',
    );
    // trailing-slash origins normalise
    expect(shortlistShareUrl('t', 'http://localhost:3000/')).toBe(
      'http://localhost:3000/shortlist/shared/t',
    );
  });
});
