/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // OTEL instrumentation hook (instrumentation.ts). Default-on in Next 15;
  // explicit here for Next 14. See specs/14-error-handling.md.
  experimental: {
    instrumentationHook: true,
  },
  images: {
    // Supabase Storage hero images (12g / specs/01b-image-sourcing.md). The Storage
    // host comes from NEXT_PUBLIC_SUPABASE_URL; allow-list it for next/image. Local
    // dev (127.0.0.1:54321) is included so curated heroes render during development.
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'http', hostname: '127.0.0.1', port: '54321' },
      { protocol: 'http', hostname: 'localhost', port: '54321' },
      // Placeholder hero host used by the local demo seed fixtures (npm run dev:db).
      // Harmless dummy-image service; production heroes still come from Supabase Storage.
      { protocol: 'https', hostname: 'picsum.photos' },
      { protocol: 'https', hostname: 'fastly.picsum.photos' }, // picsum redirects here
    ],
  },
};

export default nextConfig;
