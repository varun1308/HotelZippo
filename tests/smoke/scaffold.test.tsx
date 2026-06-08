/* Phase 0 smoke tests — the scaffold gate (specs/15-test-strategy.md, Phase 0).
   Verifies the app shell renders, the env template is complete, and OTEL is
   initialised at the instrumentation layer. */
import fs from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';

// The landing page (app/page.tsx) is a client component that reads
// useSearchParams; outside a router it returns null, so mock next/navigation.
// signInWithGoogle is mocked so no Supabase browser client is constructed.
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
}));
jest.mock('@/lib/auth/signIn', () => ({
  signInWithGoogle: jest.fn().mockResolvedValue(undefined),
  signOut: jest.fn(),
}));

import Home from '@/app/page';

const root = process.cwd();

describe('Phase 0 scaffold', () => {
  it('renders the home page shell with the brand wordmark', () => {
    render(<Home />);
    // The brand wordmark "HotelZippo" appears in the fixed top nav (split as
    // "Hotel" + <b>Zippo</b>) and the showcase slide heads.
    expect(screen.getAllByText('Zippo').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('.env.example documents every variable from specs/13-environment.md', () => {
    const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
    const required = [
      'ANTHROPIC_API_KEY',
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'APIFY_API_TOKEN',
      'APIFY_TRIPADVISOR_REVIEWS_ACTOR_ID',
      'APIFY_GOOGLE_REVIEWS_ACTOR_ID',
      'APIFY_TRIPADVISOR_SEARCH_ACTOR_ID',
      'ROUTESTACK_API_KEY',
      'ROUTESTACK_API_URL',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'DASH0_API_KEY',
      'OTEL_EXPORTER_OTLP_ENDPOINT',
    ];
    for (const key of required) {
      expect(env).toContain(key);
    }
  });

  it('.gitignore excludes .env.local but not .env.example', () => {
    const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    expect(gi).toMatch(/\.env\.local/);
    expect(gi).not.toMatch(/^\.env\.example/m);
  });

  it('OTEL is initialised at the instrumentation layer via the shared bootstrap', () => {
    // Verify by source inspection — these modules import the server-only @vercel/otel module, so we
    // assert their shape rather than executing it in jsdom. instrumentation.ts (Next.js server) and
    // the pipeline worker both delegate to lib/otel/register so the two processes share one config.
    const instr = fs.readFileSync(path.join(root, 'instrumentation.ts'), 'utf8');
    expect(instr).toContain('export function register()');
    expect(instr).toContain('registerHotelZippoOtel');

    const reg = fs.readFileSync(path.join(root, 'lib', 'otel', 'register.ts'), 'utf8');
    expect(reg).toContain('registerOTel');
    expect(reg).toContain("serviceName: 'hotelzippo'");

    // The pipeline worker (separate process) must bootstrap OTEL FIRST, or its spans are dropped.
    const worker = fs.readFileSync(path.join(root, 'scripts', 'pipeline', 'run-worker.ts'), 'utf8');
    expect(worker).toContain("import './otel-bootstrap'");
  });
});
