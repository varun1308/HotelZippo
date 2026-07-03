/* L33b — deterministic travel-date detection feeding resolveDates (spec 10c).
 * Explicit start+end pairs resolve; month-only / vague phrasing stays null so the
 * booking confirm screen collects exact dates (the spec's month-only path). */
import { detectTravelDates } from '@/lib/chat/detect-travel-dates';
import { resolveDates } from '@/lib/booking';

// A fixed "now" so year-less ranges resolve deterministically.
const NOW = new Date('2026-07-03T00:00:00Z');

describe('detectTravelDates', () => {
  it('detects an ISO pair', () => {
    expect(detectTravelDates('we land 2026-07-12 to 2026-07-19', NOW)).toEqual({
      start: '2026-07-12',
      end: '2026-07-19',
    });
  });

  it('detects "12–19 July 2026" (day-range first, en dash)', () => {
    expect(detectTravelDates('thinking 12–19 July 2026 for the four of us', NOW)).toEqual({
      start: '2026-07-12',
      end: '2026-07-19',
    });
  });

  it('detects "July 12 to 19" and resolves the missing year to the next occurrence', () => {
    expect(detectTravelDates('July 12 to 19 works for Raj Mehta and the kids', NOW)).toEqual({
      start: '2026-07-12',
      end: '2026-07-19',
    });
  });

  it('a year-less month already past rolls to next year', () => {
    expect(detectTravelDates('10-15 March', NOW)).toEqual({
      start: '2027-03-10',
      end: '2027-03-15',
    });
  });

  it('handles ordinals ("3rd to 9th of August")', () => {
    expect(detectTravelDates('3rd to 9th of August', NOW)).toEqual({
      start: '2026-08-03',
      end: '2026-08-09',
    });
  });

  it('stays null for month-only / vague / invalid ranges (never invents)', () => {
    expect(detectTravelDates('sometime in July', NOW)).toBeNull();
    expect(detectTravelDates('next month for a week', NOW)).toBeNull();
    expect(detectTravelDates('19 to 12 July', NOW)).toBeNull(); // end before start
    expect(detectTravelDates('28 to 35 December', NOW)).toBeNull(); // impossible day
    expect(detectTravelDates('', NOW)).toBeNull();
  });

  it('its output is exactly what resolveDates accepts (the seam is live, not dead code)', () => {
    const detected = detectTravelDates('12 to 19 July 2026', NOW);
    expect(resolveDates(detected)).toEqual({ checkIn: '2026-07-12', checkOut: '2026-07-19' });
    // And the null path stays null (month-only → the confirm screen collects dates).
    expect(resolveDates(detectTravelDates('early July', NOW))).toBeNull();
  });
});
