/* Conversation Agent runtime (specs 08b / 08b-1 / 03b). Server-side only.
 *
 * Wraps the Vercel AI SDK streamText loop with:
 *   • the 08b-1 system prompt + injected <family_profile> / <session_snapshot> blocks,
 *   • the `assemble_recommendations` tool (→ runAssembly: query 08a-5 + assemble 08b-2),
 *   • an INJECTABLE model so CI runs with no ANTHROPIC_API_KEY (tests pass a
 *     MockLanguageModelV3 from `ai/test`).
 *
 * The tool RETURNS the assembly JSON to the model AND the route forwards it to the
 * client as an inline component part (3b's `recommendation-set`), so the cards render
 * in the chat. Hard flags ride through untouched (08b-2 already guarantees survival). */
import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { streamText, tool, stepCountIs, type LanguageModel, type ModelMessage } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/db/server';
import { runAssembly } from '@/lib/recommendations/run-assembly';
import { DESTINATIONS, BUDGET_TIERS } from '@/lib/db/schemas';
import type { RecommendationAssembly } from '@/lib/contracts/recommendation-assembly';

export const AGENT_MODEL = 'claude-sonnet-4-20250514';

const SYSTEM_PROMPT_PATH = path.join(
  process.cwd(),
  'prompts',
  'conversation-agent',
  'system-prompt.md',
);

let cachedSystem: string | null = null;
async function loadSystemPrompt(): Promise<string> {
  if (cachedSystem == null) cachedSystem = await fs.readFile(SYSTEM_PROMPT_PATH, 'utf8');
  return cachedSystem;
}

import { buildSystem } from './build-system';
export { buildSystem };

/** The tool input the model fills in to request a recommendation. */
const assembleToolInput = z.object({
  family_profile: z
    .object({ budget_tier: z.enum(BUDGET_TIERS).nullable().optional() })
    .passthrough(),
  trip_brief: z
    .object({
      destination: z.enum(DESTINATIONS),
      evaluate_only: z.boolean().optional(),
      pre_shortlisted_hotels: z.array(z.string()).nullable().optional(),
    })
    .passthrough(),
});

export interface RunConversationArgs {
  messages: ModelMessage[];
  /** Injectable model — default Anthropic; tests pass a MockLanguageModelV3. */
  model?: LanguageModel;
  familyProfile?: unknown;
  sessionSnapshot?: string | null;
  /** Override the assembly model seam (tests); forwarded to runAssembly. */
  assembleModel?: Parameters<typeof runAssembly>[2];
}

/**
 * Run one streamed assistant turn. Returns the streamText result; the route turns it
 * into a UI-message stream response. The assemble_recommendations tool calls runAssembly
 * directly (no HTTP self-call) and returns the assembly JSON to the model.
 */
export async function runConversation(args: RunConversationArgs) {
  const model = args.model ?? anthropic(AGENT_MODEL);
  const system = buildSystem(await loadSystemPrompt(), {
    familyProfile: args.familyProfile,
    sessionSnapshot: args.sessionSnapshot,
  });

  return streamText({
    model,
    system,
    messages: args.messages,
    // Allow the model to call the tool and then narrate the result in the same turn.
    stopWhen: stepCountIs(4),
    tools: {
      assemble_recommendations: tool({
        description:
          'Assemble 2–3 family hotel recommendations for a confirmed destination + trip ' +
          'type from cached review intelligence. Call only when destination AND trip type ' +
          'are known. Returns structured recommendation JSON (top pick + alternatives, ' +
          'with hard flags). Never invent hotels — this is the only source of hotel facts.',
        inputSchema: assembleToolInput,
        execute: async (input) => {
          const supabase = createServiceClient();
          const assembly = await runAssembly(supabase, input, args.assembleModel);
          // Hydrate display metadata from `hotels` (spec 03b: single batched query by
          // hotel_id) so the client can render cards without a DB round-trip.
          return hydrateHotels(supabase, assembly);
        },
      }),
    },
  });
}

/** Attach `_hotel` display metadata to each pick (spec 03b card hydration). Single
 *  batched query by hotel_id. Error variants pass through untouched. */
export async function hydrateHotels(
  supabase: SupabaseClient,
  assembly: RecommendationAssembly,
): Promise<RecommendationAssembly> {
  if ('error' in assembly) return assembly;

  const ids = [
    assembly.top_pick.hotel_id,
    ...assembly.other_picks.map((p) => p.hotel_id),
  ];
  const { data } = await supabase
    .from('hotels')
    .select('id, destination, area, price_tier, star_rating, images')
    .in('id', ids);

  const byId = new Map((data ?? []).map((h) => [h.id, h]));
  const attach = <T extends { hotel_id: string }>(pick: T) => ({
    ...pick,
    _hotel: byId.get(pick.hotel_id) ?? null,
  });

  return {
    ...assembly,
    top_pick: attach(assembly.top_pick),
    other_picks: assembly.other_picks.map(attach),
  };
}
