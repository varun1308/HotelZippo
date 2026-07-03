/* Loads local Supabase test credentials (.env.test) for the node integration project.
 * .env.test holds the PUBLIC well-known local Supabase defaults (not secrets). */
import { config } from 'dotenv';
import path from 'node:path';

config({ path: path.join(process.cwd(), '.env.test') });

/* Defense-in-depth against PAID actor runs: unless the live smoke is explicitly opted in
 * (APIFY_LIVE_SMOKE=1), no Apify credential may reach a routine integration run — even if it
 * leaked in from the shell or a mis-loaded env file. apify-live.test.ts documents the opt-in;
 * booking-sandbox.test.ts loads its own RouteStack creds behind ROUTESTACK_LIVE_SMOKE=1. */
if (process.env.APIFY_LIVE_SMOKE !== '1') {
  delete process.env.APIFY_API_TOKEN;
  delete process.env.APIFY_TRIPADVISOR_SEARCH_ACTOR_ID;
  delete process.env.APIFY_TRIPADVISOR_REVIEWS_ACTOR_ID;
  delete process.env.APIFY_GOOGLE_REVIEWS_ACTOR_ID;
}
