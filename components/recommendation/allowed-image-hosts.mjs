/* The ONE source of truth for next/image remote hosts (H7).
 *
 * `next.config.mjs` maps this list straight into `images.remotePatterns`, and the
 * card <Hero> validates hero URLs against the same list before handing them to
 * next/image — because next/image THROWS at render for an unconfigured hostname,
 * and a single bad hero URL must never take down the chat (spec 05 hard
 * constraint 3: placeholders elegant, never broken).
 *
 * Plain .mjs (with JSDoc types) so BOTH next.config.mjs and the TS components can
 * import it without a build step. */

/** @typedef {{ protocol: 'http' | 'https'; hostname: string; port?: string }} AllowedImageHost */

/** @type {AllowedImageHost[]} */
export const ALLOWED_IMAGE_HOSTS = [
  // Supabase Storage hero images (12g / specs/01b-image-sourcing.md). The Storage
  // host comes from NEXT_PUBLIC_SUPABASE_URL; local dev (127.0.0.1:54321) is
  // included so curated heroes render during development.
  { protocol: 'https', hostname: '*.supabase.co' },
  { protocol: 'http', hostname: '127.0.0.1', port: '54321' },
  { protocol: 'http', hostname: 'localhost', port: '54321' },
  // Placeholder hero host used by the local demo seed fixtures (npm run dev:db).
  // Harmless dummy-image service; production heroes still come from Supabase Storage.
  { protocol: 'https', hostname: 'picsum.photos' },
  { protocol: 'https', hostname: 'fastly.picsum.photos' }, // picsum redirects here
  // RouteStack CDN heroes on preview-tier hotels (12i / lib/preview/verify.ts stores
  // the supplier's grounded hero URL). Host observed stable across the captured
  // fixtures (specs/fixtures/routestack/).
  { protocol: 'https', hostname: 'i.travelapi.com' },
];

/** True when `hostname` matches an allowlist pattern (supports a leading `*.` wildcard,
 *  matching next/image remotePatterns semantics: `*.x.co` matches one subdomain level). */
function hostnameMatches(/** @type {string} */ pattern, /** @type {string} */ hostname) {
  if (!pattern.startsWith('*.')) return pattern === hostname;
  const suffix = pattern.slice(2);
  if (!hostname.endsWith(`.${suffix}`)) return false;
  // `*` covers exactly one label (next/image uses `**` for multi-level).
  const head = hostname.slice(0, hostname.length - suffix.length - 1);
  return head.length > 0 && !head.includes('.');
}

/** True when `src` is safe to hand to next/image: a relative path (local asset) or an
 *  absolute http(s) URL whose host is on the allowlist above. Anything else → the caller
 *  must degrade (plain <img> or the elegant placeholder), never let next/image throw. */
export function isAllowedImageSrc(/** @type {string} */ src) {
  if (src.startsWith('/')) return true; // relative → served by us, always fine
  let url;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  const protocol = url.protocol.replace(/:$/, '');
  return ALLOWED_IMAGE_HOSTS.some(
    (p) =>
      p.protocol === protocol &&
      hostnameMatches(p.hostname, url.hostname) &&
      (p.port ?? '') === url.port,
  );
}
