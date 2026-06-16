/* Preview seeding step 2 — verifyAndStage (lib/preview/verify). RouteStack is ground truth: only
 * proposed names that appear in the (faked) search-hotels inventory are kept + upserted as
 * source='preview'. Faked RouteStack transport + faked Supabase upsert (no DB, no network). */
import { verifyAndStage } from '@/lib/preview/verify';
import type { ProposedHotel } from '@/lib/preview/propose';
import { makeMockFetch, FIXED_NOW, FIXED_NONCE } from '@/tests/fixtures/routestack';
import type { SupabaseClient } from '@supabase/supabase-js';

const ENV = { ROUTESTACK_API_KEY: 'rs_test_key', ROUTESTACK_API_SECRET: 'shhh', ROUTESTACK_API_URL: 'https://evolvemcp.routestack.ai' };
const savedEnv = { ...process.env };
beforeEach(() => Object.assign(process.env, ENV));
afterEach(() => {
  process.env = { ...savedEnv };
});

// search-hotels inventory the fake RouteStack returns (Bali-ish). Two real hotels.
const SEARCH = {
  success: true,
  message: null,
  code: 200,
  result: {
    correlationId: 'corr-x',
    token: 'tok-x',
    currency: 'USD',
    count: 2,
    result: [
      { id: 'RS-1', name: 'Mulia Resort', starRating: 5, ourprice: 400 },
      { id: 'RS-2', name: 'Padma Resort Legian', starRating: 4, ourprice: 250 },
    ],
  },
};

const DATES = { checkIn: '2026-08-01', checkOut: '2026-08-04' };

/** Minimal Supabase fake capturing the hotels upsert. */
function fakeClient() {
  const upserts: { rows: unknown[]; onConflict?: string }[] = [];
  const client = {
    from(_t: string) {
      return {
        upsert(rows: unknown[], optsArg: { onConflict?: string }) {
          upserts.push({ rows, onConflict: optsArg?.onConflict });
          return Promise.resolve({ error: null, count: (rows as unknown[]).length });
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, upserts };
}

const deps = (fetchImpl: ReturnType<typeof makeMockFetch>['fetchImpl']) => ({ fetchImpl, now: FIXED_NOW, nonce: FIXED_NONCE });

describe('verifyAndStage', () => {
  it('keeps only proposals RouteStack returns; stages them as source=preview', async () => {
    const { fetchImpl } = makeMockFetch({ '/mcp/hotel/search-hotels': SEARCH });
    const { client, upserts } = fakeClient();
    const proposals: ProposedHotel[] = [
      { name: 'Mulia Resort', oneLineWhy: 'a' }, // real → kept
      { name: 'Imaginary Palace', oneLineWhy: 'b' }, // not in inventory → dropped
      { name: 'Padma Resort Legian', oneLineWhy: 'c' }, // real → kept
    ];
    const res = await verifyAndStage(client, 'Bali', proposals, deps(fetchImpl), { dates: DATES });

    expect(res.proposed).toBe(3);
    expect(res.verified.map((v) => v.name).sort()).toEqual(['Mulia Resort', 'Padma Resort Legian']);
    expect(res.dropped).toEqual(['Imaginary Palace']);
    expect(res.staged).toBe(2);

    // Upsert targets the (name,destination) key and every row is source='preview'.
    expect(upserts).toHaveLength(1);
    expect(upserts[0].onConflict).toBe('name,destination');
    const rows = upserts[0].rows as Array<{ source: string; destination: string; price_tier: string; star_rating: number | null }>;
    expect(rows.every((r) => r.source === 'preview' && r.destination === 'Bali')).toBe(true);
    // 5★ → luxury tier; 4★ → mid-range (conservative; never auto ultra-luxury).
    const mulia = rows.find((r) => r.star_rating === 5);
    expect(mulia?.price_tier).toBe('luxury');
  });

  it('matches near-names via contains, but drops genuine mismatches', async () => {
    const { fetchImpl } = makeMockFetch({ '/mcp/hotel/search-hotels': SEARCH });
    const { client } = fakeClient();
    const res = await verifyAndStage(
      client,
      'Bali',
      [{ name: 'Mulia', oneLineWhy: 'partial' }, { name: 'Totally Different', oneLineWhy: 'x' }],
      deps(fetchImpl),
      { dates: DATES },
    );
    expect(res.verified.map((v) => v.name)).toEqual(['Mulia Resort']); // contains-match
    expect(res.dropped).toEqual(['Totally Different']);
  });

  it('stages nothing when no proposal matches', async () => {
    const { fetchImpl } = makeMockFetch({ '/mcp/hotel/search-hotels': SEARCH });
    const { client, upserts } = fakeClient();
    const res = await verifyAndStage(client, 'Bali', [{ name: 'Nope', oneLineWhy: 'x' }], deps(fetchImpl), { dates: DATES });
    expect(res.staged).toBe(0);
    expect(upserts).toHaveLength(0); // no upsert call when nothing verified
  });
});
