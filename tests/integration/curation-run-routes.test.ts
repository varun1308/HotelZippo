/* Curation ledger routes (12h PR 2) — guard/validation paths that need NO live Apify.
 * The happy path (start → poll → ingest) hits Apify's network API and is exercised by the live
 * smoke / manual run; here we prove the deterministic guards against a real local DB + ledger:
 *   - runs list validates the destination
 *   - status returns 404 for an unknown run
 *   - ingest rejects unknown / not-succeeded / wrong-purpose runs (the safety rails)
 * Routes use the service client; apify_runs is service-role only. */
import { serviceClient } from './helpers';
import { createRun, markStatus } from '@/lib/apify/run-ledger';
import { GET as runsGET } from '@/app/api/admin/curation/runs/route';
import { GET as statusGET } from '@/app/api/admin/curation/run/status/route';
import { POST as ingestPOST } from '@/app/api/admin/curation/run/ingest/route';

jest.setTimeout(30_000);

const admin = serviceClient();
const SCOPE = 'Phuket';

afterAll(async () => {
  await admin.from('apify_runs').delete().eq('scope_value', SCOPE).eq('actor_id', 'test-actor');
});

function jsonReq(url: string, body?: unknown): Request {
  return new Request(url, body ? { method: 'POST', body: JSON.stringify(body) } : { method: 'GET' });
}

describe('GET /api/admin/curation/runs', () => {
  it('400s an invalid destination', async () => {
    const res = await runsGET(jsonReq('http://x/api/admin/curation/runs?destination=Atlantis'));
    expect(res.status).toBe(400);
  });

  it('returns runs for a valid destination', async () => {
    await createRun(admin, {
      actorId: 'test-actor',
      purpose: 'curation_search',
      scopeType: 'destination',
      scopeValue: SCOPE,
      input: { query: SCOPE },
    });
    const res = await runsGET(jsonReq('http://x/api/admin/curation/runs?destination=Phuket'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.runs)).toBe(true);
    expect(json.runs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/admin/curation/run/status', () => {
  it('404s an unknown run id', async () => {
    const res = await statusGET(jsonReq('http://x/api/admin/curation/run/status?runId=00000000-0000-0000-0000-000000000000'));
    expect(res.status).toBe(404);
  });

  it('returns a terminal run as-is without an Apify call', async () => {
    const run = await createRun(admin, {
      actorId: 'test-actor',
      purpose: 'curation_search',
      scopeType: 'destination',
      scopeValue: SCOPE,
      input: { query: SCOPE },
    });
    await markStatus(admin, run.id, 'succeeded', { itemCount: 7 });
    const res = await statusGET(jsonReq(`http://x/api/admin/curation/run/status?runId=${run.id}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.run.status).toBe('succeeded');
    expect(json.run.itemCount).toBe(7);
  });
});

describe('POST /api/admin/curation/run/ingest — guards', () => {
  it('404s an unknown run', async () => {
    const res = await ingestPOST(jsonReq('http://x/api/admin/curation/run/ingest', { runId: '00000000-0000-0000-0000-000000000000' }));
    expect(res.status).toBe(404);
  });

  it('409s a run that has not succeeded', async () => {
    const run = await createRun(admin, {
      actorId: 'test-actor',
      purpose: 'curation_search',
      scopeType: 'destination',
      scopeValue: SCOPE,
      input: { query: SCOPE },
    });
    // status = pending
    const res = await ingestPOST(jsonReq('http://x/api/admin/curation/run/ingest', { runId: run.id }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('not_succeeded');
  });

  it('400s a wrong-purpose run', async () => {
    const run = await createRun(admin, {
      actorId: 'test-actor',
      purpose: 'ta_reviews',
      scopeType: 'hotel',
      scopeValue: SCOPE,
      input: { hotelId: 'x' },
    });
    await markStatus(admin, run.id, 'succeeded', { itemCount: 1 });
    const res = await ingestPOST(jsonReq('http://x/api/admin/curation/run/ingest', { runId: run.id }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('wrong_purpose');
  });
});
