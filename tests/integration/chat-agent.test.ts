/* Phase 3c integration: the agent's hotel-hydration step against local Supabase.
 * Hydration (spec 03b card mapping) attaches `_hotel` metadata to each pick by
 * hotel_id so the client renders cards without a DB round-trip. Seeds its OWN hotel so
 * the assertion always runs (independent of the demo publish/seed). The full streamText
 * tool loop is covered by the route NDJSON-translation test + the mapper/contract tests
 * — we don't mock the raw provider v3 stream protocol (brittle across SDK versions). */
import { serviceClient } from './helpers';
import { hydrateHotels } from '@/lib/chat/agent';
import type { RecommendationAssembly } from '@/lib/contracts/recommendation-assembly';

jest.setTimeout(30_000);
const admin = serviceClient();

const HOTEL = 'Chat Agent Test Resort';
const DEST = 'Phuket';

async function cleanup() {
  const { data } = await admin.from('hotels').select('id').eq('name', HOTEL).eq('destination', DEST);
  for (const h of data ?? []) await admin.from('hotel_intelligence').delete().eq('hotel_id', h.id);
  await admin.from('hotels').delete().eq('name', HOTEL).eq('destination', DEST);
}
beforeAll(cleanup);
afterAll(cleanup);

async function seedHotel(): Promise<string> {
  const { data, error } = await admin
    .from('hotels')
    .insert({
      name: HOTEL,
      destination: DEST,
      area: 'Mai Khao Beach',
      price_tier: 'luxury',
      star_rating: 5,
      images: ['https://cdn.test/chat-agent-hero.jpg'],
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

function assemblyJson(hotelId: string): RecommendationAssembly {
  return {
    top_pick: {
      hotel_id: hotelId,
      hotel_name: HOTEL,
      verdict: 'This is the one I would book for your family.',
      category_summaries: { rooms: 'r', facilities: 'f', food: 'fo', location: 'l' },
      hard_flags: [],
      brand_note: null,
      supporting_phrases: { rooms: [], facilities: [], food: [], location: [] },
      why_top_pick: 'strongest family signal',
    },
    other_picks: [],
    recommendation_notes: null,
    evaluate_only_applied: false,
    alternatives_introduced: false,
  };
}

describe('agent hotel hydration (spec 03b)', () => {
  it('attaches _hotel display metadata by hotel_id', async () => {
    const id = await seedHotel();
    const hydrated = await hydrateHotels(admin, assemblyJson(id));
    if ('error' in hydrated) throw new Error('expected a success variant');
    const hyd = hydrated.top_pick as {
      _hotel?: { destination?: string; area?: string | null; star_rating?: number; images?: string[] } | null;
    };
    expect(hyd._hotel).toBeTruthy();
    expect(hyd._hotel?.destination).toBe('Phuket');
    expect(hyd._hotel?.area).toBe('Mai Khao Beach');
    expect(hyd._hotel?.star_rating).toBe(5);
    expect(hyd._hotel?.images?.[0]).toMatch(/chat-agent-hero/);
  });

  it('passes error variants through untouched (no hydration)', async () => {
    const err = await hydrateHotels(admin, { error: 'no_eligible_hotels', reason: 'x' });
    expect('error' in err).toBe(true);
  });

  it('tolerates unknown hotel_ids (leaves _hotel null)', async () => {
    const hydrated = await hydrateHotels(admin, assemblyJson('00000000-0000-0000-0000-0000000000ff'));
    if ('error' in hydrated) throw new Error('expected a success variant');
    expect((hydrated.top_pick as { _hotel?: unknown })._hotel).toBeNull();
  });
});
