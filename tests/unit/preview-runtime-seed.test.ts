/* 12i-C ensurePreviewSeed — the on-the-fly seed latch. Mocks seedPreviewFromRouteStack and uses a
 * fake Supabase client to drive the latch states (none → claim+seed; done → already_seeded; running →
 * in_progress; failed → retry; seed throws → failed). No network. */
jest.mock('server-only', () => ({}));

const mockSeed = jest.fn();
jest.mock('@/lib/preview/verify', () => ({ seedPreviewFromRouteStack: (...a: unknown[]) => mockSeed(...a) }));

import { ensurePreviewSeed, runtimeSeedEnabled } from '@/lib/preview/runtime-seed';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingDeps } from '@/lib/booking/routestack';

const deps = {} as BookingDeps;

/** Fake client: `existing` is the current preview_seeds row (or null); captures insert/update calls. */
function fakeClient(existing: { status: string } | null, opts: { insertErr?: boolean } = {}) {
  const calls = { insert: 0, updates: [] as Array<Record<string, unknown>> };

  // chainable .eq().eq() that awaits to {error:null}
  const eqChain: Record<string, unknown> = {};
  eqChain.eq = () => eqChain;
  eqChain.then = (res: (v: { error: null }) => void) => res({ error: null });

  const selectChain = {
    eq: () => ({ maybeSingle: async () => ({ data: existing }) }),
  };

  const table = {
    select: () => selectChain,
    insert: () => {
      calls.insert += 1;
      return Promise.resolve({ error: opts.insertErr ? { message: 'conflict' } : null });
    },
    update: (patch: Record<string, unknown>) => {
      calls.updates.push(patch);
      return eqChain;
    },
  };

  const client = { from: () => table } as unknown as SupabaseClient;
  return { client, calls };
}

afterEach(() => jest.clearAllMocks());

describe('runtimeSeedEnabled', () => {
  const ORIG = process.env.PREVIEW_RUNTIME_SEED;
  afterEach(() => { if (ORIG === undefined) delete process.env.PREVIEW_RUNTIME_SEED; else process.env.PREVIEW_RUNTIME_SEED = ORIG; });
  it('off by default, on with =1', () => {
    delete process.env.PREVIEW_RUNTIME_SEED;
    expect(runtimeSeedEnabled()).toBe(false);
    process.env.PREVIEW_RUNTIME_SEED = '1';
    expect(runtimeSeedEnabled()).toBe(true);
  });
});

describe('ensurePreviewSeed', () => {
  it('no latch → claims running, runs fast seed, marks done, returns seeded', async () => {
    mockSeed.mockResolvedValue({ found: 3, staged: 3, hotels: [] });
    const { client, calls } = fakeClient(null);
    const out = await ensurePreviewSeed(client, 'Bali', deps);
    expect(out).toEqual({ state: 'seeded', staged: 3 });
    expect(calls.insert).toBe(1);
    // fast seed requested
    expect(mockSeed).toHaveBeenCalledWith(client, 'Bali', deps, expect.objectContaining({ fast: true }));
    // marked done
    expect(calls.updates.some((u) => u.status === 'done' && u.hotel_count === 3)).toBe(true);
  });

  it('latch done → already_seeded, no seed', async () => {
    const { client } = fakeClient({ status: 'done' });
    const out = await ensurePreviewSeed(client, 'Bali', deps);
    expect(out).toEqual({ state: 'already_seeded' });
    expect(mockSeed).not.toHaveBeenCalled();
  });

  it('latch running → in_progress, no seed', async () => {
    const { client } = fakeClient({ status: 'running' });
    const out = await ensurePreviewSeed(client, 'Bali', deps);
    expect(out).toEqual({ state: 'in_progress' });
    expect(mockSeed).not.toHaveBeenCalled();
  });

  it('insert race (PK conflict) → in_progress, no seed', async () => {
    const { client } = fakeClient(null, { insertErr: true });
    const out = await ensurePreviewSeed(client, 'Bali', deps);
    expect(out).toEqual({ state: 'in_progress' });
    expect(mockSeed).not.toHaveBeenCalled();
  });

  it('seed returns 0 → empty', async () => {
    mockSeed.mockResolvedValue({ found: 0, staged: 0, hotels: [] });
    const { client } = fakeClient(null);
    const out = await ensurePreviewSeed(client, 'Bali', deps);
    expect(out).toEqual({ state: 'empty' });
  });

  it('seed throws → failed (latch marked failed)', async () => {
    mockSeed.mockRejectedValue(new Error('routestack down'));
    const { client, calls } = fakeClient(null);
    const out = await ensurePreviewSeed(client, 'Bali', deps);
    expect(out).toEqual({ state: 'failed', reason: 'routestack down' });
    expect(calls.updates.some((u) => u.status === 'failed')).toBe(true);
  });
});
