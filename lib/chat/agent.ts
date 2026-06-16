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
import {
  loadFamilyProfile,
  saveFamilyProfile,
  mergeProfile,
  changedFieldLabels,
  type ProfilePatch,
} from '@/lib/db/persistence/family-profiles';
import type { Child } from '@/components/profile';

export const AGENT_MODEL = 'claude-sonnet-4-6';

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

/** Input the model fills when the user CONFIRMS a change/addition to a known profile.
 * Every field optional — the agent sends only what changed. Enums are validated against the
 * canonical sets so an out-of-range value can never be written. */
const FOOD_VALUES = ['vegetarian', 'vegan', 'none'] as const;
const childSchema = z.object({ name: z.string(), age: z.number().int().min(0).max(17) });
const updateProfileInput = z.object({
  name: z.string().min(1).optional(),
  hometown: z.string().nullable().optional(),
  spouse: z.boolean().optional(),
  children: z.array(childSchema).optional(),
  food: z.enum(FOOD_VALUES).optional(),
  indianFoodMatters: z.boolean().optional(),
  budgetTier: z.enum(BUDGET_TIERS).optional(),
  brandPreferences: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
});

/** The result the `update_profile` tool returns to the model AND the route forwards to the
 * client as a `profile-update` component chunk. `updated` is the human field labels actually
 * changed (empty ⇒ no-op: no known profile, or the patch matched the current values). */
export interface ProfileUpdateResult {
  updated: string[];
}

export interface RunConversationArgs {
  messages: ModelMessage[];
  /** Injectable model — default Anthropic; tests pass a MockLanguageModelV3. */
  model?: LanguageModel;
  familyProfile?: unknown;
  sessionSnapshot?: string | null;
  /** Override the assembly model seam (tests); forwarded to runAssembly. */
  assembleModel?: Parameters<typeof runAssembly>[2];
  /** Signed-in user id — enables the `update_profile` tool (RLS-scoped writes). */
  userId?: string;
  /** RLS-scoped client (cookie SSR) for profile reads/writes. Required alongside `userId`
   *  for `update_profile` to register; absent ⇒ tool not offered (CI/env-free stay green). */
  profileClient?: SupabaseClient;
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
      // Only offered to a signed-in user with an RLS-scoped client (env-free build + key-free
      // CI never register it). It changes a KNOWN profile only — onboarding owns the first save.
      ...(args.userId && args.profileClient
        ? {
            update_profile: tool({
              description:
                'Persist a CONFIRMED change or addition to the signed-in family’s saved ' +
                'profile (e.g. they switch budget to luxury, or tell you they’re now ' +
                'vegetarian). Call ONLY after the user confirms the change, and ONLY for a ' +
                'returning user who already has a saved profile — never during first-time ' +
                'onboarding (the summary/form saves that), and never for an unconfirmed or ' +
                'hypothetical preference. Send only the fields that changed. If no profile ' +
                'exists yet it is a safe no-op.',
              inputSchema: updateProfileInput,
              execute: (input): Promise<ProfileUpdateResult> =>
                runUpdateProfile(input, args.userId!, args.profileClient!),
            }),
          }
        : {}),
    },
  });
}

/** Merge a confirmed patch into the signed-in user's EXISTING profile (RLS-scoped). No-op
 *  (returns `{updated: []}`) when there is no profile yet (onboarding owns the first save) or
 *  the patch matches current values — so no chip ever fires on a non-change. */
export async function runUpdateProfile(
  input: z.infer<typeof updateProfileInput>,
  userId: string,
  client: SupabaseClient,
): Promise<ProfileUpdateResult> {
  const existing = await loadFamilyProfile(client);
  if (!existing) return { updated: [] }; // no known profile → onboarding's job, not ours
  const patch = input as ProfilePatch & { children?: Child[] };
  const updated = changedFieldLabels(existing, patch);
  if (updated.length === 0) return { updated: [] }; // patch matched current values → no write
  await saveFamilyProfile(mergeProfile(existing, patch), userId, client);
  return { updated };
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
    .select('id, destination, area, price_tier, star_rating, images, source')
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
