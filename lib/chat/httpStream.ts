/* Real StreamSource (client) — POSTs to /api/chat and reads the NDJSON StreamChunk
 * stream the route emits. This is the seam 3b left for 3c: ChatShell takes a `source`
 * prop; here we provide the agent-backed one. Because the route already speaks our
 * StreamChunk protocol, this adapter is a thin NDJSON line reader — no AI SDK on the
 * client, no wire-format coupling. */
import type { ChatMessage, StreamChunk } from './types';

/** Body the /api/chat route expects: the prior thread + the new user turn, plus the
 *  resumed session snapshot (Phase 5) and the signed-in user's saved family profile
 *  (so the agent greets by name and never re-asks known fields) when available. */
function toRequestBody(
  input: string,
  history: ChatMessage[],
  sessionSnapshot?: string | null,
  familyProfile?: unknown,
) {
  return {
    messages: [
      ...history,
      { id: `u${history.length}`, role: 'user' as const, parts: [{ type: 'text' as const, text: input }] },
    ],
    ...(sessionSnapshot ? { sessionSnapshot } : {}),
    ...(familyProfile ? { familyProfile } : {}),
  };
}

function isStreamChunk(v: unknown): v is StreamChunk {
  return typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string';
}

export async function* chatHttpStream(
  input: string,
  history: ChatMessage[],
  sessionSnapshot?: string | null,
  familyProfile?: unknown,
): AsyncIterable<StreamChunk> {
  let res: Response;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toRequestBody(input, history, sessionSnapshot, familyProfile)),
    });
  } catch {
    yield { type: 'text-delta', delta: "I couldn't reach my notes just now — try me again in a moment?" };
    yield { type: 'done' };
    return;
  }

  if (!res.ok || !res.body) {
    yield { type: 'text-delta', delta: "Hmm — I lost my footing for a second. Give me another go?" };
    yield { type: 'done' };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawDone = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const parsed: unknown = JSON.parse(line);
          if (isStreamChunk(parsed)) {
            if (parsed.type === 'done') sawDone = true;
            yield parsed;
          }
        } catch {
          /* skip a malformed line rather than break the stream */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Guarantee the hook always sees a terminal chunk.
  if (!sawDone) yield { type: 'done' };
}
