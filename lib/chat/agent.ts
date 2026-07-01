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
import { withSpan, HZ } from '@/lib/otel/trace';
import { runAssembly, resolveEligibility, type AssemblyOrPreview, type RuntimeSeedDeps } from '@/lib/recommendations/run-assembly';
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
  emptyProfile,
  type ProfilePatch,
} from '@/lib/db/persistence/family-profiles';
import type { Child } from '@/components/profile';

/* The conversation-loop model. Defaults to Haiku (fast/cheap; keeps chat turns well under the 60s
 * Vercel function cap) and is env-overridable (AGENT_MODEL) so prod can revert to claude-sonnet-4-6
 * with no redeploy if the tool-use loop needs the stronger model. Mirrors ASSEMBLY_MODEL. */
export const AGENT_MODEL = process.env.AGENT_MODEL || 'claude-haiku-4-5';

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
  /** Per-conversation correlation id (specs/14) — stamped on the chat turn + tool spans (PR-3)
   *  so Dash0 can follow one conversation end-to-end. */
  conversationId?: string;
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
    // OTEL (specs/14): let the AI SDK emit its own model spans (token usage, stop reason, tool
    // calls) instead of the opaque `fetch POST api.anthropic.com` span. recordInputs/Outputs OFF
    // so conversation content + the injected family profile never land in a span (warm-error /
    // no-PII principle). conversationId rides in metadata so these spans join the same Dash0 view.
    experimental_telemetry: {
      isEnabled: true,
      recordInputs: false,
      recordOutputs: false,
      functionId: 'chat.turn',
      ...(args.conversationId ? { metadata: { [HZ.conversationId]: args.conversationId } } : {}),
    },
    tools: {
      assemble_recommendations: tool({
        description:
          'Assemble 2–3 family hotel recommendations for a confirmed destination + trip ' +
          'type from cached review intelligence. Call only when destination AND trip type ' +
          'are known. Returns structured recommendation JSON (top pick + alternatives, ' +
          'with hard flags). Never invent hotels — this is the only source of hotel facts.',
        inputSchema: assembleToolInput,
        execute: (input) =>
          // chat.tool span (specs/14): what the concierge actually DID this turn — which tool, for
          // where, and how it resolved. The narrated decision points (async-dispatched vs. inline,
          // no-eligible-hotels) become span events so a turn's control flow is legible in Dash0.
          withSpan(
            'chat.tool',
            {
              attrs: {
                [HZ.toolName]: 'assemble_recommendations',
                [HZ.destination]: String(input.trip_brief?.destination ?? ''),
              },
            },
            async (span) => {
              const supabase = createServiceClient();

              // Deterministic safety net: if the model gathered profile facts (kids/food/budget) but
              // skipped the update_profile call (Haiku sometimes narrates instead of calling), persist
              // them now from the family_profile it passed to run this search. Fire-and-forget through
              // the RLS-scoped client so it can't block or break the recommendation.
              if (args.userId && args.profileClient) {
                span.addEvent('profile_reconcile_dispatched');
                void reconcileProfileFromAssembleInput(
                  input.family_profile as Record<string, unknown>,
                  args.userId,
                  args.profileClient,
                );
              }

              // 12i-C: provide the runtime-seed seam (RouteStack transport + cache + warm-failing geocode)
              // so an empty 5-enum destination can be seeded on the fly. Gated by PREVIEW_RUNTIME_SEED
              // inside runAssembly / resolveEligibility; best-effort so a missing piece never breaks the turn.
              const seedDeps = buildRuntimeSeedDeps(supabase);

              // ASYNC path (03c): dispatch the slow assembly as a JOB and return FAST — the chat turn never
              // makes the model call, so it can't ride the 60s function cap. The client polls the job for
              // staged progress + cards. Gated by ASYNC_ASSEMBLY=1; off → today's synchronous path below.
              if (asyncAssemblyEnabled()) {
                const dispatched = await dispatchAssemblyJob(supabase, input, args, seedDeps);
                // A job was created (there ARE candidates to assemble) → return the sentinel; the client polls.
                if (isAssemblyStarted(dispatched)) {
                  span.setAttribute(HZ.outcome, 'assembly_started');
                  span.addEvent('async_dispatched');
                  return dispatched;
                }
                // A terminal, model-free outcome (preview cards / still-seeding / no_eligible_hotels) was
                // resolved by the cheap pre-check → return it hydrated NOW, so the agent narrates the TRUE
                // result (e.g. "no options yet") instead of a false "cards coming in a moment" promise.
                if (dispatched) {
                  span.setAttribute(HZ.outcome, 'terminal_precheck');
                  span.addEvent('terminal_precheck_resolved');
                  return hydrateHotels(supabase, dispatched);
                }
                // null → dispatch hit an unexpected error; fall through to the synchronous path below
                // (never dead-end a recommendation turn).
                span.addEvent('async_dispatch_fell_through');
              }

              const assembly = await runAssembly(supabase, input, args.assembleModel, seedDeps);
              span.setAttribute(HZ.outcome, 'assembled_inline');
              // Hydrate display metadata from `hotels` (spec 03b: single batched query by
              // hotel_id) so the client can render cards without a DB round-trip.
              return hydrateHotels(supabase, assembly);
            },
          ),
      }),
      // Only offered to a signed-in user with an RLS-scoped client (env-free build + key-free
      // CI never register it). Creates the profile row if none exists, else merges — so it is
      // the save path for BOTH first-time onboarding capture AND later edits.
      ...(args.userId && args.profileClient
        ? {
            update_profile: tool({
              description:
                'Persist a CONFIRMED profile fact for the signed-in family — during first-time ' +
                'onboarding (e.g. they tell you their kids’ ages, food preference, budget) OR a ' +
                'later change (e.g. they switch budget to luxury, or say they’re now vegetarian). ' +
                'Creates the profile if none exists yet, otherwise merges. Call after the user ' +
                'confirms the fact, as EACH field is captured — never for an unconfirmed or ' +
                'hypothetical preference. Send only the fields that changed. If nothing actually ' +
                'changed it is a safe no-op.',
              inputSchema: updateProfileInput,
              execute: (input): Promise<ProfileUpdateResult> =>
                withSpan(
                  'chat.tool',
                  { attrs: { [HZ.toolName]: 'update_profile' } },
                  async (span) => {
                    const res = await runUpdateProfile(input, args.userId!, args.profileClient!);
                    // How many profile fields this confirmed change actually persisted (0 ⇒ no-op).
                    span.setAttribute('hz.profile.updated_count', res.updated.length);
                    span.setAttribute(HZ.outcome, res.updated.length > 0 ? 'profile_updated' : 'profile_noop');
                    if (res.updated.length > 0) span.addEvent('profile_persisted');
                    return res;
                  },
                ),
            }),
          }
        : {}),
    },
  });
}

