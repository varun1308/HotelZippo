/* Lightweight production debug timing (specs/14-error-handling.md).
 *
 * When DEBUG_BOOKING=1 (server-only, off by default), emits structured single-line timing markers to
 * stdout — visible immediately in Vercel Runtime Logs without any extra infra. Built to diagnose WHICH
 * step in a long server operation hung when a serverless function hits its wall-clock kill (e.g. the
 * 60s timeout on /api/booking/rates or the chat assemble path): the LAST line printed before the kill
 * is the culprit.
 *
 * This is NOT a substitute for OTEL/Dash0 traces — it's a zero-dependency, always-visible breadcrumb
 * trail for the times the trace export isn't configured or the function died before a span flushed.
 *
 * Flag is read at CALL time (never at import) so the module is env-free to import (key-free CI). */

/** Whether debug timing is enabled. OFF unless DEBUG_BOOKING=1. */
export function debugTimingEnabled(): boolean {
  return process.env.DEBUG_BOOKING === '1';
}

/** A scoped timer. `mark(step)` logs the cumulative + delta ms since start; `done()`/`fail()` close it.
 * All output is gated by the flag, so leaving these calls in production is free when the flag is off. */
export interface DebugTimer {
  mark(step: string, extra?: Record<string, unknown>): void;
  done(extra?: Record<string, unknown>): void;
  fail(err: unknown): void;
}

/** Create a scoped debug timer for `scope` (e.g. "assemble", "booking.rates"). `ctx` is logged on every
 * line (e.g. { dest: "Phuket" }). A no-op timer is returned when the flag is off, so callers don't branch. */
export function startDebugTimer(scope: string, ctx: Record<string, unknown> = {}): DebugTimer {
  if (!debugTimingEnabled()) return NOOP;

  const start = Date.now();
  let last = start;
  const ctxStr = fmtCtx(ctx);

  const line = (event: string, extra?: Record<string, unknown>) => {
    const now = Date.now();
    const total = now - start;
    const delta = now - last;
    last = now;
    // Single line, grep-friendly: [scope] event +Δms =total ms key=val …
    console.log(`[debug-timing] [${scope}] ${event} +${delta}ms =${total}ms${ctxStr}${fmtCtx(extra)}`);
  };

  return {
    mark: (step, extra) => line(step, extra),
    done: (extra) => line('done', extra),
    fail: (err) => line('FAIL', { error: err instanceof Error ? err.message : String(err) }),
  };
}

function fmtCtx(ctx?: Record<string, unknown>): string {
  if (!ctx) return '';
  const parts = Object.entries(ctx).map(([k, v]) => ` ${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
  return parts.join('');
}

const NOOP: DebugTimer = { mark: () => {}, done: () => {}, fail: () => {} };
