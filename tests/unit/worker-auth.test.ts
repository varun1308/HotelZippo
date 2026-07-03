/**
 * @jest-environment node
 *
 * Internal-caller guard for the assembly worker route (lib/recommendations/worker-auth.ts).
 * Open when ASSEMBLY_WORKER_SECRET is unset (key-free CI / env-free dev); when set, only a
 * request carrying the secret in x-hz-worker-auth may run the worker. Node env for the
 * global Request. */
import { WORKER_AUTH_HEADER, workerAuthHeaders, verifyWorkerAuth } from '@/lib/recommendations/worker-auth';

const saved = process.env.ASSEMBLY_WORKER_SECRET;
afterEach(() => {
  if (saved === undefined) delete process.env.ASSEMBLY_WORKER_SECRET;
  else process.env.ASSEMBLY_WORKER_SECRET = saved;
});

function reqWith(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/assembly/run', { method: 'POST', headers });
}

describe('worker auth (env-free → open)', () => {
  it('verifies any request and emits no header when the secret is unset', () => {
    delete process.env.ASSEMBLY_WORKER_SECRET;
    expect(verifyWorkerAuth(reqWith())).toBe(true);
    expect(workerAuthHeaders()).toEqual({});
  });
});

describe('worker auth (secret configured)', () => {
  beforeEach(() => {
    process.env.ASSEMBLY_WORKER_SECRET = 's3cret';
  });

  it('rejects a request without the header, or with a wrong value', () => {
    expect(verifyWorkerAuth(reqWith())).toBe(false);
    expect(verifyWorkerAuth(reqWith({ [WORKER_AUTH_HEADER]: 'nope' }))).toBe(false);
  });

  it('accepts a request carrying the headers the kick helpers emit', () => {
    expect(workerAuthHeaders()).toEqual({ [WORKER_AUTH_HEADER]: 's3cret' });
    expect(verifyWorkerAuth(reqWith(workerAuthHeaders()))).toBe(true);
  });
});
