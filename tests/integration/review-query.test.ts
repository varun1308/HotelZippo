/* Phase 2 integration (spec 02 / 08a-5): the consumption contract against local
 * Supabase. Seeds controlled hotels + intelligence rows under an otherwise-unused
 * destination (Singapore) so the assertions are isolated from the demo seed data.
 * Covers: low_confidence excluded, review_count_total=0 excluded, evaluate_only
 * branch, budget→price_tier map, all-`none` family-signal drop, top-15 sort/limit,
 * hard_flags passthrough. */
import { serviceClient } from './helpers';
import { queryCandidates, type QueryInput } from '@/lib/review-intelligence/query';

jest.setTimeout(30_000);
const admin = serviceClient();
const DEST = 'Singapore';

interface SeedSpec {
  name: string;
  price_tier?: 'mid-range' | 'luxury' | 'ultra-luxury';
  star_rating?: 3 | 4 | 5;
  low_confidence?: boolean;
  review_count_total?: number;
  review_count_family?: number;
  family_signal_strength?: Record<'rooms' | 'facilities' | 'food' | 'location', 'strong' | 'thin' | 'none'> | null;
  hard_flags?: Array<{ category: string; description: string; severity: 'moderate' | 'severe' }>;
}

const ALL_STRONG = { rooms: 'strong', facilities: 'strong', food: 'strong', location: 'strong' } as const;
const ALL_NONE = { rooms: 'none', facilities: 'none', food: 'none', location: 'none' } as const;

async function cleanup() {
  const { data } = await admin.from('hotels').select('id').eq('destination', DEST);
  for (const h of data ?? []) await admin.from('hotel_intelligence').delete().eq('hotel_id', h.id);
  await admin.from('hotels').delete().eq('destination', DEST);
}

async function seed(specs: SeedSpec[]) {
  for (const s of specs) {
    const { data: hotel, error } = await admin
      .from('hotels')
      .insert({
        name: s.name,
        destination: DEST,
        price_tier: s.price_tier ?? 'luxury',
        star_rating: s.star_rating ?? 5,
      })
      .select('id')
      .single();
    if (error) throw error;
    const { error: iErr } = await admin.from('hotel_intelligence').insert({
      hotel_id: hotel.id,
      low_confidence: s.low_confidence ?? false,
      review_count_total: s.review_count_total ?? 1000,
      review_count_family: s.review_count_family ?? 100,
      family_signal_strength: s.family_signal_strength === undefined ? ALL_STRONG : s.family_signal_strength,
      hard_flags: s.hard_flags ?? [],
    });
    if (iErr) throw iErr;
  }
}

beforeEach(cleanup);
afterAll(cleanup);

const base: QueryInput = { destination: DEST, evaluateOnly: false, budgetTier: null };

describe('queryCandidates — consumption contract', () => {
  it('excludes low_confidence and review_count_total=0 rows', async () => {
    await seed([
      { name: 'Good Hotel' },
      { name: 'Low Confidence Hotel', low_confidence: true },
      { name: 'Zero Reviews Hotel', review_count_total: 0 },
    ]);
    const out = await queryCandidates(admin, base);
    expect(out.map((c) => c.hotel.name)).toEqual(['Good Hotel']);
  });

  it('passes hard_flags through untouched', async () => {
    await seed([
      {
        name: 'Flagged Hotel',
        hard_flags: [{ category: 'refurbishment', description: 'severe works', severity: 'severe' }],
      },
    ]);
    const out = await queryCandidates(admin, base);
    expect(out).toHaveLength(1);
    expect(out[0].hard_flags[0]).toMatchObject({ category: 'refurbishment', severity: 'severe' });
  });

  it('drops hotels with family_signal_strength none across all four categories', async () => {
    await seed([
      { name: 'Family Hotel', family_signal_strength: ALL_STRONG },
      { name: 'All None Hotel', family_signal_strength: ALL_NONE },
      { name: 'Partial Signal Hotel', family_signal_strength: { ...ALL_NONE, rooms: 'thin' } },
    ]);
    const out = await queryCandidates(admin, base);
    const names = out.map((c) => c.hotel.name).sort();
    expect(names).toEqual(['Family Hotel', 'Partial Signal Hotel']);
  });

  it('applies the budget→price_tier map (value → mid-range only)', async () => {
    await seed([
      { name: 'Mid Hotel', price_tier: 'mid-range' },
      { name: 'Lux Hotel', price_tier: 'luxury' },
      { name: 'Ultra Hotel', price_tier: 'ultra-luxury' },
    ]);
    const value = await queryCandidates(admin, { ...base, budgetTier: 'value' });
    expect(value.map((c) => c.hotel.name)).toEqual(['Mid Hotel']);

    const comfort = await queryCandidates(admin, { ...base, budgetTier: 'comfort' });
    expect(comfort.map((c) => c.hotel.name).sort()).toEqual(['Lux Hotel', 'Mid Hotel']);

    const luxury = await queryCandidates(admin, { ...base, budgetTier: 'luxury' });
    expect(luxury.map((c) => c.hotel.name).sort()).toEqual(['Lux Hotel', 'Ultra Hotel']);
  });

  it('sorts by review_count_family desc and takes top 15', async () => {
    const specs: SeedSpec[] = Array.from({ length: 18 }, (_, i) => ({
      name: `Hotel ${String(i).padStart(2, '0')}`,
      review_count_family: i * 10, // 0..170
    }));
    await seed(specs);
    const out = await queryCandidates(admin, base);
    expect(out).toHaveLength(15);
    // top by family reviews first; the 3 lowest (0,10,20) dropped.
    expect(out[0].review_count_family).toBe(170);
    expect(out[14].review_count_family).toBe(30);
    // sorted strictly descending
    const counts = out.map((c) => c.review_count_family);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  describe('evaluate_only branch', () => {
    it('restricts to pre_shortlisted_hotels by normalised name; no budget/family filter', async () => {
      await seed([
        { name: 'Raffles Hotel Singapore', price_tier: 'ultra-luxury' },
        { name: 'Marina Bay Sands', price_tier: 'ultra-luxury', family_signal_strength: ALL_NONE },
        { name: 'Not Shortlisted Hotel' },
      ]);
      const out = await queryCandidates(admin, {
        destination: DEST,
        evaluateOnly: true,
        // punctuation/spacing differs — normalised match must still hit.
        preShortlistedHotels: ['raffles  hotel, singapore', 'Marina Bay Sands'],
        budgetTier: 'value', // must be IGNORED in evaluate_only
      });
      const names = out.map((c) => c.hotel.name).sort();
      // Marina Bay Sands is all-none family signal + ultra-luxury, but evaluate_only keeps it.
      expect(names).toEqual(['Marina Bay Sands', 'Raffles Hotel Singapore']);
    });
  });
});