/** Merge a confirmed patch into the signed-in user's profile (RLS-scoped), CREATING the row
 *  from a blank base if they have none yet — so this is the persist path for both first-time
 *  onboarding capture and later edits. No-op (returns `{updated: []}`) only when the patch
 *  matches current values — so no chip ever fires on a non-change. */
export async function runUpdateProfile(
  input: z.infer<typeof updateProfileInput>,
  userId: string,
  client: SupabaseClient,
): Promise<ProfileUpdateResult> {
  // No row yet (first-time onboarding) → merge the confirmed fields onto a blank profile and
  // CREATE it. This is the only path that persists conversationally-captured onboarding data
  // (name/kids/food/budget); without it, everything the concierge gathers before the structured
  // form is lost. saveFamilyProfile upserts on user_id, so the merged-from-empty write inserts.
  const existing = (await loadFamilyProfile(client)) ?? emptyProfile();
  const patch = input as ProfilePatch & { children?: Child[] };
  const updated = changedFieldLabels(existing, patch);
  if (updated.length === 0) return { updated: [] }; // patch matched current values → no write
  await saveFamilyProfile(mergeProfile(existing, patch), userId, client);
  return { updated };
}

/** Deterministic safety net (the Haiku-skips-the-tool fix): map the `family_profile` the model
 *  passes into `assemble_recommendations` onto a ProfilePatch, tolerating the loose shape the model
 *  produces (snake_case `food_preference`/`budget_tier`, `children`/`kids`, `spouse`). Only keys we
 *  can confidently interpret are returned — anything unrecognised is dropped, never guessed. */
