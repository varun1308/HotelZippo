/* Deterministic brief detection (Phase 3d).
 *
 * Scans a single USER message for trip-brief signals and returns a partial brief.
 * Pure + import-light (only the destination list) so it unit-tests with no key and
 * no DB. It NEVER invents: if a field can't be confidently detected, it is absent
 * from the result and the rail row stays "pending" (correct degradation). The
 * authoritative gate fields also lock when recommendation cards arrive (the page
 * calls applyRecommendationGates) — this detector is the progressive-fill hint. */
import { DESTINATIONS } from '@/lib/db/schemas';
import type { TripBriefState } from './types';

type BriefPatch = Partial<Omit<TripBriefState, 'prefs'>>;

/** Match a whole word/phrase, case-insensitively, on word boundaries. */
function has(text: string, phrase: string): boolean {
  const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${esc}\\b`, 'i').test(text);
}

/** Detect the destination (one of the 5 covered). Returns the canonical name. */
function detectDestination(text: string): string | null {
  for (const d of DESTINATIONS) {
    if (has(text, d)) return d;
  }
  return null;
}

/** Map budget words → a display label aligned to the BUDGET_TIERS vocabulary. */
function detectBudget(text: string): string | null {
  if (/\b(luxury|luxe|five[- ]star|splurge|high[- ]end|premium)\b/i.test(text)) return 'Luxury';
  if (/\b(comfort|comfortable|mid[- ]range|four[- ]star)\b/i.test(text)) return 'Comfort';
  if (/\b(value|budget|affordable|economical|cheap)\b/i.test(text)) return 'Value';
  return null;
}

/** Detect trip type (the three families: resort-anchored, city/activity, multi-city). */
function detectTripType(text: string): string | null {
  // Check multi-city FIRST — "multi-city road trip" also contains "city".
  if (/\b(multi[- ]?city|road trip|touring|explore|exploring|mixed)\b/i.test(text)) {
    return 'Multi-city';
  }
  if (/\b(resort|beach|island|all[- ]inclusive|relax(ing)?|laze|lazy)\b/i.test(text)) {
    return 'Resort-anchored';
  }
  if (/\b(city|urban|sightseeing|activities|activity|theme park|attractions?|shopping)\b/i.test(text)) {
    return 'City / activity';
  }
  return null;
}

/** Detect dietary signal. Vegan implies vegetarian; Indian-food mention is additive. */
function detectFood(text: string): string | null {
  const vegan = /\bvegan\b/i.test(text);
  const veg = vegan || /\b(vegetarian|veggie|veg\b|no meat|pure veg)\b/i.test(text);
  const indian = /\bindian\b/i.test(text);
  if (!veg && !indian) return null;
  const parts: string[] = [];
  if (vegan) parts.push('Vegan');
  else if (veg) parts.push('Vegetarian');
  if (indian) parts.push('Indian options important');
  return parts.join(' · ') || null;
}

/** Detect who's travelling — only when there's a concrete party signal. */
function detectWho(text: string): string | null {
  if (/\b(kids?|children|child|toddlers?|baby|babies|grandparents?|family of \d+)\b/i.test(text)) {
    return 'Family with young children';
  }
  return null;
}

/** Detect rough travel dates (months / "next month" / "december" etc.). */
function detectDates(text: string): string | null {
  const months =
    /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i;
  const m = text.match(months);
  if (m) {
    const word = m[0];
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }
  if (/\b(next month|next week|this summer|this winter|christmas|new year|holidays?)\b/i.test(text)) {
    const rel = text.match(
      /\b(next month|next week|this summer|this winter|christmas|new year|holidays?)\b/i,
    );
    return rel ? rel[0].charAt(0).toUpperCase() + rel[0].slice(1) : null;
  }
  return null;
}

/**
 * Detect brief updates from one user message. Only fields confidently present are
 * returned; everything else is omitted (so the caller never clobbers a known value
 * with a guess, and pending rows stay pending).
 */
export function detectBriefUpdates(userText: string): BriefPatch {
  const text = userText ?? '';
  const patch: BriefPatch = {};

  const destination = detectDestination(text);
  if (destination) patch.destination = destination;

  const type = detectTripType(text);
  if (type) patch.type = type;

  const budget = detectBudget(text);
  if (budget) patch.budget = budget;

  const food = detectFood(text);
  if (food) patch.food = food;

  const who = detectWho(text);
  if (who) patch.who = who;

  const dates = detectDates(text);
  if (dates) patch.dates = dates;

  return patch;
}
