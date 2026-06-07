/* Shared Apify client (Phase 6 live scraping). One thin wrapper over the Apify REST endpoint
 *   POST https://api.apify.com/v2/acts/<actorId>/run-sync-get-dataset-items?token=...
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

const APIFY_BASE = 'https://api.apify.com/v2/acts';

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
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new ApifyError('APIFY_API_TOKEN is not set', 'no_token');

  const doFetch = fetchImpl ?? fetch;

  const timeoutMs = opts.timeoutMs ?? 300_000;
  const runTimeoutSecs = opts.runTimeoutSecs ?? 240;

  const params = new URLSearchParams({ token, timeout: String(runTimeoutSecs) });
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
          headers: { 'content-type': 'application/json' },
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
