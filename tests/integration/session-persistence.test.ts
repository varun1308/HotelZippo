/* Phase 5 (specs/08b-3-session-snapshot.md): the PERSIST + LOAD sides of session memory,
 * run AS a real signed-in user so writes go through RLS (auth.uid() = user_id). Covers:
 * saveSnapshot writes session_summary + last_active; loadLatestSnapshot returns the most
 * recent by last_active; a rolling single session (re-save updates in place, no row
 * accumulation); a brand-new user with no session resolves to null (fresh onboarding). */
import { createTestUser, deleteTestUser, serviceClient, type TestUser } from './helpers';
import { saveSnapshot, loadLatestSnapshot } from '@/lib/db/persistence/sessions';

jest.setTimeout(30_000);

let user: TestUser;
beforeAll(async () => {
  user = await createTestUser('session');
});
afterAll(async () => {
  if (user) await deleteTestUser(user.id);
});

describe('session snapshot persistence', () => {
  it('returns null for a user with no session yet (fresh onboarding)', async () => {
    const snap = await loadLatestSnapshot(user.client);
    expect(snap).toBeNull();
  });

  it('saves a snapshot and loads it back', async () => {
    await saveSnapshot(user.client, user.id, 'Trip brief — partial. Destination: Phuket.');
    const snap = await loadLatestSnapshot(user.client);
    expect(snap).toBe('Trip brief — partial. Destination: Phuket.');
  });

  it('rolls a single session in place — re-save updates, does not accumulate rows', async () => {
    await saveSnapshot(user.client, user.id, 'first');
    await saveSnapshot(user.client, user.id, 'second');

    const { data } = await serviceClient().from('sessions').select('id').eq('user_id', user.id);
    expect(data).toHaveLength(1);

    const snap = await loadLatestSnapshot(user.client);
    expect(snap).toBe('second');
  });

  it('loadLatestSnapshot returns the most recent by last_active', async () => {
    // The rolling-session design keeps one row, but loadLatest must still order by
    // last_active so "most recent" is well-defined even if extra rows ever exist.
    const admin = serviceClient();
    await admin.from('sessions').delete().eq('user_id', user.id);
    await admin
      .from('sessions')
      .insert({ user_id: user.id, session_summary: 'older', last_active: '2026-01-01T00:00:00Z' });
    await admin
      .from('sessions')
      .insert({ user_id: user.id, session_summary: 'newer', last_active: '2026-06-05T00:00:00Z' });

    const snap = await loadLatestSnapshot(user.client);
    expect(snap).toBe('newer');
  });

  it('a blank/whitespace summary resolves to null (treated as no snapshot)', async () => {
    const admin = serviceClient();
    await admin.from('sessions').delete().eq('user_id', user.id);
    await admin.from('sessions').insert({ user_id: user.id, session_summary: '   ' });
    expect(await loadLatestSnapshot(user.client)).toBeNull();
  });
});
