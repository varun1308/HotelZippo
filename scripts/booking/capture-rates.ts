/* RouteStack rooms/rates schema-capture (Phase 7 · Slice C · specs/10c-booking-routestack.md).
 *
 *   npm run booking:capture                 # default destination Phuket, +30/+33 day dates
 *   npm run booking:capture -- Singapore    # a specific HotelZippo destination
 *   npm run booking:capture -- Pune         # known-good sandbox fallback city
 *
 * Runs the live sandbox flow through get-hotel-details-and-rates ONLY (it STOPS before
 * get-payment-url — it never starts a booking) and writes the RAW rooms/rates result to
 * specs/fixtures/routestack/rooms-rates.json. That captured payload is the canonical fixture
 * the adaptive mapper (lib/booking/rates.ts) is reconciled against — pinning the real room/
 * rate field names that openapi.yaml trims out.
 *
 * Needs ROUTESTACK_API_KEY / ROUTESTACK_API_SECRET / ROUTESTACK_API_URL in .env.local
 * (tsx loads it via --env-file). Run with: npm run booking:capture. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { getPartnerToken, _clearTokenCache } from '@/lib/booking/auth';
import { createRouteStackFetch } from '@/lib/booking/transport';
import { buildRoomsOccupancy } from '@/lib/booking/party';
import { mapRoomRateOptions } from '@/lib/booking/rates';

const OUT_FILE = path.join(process.cwd(), 'specs', 'fixtures', 'routestack', 'rooms-rates.json');

/** +30 / +33 days from today as ISO yyyy-mm-dd (a safe future window for sandbox inventory). */
function defaultDates(): { checkIn: string; checkOut: string } {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { checkIn: iso(now + 30 * day), checkOut: iso(now + 33 * day) };
}

async function main() {
  const destination = process.argv[2] ?? 'Phuket';
  const { checkIn, checkOut } = defaultDates();
  const fetchImpl = createRouteStackFetch();
  _clearTokenCache();

  // eslint-disable-next-line no-console
  console.log(`[capture] ${destination} · ${checkIn} → ${checkOut}`);
  const token = await getPartnerToken(fetchImpl);
  const auth = { Authorization: `Bearer ${token}` };

  // 1. resolve destination
  const dest = (await fetchImpl('/mcp/hotel/search-destinations', { query: destination, type: 'DESTINATION' }, auth)) as {
    result?: Array<{ id: string; type?: string; coordinates?: { lat: number; long: number } }>;
  };
  const hit = dest.result?.find((d) => d.coordinates && typeof d.coordinates.lat === 'number');
  if (!hit) throw new Error(`No destination match for "${destination}"`);

  // 2. search hotels (single room, 2 adults — just to surface inventory to inspect)
  const rooms = buildRoomsOccupancy({ adults: 2, childAges: [], rooms: 1 });
  const search = (await fetchImpl(
    '/mcp/hotel/search-hotels',
    {
      destinationId: hit.id,
      destinationType: hit.type ?? 'City',
      lat: hit.coordinates!.lat,
      long: hit.coordinates!.long,
      checkIn,
      checkOut,
      rooms,
      currency: 'USD',
    },
    auth,
  )) as { result?: { correlationId?: string; token?: string; result?: Array<{ id: string; name: string }> } };

  const listing = search.result;
  const first = listing?.result?.[0];
  if (!first || !listing?.correlationId || !listing?.token) {
    throw new Error('search-hotels returned no inventory / session handles — try another destination or dates.');
  }
  // eslint-disable-next-line no-console
  console.log(`[capture] hotel: ${first.name} (${first.id})`);

  // 3. details + rates — the payload we want to capture. STOP here (no payment-url).
  const rates = await fetchImpl(
    '/mcp/hotel/get-hotel-details-and-rates',
    {
      hotelId: first.id,
      hotelName: first.name,
      token: listing.token,
      correlationId: listing.correlationId,
      checkIn,
      checkOut,
      rooms,
    },
    auth,
  );

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(rates, null, 2), 'utf8');

  const result = (rates as { result?: unknown }).result ?? rates;
  const mapped = mapRoomRateOptions(result);
  // eslint-disable-next-line no-console
  console.log(`[capture] wrote ${OUT_FILE}`);
  // eslint-disable-next-line no-console
  console.log(`[capture] adaptive mapper resolved ${mapped.length} room/rate option(s).`);
  if (mapped.length === 0) {
    // eslint-disable-next-line no-console
    console.warn('[capture] ⚠ 0 options mapped — inspect rooms-rates.json and reconcile lib/booking/rates.ts aliases.');
  } else {
    // eslint-disable-next-line no-console
    console.log('[capture] sample:', JSON.stringify(mapped[0], null, 2));
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[capture] failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
