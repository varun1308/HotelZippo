/* E2E-ONLY deterministic /api/chat stub (specs/15a-e2e-test-strategy.md §1.1).
 *
 * When NEXT_PUBLIC_E2E === '1' (set ONLY by the Playwright harness, never in any real
 * deployment), the /api/chat route delegates here instead of calling the live Anthropic
 * agent. This makes the conversation journey deterministic, key-free, and CI-safe: the
 * E2E suite asserts STRUCTURE + BEHAVIOUR, not live-LLM content.
 *
 * Crucially it speaks the EXACT same NDJSON StreamChunk protocol the live route emits
 * (typing → text-delta* → optional component → done), so 100% of the CLIENT code under
 * test is production code — only the upstream provider is swapped.
 *
 * Data source: the existing scripted concierge conversation (`phuketScript` in
 * ./mockStream) — including the final inline `recommendation-set` (with hard flags). We
 * advance the script by the number of USER turns already in the history, so each send
 * yields the next assistant turn deterministically and the "find hotels" turn reliably
 * emits recommendations.
 *
 * NOT a client module — imported only by the server route. No 'use client'. */
import { phuketScript } from './mockStream';
import type { ChatMessage, StreamChunk } from './types';

const encoder = new TextEncoder();
function encodeChunk(chunk: StreamChunk): Uint8Array {
  return encoder.encode(JSON.stringify(chunk) + '\n');
}

/** True when the harness has enabled E2E stub mode. Read at call time (not import). */
export function e2eEnabled(): boolean {
  return process.env.NEXT_PUBLIC_E2E === '1';
}

interface AssistantStep {
  role: 'assistant';
  paragraphs: string[];
  offerForm?: boolean;
  researching?: string;
  recommendations?: unknown;
}

/** Pick the assistant turn to emit for this send: the Nth assistant step, where N is the
 * number of user turns already spoken (1-based). The script alternates user/assistant
 * starting with an assistant greeting, so we walk to the (userCount)-th assistant step
 * AFTER the opening greeting. If we run past the script, replay the final (recommendation)
 * turn so the journey can always reach cards. */
function pickAssistantStep(userTurns: number): AssistantStep {
  const assistantSteps = phuketScript.filter((s) => s.role === 'assistant') as AssistantStep[];
  // assistantSteps[0] is the opening greeting (before any user turn). After the user's
  // Nth message we want assistantSteps[N] (the reply), clamped to the last step.
  const idx = Math.min(userTurns, assistantSteps.length - 1);
  return assistantSteps[idx];
}

/** Build the deterministic NDJSON stream for one assistant turn. delayMs=0 → instant. */
function streamForStep(step: AssistantStep): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encodeChunk({ type: 'typing' }));
      for (const paragraph of step.paragraphs) {
        // Whole-paragraph deltas are valid protocol; the client reassembles losslessly.
        // Instant playback (no waits) keeps E2E fast + flake-free.
        controller.enqueue(encodeChunk({ type: 'text-delta', delta: paragraph }));
        controller.enqueue(encodeChunk({ type: 'text-delta', delta: '\n\n' }));
      }
      if (step.offerForm) controller.enqueue(encodeChunk({ type: 'offer-form' }));
      if (step.researching) {
        controller.enqueue(encodeChunk({ type: 'researching', label: step.researching }));
      }
      if (step.recommendations) {
        controller.enqueue(
          encodeChunk({
            type: 'component',
            component: 'recommendation-set',
            props: step.recommendations,
          }),
        );
      }
      controller.enqueue(encodeChunk({ type: 'done' }));
      controller.close();
    },
  });
}

/** Handle a POST /api/chat in E2E stub mode. Mirrors the live route's response shape +
 * headers exactly. Validates the body the same way so the 400 paths stay covered. */
export function e2eChatStub(messages: ChatMessage[]): Response {
  const userTurns = messages.filter((m) => m.role === 'user').length;
  const step = pickAssistantStep(userTurns);
  return new Response(streamForStep(step), {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
    },
  });
}
