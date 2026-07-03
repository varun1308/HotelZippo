/* GET /api/assembly/:jobId — the poll route (specs/03c-async-assembly.md AC2/AC4/AC6) against
 * LOCAL Supabase.
 *
 * Proves the route's contract end-to-end with REAL owner-read RLS: the SSR seam is swapped for a
 * real per-test Supabase client (anon or signed-in), so `auth.uid()` actually gates the SELECT —
 * unlike a stubbed getUser, this catches policy regressions. Covers: 400 (no jobId), the
 * unauthenticated + foreign-user cases (both 404 by design — RLS returns zero rows; the route
 * never distinguishes "not yours" from "missing"), the pending/running response shapes, the
 * pending RE-KICK to /api/assembly/run (fire-and-forget backstop), the succeeded result payload,
 * the failed error_kind, and the stuck-job reclaim branches (stale running → pending re-kick
 * under the attempts cap, → failed(timeout) at the cap).
 *
 * Key-free (no Anthropic — the worker is never actually run: the re-kick fetch is intercepted).
 * Self-seeding; all rows deleted in afterAll. Node project (needs Request/Response). */
import type { SupabaseClient } from '@supabase/supabase-js';

// SSR seam: the route builds its DB client via createSupabaseServerClient(cookies). Swap in a
// REAL client per test (anon / user A / user B) so RLS is enforced for the route's SELECT.
let mockDbClient: SupabaseClient | null = null;
jest.mock('@/lib/db/ssr', () => ({
  createSupabaseServerClient: () => {
    if (!mockDbClient) throw new Error('test forgot to set mockDbClient');
    return mockDbClient;
  },
}));
// cookies() isn't available outside a Next request scope; the mocked SSR client above never
// reads it, but the route still awaits it.
jest.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [] }),
}));

import { createClient } from '@supabase/supabase-js';
import { GET } from '@/app/api/assembly/[jobId]/route';
import { serviceClient, createTestUser, deleteTestUser, type TestUser } from './helpers';

jest.setTimeout(30_000);
const admin = serviceClient();

const HASH = `poll-test-${Date.now()}`;
let seq = 0;

// The re-kick is a fire-and-forget fetch to our own /api/assembly/run. Intercept ONLY that URL
// (recording the kick) and delegate everything else — the Supabase clients' own requests — to
// the real fetch, mirroring curation.test.ts's targeted stub.
const realFetch = global.fetch;
let kicks: Array<{ url: string; jobId: string | undefined }> = [];
beforeAll(() => {
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/assembly/run')) {
      let jobId: string | undefined;
      try {
        jobId = (JSON.parse(String(init?.body)) as { jobId?: string }).jobId;
      } catch {
        /* leave undefined */
      }
      kicks.push({ url, jobId });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return realFetch(input as never, init);
  }) as typeof fetch;
});
afterAll(() => {
  global.fetch = realFetch;
});
beforeEach(() => {
  kicks = [];
  mockDbClient = null;
});

let owner: TestUser;
let stranger: TestUser;
/** Anon-key client with NO session — auth.uid() is null, owner-read RLS hides every job. */
let anonClient: SupabaseClient;

beforeAll(async () => {
  owner = await createTestUser('poll-owner');
  stranger = await createTestUser('poll-stranger');
  anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
});

afterAll(async () => {
  await admin.from('recommendation_jobs').delete().like('input_hash', 'poll-test-%');
  if (owner) await deleteTestUser(owner.id);
  if (stranger) await deleteTestUser(stranger.id);
});

