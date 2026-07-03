/* Publish-to-Hotels GATES (specs/12a rules) — depth on lib/curation/publish.ts beyond
 * tests/integration/curation.test.ts, which already covers: happy path w/ stored hero, the
 * 0-image block (12g), pending rows skipped, upsert idempotency (no duplicate row), and the
 * unreachable-hero atomicity invariant.
 *
 * ADDED here (previously uncovered at the publish level): the 100-review gate enforced INSIDE
 * publishApproved (not just the canApprove unit rule), a NULL review_count, rejected rows,
 * missing tripadvisor_url, aggregated multi-reason skips, partial batches (one good + one
 * blocked), destination scoping, and re-publish REFRESHING fields on the same hotel row.
 *
 * Uses its OWN destination (Orlando) + unique 'PGate' names so the shared local DB can run
 * other suites in parallel; every row it stages is deleted in afterAll. Image downloads are
 * stubbed (no network) — same targeted-fetch pattern as curation.test.ts. */
import { serviceClient } from './helpers';
import { publishApproved } from '@/lib/curation/publish';

jest.setTimeout(30_000);
const admin = serviceClient();

// Stub ONLY image-host downloads (example.test) so storeHeroImage gets a deterministic tiny
// JPEG; delegate every other request (incl. the Supabase client's own fetch) to the real fetch.
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

// Own sandbox: a destination no other curation suite stages rows in (curation.test.ts=Phuket,
// curation-resolve-places=Tokyo, rls=Bali), plus a second one for the scoping test.
const DEST = 'Orlando';
const OTHER_DEST = 'Singapore';
const OWN_HOTELS = [
  'PGate Under Review Resort',
  'PGate Null Reviews Resort',
  'PGate Rejected Resort',
  'PGate No TA URL Resort',
  'PGate Good Resort',
  'PGate Blocked Resort',
  'PGate Other Dest Resort',
  'PGate Refresh Resort',
];

async function cleanup() {
  await admin.from('curation_hotels').delete().in('destination', [DEST, OTHER_DEST]).in('name', OWN_HOTELS);
  await admin.from('hotels').delete().in('destination', [DEST, OTHER_DEST]).in('name', OWN_HOTELS);
}
beforeEach(cleanup);
afterAll(cleanup);

/** Stage a curation row; defaults are a fully publishable APPROVED hotel — tests override the
 * single field under test so each failure reason is isolated. */
