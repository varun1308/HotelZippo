/* useChatStream — drives the chat UI from an INJECTED stream source.
 *
 * This hook owns no inference. It consumes an async iterable of `StreamChunk`s
 * (the injection seam — see types.ts `StreamSource`) and reduces them into the
 * `messages[]` array the UI renders. Phase 3c swaps the mock source for the real
 * agent without touching this file; tests pass a fake source to drive the UI
 * deterministically.
 *
 * Status lifecycle for one assistant turn:
 *   idle → (send) thinking → (first text/component) streaming → (done) idle
 *
 * A 'typing' chunk keeps us in `thinking` (3-dot indicator); the first
 * 'text-delta' or 'component' flips to `streaming`. A 'researching' chunk shows
 * the brief pill (the one allowed spinner) without ending the turn. */
'use client';

import { useCallback, useRef, useState } from 'react';
import type {
  ChatMessage,
  ChatStatus,
  ComponentPart,
  StreamChunk,
  StreamSource,
  TextPart,
} from './types';

let _seq = 0;
/** Monotonic id — deterministic across a render tree, avoids hydration churn. */
function nextId(prefix: string): string {
  _seq += 1;
  return `${prefix}-${_seq}`;
}

/** A "researching" notice surfaced beneath the live assistant turn. */
export interface ResearchingState {
  label: string;
}

export interface UseChatStreamOptions {
  /** The injected source. Required — the page passes the mock; 3c the real agent. */
  source: StreamSource;
  /** Seed the thread (e.g. for tests or a resumed session). */
  initialMessages?: ChatMessage[];
}

export interface UseChatStreamResult {
  messages: ChatMessage[];
  status: ChatStatus;
  /** Non-null while the assistant is actively researching (renders the pill). */
  researching: ResearchingState | null;
  /** The id of the message currently being streamed, or null. */
  streamingMessageId: string | null;
  sendMessage: (text: string) => Promise<void>;
  isBusy: boolean;
}

export function useChatStream({
  source,
  initialMessages = [],
}: UseChatStreamOptions): UseChatStreamResult {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [researching, setResearching] = useState<ResearchingState | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);

  /* Guard against overlapping sends (e.g. double-submit). The ref is read
   * synchronously so a second call bails before mutating state. */
  const busyRef = useRef(false);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busyRef.current) return;
      busyRef.current = true;

      const userMessage: ChatMessage = {
        id: nextId('user'),
        role: 'user',
        parts: [{ type: 'text', text: trimmed }],
      };

      // Capture history BEFORE appending the new user turn (the source contract
      // is `source(input, priorHistory)`).
      let history: ChatMessage[] = [];
      setMessages((prev) => {
        history = prev;
        return [...prev, userMessage];
      });

      const assistantId = nextId('assistant');
      setStatus('thinking');

      /** Lazily insert the assistant message on the first real content so the
       *  3-dot indicator (not an empty bubble) shows during `thinking`. */
      let assistantInserted = false;
      const ensureAssistant = () => {
        if (assistantInserted) return;
        assistantInserted = true;
        setStreamingMessageId(assistantId);
        setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', parts: [] }]);
      };

      /** Append a text delta to the trailing text part (merge), or open a new
       *  one if the last part is a component. Whole-word granularity is the
       *  source's responsibility; we never split inside a delta. */
      const appendText = (delta: string) => {
        ensureAssistant();
        setStatus('streaming');
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantId) return m;
            const parts = [...m.parts];
            const last = parts[parts.length - 1];
            if (last && last.type === 'text') {
              parts[parts.length - 1] = { type: 'text', text: last.text + delta } satisfies TextPart;
            } else {
              parts.push({ type: 'text', text: delta });
            }
            return { ...m, parts };
          }),
        );
      };

      const appendComponent = (part: ComponentPart) => {
        ensureAssistant();
        setStatus('streaming');
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, parts: [...m.parts, part] } : m)),
        );
      };

      try {
        for await (const chunk of source(trimmed, history)) {
          applyChunk(chunk, { appendText, appendComponent, assistantId, setMessages, setResearching });
          if (chunk.type === 'done') break;
        }
      } finally {
        setResearching(null);
        setStreamingMessageId(null);
        setStatus('idle');
        busyRef.current = false;
      }
    },
    [source],
  );

  return {
    messages,
    status,
    researching,
    streamingMessageId,
    sendMessage,
    isBusy: status !== 'idle',
  };
}

/* Chunk reducer pulled out so it stays a pure switch (easy to read/extend). */
function applyChunk(
  chunk: StreamChunk,
  ctx: {
    appendText: (delta: string) => void;
    appendComponent: (part: ComponentPart) => void;
    assistantId: string;
    setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
    setResearching: React.Dispatch<React.SetStateAction<ResearchingState | null>>;
  },
): void {
  switch (chunk.type) {
    case 'typing':
      // Stay in `thinking` — the indicator is driven by status, no-op here.
      break;
    case 'text-delta':
      ctx.appendText(chunk.delta);
      break;
    case 'component':
      ctx.appendComponent({ type: 'component', component: chunk.component, props: chunk.props });
      break;
    case 'offer-form':
      ctx.setMessages((prev) =>
        prev.map((m) => (m.id === ctx.assistantId ? { ...m, offerForm: true } : m)),
      );
      break;
    case 'researching':
      ctx.setResearching({ label: chunk.label ?? 'Researching hotels for your family…' });
      break;
    case 'done':
      break;
  }
}