/** Insert a job row for `owner` via the service client (the worker's write path). */
async function insertJob(fields: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin
    .from('recommendation_jobs')
    .insert({
      user_id: owner.id,
      destination: 'Phuket',
      input_hash: `${HASH}-${seq++}`,
      input: {},
      status: 'pending',
      stage: 'queued',
      ...fields,
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('insertJob failed');
  return data.id as string;
}

function get(jobId: string, client: SupabaseClient) {
  mockDbClient = client;
  return GET(new Request(`http://localhost:3000/api/assembly/${jobId}`), {
    params: Promise.resolve({ jobId }),
  });
}

const RESULT_PAYLOAD = {
  top_pick: { hotel_id: 'h-top', hotel_name: 'Mock Top', summary: 's', why_for_you: 'w', hard_flags: ['no pool'] },
  other_picks: [],
  destination: 'Phuket',
};

describe('GET /api/assembly/:jobId — request guards + owner scoping', () => {
  it('400s when jobId is empty', async () => {
    const res = await get('', owner.client);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('jobId required');
  });

  it('404s an unauthenticated caller polling a real job (RLS hides it; by design not a 401)', async () => {
    const jobId = await insertJob();
    const res = await get(jobId, anonClient);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_found');
  });

  it("404s a signed-in user polling ANOTHER user's job (owner-read scoping)", async () => {
    const jobId = await insertJob(); // owned by `owner`
    const res = await get(jobId, stranger.client);
    expect(res.status).toBe(404);
    // ...while the owner CAN read the same job.
    const own = await get(jobId, owner.client);
    expect(own.status).toBe(200);
  });

  it('404s a well-formed but nonexistent jobId', async () => {
    const res = await get(crypto.randomUUID(), owner.client);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/assembly/:jobId — status shapes (AC2/AC4)', () => {
  it('a pending job → { status: pending, stage: queued } and fires the re-kick backstop', async () => {
    const jobId = await insertJob();
    const res = await get(jobId, owner.client);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'pending', stage: 'queued' }); // no result / error_kind keys
    // The re-kick was fired (fire-and-forget, but initiated before the response returned).
    expect(kicks).toHaveLength(1);
    expect(kicks[0].jobId).toBe(jobId);
    expect(kicks[0].url).toBe('http://localhost:3000/api/assembly/run');
  });

  it('a FRESH running job → { status: running, stage } untouched, and NO re-kick', async () => {
    const jobId = await insertJob({
      status: 'running',
      stage: 'checking_intelligence',
      started_at: new Date().toISOString(), // fresh: under the 90s stale budget → no reclaim
      attempts: 1,
    });
    const res = await get(jobId, owner.client);
    const body = await res.json();
    expect(body).toEqual({ status: 'running', stage: 'checking_intelligence' });
    expect(kicks).toHaveLength(0);
  });

  it('a succeeded job returns the persisted result payload intact', async () => {
    const jobId = await insertJob({
      status: 'succeeded',
      stage: 'done',
      result: RESULT_PAYLOAD,
      finished_at: new Date().toISOString(),
    });
    const res = await get(jobId, owner.client);
    const body = await res.json();
    expect(body.status).toBe('succeeded');
    expect(body.stage).toBe('done');
    expect(body.result).toEqual(RESULT_PAYLOAD); // the hydrated card props, verbatim
    expect(body.error_kind).toBeUndefined();
    expect(kicks).toHaveLength(0);
  });

  it('a failed job returns its error_kind (warm-fallback contract, AC4)', async () => {
    const jobId = await insertJob({
      status: 'failed',
      stage: 'writing',
      error_kind: 'model_failed',
      finished_at: new Date().toISOString(),
    });
    const res = await get(jobId, owner.client);
    const body = await res.json();
    expect(body.status).toBe('failed');
    expect(body.error_kind).toBe('model_failed');
    expect(body.result).toBeUndefined();
    expect(kicks).toHaveLength(0);
  });
});

describe('GET /api/assembly/:jobId — stuck-job reclaim', () => {
  const STALE = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // way past the 90s budget

  it('a STALE running job under the attempts cap is reclaimed to pending and re-kicked', async () => {
    const jobId = await insertJob({ status: 'running', stage: 'writing', started_at: STALE, attempts: 1 });
    const res = await get(jobId, owner.client);
    const body = await res.json();
    expect(body.status).toBe('pending');
    expect(kicks).toHaveLength(1); // reclaimed → pending → backstop re-kick
    expect(kicks[0].jobId).toBe(jobId);
    // The reclaim was persisted, not just reported.
    const { data: row } = await admin
      .from('recommendation_jobs')
      .select('status, stage, started_at')
      .eq('id', jobId)
      .single();
    expect(row).toEqual({ status: 'pending', stage: 'queued', started_at: null });
  });

  it('a STALE running job AT the attempts cap → failed(timeout), stage done, no re-kick', async () => {
    const jobId = await insertJob({ status: 'running', stage: 'writing', started_at: STALE, attempts: 2 });
    const res = await get(jobId, owner.client);
    const body = await res.json();
    expect(body.status).toBe('failed');
    expect(body.error_kind).toBe('timeout');
    expect(body.stage).toBe('done'); // the route reports the reclaimed-failed job as finished
    expect(kicks).toHaveLength(0);
    const { data: row } = await admin
      .from('recommendation_jobs')
      .select('status, error_kind')
      .eq('id', jobId)
      .single();
    expect(row).toEqual({ status: 'failed', error_kind: 'timeout' });
  });
});
