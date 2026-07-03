/* Assembly input hash (specs/03c-async-assembly.md). SERVER-ONLY by construction — uses node:crypto,
 * so it lives in its own module away from job-ledger.ts (which the client chat page imports for
 * loadInflightJob; pulling node:crypto into the browser bundle fails the build). The agent (server)
 * computes the hash when creating a job; the client never needs it. */
import crypto from 'node:crypto';

/** Stable idempotency/reuse key for an assembly request. Same inputs → same hash → an identical turn
 * re-attaches to the existing job instead of re-spending on the model. Normalised so cosmetic
 * differences (case) don't fork the key. */
export interface InputHashParts {
  destination: string;
  tripType?: string | null;
  budgetTier?: string | null;
  food?: string | null;
  candidatesKey?: string | null;
}

export function computeInputHash(parts: InputHashParts): string {
  const canonical = JSON.stringify({
    destination: parts.destination.trim().toLowerCase(),
    tripType: parts.tripType ?? null,
    budgetTier: parts.budgetTier ?? null,
    food: parts.food ?? null,
    candidatesKey: parts.candidatesKey ?? null,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

/** Map a RunAssembly-shaped input ({family_profile, trip_brief}) onto the canonical hash parts —
 * spec 03c: {destination, trip_type, budget, food, candidate-set key}. Two deliberate details:
 *   • `food` reads the REAL profile key `food_preferences: string[]` (lib/db/schemas.ts) —
 *     sorted+joined so order never forks the key — falling back to the loose singular
 *     `food_preference` / `food` strings the model sometimes emits.
 *   • `candidatesKey` folds in `evaluate_only` + the (sorted) pre-shortlisted hotel set, so an
 *     evaluate-only turn can NEVER reuse an open turn's job (or vice versa), and different
 *     shortlists never collide. Open turns (no restriction) keep a null key.
 */
export function hashPartsFromAssemblyInput(input: {
  family_profile?: Record<string, unknown> | null;
  trip_brief: Record<string, unknown>;
}): InputHashParts {
  const fp = input.family_profile ?? {};
  const tb = input.trip_brief;

  const foodPrefs = fp.food_preferences;
  const food =
    Array.isArray(foodPrefs) && foodPrefs.length > 0
      ? [...foodPrefs].map(String).sort().join('+')
      : typeof fp.food_preference === 'string'
        ? fp.food_preference
        : typeof fp.food === 'string'
          ? fp.food
          : null;

  const budget = fp.budget_tier ?? fp.budgetTier;

  const evaluateOnly = tb.evaluate_only === true;
  const shortlisted = Array.isArray(tb.pre_shortlisted_hotels)
    ? [...tb.pre_shortlisted_hotels].map(String).sort()
    : [];
  const candidatesKey =
    evaluateOnly || shortlisted.length > 0
      ? JSON.stringify({ evaluate_only: evaluateOnly, hotels: shortlisted })
      : null;

  return {
    destination: String(tb.destination ?? ''),
    tripType: typeof tb.trip_type === 'string' ? tb.trip_type : null,
    budgetTier: typeof budget === 'string' ? budget : null,
    food,
    candidatesKey,
  };
}
