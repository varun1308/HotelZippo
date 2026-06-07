/* Phase 4 (specs/04-auth-persistence.md Stage 4): persistence round-trip for the
 * user-owned tables, executed AS a real signed-in user so the writes go through RLS
 * (auth.uid() = user_id) exactly as they will in the browser. Covers family_profiles
 * (upsert one-per-user + camelCase↔snake_case mapping), shortlists (save + load hotel
 * ids, stable share_token), trip_briefs (insert, user-scoped), and sessions. */
import { createTestUser, deleteTestUser, serviceClient, type TestUser } from './helpers';
import {
  saveFamilyProfile,
  loadFamilyProfile,
  toRow,
  fromRow,
} from '@/lib/db/persistence/family-profiles';
import {
  saveShortlist,
  loadShortlistHotelIds,
  loadShortlistHotels,
} from '@/lib/db/persistence/shortlists';
import type { FamilyProfile } from '@/components/profile';

jest.setTimeout(30_000);

let user: TestUser;
beforeAll(async () => {
  user = await createTestUser('persist');
});
afterAll(async () => {
  if (user) await deleteTestUser(user.id);
});

const profile: FamilyProfile = {
  name: 'Raj',
  hometown: 'Mumbai',
  spouse: true,
  children: [
    { name: 'Aanya', age: 7 },
    { name: 'Vivaan', age: 2 },
  ],
  food: 'vegetarian',
  indianFoodMatters: true,
  budgetTier: 'luxury',
  brandPreferences: ['Marriott Bonvoy'],
  notes: 'Calm beach, shallow water.',
};

describe('family_profiles persistence', () => {
  it('maps camelCase ↔ snake_case losslessly (toRow → fromRow)', () => {
    const round = fromRow(toRow(profile, user.id));
    expect(round).toEqual(profile);
  });

  it('saves and loads one profile per user (upsert on user_id)', async () => {
    await saveFamilyProfile(profile, user.id, user.client);
    const loaded = await loadFamilyProfile(user.client);
    expect(loaded).toEqual(profile);

    // Re-save with an edit → still exactly one row (upsert, not insert).
    await saveFamilyProfile({ ...profile, budgetTier: 'comfort' }, user.id, user.client);
    const { data } = await serviceClient()
      .from('family_profiles')
      .select('id')
      .eq('user_id', user.id);
    expect(data).toHaveLength(1);

    const reloaded = await loadFamilyProfile(user.client);
    expect(reloaded?.budgetTier).toBe('comfort');
  });
});

describe('shortlists persistence', () => {
  it('saves hotel ids and loads them back, with a stable share_token', async () => {
    // Two real hotels (reference data, service-role inserted) to reference by id.
    const admin = serviceClient();
    const { data: hotels } = await admin
      .from('hotels')
      .insert([
        { name: 'Persist Hotel A', destination: 'Bali', star_rating: 5, price_tier: 'luxury' },
        { name: 'Persist Hotel B', destination: 'Bali', star_rating: 4, price_tier: 'luxury' },
      ])
      .select('id');
    const ids = (hotels ?? []).map((h) => h.id as string);

    try {
      const { shareToken } = await saveShortlist(ids, user.id, { client: user.client });
      expect(shareToken).toBeTruthy();

      const loaded = await loadShortlistHotelIds(user.client);
      expect(loaded.sort()).toEqual([...ids].sort());

      // Updating the set keeps the same share_token (stable working shortlist).
      const { shareToken: token2 } = await saveShortlist([ids[0]], user.id, { client: user.client });
      expect(token2).toBe(shareToken);
      const loaded2 = await loadShortlistHotelIds(user.client);
      expect(loaded2).toEqual([ids[0]]);
    } finally {
      await admin.from('hotels').delete().in('id', ids);
    }
  });

  it('re-hydrates display-ready SavedHotel rows in saved order (the reload-survives path)', async () => {
    const admin = serviceClient();
    const { data: hotels } = await admin
      .from('hotels')
      .insert([
        {
          name: 'Rehydrate A',
          destination: 'Phuket',
          area: 'Patong',
          star_rating: 5,
          price_tier: 'luxury',
          images: ['https://example.test/a.jpg'],
        },
        {
          name: 'Rehydrate B',
          destination: 'Phuket',
          area: 'Kata',
          star_rating: 4,
          price_tier: 'mid-range',
          images: [],
        },
      ])
      .select('id');
    const ids = (hotels ?? []).map((h) => h.id as string);

    try {
      // Save in B,A order — re-hydration must preserve the SAVED order, not the DB order.
      await saveShortlist([ids[1], ids[0]], user.id, { client: user.client });

      const rows = await loadShortlistHotels(user.client);
      expect(rows.map((r) => r.hotelName)).toEqual(['Rehydrate B', 'Rehydrate A']);
      // Display mapping: price tier → label, images[0] → hero, area passed through.
      expect(rows[0]).toMatchObject({
        hotelId: ids[1],
        hotelName: 'Rehydrate B',
        destination: 'Phuket',
        area: 'Kata',
        priceTierLabel: 'Comfort', // 'mid-range' → 'Comfort'
        heroImageUrl: null, // empty images → null (never a broken img)
      });
      expect(rows[1]).toMatchObject({
        priceTierLabel: 'Luxury',
        heroImageUrl: 'https://example.test/a.jpg',
      });
    } finally {
      await admin.from('hotels').delete().in('id', ids);
    }
  });
});

describe('trip_briefs + sessions persistence (user-scoped writes succeed under RLS)', () => {
  it('inserts a trip_brief and a session keyed to the user', async () => {
    const { error: tbErr } = await user.client
      .from('trip_briefs')
      .insert({ user_id: user.id, destination: 'Phuket' });
    expect(tbErr).toBeNull();

    const { error: sErr } = await user.client
      .from('sessions')
      .insert({ user_id: user.id, session_summary: 'first visit' });
    expect(sErr).toBeNull();

    const { data: briefs } = await user.client.from('trip_briefs').select('*');
    expect((briefs ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
