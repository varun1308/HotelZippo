/* Unit guard for the E2E /api/booking/* stub (lib/booking/e2e-stub.ts, specs/15a §1.1, J4).
 *
 * The stub only runs under NEXT_PUBLIC_E2E=1, but it carries real logic (option payload,
 * no-availability branch, deep-link shape) + a prod-safety default, so it's pinned here.
 * Node project: uses Response (absent in jsdom). */
import { e2eEnabled, e2eRatesStub, e2ePaymentUrlStub } from '@/lib/booking/e2e-stub';
import type { RatesRequest, PaymentUrlRequest } from '@/lib/booking/api-contract';
import type { RatesResponse, BookingApiError } from '@/lib/booking/api-contract';

const baseRates: RatesRequest = {
  hotelId: 'h1',
  hotelName: 'Test Resort',
  destination: 'Phuket',
  party: { adults: 2, childAges: [8], rooms: 1 },
  dates: { checkIn: '2026-12-10', checkOut: '2026-12-13' },
};

const basePay: PaymentUrlRequest = {
  hotelId: 'h1',
  hotelName: 'Test Resort',
  correlationId: 'c1',
  token: 't1',
  recommendationId: 'r1',
  roomId: 'rm1',
  dates: { checkIn: '2026-12-10', checkOut: '2026-12-13' },
};

describe('booking e2eEnabled', () => {
  const prev = process.env.NEXT_PUBLIC_E2E;
  afterEach(() => {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_E2E;
    else process.env.NEXT_PUBLIC_E2E = prev;
  });
  it('defaults to false (prod can never serve the stub)', () => {
    delete process.env.NEXT_PUBLIC_E2E;
    expect(e2eEnabled()).toBe(false);
  });
  it('is true only for the exact "1" flag', () => {
    process.env.NEXT_PUBLIC_E2E = '1';
    expect(e2eEnabled()).toBe(true);
  });
});

describe('e2eRatesStub', () => {
  it('returns two room options — one fully described, one sparse (graceful omission)', async () => {
    const res = e2eRatesStub(baseRates);
    expect(res.status).toBe(200);
    const json = (await res.json()) as RatesResponse;
    expect(json.options).toHaveLength(2);
    // Full option carries the descriptive fields the picker shows.
    expect(json.options[0]).toMatchObject({ roomName: 'Deluxe Pool Access', currency: 'USD' });
    // Sparse option carries only the ids + a name (every other field omitted, not null/empty).
    expect(json.options[1].roomName).toBe('Garden Twin');
    expect(json.options[1].price).toBeUndefined();
    expect(json.options[1].board).toBeUndefined();
    // Session handles present (phase 2 threads them).
    expect(json.correlationId).toBeTruthy();
    expect(json.token).toBeTruthy();
  });

  it('returns a warm no-availability error for the __NOAVAIL__ token', async () => {
    const res = e2eRatesStub({ ...baseRates, hotelName: 'Test __NOAVAIL__ Resort' });
    expect(res.status).toBe(200); // business outcome = warm 200 body, not an HTTP error
    const json = (await res.json()) as BookingApiError;
    expect(json.error).toBe('no-availability');
    expect(json.message).toMatch(/no rooms/i);
  });
});

describe('e2ePaymentUrlStub', () => {
  it('returns a deep-link booking url', async () => {
    const res = e2ePaymentUrlStub(basePay);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { bookingUrl: string };
    expect(json.bookingUrl).toContain('example.test/checkout');
  });
});
