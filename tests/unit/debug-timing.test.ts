/* Debug timing helper (lib/observability/debug-timing.ts, specs/14).
 * Gated by DEBUG_BOOKING=1: emits nothing when off (free no-op), structured lines when on. */
import { startDebugTimer, debugTimingEnabled } from '@/lib/observability/debug-timing';

const savedEnv = { ...process.env };
let logSpy: jest.SpyInstance;
beforeEach(() => {
  process.env = { ...savedEnv };
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...savedEnv };
  logSpy.mockRestore();
});

describe('debugTimingEnabled', () => {
  it('is true only for the exact "1" flag', () => {
    process.env.DEBUG_BOOKING = '1';
    expect(debugTimingEnabled()).toBe(true);
    process.env.DEBUG_BOOKING = 'true';
    expect(debugTimingEnabled()).toBe(false);
    delete process.env.DEBUG_BOOKING;
    expect(debugTimingEnabled()).toBe(false);
  });
});

describe('startDebugTimer', () => {
  it('emits nothing when the flag is off (free no-op)', () => {
    delete process.env.DEBUG_BOOKING;
    const t = startDebugTimer('assemble', { dest: 'Phuket' });
    t.mark('step');
    t.done();
    t.fail(new Error('x'));
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('emits grep-friendly lines carrying scope, event, ctx and timing when on', () => {
    process.env.DEBUG_BOOKING = '1';
    const t = startDebugTimer('assemble', { dest: 'Phuket' });
    t.mark('queryCandidates', { count: 0 });
    t.done({ via: 'preview' });

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('[debug-timing] [assemble] queryCandidates');
    expect(lines[0]).toContain('dest=Phuket');
    expect(lines[0]).toContain('count=0');
    expect(lines[0]).toMatch(/\+\d+ms =\d+ms/);
    expect(lines[1]).toContain('done');
    expect(lines[1]).toContain('via=preview');
  });

  it('fail() logs the error message', () => {
    process.env.DEBUG_BOOKING = '1';
    const t = startDebugTimer('booking.rates');
    t.fail(new Error('boom'));
    expect(String(logSpy.mock.calls[0][0])).toContain('error=boom');
  });
});
