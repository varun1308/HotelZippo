/* M25 (specs/01b) — storeHeroImage validation: a CDN anti-bot HTML page (200 OK, text/html)
 * must never upload as hero.jpg and publish a broken hero; oversized sources are skipped too.
 * Mocks global fetch + a fake Storage client (no network, no Supabase). */
jest.mock('server-only', () => ({}));

import { storeHeroImage, MAX_HERO_BYTES, HOTEL_IMAGES_BUCKET } from '@/lib/curation/images';
import type { SupabaseClient } from '@supabase/supabase-js';

function response(body: Uint8Array | string, headers: Record<string, string>, ok = true, status = 200) {
  const bytes = typeof body === 'string' ? new Uint8Array(Buffer.from(body, 'utf8')) : body;
  return {
    ok,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    arrayBuffer: async () => bytes.buffer,
  } as unknown as Response;
}

function fakeStorage() {
  const uploads: Array<{ path: string; contentType?: string; byteLength: number }> = [];
  const supabase = {
    storage: {
      from(bucket: string) {
        expect(bucket).toBe(HOTEL_IMAGES_BUCKET);
        return {
          async upload(path: string, bytes: Uint8Array, opts: { contentType?: string }) {
            uploads.push({ path, contentType: opts.contentType, byteLength: bytes.byteLength });
            return { error: null };
          },
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://storage.example/${path}` } };
          },
        };
      },
    },
  } as unknown as SupabaseClient;
  return { supabase, uploads };
}

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('storeHeroImage', () => {
  it('uploads a real image and returns the public Storage URL', async () => {
    global.fetch = jest.fn(async () =>
      response(new Uint8Array([1, 2, 3]), { 'content-type': 'image/png', 'content-length': '3' }),
    ) as unknown as typeof fetch;
    const { supabase, uploads } = fakeStorage();
    const url = await storeHeroImage(supabase, 'hotel-1', 'https://cdn.example/h.png');
    expect(url).toBe('https://storage.example/hotels/hotel-1/hero.png');
    expect(uploads).toEqual([{ path: 'hotels/hotel-1/hero.png', contentType: 'image/png', byteLength: 3 }]);
  });

  it('SKIPS an HTML anti-bot page (200 OK, text/html) — never uploaded as hero.jpg', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = jest.fn(async () =>
      response('<html><body>Are you a robot?</body></html>', { 'content-type': 'text/html; charset=utf-8' }),
    ) as unknown as typeof fetch;
    const { supabase, uploads } = fakeStorage();
    await expect(storeHeroImage(supabase, 'hotel-1', 'https://cdn.example/blocked')).rejects.toThrow(
      /non-image content-type/,
    );
    expect(uploads).toHaveLength(0); // nothing reached Storage
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('skipping hero')); // 01b: skip + LOG
  });

  it('skips when the content-type header is missing entirely', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = jest.fn(async () => response(new Uint8Array([1]), {})) as unknown as typeof fetch;
    const { supabase, uploads } = fakeStorage();
    await expect(storeHeroImage(supabase, 'hotel-1', 'https://cdn.example/x')).rejects.toThrow(/non-image/);
    expect(uploads).toHaveLength(0);
  });

  it('skips an oversized source via the declared content-length (no buffering)', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = jest.fn(async () =>
      response(new Uint8Array([1]), { 'content-type': 'image/jpeg', 'content-length': String(MAX_HERO_BYTES + 1) }),
    ) as unknown as typeof fetch;
    const { supabase, uploads } = fakeStorage();
    await expect(storeHeroImage(supabase, 'hotel-1', 'https://cdn.example/big.jpg')).rejects.toThrow(/oversized/);
    expect(uploads).toHaveLength(0);
  });

  it('skips an oversized body even when no content-length was declared', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = jest.fn(async () =>
      response(new Uint8Array(MAX_HERO_BYTES + 1), { 'content-type': 'image/jpeg' }),
    ) as unknown as typeof fetch;
    const { supabase, uploads } = fakeStorage();
    await expect(storeHeroImage(supabase, 'hotel-1', 'https://cdn.example/big2.jpg')).rejects.toThrow(/oversized/);
    expect(uploads).toHaveLength(0);
  });

  it('still throws on a non-OK download (unchanged behaviour)', async () => {
    global.fetch = jest.fn(async () => response('nope', { 'content-type': 'image/jpeg' }, false, 403)) as unknown as typeof fetch;
    const { supabase } = fakeStorage();
    await expect(storeHeroImage(supabase, 'hotel-1', 'https://cdn.example/403.jpg')).rejects.toThrow(/403/);
  });
});
