/* useChatStream: reduces injected chunks into messages + status transitions. */
import { act, renderHook, waitFor } from '@testing-library/react';
import { useChatStream } from '@/lib/chat/useChatStream';
import type { StreamChunk, StreamSource } from '@/lib/chat/types';

/** A deterministic source that yields a fixed list of chunks. */
function sourceFrom(chunks: StreamChunk[]): StreamSource {
  return async function* () {
    for (const c of chunks) yield c;
  };
}

describe('useChatStream', () => {
  it('accumulates text-delta chunks into a single assistant message', async () => {
    const source = sourceFrom([
      { type: 'typing' },
      { type: 'text-delta', delta: 'Hello' },
      { type: 'text-delta', delta: ' ' },
      { type: 'text-delta', delta: 'there' },
      { type: 'done' },
    ]);
    const { result } = renderHook(() => useChatStream({ source }));

    await act(async () => {
      await result.current.sendMessage('hi');
    });

    // user message + one assistant message.
    expect(result.current.messages).toHaveLength(2);
    const assistant = result.current.messages[1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.parts).toHaveLength(1);
    expect(assistant.parts[0]).toEqual({ type: 'text', text: 'Hello there' });
  });

  it('appends a component part for a component chunk', async () => {
    const source = sourceFrom([
      { type: 'text-delta', delta: 'See:' },
      { type: 'component', component: 'recommendation-set', props: { a: 1 } },
      { type: 'done' },
    ]);
    const { result } = renderHook(() => useChatStream({ source }));

    await act(async () => {
      await result.current.sendMessage('show me');
    });

    const assistant = result.current.messages[1];
    expect(assistant.parts).toHaveLength(2);
    expect(assistant.parts[1]).toEqual({
      type: 'component',
      component: 'recommendation-set',
      props: { a: 1 },
    });
  });

  it('sets offerForm on the assistant message for an offer-form chunk', async () => {
    const source = sourceFrom([
      { type: 'text-delta', delta: 'Noted.' },
      { type: 'offer-form' },
      { type: 'done' },
    ]);
    const { result } = renderHook(() => useChatStream({ source }));
    await act(async () => {
      await result.current.sendMessage('vegetarian');
    });
    expect(result.current.messages[1].offerForm).toBe(true);
  });

  it('transitions status idle → thinking → streaming → idle', async () => {
    // A source whose chunks are released one at a time so React can flush a
    // render between each — letting us observe the intermediate statuses
    // (otherwise React 18 batches the whole synchronous run into one frame).
    let release!: () => void;
    const gate = () =>
      new Promise<void>((r) => {
        release = r;
      });

    const source: StreamSource = async function* () {
      yield { type: 'typing' };
      await gate();
      yield { type: 'text-delta', delta: 'Hi' };
      await gate();
      yield { type: 'done' };
    };

    const { result } = renderHook(() => useChatStream({ source }));
    expect(result.current.status).toBe('idle');

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.sendMessage('go');
    });
    // After the first 'typing' chunk (before any text), we are thinking.
    await waitFor(() => expect(result.current.status).toBe('thinking'));

    // Release the text-delta → streaming.
    await act(async () => {
      release();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.status).toBe('streaming'));

    // Release 'done' → back to idle.
    await act(async () => {
      release();
      await sendPromise;
    });
    expect(result.current.status).toBe('idle');
  });

  it('ignores empty / whitespace-only sends', async () => {
    const source = sourceFrom([{ type: 'text-delta', delta: 'x' }, { type: 'done' }]);
    const { result } = renderHook(() => useChatStream({ source }));
    await act(async () => {
      await result.current.sendMessage('   ');
    });
    expect(result.current.messages).toHaveLength(0);
  });
});
