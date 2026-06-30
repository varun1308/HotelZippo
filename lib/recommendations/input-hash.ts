/* Assembly input hash (specs/03c-async-assembly.md). SERVER-ONLY by construction — uses node:crypto,
 * so it lives in its own module away from job-ledger.ts (which the client chat page imports for
 * loadInflightJob; pulling node:crypto into the browser bundle fails the build). The agent (server)
 * computes the hash when creating a job; the client never needs it. */
import crypto from 'node:crypto';

/** Stable idempotency/reuse key for an assembly request. Same inputs → same hash → an identical turn
 * re-attaches to the existing job instead of re-spending on the model. Normalised so cosmetic
 * differences (case) don't fork the key. */
export function computeInputHash(parts: {
  destination: string;
  tripType?: string | null;
  budgetTier?: string | null;
  food?: string | null;
  candidatesKey?: string | null;
}): string {
  const canonical = JSON.stringify({
    destination: parts.destination.trim().toLowerCase(),
    tripType: parts.tripType ?? null,
    budgetTier: parts.budgetTier ?? null,
    food: parts.food ?? null,
    candidatesKey: parts.candidatesKey ?? null,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}
