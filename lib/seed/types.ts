/* Demo Intelligence seed types + Zod (12d / specs/12d-seed-script.md).
 * A demo file is a hand-authored JSON record (founder-authored) that maps to one
 * public.hotel_intelligence row. `hotel_name` + `destination` are the lookup keys
 * into public.hotels; the remaining fields are the synthesised intelligence payload.
 * The shape mirrors hotelIntelligenceSchema (lib/db/schemas) minus the DB-managed
 * columns (id, hotel_id, last_refreshed, low_confidence). */
import { z } from 'zod';
import {
  DESTINATIONS,
  SIGNAL_STRENGTHS,
  hardFlagSchema,
} from '@/lib/db/schemas';

const categoryStrings = z.object({
  rooms: z.string(),
  facilities: z.string(),
  food: z.string(),
  location: z.string(),
});

const categoryPhrases = z.object({
  rooms: z.array(z.string()),
  facilities: z.array(z.string()),
  food: z.array(z.string()),
  location: z.array(z.string()),
});

const categorySignals = z.object({
  rooms: z.enum(SIGNAL_STRENGTHS),
  facilities: z.enum(SIGNAL_STRENGTHS),
  food: z.enum(SIGNAL_STRENGTHS),
  location: z.enum(SIGNAL_STRENGTHS),
});

/** One hand-authored demo intelligence file. Strict: unknown keys are rejected so a
 * typo in a founder-authored file fails loudly at validation rather than silently
 * dropping into a column that never gets written. */
export const demoIntelligenceSchema = z
  .object({
    hotel_name: z.string().min(1),
    destination: z.enum(DESTINATIONS),
    rooms_summary: z.string(),
    facilities_summary: z.string(),
    food_summary: z.string(),
    location_summary: z.string(),
    hard_flags: z.array(hardFlagSchema),
    conflicting_signals: categoryStrings,
    family_signal_strength: categorySignals,
    supporting_phrases: categoryPhrases,
    indian_food_signal: z.string(),
    review_count_family: z.number().int().nonnegative(),
    review_count_total: z.number().int().nonnegative(),
  })
  .strict();

export type DemoIntelligence = z.infer<typeof demoIntelligenceSchema>;

export interface SeedDetail {
  file: string;
  hotel_name: string;
  destination: string;
  action: 'written' | 'skipped';
  hotel_id?: string;
  reason?: string;
}

export interface SeedResult {
  written: number;
  skipped: number;
  details: SeedDetail[];
}