async function stage(row: Record<string, unknown>) {
  const { data, error } = await admin
    .from('curation_hotels')
    .insert({
      destination: DEST,
      status: 'approved',
      tripadvisor_url: 'https://www.tripadvisor.com/pgate',
      review_count: 500,
      images: ['https://example.test/hero.jpg'],
      ...row,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function hotelRows(name: string, destination = DEST) {
  const { data } = await admin.from('hotels').select('id, star_rating, price_tier').eq('name', name).eq('destination', destination);
  return data ?? [];
}

describe('publishApproved — 12a gates', () => {
  it('blocks an APPROVED hotel with < 100 reviews (publish-level gate, not just canApprove)', async () => {
    // An approved row can drift under the gate post-approval (e.g. manual edit) — publish must
    // re-check, not trust the status.
    await stage({ name: 'PGate Under Review Resort', review_count: 99 });
    const result = await publishApproved(admin, DEST);
    const skip = result.skipped.find((s) => s.name === 'PGate Under Review Resort');
    expect(skip).toBeTruthy();
    expect(skip!.reasons.join(' ')).toMatch(/100 reviews/i);
    expect(await hotelRows('PGate Under Review Resort')).toHaveLength(0); // nothing committed
  });

  it('blocks a NULL review_count the same as a low one', async () => {
    await stage({ name: 'PGate Null Reviews Resort', review_count: null });
    const result = await publishApproved(admin, DEST);
    const skip = result.skipped.find((s) => s.name === 'PGate Null Reviews Resort');
    expect(skip).toBeTruthy();
    expect(skip!.reasons.join(' ')).toMatch(/100 reviews/i);
    expect(await hotelRows('PGate Null Reviews Resort')).toHaveLength(0);
  });

  it('never publishes a REJECTED row (curation.test.ts covers pending; this pins rejected)', async () => {
    await stage({ name: 'PGate Rejected Resort', status: 'rejected' });
    const result = await publishApproved(admin, DEST);
    // Rejected rows are filtered by the status='approved' query — not even reported as skipped.
    expect(result.details.find((d) => d.name === 'PGate Rejected Resort')).toBeUndefined();
    expect(result.skipped.find((s) => s.name === 'PGate Rejected Resort')).toBeUndefined();
    expect(await hotelRows('PGate Rejected Resort')).toHaveLength(0);
  });

  it('blocks a missing tripadvisor_url (required-field rule)', async () => {
    await stage({ name: 'PGate No TA URL Resort', tripadvisor_url: null });
    const result = await publishApproved(admin, DEST);
    const skip = result.skipped.find((s) => s.name === 'PGate No TA URL Resort');
    expect(skip).toBeTruthy();
    expect(skip!.reasons.join(' ')).toMatch(/tripadvisor_url/i);
    expect(await hotelRows('PGate No TA URL Resort')).toHaveLength(0);
  });

  it('aggregates EVERY failed rule into one skip entry (review gate + image rule together)', async () => {
    await stage({ name: 'PGate Blocked Resort', review_count: 10, images: [] });
    const result = await publishApproved(admin, DEST);
    const skip = result.skipped.find((s) => s.name === 'PGate Blocked Resort');
    expect(skip).toBeTruthy();
    const joined = skip!.reasons.join(' ');
    expect(joined).toMatch(/100 reviews/i);
    expect(joined).toMatch(/image/i); // the 12g reason is present too, not swallowed
    expect(skip!.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('a partial batch publishes the good row and skips ONLY the blocked one', async () => {
    await stage({ name: 'PGate Good Resort', star_rating: 5, price_tier: 'luxury' });
    await stage({ name: 'PGate Blocked Resort', review_count: 99 });
    const result = await publishApproved(admin, DEST);

    expect(result.details.map((d) => d.name)).toContain('PGate Good Resort');
    expect(result.details.map((d) => d.name)).not.toContain('PGate Blocked Resort');
    expect(result.skipped.map((s) => s.name)).toContain('PGate Blocked Resort');

    expect(await hotelRows('PGate Good Resort')).toHaveLength(1); // blocked neighbour didn't poison the batch
    expect(await hotelRows('PGate Blocked Resort')).toHaveLength(0);
  });

  it('scopes to the requested destination — an approved row elsewhere is untouched', async () => {
    await stage({ name: 'PGate Other Dest Resort', destination: OTHER_DEST });
    const result = await publishApproved(admin, DEST); // publish Orlando only
    expect(result.details.find((d) => d.name === 'PGate Other Dest Resort')).toBeUndefined();
    expect(result.skipped.find((s) => s.name === 'PGate Other Dest Resort')).toBeUndefined();
    expect(await hotelRows('PGate Other Dest Resort', OTHER_DEST)).toHaveLength(0);
  });

  it('re-publish REFRESHES fields on the SAME hotel row (curated edits flow through the upsert)', async () => {
    const staged = await stage({ name: 'PGate Refresh Resort', star_rating: 4, price_tier: 'mid-range' });
    await publishApproved(admin, DEST);
    const [first] = await hotelRows('PGate Refresh Resort');
    expect(first.star_rating).toBe(4);

    // Curator corrects the row, then re-publishes.
    await admin
      .from('curation_hotels')
      .update({ star_rating: 5, price_tier: 'luxury' })
      .eq('id', staged.id);
    await publishApproved(admin, DEST);

    const rows = await hotelRows('PGate Refresh Resort');
    expect(rows).toHaveLength(1); // still one row (idempotent key)...
    expect(rows[0].id).toBe(first.id); // ...the SAME row (stable hotel id → stable Storage object)
    expect(rows[0].star_rating).toBe(5); // ...with the edits carried through
    expect(rows[0].price_tier).toBe('luxury');
  });
});
