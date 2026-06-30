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
import { runAssembly, type AssemblyOrPreview, type RuntimeSeedDeps } from '@/lib/recommendations/run-assembly';
import { createJob, findReusable } from '@/lib/recommendations/job-ledger';
import { computeInputHash } from '@/lib/recommendations/input-hash';
import { createRouteStackFetch } from '@/lib/booking/transport';
import { createMockRouteStackFetch, routeStackMockEnabled } from '@/lib/booking/mock-transport';
import { makeSupabaseIdCache } from '@/lib/booking/id-cache';
import { resolveCityLocation } from '@/lib/curation/google-places';
import { DESTINATIONS, BUDGET_TIERS } from '@/lib/db/schemas';
import type { RecommendationAssembly, RecommendationSuccess } from '@/lib/contracts/recommendation-assembly';
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
  /** Request origin (for the async-assembly worker kick). The route passes req.url's origin. */
  appOrigin?: string;
}

/** Async-assembly flag (03c). When ASYNC_ASSEMBLY=1, the assemble_recommendations tool dispatches the
 * slow LLM call as a JOB and returns fast (the client polls for staged progress + cards) instead of
 * running the model inline on the chat turn's 60s budget. Off by default → today's synchronous path,
 * byte-for-byte. Read at call time (never at import) so the module stays env-free to import. */
export function asyncAssemblyEnabled(): boolean {
  return process.env.ASYNC_ASSEMBLY === '1';
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

          // ASYNC path (03c): dispatch the slow assembly as a JOB and return FAST — the chat turn never
          // makes the model call, so it can't ride the 60s function cap. The client polls the job for
          // staged progress + cards. Gated by ASYNC_ASSEMBLY=1; off → today's synchronous path below.
          if (asyncAssemblyEnabled()) {
            const job = await dispatchAssemblyJob(supabase, input, args);
            if (job) return job; // { result: 'assembly_started', jobId, destination }
            // Fall through to synchronous on any dispatch failure — never dead-end a recommendation turn.
          }

          // 12i-C: provide the runtime-seed seam (RouteStack transport + cache + warm-failing geocode)
          // so an empty 5-enum destination can be seeded on the fly. Gated by PREVIEW_RUNTIME_SEED
          // inside runAssembly; built best-effort so a missing piece never breaks the turn.
          const seedDeps = buildRuntimeSeedDeps(supabase);
          const assembly = await runAssembly(supabase, input, args.assembleModel, seedDeps);
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

/** The sentinel the async tool returns to the model (03c). The chat route translates this into an
 *  `assembly-progress` component chunk; the client polls the jobId for staged progress + cards. */
export interface AssemblyStarted {
  result: 'assembly_started';
  jobId: string;
  destination: string;
}

/** Dispatch an assembly JOB and return the sentinel (or null on any failure → caller falls back to the
 *  synchronous path). Reuses a recent identical job (input_hash) to avoid double-spend, then fires a
 *  best-effort worker kick. Never throws — a recommendation turn must never dead-end. */
async function dispatchAssemblyJob(
  supabase: SupabaseClient,
  input: Parameters<typeof runAssembly>[1],
  args: RunConversationArgs,
): Promise<AssemblyStarted | null> {
  try {
    const destination = String(input.trip_brief.destination);
    const inputHash = computeInputHash({
      destination,
      tripType: (input.trip_brief.trip_type as string | undefined) ?? null,
      budgetTier: (input.family_profile?.budget_tier as string | undefined) ?? null,
      food: (input.family_profile?.food_preference as string | undefined) ?? null,
    });

    // Reuse guard: a recent non-failed job for the same input → re-attach (one model call, not two).
    const reusable = await findReusable(supabase, inputHash).catch(() => null);
    const job =
      reusable ??
      (await createJob(supabase, {
        userId: args.userId ?? null,
        destination,
        inputHash,
        input,
      }));

    // Best-effort worker kick (fire-and-forget; the poll route re-kicks if this is lost). No origin
    // (standalone/test) → skip the kick; the first client poll's re-kick still runs it.
    if (args.appOrigin && !reusable) {
      void fetch(`${args.appOrigin}/api/assembly/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id }),
        cache: 'no-store',
      }).catch(() => {});
    }

    return { result: 'assembly_started', jobId: job.id, destination };
  } catch {
    return null; // fall back to synchronous assembly
  }
}

/** Build the 12i-C runtime-seed seam (RouteStack transport + id-cache + warm-failing geocode). Returns
 *  undefined if the service client can't back the cache — runAssembly then simply won't seed. */
function buildRuntimeSeedDeps(supabase: SupabaseClient): RuntimeSeedDeps | undefined {
  try {
    const geocode = async (q: string) => {
      try {
        return await resolveCityLocation(q);
      } catch {
        return null;
      }
    };
    // Honour the mock-demo flag here too (10e). The preview runtime-seed path (12i-C) hits RouteStack
    // search-hotels for a destination with no published hotels — if it used the LIVE transport while
    // ROUTESTACK_MOCK=1, a Phuket chat with an empty prod DB would hang on the unstable sandbox and the
    // serverless function would hit its 60s kill. The mock's appOrigin only matters for the payment-url
    // deep link, which the seed path never calls, so '' is safe here.
    const mock = routeStackMockEnabled();
    const fetchImpl = mock ? createMockRouteStackFetch('') : createRouteStackFetch();
    return { bookingDeps: { fetchImpl, cache: makeSupabaseIdCache(supabase), geocode, mock } };
  } catch {
    return undefined;
  }
}

/** Attach `_hotel` display metadata to each pick (spec 03b card hydration). Single
 *  batched query by hotel_id. Error variants pass through untouched; the PREVIEW variant (12i-B)
 *  is ALREADY hydrated (it's built from `hotels` rows) so it passes through too. */
export async function hydrateHotels(
  supabase: SupabaseClient,
  assembly: AssemblyOrPreview,
): Promise<AssemblyOrPreview> {
  // Preview recommendations already carry `_hotel`; the seeding variant has no hotels yet. Both pass
  // through, as do error variants.
  if ('result' in assembly && (assembly.result === 'preview_recommendations' || assembly.result === 'preview_seeding')) return assembly;
  if ('error' in assembly) return assembly;
  // Past the guards this is the curated success shape.
  const success = assembly as RecommendationSuccess;

  const ids = [
    success.top_pick.hotel_id,
    ...success.other_picks.map((p) => p.hotel_id),
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
    ...success,
    top_pick: attach(success.top_pick),
    other_picks: success.other_picks.map(attach),
  };
}
