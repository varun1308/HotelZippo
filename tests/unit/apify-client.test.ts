/* Shared Apify client (lib/apify/client.ts). Network-free: an injected fetch impl drives every
 * branch — URL/token/limit construction, array parsing, and each ApifyError kind. */
import { runActorGetItems, ApifyError } from '@/lib/apify/client';

const ACTOR = 'apify~some-actor';

function okResponse(items: unknown): Response {
  return { ok: true, status: 200, json: async () => items, text: async () => JSON.stringify(items) } as Response;
}

describe('runActorGetItems', () => {
  const ORIG = process.env.APIFY_API_TOKEN;
  beforeEach(() => {
    process.env.APIFY_API_TOKEN = 'tok_test';
  });
  afterAll(() => {
    if (ORIG === undefined) delete process.env.APIFY_API_TOKEN;
    else process.env.APIFY_API_TOKEN = ORIG;
  });

  it('throws no_token when APIFY_API_TOKEN is unset', async () => {
    delete process.env.APIFY_API_TOKEN;
    await expect(runActorGetItems({ actorId: ACTOR, input: {} })).rejects.toMatchObject({
      name: 'ApifyError',
      kind: 'no_token',
    });
  });

  it('POSTs to run-sync-get-dataset-items with a Bearer token, run timeout, limit, and JSON body', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seenUrl = url;
      seenInit = init;
      return okResponse([{ a: 1 }]);
    }) as unknown as typeof fetch;

    const items = await runActorGetItems(
      { actorId: ACTOR, input: { q: 'hotels in Phuket' }, limit: 50, runTimeoutSecs: 120 },
      fetchImpl,
    );

    expect(items).toEqual([{ a: 1 }]);
    expect(seenUrl).toContain(`/actors/${encodeURIComponent(ACTOR)}/run-sync-get-dataset-items`);
    expect(seenUrl).toContain('timeout=120');
    expect(seenUrl).toContain('limit=50');
    expect(seenInit?.method).toBe('POST');
    expect(JSON.parse(String(seenInit?.body))).toEqual({ q: 'hotels in Phuket' });
    // Token travels in the Authorization header, NOT the URL (no secret in logs/spans).
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok_test');
    expect(seenUrl).not.toContain('tok_test');
    expect(seenUrl).not.toContain('token=');
  });

  it('omits the limit param when no limit is given', async () => {
    let seenUrl = '';
    const fetchImpl = (async (url: string) => {
      seenUrl = url;
      return okResponse([]);
    }) as unknown as typeof fetch;
    await runActorGetItems({ actorId: ACTOR, input: {} }, fetchImpl);
    expect(seenUrl).not.toContain('limit=');
  });

  it('throws http_error with the status on a non-2xx response (body truncated)', async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 429, text: async () => 'x'.repeat(5000) }) as Response) as unknown as typeof fetch;
    const err = await runActorGetItems({ actorId: ACTOR, input: {} }, fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(ApifyError);
    expect(err.kind).toBe('http_error');
    expect(err.status).toBe(429);
    expect(err.message.length).toBeLessThan(400); // truncated, not the full 5000 chars
  });

  it('throws timeout when the fetch aborts', async () => {
    const fetchImpl = (async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }) as unknown as typeof fetch;
    await expect(runActorGetItems({ actorId: ACTOR, input: {} }, fetchImpl)).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('throws bad_response when the body is not an array', async () => {
    const fetchImpl = (async () =>
      ({ ok: true, status: 200, json: async () => ({ not: 'an array' }) }) as Response) as unknown as typeof fetch;
    await expect(runActorGetItems({ actorId: ACTOR, input: {} }, fetchImpl)).rejects.toMatchObject({
      kind: 'bad_response',
    });
  });
});
