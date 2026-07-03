/* Shared Apify client (Phase 6 live scraping). One thin wrapper over the Apify REST endpoint
 *   POST https://api.apify.com/v2/actors/<actorId>/run-sync-get-dataset-items
 *   Authorization: Bearer <APIFY_API_TOKEN>
 * which runs an actor synchronously and returns its dataset items in one call. Reused by both
 * the curation hotel-SEARCH path (lib/curation/fetch.ts) and the review SCRAPER
 * (lib/review-intelligence/apify.ts).
 *
 * Deliberately NO `apify-client` npm dependency: the single endpoint we need is one fetch, and
 * the SDK would add an auth surface + OTEL-wrapping friction for zero benefit at this volume
 * (sequential, founder-driven runs). If pagination / backoff / async-run polling become needed,
 * `apify-client` (or the async run+poll endpoints) is the documented upgrade.
 *
 * Server-side by construction (reads APIFY_API_TOKEN). No `import 'server-only'` — both callers
 * run in the standalone tsx worker chain where that guard throws (same reasoning as
 * lib/review-intelligence/apify.ts and synthesis.ts). Never imported by a client component. */
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { withActorCache, cacheEnabled, cacheKeyFor } from '@/lib/dev/actor-cache';

export type ApifyErrorKind = 'no_token' | 'http_error' | 'timeout' | 'bad_response';

export class ApifyError extends Error {
  constructor(
    message: string,
    public readonly kind: ApifyErrorKind,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApifyError';
  }
}

export interface RunActorOptions {
  /** Apify actor id, e.g. "apify~tripadvisor-reviews" (from env). */
  actorId: string;
  /** Actor input JSON (the actor-specific shape lives in each caller's mapper). */
  input: Record<string, unknown>;
  /** Overall request timeout (ms) — aborts the fetch. Default 300_000 (5 min). */
  timeoutMs?: number;
  /** Apify-side run timeout (secs), passed as ?timeout=. Default 240. */
  runTimeoutSecs?: number;
  /** Hard cap on dataset items pulled, passed as ?limit=. Omit for no cap. */
  limit?: number;
}

const APIFY_BASE = 'https://api.apify.com/v2/actors';
const APIFY_API = 'https://api.apify.com/v2';

/** Truncate an error body before it goes into an Error message / OTEL — Apify (and TripAdvisor
 * anti-bot pages) can return huge HTML bodies, and we must never echo the token. */
function snippet(body: string): string {
  const clean = body.replace(/\s+/g, ' ').trim();
  return clean.length > 300 ? `${clean.slice(0, 300)}…` : clean;
}

/** Run an actor synchronously and return its dataset items (untyped rows — each caller's mapper
 * narrows them). Throws ApifyError on missing token, non-2xx, timeout, or a non-array body.
 *
 * Injectable `fetchImpl` for tests (defaults to global fetch) — keeps unit tests network-free.
 * The default is resolved lazily inside the body (not as a default arg) so the token guard runs
 * first and a test env without a global `fetch` can still exercise the no-token path. */
export async function runActorGetItems(
  opts: RunActorOptions,
  fetchImpl?: typeof fetch,
): Promise<unknown[]> {
  // Dev-only file cache (CURATION_USE_CACHE=1): a HIT replays banked dataset items with NO live call
  // (and needs no token), so the admin routes can be exercised end-to-end for free. No-op in prod.
  return withActorCache('apify', opts.actorId, opts.input, () => runActorLive(opts, fetchImpl)) as Promise<unknown[]>;
}

