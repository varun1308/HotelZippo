/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // OTEL instrumentation hook (instrumentation.ts). Default-on in Next 15;
  // explicit here for Next 14. See specs/14-error-handling.md.
  experimental: {
    instrumentationHook: true,
  },
  images: {
    // Supabase Storage hero images are added in Phase 1 (see specs/01b-image-sourcing.md).
    // remotePatterns will be populated with the Storage domain at that point.
    remotePatterns: [],
  },
};

export default nextConfig;
