/* Dev-only file cache for external calls (Apify actors + Google Places), so the admin curation UI
 * and routes can be exercised END-TO-END against REAL banked payloads with ZERO live spend.
 *
 * OFF by default and prod-safe: every function is a no-op unless CURATION_USE_CACHE === '1'. That
 * flag is a developer convenience for local route testing — never set it in production, where live
 * data is the point. When on:
 *   - a cache HIT returns the banked payload and the live call is skipped entirely;
 *   - a cache MISS makes the real call and WRITES THROUGH, so the first run banks it for the rest.
 *
 * The cache lives under scripts/dev/.cache/routes/ (git-ignored, alongside the script caches) and is
 * keyed by a stable hash of (label, actorId/endpoint, normalised input). "Volatile" input keys that
 * change run-to-run without changing the meaningful result (e.g. the reviews date floor) are stripped
 * before hashing so same-query calls keep hitting the cache across days.
 *
 * Server-side only by construction (fs + reached from server routes / the tsx worker); never imported
 * by a client component. No `import 'server-only'` so the tsx worker chain can load it too. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const CACHE_DIR = path.join(process.cwd(), 'scripts', 'dev', '.cache', 'routes');

/** Input keys that vary run-to-run without changing the meaningful result — excluded from the hash so
 * repeated same-query calls stay cache-hits (e.g. the reviews 12-month date floor shifts daily). */
const VOLATILE_KEYS = new Set(['lastReviewDate', 'since']);

export function cacheEnabled(): boolean {
  return process.env.CURATION_USE_CACHE === '1';
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => !VOLATILE_KEYS.has(k))
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** The cache filename for a (label, scope, input) — exported so dev pre-seed tooling computes the
 * SAME key the live wrapper uses (no drift). Internal to dev tooling; not part of any prod path. */
export function cacheKeyFor(label: string, scope: string, input: unknown): string {
  return keyFor(label, scope, input);
}

function keyFor(label: string, scope: string, input: unknown): string {
  const hash = crypto.createHash('sha256').update(`${scope}\n${stableStringify(input)}`).digest('hex').slice(0, 16);
  // A readable prefix + the hash → easy to eyeball which file is which in the cache dir.
  const safeScope = scope.replace(/[^a-z0-9]+/gi, '-').slice(0, 40);
  return `${label}__${safeScope}__${hash}.json`;
}

async function read(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.readFile(path.join(CACHE_DIR, file), 'utf8'));
  } catch {
    return undefined;
  }
}

async function write(file: string, value: unknown): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(path.join(CACHE_DIR, file), JSON.stringify(value, null, 2), 'utf8');
}

/** Wrap a live call with the dev cache: HIT → return banked value (no live call); MISS → run `live`,
 * write through, return it. A pure pass-through to `live()` when the flag is off. `label` groups the
 * cache files by kind (e.g. "apify", "places"); `scope` distinguishes calls within a kind (actor id /
 * endpoint); `input` is the request payload (volatile keys are normalised out of the key). */
export async function withActorCache<T>(
  label: string,
  scope: string,
  input: unknown,
  live: () => Promise<T>,
): Promise<T> {
  if (!cacheEnabled()) return live();
  const file = keyFor(label, scope, input);
  const hit = await read(file);
  if (hit !== undefined) {
    // eslint-disable-next-line no-console
    console.log(`[actor-cache] HIT ${file} (no live call)`);
    return hit as T;
  }
  // eslint-disable-next-line no-console
  console.log(`[actor-cache] MISS ${file} — calling live + banking`);
  const value = await live();
  await write(file, value);
  return value;
}
