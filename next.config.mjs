import { ALLOWED_IMAGE_HOSTS } from './components/recommendation/allowed-image-hosts.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // OTEL instrumentation hook (instrumentation.ts). Default-on in Next 15;
  // explicit here for Next 14. See specs/14-error-handling.md.
  experimental: {
    instrumentationHook: true,
  },
  images: {
    // The allowlist lives in ONE place (allowed-image-hosts.mjs) — the card <Hero>
    // validates hero URLs against the same list so next/image can never throw on an
    // unconfigured host (H7 / spec 05 hard constraint 3).
    remotePatterns: ALLOWED_IMAGE_HOSTS.map(({ protocol, hostname, port }) => ({
      protocol,
      hostname,
      ...(port ? { port } : {}),
    })),
  },
};

export default nextConfig;
