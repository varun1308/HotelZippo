/* POST /api/admin/preview/seed (12i step 5). The seed route's PROPOSE→VERIFY→STAGE logic is covered
 * by the propose + verify unit tests; here we lock the route-level guards that need no DB/network:
 *   - operator gate: 403 unless PREVIEW_SEEDING_ENABLED=1
 *   - destination validation: 400 on an unknown destination
 * Node project (the route imports the AI SDK transitively via lib/preview/propose). */
import { POST } from '@/app/api/admin/preview/seed/route';

function req(body: unknown): Request {
  return new Request('http://localhost/api/admin/preview/seed', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ORIG = process.env.PREVIEW_SEEDING_ENABLED;
afterEach(() => {
  if (ORIG === undefined) delete process.env.PREVIEW_SEEDING_ENABLED;
  else process.env.PREVIEW_SEEDING_ENABLED = ORIG;
});

describe('POST /api/admin/preview/seed — guards', () => {
  it('403 when preview seeding is disabled (flag unset)', async () => {
    delete process.env.PREVIEW_SEEDING_ENABLED;
    const res = await POST(req({ destination: 'Bali' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('preview_seeding_disabled');
  });

  it('400 on an unknown destination (even when enabled)', async () => {
    process.env.PREVIEW_SEEDING_ENABLED = '1';
    const res = await POST(req({ destination: 'Atlantis' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_destination');
  });

  it('400 on invalid JSON', async () => {
    process.env.PREVIEW_SEEDING_ENABLED = '1';
    const bad = new Request('http://localhost/api/admin/preview/seed', { method: 'POST', body: '{not json' });
    const res = await POST(bad);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_json');
  });
});
