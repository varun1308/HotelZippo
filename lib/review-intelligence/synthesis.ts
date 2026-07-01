/* Synthesis call + confidence gate (Phase 6 · specs/02 Stage 5 / 08a-1 / 08a-2).
 * Server-side. Calls the 08a-1 synthesis prompt with the segmented review input, parses
 * and validates the JSON, and applies the confidence gate. Model is INJECTABLE (default
 * Anthropic claude-sonnet-4-6, lazily imported, ANTHROPIC_API_KEY server-side only) so the
 * 7 synthesis test cases (08a-3) and the pipeline tests run key-free with a fixture model.
 *
 * Malformed output → SynthesisError (the pipeline fails that hotel with no partial write
 * and logs the full response via OTEL, per spec 14 / TC-P14). Wrapped in an OTEL span. */
// No `import 'server-only'`: part of the worker chain (run by the standalone Node worker via
// tsx). Server-side by construction (Anthropic key); never imported by a client component.
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { withSpan, HZ } from '@/lib/otel/trace';
import { SIGNAL_STRENGTHS, hardFlagSchema } from '@/lib/db/schemas';

export const SYNTHESIS_MODEL = 'claude-sonnet-4-6';
const PROMPT_PATH = path.join(process.cwd(), 'prompts/review-intelligence-agent/synthesis.md');

const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

const categoryStrings = z.object({
  rooms: z.string(),
  facilities: z.string(),
  food: z.string(),
  location: z.string(),
});
const categorySignals = z.object({
  rooms: z.enum(SIGNAL_STRENGTHS),
  facilities: z.enum(SIGNAL_STRENGTHS),
  food: z.enum(SIGNAL_STRENGTHS),
  location: z.enum(SIGNAL_STRENGTHS),
});
const categoryPhrases = z.object({
  rooms: z.array(z.string()),
  facilities: z.array(z.string()),
  food: z.array(z.string()),
  location: z.array(z.string()),
});

/** The exact JSON the 08a-1 prompt emits (STEP 4 output schema). This is the model-output
 * contract — distinct from the DB row (which adds id / hotel_id / last_refreshed /
 * low_confidence). It deliberately mirrors lib/seed/types demoIntelligenceSchema PLUS the
 * `confidence` block the gate reads. */
export const synthesisOutputSchema = z
  .object({
    confidence: z.object({
      overall: z.enum(CONFIDENCE_LEVELS),
      rooms: z.enum(SIGNAL_STRENGTHS),
      facilities: z.enum(SIGNAL_STRENGTHS),
      food: z.enum(SIGNAL_STRENGTHS),
      location: z.enum(SIGNAL_STRENGTHS),
    }),
    rooms_summary: z.string(),
    facilities_summary: z.string(),
    food_summary: z.string(),
    location_summary: z.string(),
    hard_flags: z.array(hardFlagSchema),
    conflicting_signals: categoryStrings,
    family_signal_strength: categorySignals,
    supporting_phrases: categoryPhrases,
    indian_food_signal: z.string(),
    review_count_family: z.number().int().nonnegative(),
    review_count_total: z.number().int().nonnegative(),
  })
  .strict();

export type SynthesisOutput = z.infer<typeof synthesisOutputSchema>;

export class SynthesisError extends Error {
  constructor(
    message: string,
    readonly code: 'model_call_failed' | 'malformed_output',
    readonly raw?: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SynthesisError';
  }
}

/** Injectable model call: system prompt + the formatted review input → raw text. */
export type SynthesisCallModel = (args: {
  system: string;
  input: string;
  model: string;
}) => Promise<string>;

export interface SynthesiseDeps {
  callModel?: SynthesisCallModel;
  systemPrompt?: string;
}

let cachedPrompt: string | null = null;
async function loadPrompt(): Promise<string> {
  if (cachedPrompt == null) cachedPrompt = await fs.readFile(PROMPT_PATH, 'utf8');
  return cachedPrompt;
}

/** Strip an optional ```json … ``` fence if the model wrapped its output. */
function stripFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

const defaultCallModel: SynthesisCallModel = async ({ system, input, model }) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new SynthesisError('ANTHROPIC_API_KEY is not set (server-side only; see specs/13).', 'model_call_failed');
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model,
    max_tokens: 4096,
    system,
    messages: [{ role: 'user', content: input }],
  });
  const block = resp.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') {
    throw new SynthesisError('model returned no text block', 'malformed_output');
  }
  return block.text;
};

/** The confidence-gate outcome (08a-2): how the pipeline should publish this record. */
export interface GateResult {
  /** low_confidence column value. */
  lowConfidence: boolean;
  /** medium → flag for the human review queue. */
  reviewQueue: boolean;
  /** low → raise a Dash0 alert. */
  alert: boolean;
}

/** Map the synthesis confidence.overall → the publish gate (08a-2 confidence gate). */
export function confidenceGate(overall: ConfidenceLevel): GateResult {
  switch (overall) {
    case 'high':
      return { lowConfidence: false, reviewQueue: false, alert: false };
    case 'medium':
      return { lowConfidence: false, reviewQueue: true, alert: false };
    case 'low':
      return { lowConfidence: true, reviewQueue: false, alert: true };
  }
}

/** Call synthesis, validate the JSON, and return the parsed output + the gate. Throws
 * SynthesisError on a failed call or malformed/invalid JSON (no partial write upstream). */
export async function synthesise(
  input: string,
  deps: SynthesiseDeps = {},
): Promise<{ output: SynthesisOutput; gate: GateResult }> {
  const callModel = deps.callModel ?? defaultCallModel;
  const system = deps.systemPrompt ?? (await loadPrompt());

  return withSpan(
    'anthropic.review_synthesis',
    { attrs: { [HZ.model]: SYNTHESIS_MODEL } },
    async (span) => {
      let raw: string;
      try {
        raw = await callModel({ system, input, model: SYNTHESIS_MODEL });
      } catch (e) {
        if (e instanceof SynthesisError) throw e;
        throw new SynthesisError(
          `synthesis model call failed: ${e instanceof Error ? e.message : String(e)}`,
          'model_call_failed',
          undefined,
          e,
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(stripFence(raw));
      } catch (e) {
        throw new SynthesisError('synthesis output was not valid JSON', 'malformed_output', raw, e);
      }
      const result = synthesisOutputSchema.safeParse(parsed);
      if (!result.success) {
        throw new SynthesisError(
          `synthesis output failed schema validation: ${result.error.message}`,
          'malformed_output',
          raw,
        );
      }

      const gate = confidenceGate(result.data.confidence.overall);
      span.setAttribute('hz.confidence', result.data.confidence.overall);
      span.setAttribute('hz.hard_flag_count', result.data.hard_flags.length);
      span.setAttribute('hz.low_confidence', gate.lowConfidence);
      return { output: result.data, gate };
    },
  );
}
