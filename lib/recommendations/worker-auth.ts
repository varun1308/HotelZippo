/* Internal-caller guard for the assembly worker route (POST /api/assembly/run).
 *
 * The worker is internet-reachable but only ever called by OUR OWN server (the chat turn's
 * fire-and-forget kick + the poll route's re-kick). When ASSEMBLY_WORKER_SECRET is set, every
 * kick carries it in the x-hz-worker-auth header and the route rejects anything without it —
 * so an outside caller can't burn worker invocations / re-kick arbitrary jobs. Unset (key-free
 * CI, env-free dev) → open, matching the codebase's lazy-env discipline. A dedicated env var
 * (not one derived from an existing secret) so already-configured environments don't lock
 * themselves out on deploy — enabling the guard is an explicit opt-in.
 *
 * Not imported by any client module (job-ledger stays the only client-shared ledger surface). */

export const WORKER_AUTH_HEADER = 'x-hz-worker-auth';

/** Headers a dispatch kick should spread into its fetch — empty when the guard is off. */
export function workerAuthHeaders(): Record<string, string> {
  const secret = process.env.ASSEMBLY_WORKER_SECRET;
  return secret ? { [WORKER_AUTH_HEADER]: secret } : {};
}

/** True when the request may run the worker: guard off (no secret configured) or header matches. */
export function verifyWorkerAuth(req: Request): boolean {
  const secret = process.env.ASSEMBLY_WORKER_SECRET;
  if (!secret) return true;
  return req.headers.get(WORKER_AUTH_HEADER) === secret;
}
