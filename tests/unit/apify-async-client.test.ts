/* Async Apify client primitives (12h · run ledger) — startRun / getRunStatus / pullDatasetItems.
 * Network-free: an injected fetchImpl returns canned Apify API shapes. Asserts the URL/method, the
 * status mapping, the Bearer auth, and that the token never lands in the URL. */
import { startRun, getRunStatus, pullDatasetItems, ApifyError } from '@/lib/apify/client';

const OLD_ENV = process.env;
beforeEach(() => {
  process.env = { ...OLD_ENV, APIFY_API_TOKEN: 'apify_test_token' };
});
afterEach(() => {
  process.env = OLD_ENV;
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('startRun', () => {
  it('POSTs to /actors/<id>/runs and returns the run + dataset ids', async () => {
    let seenUrl = '';
    let seenInit: RequestInit = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seenUrl = url;
      seenInit = init;
      return jsonResponse({ data: { id: 'run_123', defaultDatasetId: 'ds_456' } });
    }) as unknown as typeof fetch;

    const out = await startRun({ actorId: 'maxcopell~tripadvisor', input: { q: 'Phuket' } }, fetchImpl);

    expect(out).toEqual({ apifyRunId: 'run_123', apifyDatasetId: 'ds_456' });
    expect(seenUrl).toContain('/v2/actors/maxcopell~tripadvisor/runs');
    expect(seenInit.method).toBe('POST');
    // Auth via header, NOT the URL (the token must never be in a URL that lands in logs/spans).
    expect((seenInit.headers as Record<string, string>).authorization).toBe('Bearer apify_test_token');
    expect(seenUrl).not.toContain('apify_test_token');
  });

  it('throws bad_response when data ids are missing', async () => {
    const fetchImpl = (async () => jsonResponse({ data: {} })) as unknown as typeof fetch;
    await expect(startRun({ actorId: 'a', input: {} }, fetchImpl)).rejects.toBeInstanceOf(ApifyError);
  });

  it('throws no_token when APIFY_API_TOKEN is unset', async () => {
    delete process.env.APIFY_API_TOKEN;
    const fetchImpl = (async () => jsonResponse({})) as unknown as typeof fetch;
    await expect(startRun({ actorId: 'a', input: {} }, fetchImpl)).rejects.toMatchObject({ kind: 'no_token' });
  });
});

describe('getRunStatus', () => {
  it.each([
    ['SUCCEEDED', 'succeeded'],
    ['RUNNING', 'running'],
    ['READY', 'running'],
    ['FAILED', 'failed'],
    ['TIMED-OUT', 'failed'],
    ['ABORTED', 'failed'],
  ])('maps Apify status %s → %s', async (apifyStatus, expected) => {
    const fetchImpl = (async (url: string) => {
      expect(url).toContain('/v2/actor-runs/run_123');
      return jsonResponse({ data: { status: apifyStatus, usageTotalUsd: 0.42 } });
    }) as unknown as typeof fetch;
    const out = await getRunStatus('run_123', fetchImpl);
    expect(out.status).toBe(expected);
    expect(out.costEstimate).toBe(0.42);
  });
});

describe('pullDatasetItems', () => {
  it('GETs the dataset items and returns the array', async () => {
    const items = [{ name: 'Hotel A' }, { name: 'Hotel B' }];
    let seenUrl = '';
    const fetchImpl = (async (url: string) => {
      seenUrl = url;
      return jsonResponse(items);
    }) as unknown as typeof fetch;
    const out = await pullDatasetItems('ds_456', { limit: 50 }, fetchImpl);
    expect(out).toEqual(items);
    expect(seenUrl).toContain('/v2/datasets/ds_456/items');
    expect(seenUrl).toContain('limit=50');
  });

  it('throws bad_response when the body is not an array', async () => {
    const fetchImpl = (async () => jsonResponse({ not: 'an array' })) as unknown as typeof fetch;
    await expect(pullDatasetItems('ds_456', {}, fetchImpl)).rejects.toMatchObject({ kind: 'bad_response' });
  });
});
