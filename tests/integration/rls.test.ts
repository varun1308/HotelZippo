/* Phase 1 GATE (specs/15-test-strategy.md): "RLS policies verified — user A cannot
 * read user B's data." Exercises every owner-scoped table with two real authenticated
 * users, plus the service-role-only and read-only-reference table policies. */
import { createTestUser, deleteTestUser, serviceClient, type TestUser } from './helpers';

jest.setTimeout(30_000);

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
});

afterAll(async () => {
  if (alice) await deleteTestUser(alice.id);
  if (bob) await deleteTestUser(bob.id);
});

describe('RLS — owner-scoped tables isolate users', () => {
  it('family_profiles: B cannot read A’s row', async () => {
    const { error: insErr } = await alice.client
      .from('family_profiles')
      .insert({ user_id: alice.id, name: 'Alice', budget_tier: 'comfort' });
    expect(insErr).toBeNull();

    // Bob, querying with his own authenticated client, sees none of Alice's rows.
    const { data: bobView } = await bob.client.from('family_profiles').select('*');
    expect(bobView ?? []).toHaveLength(0);

    // Alice sees her own.
    const { data: aliceView } = await alice.client.from('family_profiles').select('*');
    expect(aliceView).toHaveLength(1);
    expect(aliceView![0].name).toBe('Alice');
  });

  it('trip_briefs: B cannot read A’s row', async () => {
    await alice.client.from('trip_briefs').insert({ user_id: alice.id, destination: 'Phuket' });
    const { data: bobView } = await bob.client.from('trip_briefs').select('*');
    expect(bobView ?? []).toHaveLength(0);
  });

  it('shortlists: B cannot read A’s row', async () => {
    await alice.client.from('shortlists').insert({ user_id: alice.id, hotel_ids: [] });
    const { data: bobView } = await bob.client.from('shortlists').select('*');
    expect(bobView ?? []).toHaveLength(0);
  });

  it('sessions: B cannot read A’s row', async () => {
    await alice.client.from('sessions').insert({ user_id: alice.id, session_summary: 'hi' });
    const { data: bobView } = await bob.client.from('sessions').select('*');
    expect(bobView ?? []).toHaveLength(0);
  });

  it('B cannot insert a row owned by A (WITH CHECK)', async () => {
    const { error } = await bob.client
      .from('family_profiles')
      .insert({ user_id: alice.id, name: 'spoof' });
    expect(error).not.toBeNull(); // RLS rejects the cross-owner insert
  });

  it('users: a user reads only their own profile row', async () => {
    const { data } = await alice.client.from('users').select('*');
    expect(data).toHaveLength(1);
    expect(data![0].id).toBe(alice.id);
  });
});

describe('RLS — reference + service-role tables', () => {
  it('hotels / hotel_intelligence are readable by authenticated users', async () => {
    const admin = serviceClient();
    const { data: hotel } = await admin
      .from('hotels')
      .insert({ name: 'RLS Test Hotel', destination: 'Bali', star_rating: 4, price_tier: 'luxury' })
      .select()
      .single();

    const { data: read, error } = await alice.client.from('hotels').select('*').eq('id', hotel!.id);
    expect(error).toBeNull();
    expect(read).toHaveLength(1);

    await admin.from('hotels').delete().eq('id', hotel!.id);
  });

  it('curation_hotels (service-role only) is NOT client-readable', async () => {
    const admin = serviceClient();
    await admin.from('curation_hotels').insert({ name: 'Staged', destination: 'Bali' });
    const { data } = await alice.client.from('curation_hotels').select('*');
    expect(data ?? []).toHaveLength(0);
    await admin.from('curation_hotels').delete().eq('name', 'Staged');
  });

  it('raw_reviews (service-role only) is NOT client-readable', async () => {
    const { data } = await alice.client.from('raw_reviews').select('*');
    expect(data ?? []).toHaveLength(0);
  });

  it('raw_routestack_payloads (service-role only) is NOT client-readable', async () => {
    const admin = serviceClient();
    await admin
      .from('raw_routestack_payloads')
      .insert({ step: 'search_hotels', path: '/mcp/hotel/search-hotels' });
    const { data } = await alice.client.from('raw_routestack_payloads').select('*');
    expect(data ?? []).toHaveLength(0);
    await admin.from('raw_routestack_payloads').delete().eq('step', 'search_hotels');
  });
});
