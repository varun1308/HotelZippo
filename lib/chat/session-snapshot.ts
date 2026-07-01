/* Session Snapshot generator (Phase 5 · specs/08b-3-session-snapshot.md).
 *
 * One-shot compression of a full conversation transcript into a dense PLAIN-TEXT summary
 * for sessions.session_summary, injected as <session_snapshot> on resume. The model call
 * is INJECTABLE (deps.callModel) so contract/unit tests run key-free; the default lazily
 * imports the Anthropic SDK (server-side only, ANTHROPIC_API_KEY) exactly like the
 * recommendation assembler (lib/recommendations/assemble.ts).
 *
 * Token budget (08b-3): under 400 preferred, 500 HARD CEILING. Enforcement is
 * prompt-driven; if the model ever exceeds the ceiling we record the overflow on the OTEL
 * span (per spec 14 — the single observability path) but STILL store the summary, since a
 * mid-sentence truncation degrades resume worse than a slightly-long summary. */
import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import type { ModelMessage } from 'ai';

/* Session-summarisation model. Defaults to Haiku and is env-overridable (SNAPSHOT_MODEL) to revert to
 * claude-sonnet-4-6 with no redeploy. Mirrors AGENT_MODEL / ASSEMBLY_MODEL. */
export const SNAPSHOT_MODEL = process.env.SNAPSHOT_MODEL || 'claude-haiku-4-5';
const PROMPT_PATH = path.join(process.cwd(), 'prompts/conversation-agent/session-snapshot.md');

/** Token budget from the contract. ~4 chars/token heuristic for the overflow check —
 * we don't tokenise exactly (no tokenizer dependency); this just flags egregious overflow. */
export const SNAPSHOT_TOKEN_CEILING = 500;
const CHARS_PER_TOKEN = 4;

/** Injectable model call: takes the system prompt + the transcript, returns plain text. */
export type SnapshotCallModel = (args: {
  system: string;
  transcript: string;
  model: string;
}) => Promise<string>;

export interface GenerateSnapshotDeps {
  callModel?: SnapshotCallModel;
  /** Override the on-disk prompt (tests). */
  systemPrompt?: string;
}

export class SnapshotError extends Error {
  constructor(
    message: string,
    readonly code: 'model_call_failed' | 'empty_output',
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SnapshotError';
  }
}

let cachedPrompt: string | null = null;
async function loadPrompt(): Promise<string> {
  if (cachedPrompt == null) cachedPrompt = await fs.readFile(PROMPT_PATH, 'utf8');
  return cachedPrompt;
}

/** Render the conversation history as a plain transcript for the user turn. */
export function renderTranscript(messages: ModelMessage[]): string {
  return messages
    .map((m) => {
      const role = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Concierge' : m.role;
      const content =
        typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? m.content
                .map((p) => (p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text) : ''))
                .join('')
            : '';
      return { role, content: content.trim() };
    })
    // Drop turns with no CONTENT (e.g. an empty assistant placeholder) — they carry no state.
    .filter((m) => m.content.length > 0)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');
}

/** Rough token estimate (chars/4). Only used to flag ceiling overflow for observability. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Default Anthropic call — lazily imported so the module never needs a key just to load. */
const defaultCallModel: SnapshotCallModel = async ({ system, transcript, model }) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new SnapshotError('ANTHROPIC_API_KEY is not set (server-side only; see specs/13).', 'model_call_failed');
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model,
    max_tokens: 700, // a little headroom over the 500-token ceiling so we never clip mid-word
    system,
    messages: [{ role: 'user', content: transcript }],
  });
  const block = resp.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') {
    throw new SnapshotError('model returned no text block', 'empty_output');
  }
  return block.text;
};

/**
 * Generate a session snapshot from the conversation history. Returns the plain-text
 * summary (trimmed). Wrapped in an OTEL span (anthropic.session_snapshot) per spec 14;
 * overflow past the 500-token ceiling is recorded on the span but not fatal.
 */
export async function generateSnapshot(
  messages: ModelMessage[],
  deps: GenerateSnapshotDeps = {},
): Promise<string> {
  const callModel = deps.callModel ?? defaultCallModel;
  const system = deps.systemPrompt ?? (await loadPrompt());
  const transcript = renderTranscript(messages);

  const tracer = trace.getTracer('hotelzippo');
  return tracer.startActiveSpan('anthropic.session_snapshot', async (span) => {
    span.setAttribute('model', SNAPSHOT_MODEL);
    const start = Date.now();
    try {
      const raw = await callModel({ system, transcript, model: SNAPSHOT_MODEL });
      const summary = raw.trim();
      if (summary.length === 0) {
        throw new SnapshotError('snapshot output was empty', 'empty_output');
      }

      const tokens = estimateTokens(summary);
      span.setAttribute('snapshot.estimated_tokens', tokens);
      span.setAttribute('snapshot.token_ceiling', SNAPSHOT_TOKEN_CEILING);
      if (tokens > SNAPSHOT_TOKEN_CEILING) {
        // Over the hard ceiling: record it for Dash0 but STILL return the summary
        // (prompt-enforced budget; truncating mid-sentence is worse). Spec 08b-3 + 14.
        span.setAttribute('snapshot.over_ceiling', true);
        span.addEvent('snapshot_over_token_ceiling', { estimated_tokens: tokens });
      }
      span.setStatus({ code: SpanStatusCode.OK });
      return summary;
    } catch (e) {
      span.recordException(e as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      if (e instanceof SnapshotError) throw e;
      throw new SnapshotError(
        `snapshot model call failed: ${e instanceof Error ? e.message : String(e)}`,
        'model_call_failed',
        e,
      );
    } finally {
      span.setAttribute('duration_ms', Date.now() - start);
      span.end();
    }
  });
}
