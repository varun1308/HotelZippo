/* Phase 5: the /api/session/snapshot route's quiet-no-op guards (spec 08b-3 + 14: a
 * background save never surfaces an error). The full authed generate+persist path is
 * covered by its parts (generateSnapshot unit test, saveSnapshot integration test, the
 * trigger-hook test that beacons to this endpoint); here we pin the guard branches that
 * need no auth: a non-JSON body and an empty message list both return 204, not an error. */
import { cookies } from 'next/headers';

// next/headers cookies() isn't available outside a request scope; stub it so importing the
// route doesn't blow up. These guard tests return before any Supabase/auth call.
jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({ getAll: () => [] })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { POST } = require('@/app/api/session/snapshot/route');

function jsonReq(body: unknown): Request {
  return new Request('http://localhost:3000/api/session/snapshot', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/session/snapshot — no-op guards', () => {
  it('returns 204 on a non-JSON body (nothing to snapshot)', async () => {
    const req = new Request('http://localhost:3000/api/session/snapshot', {
      method: 'POST',
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(204);
    expect(cookies).not.toHaveBeenCalled(); // bailed before touching auth
  });

  it('returns 204 when messages is empty', async () => {
    const res = await POST(jsonReq({ messages: [] }));
    expect(res.status).toBe(204);
  });

  it('returns 204 when messages is missing', async () => {
    const res = await POST(jsonReq({}));
    expect(res.status).toBe(204);
  });
});
