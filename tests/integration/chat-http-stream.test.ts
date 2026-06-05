/* The client StreamSource adapter: reads NDJSON StreamChunks from /api/chat.
 * Drives a mocked fetch returning an NDJSON ReadableStream; asserts the adapter
 * yields the right chunk sequence and always terminates with `done`. */
import { chatHttpStream } from '@/lib/chat/httpStream';
import type { StreamChunk } from '@/lib/chat/types';

function ndjsonResponse(chunks: StreamChunk[], opts?: { splitMidLine?: boolean }): Response {
  const text = chunks.map((c) => JSON.stringify(c)).join('\n') + '\n';
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (opts?.splitMidLine) {
        // Emit in two arbitrary slices to exercise the line-buffer across reads.
        const mid = Math.floor(bytes.length / 2);
        controller.enqueue(bytes.slice(0, mid));
        controller.enqueue(bytes.slice(mid));
      } else {
        controller.enqueue(bytes);
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
}

async function collect(input: string): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of chatHttpStream(input, [])) out.push(c);
  return out;
}

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

describe('chatHttpStream adapter', () => {
  it('yields the chunks the route emits, in order', async () => {
    const chunks: StreamChunk[] = [
      { type: 'typing' },
      { type: 'text-delta', delta: 'Hello ' },
      { type: 'text-delta', delta: 'there.' },
      { type: 'component', component: 'recommendation-set', props: { topPick: {}, otherPicks: [] } },
      { type: 'done' },
    ];
    global.fetch = jest.fn(async () => ndjsonResponse(chunks)) as typeof fetch;
    const out = await collect('hi');
    expect(out.map((c) => c.type)).toEqual(['typing', 'text-delta', 'text-delta', 'component', 'done']);
    expect((out[1] as { delta: string }).delta).toBe('Hello ');
  });

  it('reassembles chunks split across read() boundaries', async () => {
    const chunks: StreamChunk[] = [
      { type: 'text-delta', delta: 'partial line handling' },
      { type: 'done' },
    ];
    global.fetch = jest.fn(async () => ndjsonResponse(chunks, { splitMidLine: true })) as typeof fetch;
    const out = await collect('hi');
    expect(out.find((c) => c.type === 'text-delta')).toBeTruthy();
    expect(out[out.length - 1].type).toBe('done');
  });

  it('emits a warm error + done on a non-ok response', async () => {
    global.fetch = jest.fn(async () => new Response('nope', { status: 502 })) as typeof fetch;
    const out = await collect('hi');
    expect(out[0].type).toBe('text-delta');
    expect(out[out.length - 1].type).toBe('done');
  });

  it('emits a warm error + done when fetch throws (network down)', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as typeof fetch;
    const out = await collect('hi');
    expect(out[out.length - 1].type).toBe('done');
    expect(out.some((c) => c.type === 'text-delta')).toBe(true);
  });

  it('always terminates with done even if the stream omitted it', async () => {
    global.fetch = jest.fn(async () =>
      ndjsonResponse([{ type: 'text-delta', delta: 'no terminal' }]),
    ) as typeof fetch;
    // remove the trailing done from the fixture by sending only the delta:
    const out = await collect('hi');
    expect(out[out.length - 1].type).toBe('done');
  });

  /** A fetch spy whose recorded calls are typed [input, init] so we can read the body. */
  function fetchSpy() {
    return jest.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(ndjsonResponse([{ type: 'done' }])),
    );
  }
  function sentBody(spy: ReturnType<typeof fetchSpy>): Record<string, unknown> {
    const init = spy.mock.calls[0]?.[1];
    return JSON.parse((init?.body as string) ?? '{}');
  }

  it('sends the family profile + session snapshot in the request body when provided', async () => {
    const spy = fetchSpy();
    global.fetch = spy as unknown as typeof fetch;
    const profile = { name: 'Varun', children: [], food: 'none' };
    for await (const _ of chatHttpStream('hi', [], 'prior summary', profile)) void _;

    const body = sentBody(spy);
    expect(body.familyProfile).toEqual(profile);
    expect(body.sessionSnapshot).toBe('prior summary');
    // the new user turn is appended to the messages
    const messages = body.messages as Array<{ role: string }>;
    expect(messages[messages.length - 1]).toMatchObject({ role: 'user' });
  });

  it('omits familyProfile from the body when not provided', async () => {
    const spy = fetchSpy();
    global.fetch = spy as unknown as typeof fetch;
    await collect('hi');
    expect('familyProfile' in sentBody(spy)).toBe(false);
  });
});