async function runActorLive(opts: RunActorOptions, fetchImpl?: typeof fetch): Promise<unknown[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new ApifyError('APIFY_API_TOKEN is not set', 'no_token');

  const doFetch = fetchImpl ?? fetch;

  const timeoutMs = opts.timeoutMs ?? 300_000;
  const runTimeoutSecs = opts.runTimeoutSecs ?? 240;

  // Token goes in the Authorization header, NOT the query string: the URL can land in OTEL spans
  // and proxy/server logs, so keeping the secret out of it is the documented, safer choice.
  const params = new URLSearchParams({ timeout: String(runTimeoutSecs) });
  if (opts.limit != null) params.set('limit', String(opts.limit));
  const url = `${APIFY_BASE}/${encodeURIComponent(opts.actorId)}/run-sync-get-dataset-items?${params}`;

  const tracer = trace.getTracer('hotelzippo');
  return tracer.startActiveSpan('apify.run_actor', async (span) => {
    span.setAttribute('actor_id', opts.actorId);
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res: Response;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(opts.input),
          signal: controller.signal,
        });
      } catch (e) {
        // AbortError (our timeout) or a network failure.
        if (e instanceof Error && e.name === 'AbortError') {
          throw new ApifyError(`apify run timed out after ${timeoutMs}ms`, 'timeout');
        }
        throw new ApifyError(
          `apify request failed: ${e instanceof Error ? e.message : String(e)}`,
          'http_error',
        );
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new ApifyError(`apify actor returned ${res.status}: ${snippet(body)}`, 'http_error', res.status);
      }

      let items: unknown;
      try {
        items = await res.json();
      } catch (e) {
        throw new ApifyError(
          `apify response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
          'bad_response',
        );
      }
      if (!Array.isArray(items)) {
        throw new ApifyError('apify response was not a dataset-items array', 'bad_response');
      }

      span.setAttribute('item_count', items.length);
      span.setStatus({ code: SpanStatusCode.OK });
      return items;
    } catch (e) {
      span.recordException(e as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw e;
    } finally {
      clearTimeout(timer);
      span.setAttribute('duration_ms', Date.now() - start);
      span.end();
    }
  });
}

// ── Async run lifecycle (12h · Apify Run Ledger) ────────────────────────────────────────────────
// The sync `runActorGetItems` above blocks ~5 min for the actor to finish — right for the laptop/CLI
// worker, but it exceeds Vercel's serverless function limit and loses paid data on any failure after
// Apify finishes. These three primitives use Apify's ASYNC endpoints so a run can be STARTED (returns
// in <1s), POLLED, and its dataset PULLED separately — the durable path the ledger persists around.

/** Apify's terminal/active run statuses, normalised to our ledger's vocabulary. */
export type ApifyRunStatus = 'running' | 'succeeded' | 'failed';

/** A small helper: authenticated JSON fetch against the Apify API with the Bearer token + abort. */
async function apifyJson(
  url: string,
  init: RequestInit,
  doFetch: typeof fetch,
  timeoutMs: number,
): Promise<unknown> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new ApifyError('APIFY_API_TOKEN is not set', 'no_token');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await doFetch(url, {
        ...init,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
        signal: controller.signal,
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new ApifyError(`apify request timed out after ${timeoutMs}ms`, 'timeout');
      }
      throw new ApifyError(`apify request failed: ${e instanceof Error ? e.message : String(e)}`, 'http_error');
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ApifyError(`apify returned ${res.status}: ${snippet(body)}`, 'http_error', res.status);
    }
    try {
      return await res.json();
    } catch (e) {
      throw new ApifyError(`apify response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`, 'bad_response');
    }
  } finally {
    clearTimeout(timer);
  }
}

export interface StartRunResult {
  apifyRunId: string;
  apifyDatasetId: string;
}

// ── Dev actor-cache seam for the ASYNC ledger path (CURATION_USE_CACHE=1) ──────────────────────
// The sync runActorGetItems is already wrapped in withActorCache, but the ledger UI path goes
// startRun → getRunStatus → pullDatasetItems, which would otherwise ALWAYS hit live Apify (paid)
// even in supposedly-free cache mode. Seam: when the exact (actorId, input) is banked, startRun
// returns a SYNTHETIC already-succeeded run whose ids carry the cache key ("cache:<file>");
// getRunStatus reports it succeeded with no live call; and ingest pulls the items through
// withActorCache on the run's own (actorId, input) — a guaranteed HIT for a synthetic run.
// A cache MISS falls through to the live start (same write-through-on-first-use semantics as
// withActorCache; the pull is then banked by the ingest route's wrapper).
const CACHE_RUN_PREFIX = 'cache:';

/** True for the synthetic run/dataset ids minted by a cache-mode startRun. */
export function isCacheRunId(id: string): boolean {
  return id.startsWith(CACHE_RUN_PREFIX);
}

/** Sentinel thrown by the probe `live()` to detect a MISS without making (or banking) any call. */
const CACHE_PROBE_MISS = new Error('actor-cache probe miss');

/** Cache-mode READ without write-through: HIT → banked items; MISS (or cache off) → null. */
async function readBankedItems(actorId: string, input: Record<string, unknown>): Promise<unknown[] | null> {
  if (!cacheEnabled()) return null;
  try {
    const banked = await withActorCache('apify', actorId, input, async () => {
      throw CACHE_PROBE_MISS;
    });
    return Array.isArray(banked) ? banked : null;
  } catch (e) {
    if (e === CACHE_PROBE_MISS) return null;
    throw e;
  }
}

/** Start an actor run asynchronously. Returns the Apify run id + its default dataset id IMMEDIATELY
 * (the actor keeps running on Apify's side). Persist these in the ledger so the run is recoverable.
 * In dev cache mode a banked (actorId, input) short-circuits to a synthetic succeeded run — no
 * live call, no spend (see the seam note above). */
export async function startRun(
  opts: { actorId: string; input: Record<string, unknown>; runTimeoutSecs?: number },
  fetchImpl?: typeof fetch,
): Promise<StartRunResult> {
  const banked = await readBankedItems(opts.actorId, opts.input);
  if (banked) {
    const syntheticId = `${CACHE_RUN_PREFIX}${cacheKeyFor('apify', opts.actorId, opts.input)}`;
    // eslint-disable-next-line no-console
    console.log(`[actor-cache] startRun HIT → synthetic run ${syntheticId} (no live call)`);
    return { apifyRunId: syntheticId, apifyDatasetId: syntheticId };
  }

  const doFetch = fetchImpl ?? fetch;
  const params = new URLSearchParams();
  if (opts.runTimeoutSecs != null) params.set('timeout', String(opts.runTimeoutSecs));
  const qs = params.toString();
  const url = `${APIFY_BASE}/${encodeURIComponent(opts.actorId)}/runs${qs ? `?${qs}` : ''}`;
  const body = (await apifyJson(url, { method: 'POST', body: JSON.stringify(opts.input) }, doFetch, 30_000)) as {
    data?: { id?: string; defaultDatasetId?: string };
  };
  const apifyRunId = body?.data?.id;
  const apifyDatasetId = body?.data?.defaultDatasetId;
  if (!apifyRunId || !apifyDatasetId) {
    throw new ApifyError('apify start-run response missing data.id / data.defaultDatasetId', 'bad_response');
  }
  return { apifyRunId, apifyDatasetId };
}

export interface RunStatusResult {
  status: ApifyRunStatus;
  /** Apify-reported items in the dataset (when known). */
  itemCount?: number;
  /** Apify-reported run cost in USD (when known). */
  costEstimate?: number;
}

/** Apify's EXPLICIT terminal-failure run statuses. Anything unrecognized/missing is treated as
 * still-running (keep polling) — mapping an unknown status to 'failed' is terminal in our ledger
 * and would strand PAID data behind a vocabulary drift. */
const APIFY_FAILED_STATUSES = new Set(['FAILED', 'TIMED-OUT', 'TIMING-OUT', 'ABORTED', 'ABORTING']);

/** Poll one run's status. Maps Apify's run statuses onto our 3-state vocabulary:
 *   SUCCEEDED → succeeded ; FAILED|TIMED-OUT|ABORTED(+ing) → failed ; everything else → running.
 * On success, best-effort parses the dataset's itemCount (one extra free GET) so the admin UI
 * can show "N items" instead of "?". A synthetic cache run is always succeeded (no live call). */
export async function getRunStatus(apifyRunId: string, fetchImpl?: typeof fetch): Promise<RunStatusResult> {
  if (isCacheRunId(apifyRunId)) return { status: 'succeeded' };

  const doFetch = fetchImpl ?? fetch;
  const url = `${APIFY_API}/actor-runs/${encodeURIComponent(apifyRunId)}`;
  const body = (await apifyJson(url, { method: 'GET' }, doFetch, 30_000)) as {
    data?: { status?: string; stats?: { computeUnits?: number }; usageTotalUsd?: number; defaultDatasetId?: string };
  };
  const raw = body?.data?.status ?? '';
  const status: ApifyRunStatus =
    raw === 'SUCCEEDED' ? 'succeeded' : APIFY_FAILED_STATUSES.has(raw) ? 'failed' : 'running';
  const result: RunStatusResult = { status };
  if (typeof body?.data?.usageTotalUsd === 'number') result.costEstimate = body.data.usageTotalUsd;
  if (status === 'succeeded' && body?.data?.defaultDatasetId) {
    try {
      const ds = (await apifyJson(
        `${APIFY_API}/datasets/${encodeURIComponent(body.data.defaultDatasetId)}`,
        { method: 'GET' },
        doFetch,
        30_000,
      )) as { data?: { itemCount?: number } };
      if (typeof ds?.data?.itemCount === 'number') result.itemCount = ds.data.itemCount;
    } catch {
      /* best-effort — a missing itemCount only means the UI shows "?" */
    }
  }
  return result;
}

/** Pull a dataset's items by id. Free + repeatable for a succeeded run (the dataset persists on
 * Apify), so this is what powers REUSE / re-ingest. `limit` caps the rows pulled. */
export async function pullDatasetItems(
  apifyDatasetId: string,
  opts: { limit?: number; timeoutMs?: number } = {},
  fetchImpl?: typeof fetch,
): Promise<unknown[]> {
  if (isCacheRunId(apifyDatasetId)) {
    // A synthetic cache run's items are served by the caller's withActorCache wrapper (keyed on
    // the run's actorId+input) — reaching here means the bank entry is gone or the flag is off.
    throw new ApifyError(
      'synthetic cache dataset id — its banked payload is missing or CURATION_USE_CACHE is off; re-seed the cache (npm run dev:preseed-cache) or start a fresh live run',
      'bad_response',
    );
  }
  const doFetch = fetchImpl ?? fetch;
  const params = new URLSearchParams({ format: 'json', clean: 'true' });
  if (opts.limit != null) params.set('limit', String(opts.limit));
  const url = `${APIFY_API}/datasets/${encodeURIComponent(apifyDatasetId)}/items?${params}`;
  const items = await apifyJson(url, { method: 'GET' }, doFetch, opts.timeoutMs ?? 120_000);
  if (!Array.isArray(items)) throw new ApifyError('apify dataset items response was not an array', 'bad_response');
  return items;
}
