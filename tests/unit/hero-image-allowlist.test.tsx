/* H7 — hero image host allowlist + graceful degradation.
 *
 * next/image THROWS at render for hostnames missing from remotePatterns; the card
 * <Hero> must therefore validate the src against the SAME allowlist (the shared
 * allowed-image-hosts helper) and degrade — plain <img> for a live-but-unlisted
 * host, elegant placeholder for garbage — never a crash (spec 05 hard constraint 3).
 * The ChatErrorBoundary is the last line of defence: one bad inline block can never
 * take down the whole chat. */
import { render, screen } from '@testing-library/react';
import { ALLOWED_IMAGE_HOSTS, isAllowedImageSrc } from '@/components/recommendation/allowed-image-hosts.mjs';
import { Hero } from '@/components/recommendation/internal';
import { TopPickCard } from '@/components/recommendation/HotelCard';
import { ChatErrorBoundary } from '@/components/chat/ChatErrorBoundary';
import { MessageRow } from '@/components/chat/MessageRow';
import { topPick } from './fixtures';

describe('isAllowedImageSrc', () => {
  it('allows every configured host shape (wildcard, port, plain)', () => {
    expect(isAllowedImageSrc('https://abc.supabase.co/storage/v1/object/x.jpg')).toBe(true);
    expect(isAllowedImageSrc('http://127.0.0.1:54321/storage/v1/object/x.jpg')).toBe(true);
    expect(isAllowedImageSrc('http://localhost:54321/storage/v1/object/x.jpg')).toBe(true);
    expect(isAllowedImageSrc('https://picsum.photos/seed/1/800/600')).toBe(true);
    // RouteStack CDN heroes on preview-tier hotels (specs/fixtures/routestack).
    expect(isAllowedImageSrc('https://i.travelapi.com/lodging/1000000/1.jpg')).toBe(true);
  });

  it('allows relative paths (local assets)', () => {
    expect(isAllowedImageSrc('/heroes/raj-family-resort.jpg')).toBe(true);
  });

  it('rejects unlisted hosts, wrong protocols/ports, and garbage', () => {
    expect(isAllowedImageSrc('https://evil.example.com/x.jpg')).toBe(false);
    expect(isAllowedImageSrc('http://picsum.photos/x.jpg')).toBe(false); // https-only host
    expect(isAllowedImageSrc('http://localhost:9999/x.jpg')).toBe(false); // wrong port
    expect(isAllowedImageSrc('https://supabase.co/x.jpg')).toBe(false); // wildcard needs a subdomain
    expect(isAllowedImageSrc('https://a.b.supabase.co/x.jpg')).toBe(false); // `*` is one label
    expect(isAllowedImageSrc('not a url at all')).toBe(false);
  });

  it('every allowlist entry is remotePatterns-shaped (next.config.mjs maps it 1:1)', () => {
    for (const p of ALLOWED_IMAGE_HOSTS) {
      expect(['http', 'https']).toContain(p.protocol);
      expect(typeof p.hostname).toBe('string');
    }
  });
});

describe('Hero degradation (never a crash, never broken)', () => {
  // NOTE: the allowlisted path (next/image) is not renderable under jest — next/image
  // reads remotePatterns from the running Next server, which jest doesn't boot, and
  // throws for ANY remote host here. The allowlist agreement itself is covered by the
  // isAllowedImageSrc tests above (next.config.mjs maps the same list 1:1).

  it('renders a plain <img> (not the placeholder, no throw) for a non-allowlisted http(s) host', () => {
    const { container } = render(
      <Hero src="https://some-new-cdn.example.net/hero.jpg" alt="Preview hotel hero" />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    // Plain <img>: the raw URL, untouched by the next/image loader.
    expect(img).toHaveAttribute('src', 'https://some-new-cdn.example.net/hero.jpg');
  });

  it('renders the elegant placeholder for a non-URL src', () => {
    const { container } = render(<Hero src="definitely-not-a-url" alt="x" label="resort hero" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: /photo unavailable/i })).toBeInTheDocument();
  });

  it('a full card with a non-allowlisted hero renders without throwing', () => {
    render(
      <TopPickCard {...topPick} heroImageUrl="https://unknown-cdn.example.org/h.jpg" />,
    );
    expect(screen.getByText(topPick.hotelName)).toBeInTheDocument();
  });
});

describe('ChatErrorBoundary (H7 — one bad card never takes down the chat)', () => {
  function Bomb(): JSX.Element {
    throw new Error('boom');
  }

  let consoleSpy: jest.SpyInstance;
  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => consoleSpy.mockRestore());

  it('renders the warm fallback instead of crashing', () => {
    render(
      <ChatErrorBoundary>
        <Bomb />
      </ChatErrorBoundary>,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/couldn.t display this one/i);
  });

  it('a malformed recommendation-set part degrades to the warm line, message still renders', () => {
    const { container } = render(
      <MessageRow
        message={{
          id: 'a1',
          role: 'assistant',
          parts: [
            { type: 'text', text: 'Here you go:' },
            // Broken payload: no topPick → the card component throws at render.
            { type: 'component', component: 'recommendation-set', props: {} },
          ],
        }}
      />,
    );
    // The prose survives (whole-word spans, so match on textContent) and the block
    // shows the warm fallback — no page crash.
    expect(container.textContent).toMatch(/Here you go:/);
    expect(screen.getByRole('status')).toHaveTextContent(/couldn.t display this one/i);
  });
});
