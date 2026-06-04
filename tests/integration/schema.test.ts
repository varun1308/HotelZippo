/* Phase 1 GATE (specs/15-test-strategy.md): "All 10 core tables created with correct
 * schema." Verifies each table exists and that a representative row round-trips through
 * its Zod schema (contract test). Also asserts the curation_hotels staging table exists. */
import { serviceClient } from './helpers';
import {
  coreTableSchemas,
  curationHotelSchema,
  type CoreTableName,
} from '@/lib/db/schemas';

jest.setTimeout(30_000);
const admin = serviceClient();

describe('Phase 1 — all 10 core tables exist and are queryable', () => {
  const tables = Object.keys(coreTableSchemas) as CoreTableName[];
  it.each(tables)('table %s exists', async (table) => {
    const { error } = await admin.from(table).select('*').limit(0);
    expect(error).toBeNull();
  });

  it('curation_hotels staging table exists', async () => {
    const { error } = await admin.from('curation_hotels').select('*').limit(0);
    expect(error).toBeNull();
  });
});

describe('Phase 1 — seeded rows are schema-valid (Zod contract)', () => {
  it('hotels + hotel_intelligence round-trip through their schemas', async () => {
    const { data: hotel, error: hErr } = await admin
      .from('hotels')
      .insert({
        name: 'Schema Test Hotel',
        destination: 'Phuket',
        area: 'Karon Beach',
        star_rating: 5,
        brand: 'Independent',
        price_tier: 'luxury',
        images: ['https://example.test/hero.jpg'],
      })
      .select()
      .single();
    expect(hErr).toBeNull();
    expect(() => coreTableSchemas.hotels.parse(hotel)).not.toThrow();

    const { data: intel, error: iErr } = await admin
      .from('hotel_intelligence')
      .insert({
        hotel_id: hotel!.id,
        rooms_summary: 'Spacious family rooms.',
        facilities_summary: 'Large pool.',
        food_summary: 'Good breakfast.',
        location_summary: 'Beachfront.',
        hard_flags: [
          { category: 'Refurbishment', description: 'Lobby works', severity: 'moderate', review_evidence_count: 4 },
        ],
        family_signal_strength: { rooms: 'strong', facilities: 'strong', food: 'thin', location: 'strong' },
        indian_food_signal: 'Several Indian families noted vegetarian options.',
        review_count_family: 40,
        review_count_total: 320,
        low_confidence: false,
      })
      .select()
      .single();
    expect(iErr).toBeNull();
    expect(() => coreTableSchemas.hotel_intelligence.parse(intel)).not.toThrow();

    // cleanup (cascades to hotel_intelligence via FK)
    await admin.from('hotels').delete().eq('id', hotel!.id);
  });

  it('star_rating outside {3,4,5} is rejected by the DB check constraint', async () => {
    const { error } = await admin
      .from('hotels')
      .insert({ name: 'Bad Stars', destination: 'Bali', star_rating: 2, price_tier: 'mid-range' });
    expect(error).not.toBeNull();
  });

  it('curation_hotels row is schema-valid', async () => {
    const { data, error } = await admin
      .from('curation_hotels')
      .insert({ name: 'Curate Me', destination: 'Bali', review_count: 150, status: 'pending' })
      .select()
      .single();
    expect(error).toBeNull();
    expect(() => curationHotelSchema.parse(data)).not.toThrow();
    await admin.from('curation_hotels').delete().eq('id', data!.id);
  });
});
