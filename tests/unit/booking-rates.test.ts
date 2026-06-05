/* Phase 7 · adaptive rooms/rates mapper. Field names are pinned for real in Slice C via a
 * captured sandbox fixture; here we prove the mapper is tolerant of nesting + aliases and
 * omits gracefully. */
import { mapRoomRateOptions } from '@/lib/booking/rates';
import { DETAILS_AND_RATES_RESPONSE } from '@/tests/fixtures/routestack';

describe('mapRoomRateOptions', () => {
  it('extracts options carrying both ids, mapping descriptive fields', () => {
    const opts = mapRoomRateOptions(DETAILS_AND_RATES_RESPONSE.result);
    expect(opts).toHaveLength(2);
    const a = opts.find((o) => o.recommendationId === 'reco-A')!;
    expect(a.roomId).toBe('room-A');
    expect(a.price).toBe(482.5);
    expect(a.currency).toBe('USD');
    expect(a.board).toBe('Breakfast included');
    expect(a.freeCancellation).toBe(true);
    expect(a.cancellation).toMatch(/free cancellation/i);
    // room-level fields (roomType/bedType/maxOccupancy) read from the nearest node that has ids?
    // The rate node itself lacks them, so they may be omitted — that's acceptable (graceful).
  });

  it('drops nodes missing either id', () => {
    const payload = { rates: [{ recommendationId: 'only-reco', total: 100 }, { roomId: 'only-room' }] };
    expect(mapRoomRateOptions(payload)).toHaveLength(0);
  });

  it('omits absent descriptive fields rather than inventing them', () => {
    const payload = { rates: [{ recommendationId: 'r', roomId: 'm' }] };
    const [opt] = mapRoomRateOptions(payload);
    expect(opt).toEqual({ recommendationId: 'r', roomId: 'm' });
    expect(opt.price).toBeUndefined();
    expect(opt.board).toBeUndefined();
  });

  it('reads snake_case + alternate aliases', () => {
    const payload = {
      recommendation_id: 'r1',
      room_id: 'm1',
      room_type: 'Sea View',
      amount: '350',
      currencyCode: 'USD',
      meal_plan: 'Half board',
      bed_type: '1 Queen',
      max_occupancy: 2,
      refundable: 'yes',
    };
    const [opt] = mapRoomRateOptions(payload);
    expect(opt).toMatchObject({
      recommendationId: 'r1',
      roomId: 'm1',
      roomName: 'Sea View',
      price: 350,
      currency: 'USD',
      board: 'Half board',
      bed: '1 Queen',
      maxOccupancy: 2,
      freeCancellation: true,
    });
  });

  it('de-dups repeated id pairs across mirror nodes', () => {
    const payload = {
      a: { recommendationId: 'x', roomId: 'y', total: 1 },
      b: { recommendationId: 'x', roomId: 'y', total: 1 },
    };
    expect(mapRoomRateOptions(payload)).toHaveLength(1);
  });

  it('returns [] for an unusable payload', () => {
    expect(mapRoomRateOptions(null)).toEqual([]);
    expect(mapRoomRateOptions({ junk: true })).toEqual([]);
    expect(mapRoomRateOptions('nope')).toEqual([]);
  });
});
