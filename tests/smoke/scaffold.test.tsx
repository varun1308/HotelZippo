/* Phase 0 smoke tests — the scaffold gate (specs/15-test-strategy.md, Phase 0).
   Verifies the app shell renders, the env template is complete, and OTEL is
   initialised at the instrumentation layer. */
import fs from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import Home from '@/app/page';

const root = process.cwd();

describe('Phase 0 scaffold', () => {
  it('renders the home page shell with the brand wordmark', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('HotelZippo');
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
      'NEXT_PUBLIC_APP_URL',
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

  it('OTEL is initialised at the instrumentation layer with service.name hotelzippo', () => {
    // Verify by source inspection — instrumentation.ts imports the server-only
    // @vercel/otel module, so we assert its shape rather than executing it in jsdom.
    const src = fs.readFileSync(path.join(root, 'instrumentation.ts'), 'utf8');
    expect(src).toContain('export function register()');
    expect(src).toContain('registerOTel');
    expect(src).toContain("serviceName: 'hotelzippo'");
  });
});
