/* Locally-run pipeline worker entrypoint (Phase 6 · specs/02 Orchestration).
 *
 *   npm run pipeline:worker          # poll once: process the active run, if any, then exit
 *   npm run pipeline:worker -- --watch   # poll continuously every POLL_MS
 *
 * This is a SEPARATE Node/TS process (not a Vercel route) so a full destination scrape can
 * run for many minutes. It initialises OTEL independently (per spec 14 — the pipeline is a
 * separate process) and uses the service-role Supabase client (pipeline tables are
 * service-role only). The admin UI triggers a run by inserting a pipeline_runs row
 * (status='running'); this worker picks it up via the DB-enforced single-active-run.
 *
 * Run with: npx tsx scripts/pipeline/run-worker.ts  (tsx loads .env.local). */
// OTEL bootstrap MUST run before anything that creates spans (processActiveRun → apify/synthesis
// spans). Without this, every pipeline span is created against a no-op tracer and silently dropped.
// This side-effecting import is FIRST so ESM evaluates it ahead of the worker chain's tracers; it
// uses the same shared config as the Next.js server (lib/otel/register) so both processes match.
import './otel-bootstrap';

import { createClient } from '@supabase/supabase-js';
import { processActiveRun } from '@/lib/review-intelligence/worker';

const POLL_MS = Number(process.env.PIPELINE_POLL_MS ?? 5000);

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (see specs/13).');
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function tick(): Promise<boolean> {
  const client = serviceClient();
  const result = await processActiveRun(client);
  if (result) {
    // eslint-disable-next-line no-console
    console.log(
      `[pipeline] run ${result.runId} done — ${result.complete}/${result.total} complete, ${result.failed} failed`,
    );
    return true;
  }
  return false;
}

async function main() {
  const watch = process.argv.includes('--watch');
  if (!watch) {
    const ran = await tick();
    if (!ran) console.log('[pipeline] no active run'); // eslint-disable-line no-console
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[pipeline] watching for runs every ${POLL_MS}ms…`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[pipeline] tick error:', e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[pipeline] fatal:', e);
  process.exit(1);
});
