/* Async Apify client primitives (12h · run ledger) — startRun / getRunStatus / pullDatasetItems.
 * Network-free: an injected fetchImpl returns canned Apify API shapes. Asserts the URL/method, the
 * status mapping (unknown → NON-terminal, L22), itemCount parsing, the Bearer auth, that the token
 * never lands in the URL, and the CURATION_USE_CACHE seam (M18: banked input → synthetic run). */
import fs from 'node:fs/promises';
import path from 'node:path';
import { startRun, getRunStatus, pullDatasetItems, isCacheRunId, ApifyError } from '@/lib/apify/client';
import { cacheKeyFor } from '@/lib/dev/actor-cache';

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
    ['RUNNING', 'running'],
    ['READY', 'running'],
    ['FAILED', 'failed'],
    ['TIMED-OUT', 'failed'],
    ['ABORTED', 'failed'],
    // L22: unknown / future / missing statuses must stay NON-terminal — mapping them to
    // 'failed' is terminal in the ledger and strands paid data.
    ['MIGRATING', 'running'],
    ['SOME-FUTURE-STATE', 'running'],
    ['', 'running'],
  ])('maps Apify status %s → %s', async (apifyStatus, expected) => {
    const fetchImpl = (async (url: string) => {
      expect(url).toContain('/v2/actor-runs/run_123');
      return jsonResponse({ data: { status: apifyStatus, usageTotalUsd: 0.42 } });
    }) as unknown as typeof fetch;
    const out = await getRunStatus('run_123', fetchImpl);
    expect(out.status).toBe(expected);
    expect(out.costEstimate).toBe(0.42);
  });

  it('L22: parses itemCount from the dataset on a SUCCEEDED run (fixes the "? items" UI gap)', async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes('/v2/actor-runs/run_123')) {
        return jsonResponse({ data: { status: 'SUCCEEDED', defaultDatasetId: 'ds_456', usageTotalUsd: 0.42 } });
      }
      expect(url).toContain('/v2/datasets/ds_456');
      return jsonResponse({ data: { itemCount: 487 } });
    }) as unknown as typeof fetch;
    const out = await getRunStatus('run_123', fetchImpl);
    expect(out).toEqual({ status: 'succeeded', costEstimate: 0.42, itemCount: 487 });
  });

  it('L22: a failed dataset lookup is best-effort (status still succeeded, itemCount absent)', async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes('/v2/actor-runs/')) {
        return jsonResponse({ data: { status: 'SUCCEEDED', defaultDatasetId: 'ds_456' } });
      }
      return jsonResponse({ error: 'boom' }, false, 500);
    }) as unknown as typeof fetch;
    const out = await getRunStatus('run_123', fetchImpl);
    expect(out.status).toBe('succeeded');
    expect(out.itemCount).toBeUndefined();
  });
});

describe('CURATION_USE_CACHE seam (M18)', () => {
  const ACTOR = 'maxcopell~tripadvisor';
  const INPUT = { query: 'Phuket', maxItemsPerQuery: 500 };
  const CACHE_DIR = path.join(process.cwd(), 'scripts', 'dev', '.cache', 'routes');
  const bankFile = path.join(CACHE_DIR, cacheKeyFor('apify', ACTOR, INPUT));

  afterEach(async () => {
    await fs.rm(bankFile, { force: true });
  });

  it('startRun with a banked input returns a synthetic succeeded run — NO live call, NO token needed', async () => {
    delete process.env.APIFY_API_TOKEN; // free mode must not even need a token
    process.env.CURATION_USE_CACHE = '1';
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(bankFile, JSON.stringify([{ name: 'Banked Hotel' }]), 'utf8');

    const fetchImpl = (async () => {
      throw new Error('live Apify must not be called on a cache HIT');
    }) as unknown as typeof fetch;

    const out = await startRun({ actorId: ACTOR, input: INPUT }, fetchImpl);
    expect(isCacheRunId(out.apifyRunId)).toBe(true);
    expect(out.apifyDatasetId).toBe(out.apifyRunId);
    // …and the status poll resolves it as succeeded with no live call either.
    await expect(getRunStatus(out.apifyRunId, fetchImpl)).resolves.toEqual({ status: 'succeeded' });
  });

  it('startRun falls through to the live start on a cache MISS', async () => {
    process.env.CURATION_USE_CACHE = '1'; // no bank file written
    const fetchImpl = (async () =>
      jsonResponse({ data: { id: 'run_live', defaultDatasetId: 'ds_live' } })) as unknown as typeof fetch;
    const out = await startRun({ actorId: ACTOR, input: INPUT }, fetchImpl);
    expect(out).toEqual({ apifyRunId: 'run_live', apifyDatasetId: 'ds_live' });
  });

  it('pullDatasetItems refuses a synthetic cache dataset id with a clear error', async () => {
    const fetchImpl = (async () => jsonResponse([])) as unknown as typeof fetch;
    await expect(pullDatasetItems('cache:apify__x__deadbeef.json', {}, fetchImpl)).rejects.toMatchObject({
      kind: 'bad_response',
    });
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
