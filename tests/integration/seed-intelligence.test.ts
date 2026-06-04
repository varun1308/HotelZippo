/* Phase 1c integration (12e): demo-intelligence seeding against local Supabase.
 * happy path → row in hotel_intelligence with low_confidence=false; idempotency
 * (run twice → no dupes, unique(hotel_id)); fail-loud when the named hotel is not
 * yet published. Uses a temp demo dir so we don't depend on founder-authored files. */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serviceClient } from './helpers';
import { seedIntelligence, SeedError } from '@/lib/seed/seed-intelligence';

jest.setTimeout(30_000);
const admin = serviceClient();
const DEST = 'Phuket';
const HOTEL = 'Seed Test JW Marriott';

function record(hotel_name: string) {
  return {
    hotel_name,
    destination: DEST,
    rooms_summary: 'rooms',
    facilities_summary: 'facilities',
    food_summary: 'food',
    location_summary: 'location',
    hard_flags: [
      { category: 'refurbishment', description: 'wing refurb', severity: 'moderate', review_evidence_count: 9 },
    ],
    conflicting_signals: { rooms: '', facilities: '', food: '', location: '' },
    family_signal_strength: { rooms: 'strong', facilities: 'strong', food: 'thin', location: 'strong' },
    supporting_phrases: { rooms: [], facilities: [], food: [], location: [] },
    indian_food_signal: 'Indian options available',
    review_count_family: 100,
    review_count_total: 1000,
  };
}

let dir: string;

async function cleanup() {
  // hotel_intelligence cascades on hotel delete; delete the hotel by name+dest.
  const { data } = await admin.from('hotels').select('id').eq('name', HOTEL).eq('destination', DEST);
  for (const h of data ?? []) {
    await admin.from('hotel_intelligence').delete().eq('hotel_id', h.id);
  }
  await admin.from('hotels').delete().eq('name', HOTEL).eq('destination', DEST);
}

beforeEach(async () => {
  await cleanup();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'demo-intel-int-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  await cleanup();
});

async function writeRecord(name: string, hotel_name: string) {
  await fs.writeFile(path.join(dir, name), JSON.stringify(record(hotel_name)), 'utf8');
}

async function publishHotel(): Promise<string> {
  const { data, error } = await admin
    .from('hotels')
    .insert({ name: HOTEL, destination: DEST, star_rating: 5, brand: 'Marriott' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

describe('seedIntelligence', () => {
  it('fails loudly when the named hotel is not published (no rows written)', async () => {
    await writeRecord('jw.json', HOTEL);
    await expect(seedIntelligence(admin, dir)).rejects.toBeInstanceOf(SeedError);
    await expect(seedIntelligence(admin, dir)).rejects.toMatchObject({ code: 'hotels_not_published' });
  });

  it('seeds an intelligence row for a published hotel with low_confidence=false', async () => {
    const hotelId = await publishHotel();
    await writeRecord('jw.json', HOTEL);

    const result = await seedIntelligence(admin, dir);
    expect(result.written).toBe(1);
    expect(result.skipped).toBe(0);

    const { data } = await admin
      .from('hotel_intelligence')
      .select('*')
      .eq('hotel_id', hotelId)
      .single();
    expect(data).toBeTruthy();
    expect(data!.low_confidence).toBe(false);
    expect(data!.indian_food_signal).toMatch(/Indian/);
    expect(Array.isArray(data!.hard_flags)).toBe(true);
    expect(data!.hard_flags[0].severity).toBe('moderate');
    expect(data!.review_count_total).toBe(1000);
  });

  it('is idempotent — running twice leaves a single row (unique hotel_id)', async () => {
    const hotelId = await publishHotel();
    await writeRecord('jw.json', HOTEL);

    await seedIntelligence(admin, dir);
    await seedIntelligence(admin, dir);

    const { data } = await admin.from('hotel_intelligence').select('id').eq('hotel_id', hotelId);
    expect(data).toHaveLength(1);
  });

  it('fails loudly with no_files on an empty demo dir', async () => {
    await expect(seedIntelligence(admin, dir)).rejects.toMatchObject({ code: 'no_files' });
  });
});
