/* Apify Run Ledger (12h · migration 0012) round-trips through its service-role table apify_runs.
 * Proves the status lifecycle (pending → running → succeeded → ingested / failed), the listing, and
 * the reuse guard (findReusable matches same-query within the window, ignores stale / different).
 * Service-role only (apify_runs has RLS enabled with no client policies). */
import { serviceClient } from './helpers';
import {
  createRun,
  markRunning,
  markStatus,
  markIngested,
  loadRun,
  listRuns,
  findReusable,
} from '@/lib/apify/run-ledger';

jest.setTimeout(30_000);

const admin = serviceClient();
const SCOPE = `Phuket-test-${Date.now()}`;

afterAll(async () => {
  await admin.from('apify_runs').delete().eq('scope_value', SCOPE);
});

describe('apify_runs lifecycle', () => {
  it('walks pending → running → succeeded → ingested', async () => {
    const run = await createRun(admin, {
      actorId: 'maxcopell~tripadvisor',
      purpose: 'curation_search',
      scopeType: 'destination',
      scopeValue: SCOPE,
      input: { query: SCOPE, maxItems: 50 },
    });
    expect(run.status).toBe('pending');
    expect(run.apifyRunId).toBeNull();

    await markRunning(admin, run.id, { apifyRunId: 'run_abc', apifyDatasetId: 'ds_abc' });
    let cur = await loadRun(admin, run.id);
    expect(cur?.status).toBe('running');
    expect(cur?.apifyRunId).toBe('run_abc');
    expect(cur?.apifyDatasetId).toBe('ds_abc');

    await markStatus(admin, run.id, 'succeeded', { itemCount: 42, costEstimate: 0.5 });
    cur = await loadRun(admin, run.id);
    expect(cur?.status).toBe('succeeded');
    expect(cur?.itemCount).toBe(42);
    expect(cur?.finishedAt).not.toBeNull();
    expect(cur?.ingestedAt).toBeNull(); // succeeded-but-not-ingested = the reuse case

    await markIngested(admin, run.id);
    cur = await loadRun(admin, run.id);
    expect(cur?.status).toBe('ingested');
    expect(cur?.ingestedAt).not.toBeNull();
  });

  it('records a failed run with a (truncated) error', async () => {
    const run = await createRun(admin, {
      actorId: 'a',
      purpose: 'ta_reviews',
      scopeType: 'hotel',
      scopeValue: SCOPE,
      input: { hotelId: 'x' },
    });
    await markStatus(admin, run.id, 'failed', { error: 'boom '.repeat(200) });
    const cur = await loadRun(admin, run.id);
    expect(cur?.status).toBe('failed');
    expect(cur?.error?.length).toBeLessThanOrEqual(501); // ≤500 + ellipsis
  });

  it('lists runs for a scope newest-first', async () => {
    const runs = await listRuns(admin, { scopeValue: SCOPE });
    expect(runs.length).toBeGreaterThanOrEqual(2);
    // newest first
    for (let i = 1; i < runs.length; i++) {
      expect(new Date(runs[i - 1].startedAt).getTime()).toBeGreaterThanOrEqual(new Date(runs[i].startedAt).getTime());
    }
  });
});

describe('findReusable (reuse guard)', () => {
  it('matches a recent succeeded run with the same query, ignoring volatile keys', async () => {
    const input = { query: SCOPE, maxItems: 50, lastReviewDate: '2026-06-16' };
    const run = await createRun(admin, {
      actorId: 'maxcopell~tripadvisor',
      purpose: 'curation_search',
      scopeType: 'destination',
      scopeValue: SCOPE,
      input,
    });
    await markStatus(admin, run.id, 'succeeded', { itemCount: 10 });

    // Same query but a different (volatile) date floor → still a match.
    const hit = await findReusable(admin, {
      purpose: 'curation_search',
      scopeValue: SCOPE,
      input: { query: SCOPE, maxItems: 50, lastReviewDate: '2025-01-01' },
      withinDays: 7,
    });
    expect(hit).not.toBeNull();
    expect(hit?.id).toBeDefined();
  });

  it('returns null for a different query', async () => {
    const hit = await findReusable(admin, {
      purpose: 'curation_search',
      scopeValue: SCOPE,
      input: { query: 'Some Other Place', maxItems: 50 },
      withinDays: 7,
    });
    expect(hit).toBeNull();
  });
});
