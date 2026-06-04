/* Phase 1b integration (12b): full curation flow against local Supabase.
 * fetch (mock) → stage → approve (rule enforced) → Publish-to-Hotels → verify in hotels,
 * incl. hero image stored to Storage. Image downloads are stubbed (no network). */
import { serviceClient } from './helpers';
import { publishApproved } from '@/lib/curation/publish';
import { canApprove } from '@/lib/curation/validator';

jest.setTimeout(30_000);
const admin = serviceClient();

// Stub ONLY image-host downloads (example.test) so storeHeroImage gets a deterministic
// tiny JPEG; delegate every other request (incl. the Supabase client's own fetch) to
// the real fetch, otherwise we'd break all DB/Storage calls.
const realFetch = global.fetch;
beforeAll(() => {
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('https://example.test/')) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    }
    return realFetch(input as never, init);
  }) as typeof fetch;
});
afterAll(() => {
  global.fetch = realFetch;
});

const DEST = 'Phuket';

async function cleanup() {
  await admin.from('curation_hotels').delete().eq('destination', DEST);
  await admin.from('hotels').delete().eq('destination', DEST);
}

beforeEach(cleanup);
afterAll(cleanup);

async function stage(row: Record<string, unknown>) {
  const { data, error } = await admin
    .from('curation_hotels')
    .insert({ destination: DEST, status: 'pending', ...row })
    .select()
    .single();
  if (error) throw error;
  return data;
}

describe('curation → publish', () => {
  it('publishes an approved, complete hotel into public.hotels with a stored hero image', async () => {
    const r = await stage({
      name: 'JW Marriott Phuket Resort & Spa',
      tripadvisor_url: 'https://www.tripadvisor.com/x',
      review_count: 4200,
      star_rating: 5,
      brand: 'Marriott',
      price_tier: 'luxury',
      images: ['https://example.test/hero.jpg'],
      status: 'approved',
    });

    const result = await publishApproved(admin, DEST);
    expect(result.published).toBe(1);
    expect(result.skipped).toHaveLength(0);

    const { data: hotel } = await admin
      .from('hotels')
      .select('*')
      .eq('name', r.name)
      .eq('destination', DEST)
      .single();
    expect(hotel).toBeTruthy();
    expect(hotel!.star_rating).toBe(5);
    expect(hotel!.images?.length).toBe(1);
    // hero URL points at the hotel-images Storage bucket
    expect(hotel!.images![0]).toMatch(/hotel-images\/hotels\//);
  });

  it('skips a hotel with no images (12g blocks publish)', async () => {
    await stage({
      name: 'No Image Resort',
      tripadvisor_url: 'https://www.tripadvisor.com/y',
      review_count: 200,
      images: [],
      status: 'approved',
    });
    const result = await publishApproved(admin, DEST);
    expect(result.published).toBe(0);
    expect(result.skipped[0].reasons.join(' ')).toMatch(/image/i);
  });

  it('does not publish pending/rejected rows', async () => {
    await stage({
      name: 'Pending Resort',
      tripadvisor_url: 'https://www.tripadvisor.com/z',
      review_count: 200,
      images: ['https://example.test/hero.jpg'],
      status: 'pending',
    });
    const result = await publishApproved(admin, DEST);
    expect(result.published).toBe(0);
  });

  it('publish upserts on (name, destination) — re-publish does not duplicate', async () => {
    const payload = {
      name: 'Idempotent Resort',
      tripadvisor_url: 'https://www.tripadvisor.com/i',
      review_count: 300,
      star_rating: 4 as const,
      price_tier: 'mid-range',
      images: ['https://example.test/hero.jpg'],
      status: 'approved',
    };
    await stage(payload);
    await publishApproved(admin, DEST);
    await publishApproved(admin, DEST);

    const { data } = await admin
      .from('hotels')
      .select('id')
      .eq('name', payload.name)
      .eq('destination', DEST);
    expect(data).toHaveLength(1);
  });

  it('approval rule mirrors DB reality: < 100 reviews cannot be approved', () => {
    expect(canApprove({ review_count: 99 }).ok).toBe(false);
  });
});
