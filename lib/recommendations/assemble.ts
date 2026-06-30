/* Recommendation assembly — step (b) of the two-step runtime (spec 03b / 08b-2).
 * Server-side only. Takes the family_profile + trip_brief + ≤15 candidate intelligence
 * records, calls the assembly model with the 08b-2 prompt, and validates the JSON
 * against the contract. Malformed output FAILS (spec 14) — never a partial recommendation.
 *
 * The model call is INJECTABLE (deps.callModel): the default implementation calls
 * Anthropic (claude-sonnet-4-6, ANTHROPIC_API_KEY server-side only); tests inject
 * a fake so the contract tests + CI run with no API key. */
import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  recommendationAssemblySchema,
  type RecommendationAssembly,
} from '@/lib/contracts/recommendation-assembly';
import type { Candidate } from '@/lib/review-intelligence/query';
import { startDebugTimer } from '@/lib/observability/debug-timing';

export const ASSEMBLY_MODEL = 'claude-sonnet-4-6';

/** Per-request timeout (ms) for the assembly model call. A hung/slow Anthropic response must fail WARM
 * BEFORE the serverless function's wall-clock kill (60s on /api/chat), so the chat speaks a graceful
 * retry instead of the platform dropping the stream mid-flight (the prod 60s-timeout symptom — see prod
 * logs 2026-06-30: queryCandidates Phuket count=15 → assembly call hung → 60s kill). Default 45s, env-
 * overridable. Read at call time (never at import) so the module stays env-free to import. */
export function assemblyTimeoutMs(): number {
  const raw = Number(process.env.ASSEMBLY_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 45_000;
}
const PROMPT_PATH = path.join(
  process.cwd(),
  'prompts',
  'conversation-agent',
  'recommendation-assembly.md',
);

/** Inputs to the assembly call — resolved upstream by the route. */
export interface AssembleInput {
  family_profile: unknown;
  trip_brief: unknown;
  candidates: Candidate[];
}

/** The injectable model seam: given the system prompt + user JSON, return raw text. */
export type CallModel = (args: {
  system: string;
  userJson: string;
  model: string;
}) => Promise<string>;

export interface AssembleDeps {
  callModel?: CallModel;
  /** Override the system prompt (tests); defaults to the on-disk 08b-2 artifact. */
  systemPrompt?: string;
}

/** Thrown when the model returns output that is not valid assembly JSON (spec 14). */
export class AssemblyError extends Error {
  constructor(
    message: string,
    readonly code: 'malformed_output' | 'model_call_failed',
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AssemblyError';
  }
}

let cachedPrompt: string | null = null;
async function loadSystemPrompt(): Promise<string> {
  if (cachedPrompt == null) cachedPrompt = await fs.readFile(PROMPT_PATH, 'utf8');
  return cachedPrompt;
}

/** Strip an optional ```json … ``` fence if the model wrapped its output. */
function stripFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

/** Default model call — Anthropic Messages API. Imported lazily so the module (and the
 * contract tests that inject a fake) never require an API key just to load. */
const defaultCallModel: CallModel = async ({ system, userJson, model }) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AssemblyError(
      'ANTHROPIC_API_KEY is not set (server-side only; see specs/13).',
      'model_call_failed',
    );
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  // Per-request timeout (not the SDK's default): a hung model call throws APIConnectionTimeoutError,
  // caught upstream and wrapped as a warm AssemblyError('model_call_failed') → the chat offers a retry,
  // never the raw 60s platform kill that drops the stream.
  const resp = await client.messages.create(
    {
      model,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: userJson }],
    },
    { timeout: assemblyTimeoutMs() },
  );
  const block = resp.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') {
    throw new AssemblyError('model returned no text block', 'malformed_output');
  }
  return block.text;
};

/**
 * Run the assembly model and validate its output. Returns the parsed assembly object
 * (success or error variant). Throws AssemblyError on a failed call or malformed JSON.
 */
export async function assembleRecommendations(
  input: AssembleInput,
  deps: AssembleDeps = {},
): Promise<RecommendationAssembly> {
  const callModel = deps.callModel ?? defaultCallModel;
  const system = deps.systemPrompt ?? (await loadSystemPrompt());

  // The model receives the inputs as a single JSON object.
  const userJson = JSON.stringify({
    family_profile: input.family_profile,
    trip_brief: input.trip_brief,
    candidates: input.candidates,
  });

  // DEBUG_BOOKING=1 → time the model call specifically (prod 2026-06-30 showed the assembly step is
  // where /api/chat hangs to the 60s kill). promptBytes/candidates help spot a too-large input; the
  // model:done/model:timeout line tells us whether the 45s warm-fail fired. Free no-op when off.
  const t = startDebugTimer('assemble.model', {
    candidates: input.candidates.length,
    promptBytes: userJson.length,
    timeoutMs: assemblyTimeoutMs(),
  });

  let raw: string;
  try {
    raw = await callModel({ system, userJson, model: ASSEMBLY_MODEL });
    t.mark('model:done', { outBytes: raw.length });
  } catch (e) {
    t.fail(e);
    if (e instanceof AssemblyError) throw e;
    throw new AssemblyError(
      `assembly model call failed: ${e instanceof Error ? e.message : String(e)}`,
      'model_call_failed',
      e,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch (e) {
    throw new AssemblyError('assembly output was not valid JSON', 'malformed_output', e);
  }

  const result = recommendationAssemblySchema.safeParse(parsed);
  if (!result.success) {
    throw new AssemblyError(
      `assembly output did not match the contract: ${result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')}`,
      'malformed_output',
      result.error,
    );
  }
  return result.data;
}
