/* Re-map entrypoint (Phase 6 follow-up). Rebuilds raw_reviews from the banked
 * raw_review_payloads WITHOUT a (paid) Apify re-scrape — run this after changing a mapper.
 *
 *   npm run pipeline:remap                    # re-map ALL hotels with stored payloads (additive)
 *   npm run pipeline:remap -- --hotel <id>    # re-map one hotel
 *   npm run pipeline:remap -- --replace       # delete + regenerate raw_reviews (use after a
 *                                             # mapper change that should overwrite existing rows)
 *   npm run pipeline:remap -- --no-indian     # disable O1 Indian tagging during re-map
 *
 * Separate Node/TS process, service-role client (payload + review tables are service-role only).
 * NO Apify import anywhere in this path — that's the guarantee. tsx loads .env.local. */
import { createClient } from '@supabase/supabase-js';
import { remapHotel, remapAll } from '@/lib/review-intelligence/remap';

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (see specs/13).');
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const client = serviceClient();
  const hotelId = argValue('--hotel');
  const replace = process.argv.includes('--replace');
  const indian = !process.argv.includes('--no-indian');
  const opts = { replace, indian };

  if (hotelId) {
    const { attempted } = await remapHotel(client, hotelId, null, opts);
    // eslint-disable-next-line no-console
    console.log(`[remap] hotel ${hotelId} — ${attempted} raw_reviews ${replace ? 'regenerated' : 'upserted'}`);
    return;
  }

  const results = await remapAll(client, null, opts);
  const total = results.reduce((n, r) => n + r.attempted, 0);
  // eslint-disable-next-line no-console
  console.log(`[remap] ${results.length} hotels — ${total} raw_reviews ${replace ? 'regenerated' : 'upserted'}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[remap] fatal:', e);
  process.exit(1);
});
