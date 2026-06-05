/* Live RouteStack HTTP transport (Phase 7 · specs/10c-booking-routestack.md).
 *
 * The real `fetch`-based RouteStackFetch plugged into the orchestrator's injectable seam.
 * Tests inject a mock instead (key-free CI); this is used at request time from the booking
 * API routes. Server-side only — reads ROUTESTACK_API_URL lazily (never at import).
 *
 * RouteStack returns its business outcomes inside a 200 { success, code, message } envelope,
 * so we DON'T throw on non-2xx alone — we return the parsed body and let the orchestrator
 * branch on the envelope. A genuine network/transport failure (or non-JSON body) throws, and
 * the orchestrator wraps it as a transport BookingError. */
import 'server-only';
import { BookingError } from './types';
import type { RouteStackFetch } from './auth';

/** Build the live transport. `baseUrl` defaults to ROUTESTACK_API_URL (read at call time). */
export function createRouteStackFetch(baseUrl?: string): RouteStackFetch {
  return async (path, body, headers) => {
    const base = baseUrl ?? process.env.ROUTESTACK_API_URL;
    if (!base) {
      throw new BookingError('config', 'Missing ROUTESTACK_API_URL (see specs/13-environment.md).');
    }
    const url = `${base.replace(/\/$/, '')}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
        body: JSON.stringify(body ?? {}),
        // RouteStack is request-time only; no caching of booking calls.
        cache: 'no-store',
      });
    } catch (e) {
      throw new BookingError('transport', `RouteStack ${path} unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }

    const text = await res.text();
    // A 5xx with no JSON body is a transport failure; a JSON envelope (even success:false)
    // is handed back for the orchestrator to interpret.
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      if (!res.ok) {
        throw new BookingError('transport', `RouteStack ${path} returned ${res.status} (non-JSON)`);
      }
      throw new BookingError('transport', `RouteStack ${path} returned an unparseable body`);
    }
    if (!res.ok && !isEnvelope(parsed)) {
      // Non-envelope error status → transport-level failure.
      throw new BookingError('transport', `RouteStack ${path} returned ${res.status}`);
    }
    return parsed;
  };
}

function isEnvelope(v: unknown): boolean {
  return !!v && typeof v === 'object' && typeof (v as Record<string, unknown>).success === 'boolean';
}
