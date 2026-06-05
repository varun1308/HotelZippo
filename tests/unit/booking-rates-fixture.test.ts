/* Phase 7 · Slice C — the adaptive rooms/rates mapper against the canonical fixture at
 * specs/fixtures/routestack/rooms-rates.json.
 *
 * RECONCILIATION CONTRACT: today this fixture is a representative PLACEHOLDER (the sandbox
 * account is not yet provisioned for hotel search — see memory: routestack-sandbox-blocker).
 * Once `npm run booking:capture` overwrites it with a REAL sandbox payload, this same test
 * keeps the mapper honest: if the real field names differ, this test fails and lib/booking/
 * rates.ts aliases get reconciled until it passes again. The test asserts on STRUCTURE
 * (ids + that descriptive fields resolve), not on placeholder-specific values, so it stays
 * meaningful after the swap. */
import fs from 'node:fs';
import path from 'node:path';
import { mapRoomRateOptions } from '@/lib/booking/rates';

const FIXTURE = path.join(process.cwd(), 'specs', 'fixtures', 'routestack', 'rooms-rates.json');

describe('rooms/rates mapper against the canonical fixture', () => {
  const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as { result?: unknown };
  const options = mapRoomRateOptions(raw.result ?? raw);

  it('resolves at least one bookable option with both ids', () => {
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) {
      expect(typeof o.recommendationId).toBe('string');
      expect(o.recommendationId.length).toBeGreaterThan(0);
      expect(typeof o.roomId).toBe('string');
      expect(o.roomId.length).toBeGreaterThan(0);
    }
  });

  it('resolves the descriptive fields the picker shows (when present in the payload)', () => {
    // At least one option should carry a price + currency and a board basis — proving the
    // alias probing reaches the rate nodes. (Tolerant: not every option needs every field.)
    expect(options.some((o) => typeof o.price === 'number')).toBe(true);
    expect(options.some((o) => typeof o.currency === 'string')).toBe(true);
    expect(options.some((o) => typeof o.board === 'string')).toBe(true);
    expect(options.some((o) => o.freeCancellation === true)).toBe(true);
  });

  it('de-dups distinct rate plans by (recommendationId, roomId)', () => {
    const keys = new Set(options.map((o) => `${o.recommendationId}::${o.roomId}`));
    expect(keys.size).toBe(options.length);
  });
});
