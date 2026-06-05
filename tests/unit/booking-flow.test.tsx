/* Phase 7 · Slice B — the booking modal flow state machine. Mocks the two API routes and the
 * url opener; proves confirm → searching → picking → finalizing → handoff + the warm error
 * paths. server-only is aliased (the hook itself is client, but it pulls party.ts which is
 * pure — no server-only — so no mock strictly needed; aliased for safety). */
jest.mock('server-only', () => ({}));

import { act, renderHook, waitFor } from '@testing-library/react';
import { useBookingFlow } from '@/lib/booking/useBookingFlow';
import type { FamilyProfile } from '@/components/profile';
import type { RatesResponse, PaymentUrlResponse, BookingApiError } from '@/lib/booking/api-contract';
import type { BookingHotel } from '@/lib/booking/context';

const HOTEL: BookingHotel = { hotelId: 'H-1', hotelName: 'The Family Beach Resort', destination: 'Phuket' };

const PROFILE: FamilyProfile = {
  name: 'Varun',
  hometown: 'Mumbai',
  spouse: true,
  children: [{ name: 'A', age: 2 }, { name: 'B', age: 7 }],
  food: 'vegetarian',
  indianFoodMatters: true,
  budgetTier: 'comfort',
  brandPreferences: [],
  notes: null,
};

const RATES: RatesResponse = {
  hotelId: 'H-1',
  hotelName: 'The Family Beach Resort',
  correlationId: 'corr-1',
  token: 'tok-1',
  options: [
    { recommendationId: 'reco-A', roomId: 'room-A', roomName: 'Deluxe Twin', price: 482.5, currency: 'USD', board: 'Breakfast included' },
  ],
};
const PAYMENT: PaymentUrlResponse = { bookingUrl: 'https://evolve.routestack.ai/hotel/guests?x=1&deeplink=Y' };

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

function mockFetch(map: Record<string, unknown>): jest.Mock {
  return jest.fn(async (url: string) => {
    const key = Object.keys(map).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected url ${url}`);
    return jsonResponse(map[key]);
  });
}

describe('useBookingFlow', () => {
  it('seeds the confirm step from the saved profile on proceed', () => {
    const { result } = renderHook(() => useBookingFlow({ profile: PROFILE, dates: null, fetchImpl: jest.fn(), openUrl: jest.fn() }));
    act(() => result.current.proceed(HOTEL));
    expect(result.current.state.step).toBe('confirm');
    expect(result.current.state.hotel).toEqual(HOTEL);
    expect(result.current.state.party).toEqual({ adults: 2, childAges: [2, 7], rooms: 1 });
    expect(result.current.state.dates).toBeNull(); // month-only → confirm screen collects
  });

  it('runs phase 1 on confirm and advances to the picker', async () => {
    const fetchImpl = mockFetch({ '/api/booking/rates': RATES });
    const { result } = renderHook(() => useBookingFlow({ profile: PROFILE, dates: null, fetchImpl: fetchImpl as unknown as typeof fetch, openUrl: jest.fn() }));
    act(() => result.current.proceed(HOTEL));
    act(() => result.current.setDates({ checkIn: '2026-07-01', checkOut: '2026-07-05' }));
    await act(async () => {
      await result.current.confirm();
    });
    expect(result.current.state.step).toBe('picking');
    expect(result.current.state.options).toHaveLength(1);
    // The request carried the confirmed party + dates.
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ hotelName: HOTEL.hotelName, destination: 'Phuket', dates: { checkIn: '2026-07-01', checkOut: '2026-07-05' } });
    expect(body.party).toEqual({ adults: 2, childAges: [2, 7], rooms: 1 });
  });

  it('stays on confirm when dates are missing (no call)', async () => {
    const fetchImpl = mockFetch({ '/api/booking/rates': RATES });
    const { result } = renderHook(() => useBookingFlow({ profile: PROFILE, dates: null, fetchImpl: fetchImpl as unknown as typeof fetch, openUrl: jest.fn() }));
    act(() => result.current.proceed(HOTEL));
    await act(async () => {
      await result.current.confirm();
    });
    expect(result.current.state.step).toBe('confirm');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('selects a room, runs phase 2, opens the deep link, and closes', async () => {
    const fetchImpl = mockFetch({ '/api/booking/rates': RATES, '/api/booking/payment-url': PAYMENT });
    const openUrl = jest.fn();
    const { result } = renderHook(() => useBookingFlow({ profile: PROFILE, dates: null, fetchImpl: fetchImpl as unknown as typeof fetch, openUrl }));
    act(() => result.current.proceed(HOTEL));
    act(() => result.current.setDates({ checkIn: '2026-07-01', checkOut: '2026-07-05' }));
    await act(async () => {
      await result.current.confirm();
    });
    await act(async () => {
      await result.current.selectRoom(RATES.options[0]);
    });
    expect(openUrl).toHaveBeenCalledWith(PAYMENT.bookingUrl);
    expect(result.current.state.step).toBe('idle'); // handed off → modal closed

    // payment-url request threaded the session handles + chosen room.
    const payCall = fetchImpl.mock.calls.find((c) => (c[0] as string).includes('/payment-url'))!;
    const body = JSON.parse((payCall[1] as RequestInit).body as string);
    expect(body).toMatchObject({ correlationId: 'corr-1', token: 'tok-1', recommendationId: 'reco-A', roomId: 'room-A' });
  });

  it('maps a warm API error envelope to the error step', async () => {
    const err: BookingApiError = { error: 'no-availability', message: 'No rooms for those dates.' };
    const fetchImpl = mockFetch({ '/api/booking/rates': err });
    const { result } = renderHook(() => useBookingFlow({ profile: PROFILE, dates: null, fetchImpl: fetchImpl as unknown as typeof fetch, openUrl: jest.fn() }));
    act(() => result.current.proceed(HOTEL));
    act(() => result.current.setDates({ checkIn: '2026-07-01', checkOut: '2026-07-05' }));
    await act(async () => {
      await result.current.confirm();
    });
    expect(result.current.state.step).toBe('error');
    expect(result.current.state.error).toEqual({ kind: 'no-availability', message: 'No rooms for those dates.' });

    // retry returns to confirm (never a dead-end).
    act(() => result.current.retry());
    expect(result.current.state.step).toBe('confirm');
  });

  it('handles a transport throw as a warm error', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('network');
    });
    const { result } = renderHook(() => useBookingFlow({ profile: PROFILE, dates: null, fetchImpl: fetchImpl as unknown as typeof fetch, openUrl: jest.fn() }));
    act(() => result.current.proceed(HOTEL));
    act(() => result.current.setDates({ checkIn: '2026-07-01', checkOut: '2026-07-05' }));
    await act(async () => {
      await result.current.confirm();
    });
    await waitFor(() => expect(result.current.state.step).toBe('error'));
    expect(result.current.state.error?.kind).toBe('transport');
  });

  it('falls back to an empty party with no profile', () => {
    const { result } = renderHook(() => useBookingFlow({ profile: null, dates: null, fetchImpl: jest.fn(), openUrl: jest.fn() }));
    act(() => result.current.proceed(HOTEL));
    expect(result.current.state.party).toEqual({ adults: 1, childAges: [], rooms: 1 });
  });
});
