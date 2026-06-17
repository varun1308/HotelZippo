/* 12i-C ensurePreviewSeed against local Supabase — the latch persists + dedupes for real. We STUB the
 * RouteStack seed (no spend) by mocking seedPreviewFromRouteStack, and assert the preview_seeds row
 * transitions running → done, that a second call short-circuits to already_seeded, and a concurrent
 * claim yields in_progress. Cleans its own latch row. */
const mockSeed = jest.fn();
jest.mock('@/lib/preview/verify', () => ({ seedPreviewFromRouteStack: (...a: unknown[]) => mockSeed(...a) }));

import { serviceClient } from './helpers';
import { ensurePreviewSeed } from '@/lib/preview/runtime-seed';
import type { BookingDeps } from '@/lib/booking/routestack';

jest.setTimeout(30_000);
const admin = serviceClient();
const DEST = 'Singapore'; // owned by this test (no demo data)
const deps = {} as BookingDeps;

async function cleanup() {
  await admin.from('preview_seeds').delete().eq('destination', DEST);
}
beforeEach(async () => { await cleanup(); mockSeed.mockReset(); });
afterAll(cleanup);

describe('ensurePreviewSeed (real DB latch)', () => {
  it('claims running → seeds → marks done; row reflects it', async () => {
    mockSeed.mockResolvedValue({ found: 4, staged: 4, hotels: [] });
    const out = await ensurePreviewSeed(admin, DEST, deps);
    expect(out).toEqual({ state: 'seeded', staged: 4 });

    const { data } = await admin.from('preview_seeds').select('status, hotel_count').eq('destination', DEST).single();
    expect(data?.status).toBe('done');
    expect(data?.hotel_count).toBe(4);
  });

  it('second call after done → already_seeded, no re-seed', async () => {
    mockSeed.mockResolvedValue({ found: 4, staged: 4, hotels: [] });
    await ensurePreviewSeed(admin, DEST, deps);
    mockSeed.mockClear();

    const out = await ensurePreviewSeed(admin, DEST, deps);
    expect(out).toEqual({ state: 'already_seeded' });
    expect(mockSeed).not.toHaveBeenCalled();
  });

  it('a row already running → in_progress (no double seed)', async () => {
    await admin.from('preview_seeds').insert({ destination: DEST, status: 'running' });
    const out = await ensurePreviewSeed(admin, DEST, deps);
    expect(out).toEqual({ state: 'in_progress' });
    expect(mockSeed).not.toHaveBeenCalled();
  });

  it('failed latch → retried (flips back to running, seeds, done)', async () => {
    await admin.from('preview_seeds').insert({ destination: DEST, status: 'failed', error: 'old' });
    mockSeed.mockResolvedValue({ found: 2, staged: 2, hotels: [] });
    const out = await ensurePreviewSeed(admin, DEST, deps);
    expect(out).toEqual({ state: 'seeded', staged: 2 });
    const { data } = await admin.from('preview_seeds').select('status').eq('destination', DEST).single();
    expect(data?.status).toBe('done');
  });
});