export function profilePatchFromAssembleInput(
  familyProfile: Record<string, unknown> | null | undefined,
): ProfilePatch & { children?: Child[] } {
  const fp = familyProfile ?? {};
  const patch: ProfilePatch & { children?: Child[] } = {};

  const budget = fp.budget_tier ?? fp.budgetTier;
  if (typeof budget === 'string' && (BUDGET_TIERS as readonly string[]).includes(budget)) {
    patch.budgetTier = budget as ProfilePatch['budgetTier'];
  }

  const food = fp.food_preference ?? fp.food;
  if (typeof food === 'string' && (FOOD_VALUES as readonly string[]).includes(food)) {
    patch.food = food as ProfilePatch['food'];
  }

  const kids = (fp.children ?? fp.kids) as unknown;
  if (Array.isArray(kids)) {
    const children = kids
      .map((c) => {
        const o = (c ?? {}) as Record<string, unknown>;
        const age = typeof o.age === 'number' ? o.age : Number(o.age);
        if (!Number.isInteger(age) || age < 0 || age > 17) return null;
        return { name: typeof o.name === 'string' ? o.name : '', age };
      })
      .filter((c): c is Child => c != null);
    if (children.length > 0) patch.children = children;
  }

  if (typeof fp.spouse === 'boolean') patch.spouse = fp.spouse;

  return patch;
}

/** Best-effort reconcile: persist any profile facts the model USED to run a search but never saved
 *  (Haiku sometimes narrates "noted your kids" without emitting `update_profile`). Reuses the
 *  create-or-merge path, so it only writes genuinely-new fields and never fires the visible chip on
 *  a non-change. Never throws — a reconcile failure must not break the recommendation turn. */
export async function reconcileProfileFromAssembleInput(
  familyProfile: Record<string, unknown> | null | undefined,
  userId: string,
  client: SupabaseClient,
): Promise<void> {
  try {
    const patch = profilePatchFromAssembleInput(familyProfile);
    if (Object.keys(patch).length === 0) return;
    await runUpdateProfile(patch, userId, client);
  } catch {
    /* reconcile is a safety net — swallow any error so the recommendation still renders */
  }
}

/** The sentinel the async tool returns to the model (03c). The chat route translates this into an
 *  `assembly-progress` component chunk; the client polls the jobId for staged progress + cards. */
export interface AssemblyStarted {
  result: 'assembly_started';
  jobId: string;
  destination: string;
}

/** Discriminate the async sentinel from a terminal AssemblyOrPreview (which has top_pick/error/result
 *  but never the 'assembly_started' literal). Null/undefined → not the sentinel. */
function isAssemblyStarted(
  x: AssemblyStarted | AssemblyOrPreview | null,
): x is AssemblyStarted {
  return !!x && 'result' in x && x.result === 'assembly_started';
}

/** Dispatch the async assembly (03c). First runs the CHEAP, model-free eligibility pre-check
 *  (resolveEligibility): if the destination has no candidates and no preview (e.g. an unseeded Bali),
 *  it returns that terminal result DIRECTLY — no job is created and the agent narrates the true
 *  outcome, never a false "your cards will appear in a moment" promise. Only when there ARE candidates
 *  to assemble does it create the job + sentinel and kick the worker.
 *
 *  Returns: AssemblyStarted (job dispatched) · a terminal AssemblyOrPreview (no model needed — caller
 *  hydrates + returns it now) · or null on an unexpected error (caller falls back to the sync path).
 *  Never throws — a recommendation turn must never dead-end. */
async function dispatchAssemblyJob(
  supabase: SupabaseClient,
  input: Parameters<typeof runAssembly>[1],
  args: RunConversationArgs,
  seedDeps?: RuntimeSeedDeps,
): Promise<AssemblyStarted | AssemblyOrPreview | null> {
  try {
    const destination = String(input.trip_brief.destination);

    // Eligibility FIRST (cheap: queryCandidates + preview, no model call). A terminal result here
    // (preview cards / still-seeding / no_eligible_hotels) is returned directly — we only create a
    // background job when there are real candidates for the slow model call to assemble.
    const eligibility = await resolveEligibility(supabase, input, seedDeps);
    if (!('assemble' in eligibility)) return eligibility;

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
