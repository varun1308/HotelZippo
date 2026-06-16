/* Preview seeding — step 1: Claude proposes candidate hotel NAMES for a destination (12i).
 *
 * The honest contract (12i): Claude proposes NAMES + a one-line "why family-friendly" ONLY. It never
 * invents review counts, hard-flags, quotes, prices, or star ratings — those are not trustworthy from
 * an LLM and would corrupt the review-intelligence promise. RouteStack (lib/preview/verify.ts) is the
 * ground truth that decides which proposals are real + bookable.
 *
 * Injectable `generate` seam (like lib/chat/agent.ts's injectable model, but at the function level so
 * tests need NOT mock the provider-v3 protocol — see the 3c "inject the seam, not the protocol"
 * lesson): default calls Anthropic via the Vercel AI SDK; tests pass a plain fake. Key-free CI.
 *
 * No `import 'server-only'`: reached only server-side (admin route + a tsx maintenance path), but the
 * guard would break the tsx path — server-side by construction (reads ANTHROPIC_API_KEY via the SDK). */
import { generateObject, type LanguageModel } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { DESTINATIONS } from '@/lib/db/schemas';

export const PREVIEW_MODEL = 'claude-sonnet-4-6';
const DEFAULT_COUNT = 5;

/** One Claude-proposed candidate. NAMES + a short why only — deliberately NOT review-backed facts. */
export const proposedHotelSchema = z.object({
  name: z.string().min(1),
  oneLineWhy: z.string().min(1),
});
export type ProposedHotel = z.infer<typeof proposedHotelSchema>;

const responseSchema = z.object({ hotels: z.array(proposedHotelSchema) });

/** Injectable generation seam. Default = Anthropic generateObject; tests pass a fake returning
 * `{ hotels }` directly (no provider-protocol mock). */
export type GenerateProposals = (prompt: string, count: number) => Promise<{ hotels: ProposedHotel[] }>;

function defaultGenerate(model?: LanguageModel): GenerateProposals {
  return async (prompt) => {
    const { object } = await generateObject({
      model: model ?? anthropic(PREVIEW_MODEL),
      schema: responseSchema,
      prompt,
    });
    return object;
  };
}

/** Tight, low-token prompt — JSON only, no prose, names + one-line why. */
export function buildProposePrompt(destination: string, count: number): string {
  return [
    `List ${count} real, currently-operating family-friendly hotels in ${destination}.`,
    'Favor places that work well for families with young kids (space, pool, location).',
    'Return ONLY the hotels. For each: its exact commonly-used hotel name, and a one-line reason it suits families.',
    'Do NOT invent review counts, ratings, prices, or amenities you are unsure of — name + one-line why only.',
  ].join(' ');
}

export interface ProposeOptions {
  count?: number;
  /** Injectable model (forwarded to the default generator) — tests usually pass `generate` instead. */
  model?: LanguageModel;
  /** Injectable generation seam (tests pass a fake; default calls Anthropic). */
  generate?: GenerateProposals;
}

/** Propose up to `count` candidate hotel names for a HotelZippo destination. Validates the
 * destination, de-dupes by name, and caps to `count`. Throws on an unknown destination. */
export async function proposeHotels(destination: string, opts: ProposeOptions = {}): Promise<ProposedHotel[]> {
  if (!DESTINATIONS.includes(destination as (typeof DESTINATIONS)[number])) {
    throw new Error(`Unknown destination "${destination}"`);
  }
  const count = opts.count ?? DEFAULT_COUNT;
  const generate = opts.generate ?? defaultGenerate(opts.model);

  const { hotels } = await generate(buildProposePrompt(destination, count), count);

  // De-dupe by case-insensitive name, drop blanks, cap to count.
  const seen = new Set<string>();
  const out: ProposedHotel[] = [];
  for (const h of hotels ?? []) {
    const name = h.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, oneLineWhy: (h.oneLineWhy ?? '').trim() });
    if (out.length >= count) break;
  }
  return out;
}
