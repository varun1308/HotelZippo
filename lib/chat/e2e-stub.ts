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

interface CardLike {
  hotelId?: string;
  hotelName: string;
  [k: string]: unknown;
}
interface RecoLike {
  topPick: CardLike;
  otherPicks: CardLike[];
  [k: string]: unknown;
}

/** Rebind the scripted recommendation cards to REAL seeded hotels (id + name) so the stubbed
 * cards are production-faithful: the Save + Proceed-to-book paths key off `hotelId`, which the
 * live map-recommendation carries from the DB. We keep the scripted DISPLAY content (hard
 * flags, verdict, category summaries — what J2 asserts on) and only swap identity onto real
 * seeded rows, so the top pick + alts are all saveable/bookable. Best-effort: if the lookup
 * fails (no DB / nothing seeded), the cards still render; only save/booking stay inert. */
async function withRealHotelIds(reco: unknown): Promise<unknown> {
  if (!reco || typeof reco !== 'object') return reco;
  const r = reco as RecoLike;

  let seeded: Array<{ id: string; name: string; destination: string }> = [];
  try {
    const { createServiceClient } = await import('@/lib/db/server');
    const { data } = await createServiceClient()
      .from('hotels')
      .select('id, name, destination')
      .eq('destination', r.topPick?.destination ?? 'Phuket')
      .order('name', { ascending: true });
    seeded = data ?? [];
  } catch {
    return reco; // no DB → leave the scripted cards as-is (render-only)
  }
  if (seeded.length === 0) return reco;

  // Assign distinct seeded hotels to the cards in order (top pick first, then alts), keeping
  // the scripted display fields. If there aren't enough seeded rows, leave extras untouched.
  let cursor = 0;
  const rebind = (c: CardLike): CardLike => {
    const hit = seeded[cursor];
    if (!hit) return c;
    cursor += 1;
    return { ...c, hotelId: hit.id, hotelName: hit.name, destination: hit.destination };
  };
  return {
    ...r,
    topPick: rebind(r.topPick),
    otherPicks: (r.otherPicks ?? []).map(rebind),
  };
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

/** Build the deterministic NDJSON stream for one assistant turn. delayMs=0 → instant.
 * `recommendations` is pre-resolved (real hotel ids stamped) so this stays sync. */
function streamForStep(step: AssistantStep, recommendations: unknown): ReadableStream<Uint8Array> {
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
      if (recommendations) {
        controller.enqueue(
          encodeChunk({
            type: 'component',
            component: 'recommendation-set',
            props: recommendations,
          }),
        );
      }
      controller.enqueue(encodeChunk({ type: 'done' }));
      controller.close();
    },
  });
}

/** Handle a POST /api/chat in E2E stub mode. Mirrors the live route's response shape +
 * headers exactly. Async because the recommendation turn resolves real seeded hotel ids so
 * the stubbed cards drive the Save + Proceed-to-book paths exactly like production. */
export async function e2eChatStub(messages: ChatMessage[]): Promise<Response> {
  const userTurns = messages.filter((m) => m.role === 'user').length;
  const step = pickAssistantStep(userTurns);
  const recommendations = step.recommendations
    ? await withRealHotelIds(step.recommendations)
    : undefined;
  return new Response(streamForStep(step, recommendations), {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
    },
  });
}
