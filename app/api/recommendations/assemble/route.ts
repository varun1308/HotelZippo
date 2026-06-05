/* POST /api/recommendations/assemble  (spec 03b end-to-end runtime, two-step)
 * Body: { family_profile, trip_brief }  (resolved records from the Conversation Agent).
 *
 * Step (a): consumption query (08a-5) — deterministic candidate set (≤15), excludes
 *           low_confidence + raw_reviews never touched.
 * Step (b): assembly LLM call (08b-2) — validated against the contract; malformed → 502,
 *           NO partial recommendation (spec 14).
 *
 * Returns the assembly JSON (success or {error: ...} variant) for the agent turn.
 * Server-side only; service client; ANTHROPIC_API_KEY server-side only. */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/db/server';
import { AssemblyError } from '@/lib/recommendations/assemble';
import { runAssembly } from '@/lib/recommendations/run-assembly';
import { DESTINATIONS, BUDGET_TIERS } from '@/lib/db/schemas';

export const runtime = 'nodejs';

/** Minimal shape we need off the resolved records to drive the query. We accept the full
 * objects (passed through to the model) but only read these fields for step (a). */
const requestSchema = z.object({
  family_profile: z
    .object({ budget_tier: z.enum(BUDGET_TIERS).nullable().optional() })
    .passthrough()
    .nullable()
    .optional(),
  trip_brief: z
    .object({
      destination: z.enum(DESTINATIONS),
      evaluate_only: z.boolean().optional(),
      pre_shortlisted_hotels: z.array(z.string()).nullable().optional(),
    })
    .passthrough(),
});

export async function POST(req: Request) {
  // Parse + validate the request.
  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message:
          'family_profile (optional) and trip_brief (with a valid destination) are required.',
        detail: e instanceof z.ZodError ? e.issues : undefined,
      },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();

  // Two-step runtime (08a-5 query → 08b-2 assembly) via the shared helper, so this
  // route and the conversation agent's tool run the exact same code path.
  try {
    const assembly = await runAssembly(supabase, {
      family_profile: body.family_profile ?? {},
      trip_brief: body.trip_brief,
    });
    return NextResponse.json(assembly);
  } catch (e) {
    if (e instanceof AssemblyError && e.code === 'malformed_output') {
      // Never render a partial recommendation (spec 14). Fail the request.
      return NextResponse.json(
        {
          error: 'assembly_malformed',
          message:
            "Hmm — I put your shortlist together but it didn't come back clean. That's on me. Give me another go?",
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        error: 'assembly_failed',
        message:
          "I couldn't finish your recommendation just now. That's on me, not you — try again in a moment?",
        reason: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}
