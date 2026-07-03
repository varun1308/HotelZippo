/* Deterministic travel-date detection (L33b · spec 10c).
 *
 * The trip-brief rail stores `dates` as DISPLAY text (e.g. "December"), which can
 * never satisfy `resolveDates` (lib/booking/party.ts) — so the booking flow was
 * always started with `dates: null` and users re-entered dates they had already
 * typed. This detector scans each USER message for an EXPLICIT, resolvable
 * start+end pair and returns the `{ start, end }` shape `resolveDates` accepts;
 * month-only or vague phrasing returns null (the confirm screen collects exact
 * dates — the month-only path from the spec). Pure + import-free: unit-testable
 * with no key and no DB. It NEVER invents dates.
 *
 * Recognised shapes:
 *   • ISO pair          — "2026-07-12 to 2026-07-19" (also – — / until / through)
 *   • day-range + month — "12–19 July", "12 to 19 July 2026"
 *   • month + day-range — "July 12–19", "July 12 to 19, 2026"
 * A missing year resolves to the NEXT occurrence of that month (never the past). */

export interface DetectedTravelDates {
  start: string;
  end: string;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

const MONTH_RE = MONTHS.map((m) => `${m.slice(0, 3)}(?:${m.slice(3)})?`).join('|');
const SEP = '(?:\\s*(?:to|until|through|till|[-–—])\\s*)';

/** Month name/abbrev → 1-based month number, or null. */
function monthNumber(word: string): number | null {
  const lower = word.toLowerCase();
  const idx = MONTHS.findIndex((m) => m === lower || m.slice(0, 3) === lower);
  return idx === -1 ? null : idx + 1;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Days in a month (year-aware for February). */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Resolve an omitted year to the next occurrence of `month` (this year if the month
 *  hasn't finished yet, else next year) — a family planning a trip means the future. */
function resolveYear(month: number, now: Date): number {
  const y = now.getUTCFullYear();
  return month >= now.getUTCMonth() + 1 ? y : y + 1;
}

function buildRange(
  year: number,
  month: number,
  startDay: number,
  endDay: number,
): DetectedTravelDates | null {
  const max = daysInMonth(year, month);
  if (startDay < 1 || endDay <= startDay || endDay > max) return null;
  return {
    start: `${year}-${pad(month)}-${pad(startDay)}`,
    end: `${year}-${pad(month)}-${pad(endDay)}`,
  };
}

/**
 * Detect an explicit, resolvable start+end date pair in one user message.
 * Returns the loose `{ start, end }` shape `resolveDates` accepts, or null when the
 * message carries no confident exact range (month-only stays null by design).
 */
export function detectTravelDates(text: string, now: Date = new Date()): DetectedTravelDates | null {
  const t = text ?? '';

  // 1. ISO pair: 2026-07-12 to 2026-07-19
  const iso = new RegExp(`(\\d{4}-\\d{2}-\\d{2})${SEP}(\\d{4}-\\d{2}-\\d{2})`, 'i').exec(t);
  if (iso) {
    const [, start, end] = iso;
    return end > start ? { start, end } : null;
  }

  // 2. day-range + month: "12–19 July [2026]"
  const dayFirst = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?${SEP}(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\b(?:,?\\s*(\\d{4}))?`,
    'i',
  ).exec(t);
  if (dayFirst) {
    const month = monthNumber(dayFirst[3]);
    if (month) {
      const year = dayFirst[4] ? Number(dayFirst[4]) : resolveYear(month, now);
      return buildRange(year, month, Number(dayFirst[1]), Number(dayFirst[2]));
    }
  }

  // 3. month + day-range: "July 12–19[, 2026]"
  const monthFirst = new RegExp(
    `\\b(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?${SEP}(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4}))?`,
    'i',
  ).exec(t);
  if (monthFirst) {
    const month = monthNumber(monthFirst[1]);
    if (month) {
      const year = monthFirst[4] ? Number(monthFirst[4]) : resolveYear(month, now);
      return buildRange(year, month, Number(monthFirst[2]), Number(monthFirst[3]));
    }
  }

  return null;
}
