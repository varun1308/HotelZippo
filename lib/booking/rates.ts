/* Adaptive rooms/rates mapper (Phase 7 · specs/10c-booking-routestack.md).
 *
 * The get-hotel-details-and-rates response is TRIMMED in specs/openapi.yaml ("Response
 * trimmed for documentation due to size", length 150098), so the exact room/rate field
 * names are not known from the doc. This mapper is therefore deliberately TOLERANT: it
 * probes a set of plausible field-name aliases, coerces types defensively, and OMITS any
 * field it can't find rather than rendering broken. The exact names are pinned in Slice C
 * by capturing a real sandbox response into specs/fixtures/routestack/rooms-rates.json and
 * reconciling the aliases below against it.
 *
 * Hard requirement: an option is only usable if it has BOTH recommendationId and roomId
 * (phase 2 needs them). Options missing either are dropped. */
import type { RoomRateOption } from './types';

/** Walk a nested object/array tree collecting every plain object node, so we can find the
 * rate-bearing nodes regardless of how the provider nests rooms → rate plans. Bounded depth
 * to avoid pathological payloads. */
function collectNodes(value: unknown, depth = 0, acc: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (depth > 8 || value == null) return acc;
  if (Array.isArray(value)) {
    for (const v of value) collectNodes(v, depth + 1, acc);
    return acc;
  }
  if (typeof value === 'object') {
    const node = value as Record<string, unknown>;
    acc.push(node);
    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') collectNodes(v, depth + 1, acc);
    }
  }
  return acc;
}

function pickString(node: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = node[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function pickNumber(node: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = node[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  }
  return undefined;
}

function pickBool(node: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const k of keys) {
    const v = node[k];
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      if (/^(true|yes|free)$/i.test(v.trim())) return true;
      if (/^(false|no)$/i.test(v.trim())) return false;
    }
  }
  return undefined;
}

/** A node is a rate option iff it carries both ids (under any of the known aliases). */
function extractIds(node: Record<string, unknown>): { recommendationId: string; roomId: string } | null {
  const recommendationId = pickString(node, ['recommendationId', 'recommendation_id', 'recommendationID', 'recoId']);
  const roomId = pickString(node, ['roomId', 'room_id', 'roomID', 'rateId', 'rate_id']);
  if (recommendationId && roomId) return { recommendationId, roomId };
  return null;
}

function mapOption(node: Record<string, unknown>, ids: { recommendationId: string; roomId: string }): RoomRateOption {
  const price = pickNumber(node, ['price', 'total', 'totalPrice', 'ourprice', 'amount', 'showTotal', 'publishedRate']);
  const currency = pickString(node, ['currency', 'currencyCode', 'priceCurrency']);
  const free = pickBool(node, ['free_cancellation', 'freeCancellation', 'refundable', 'allow_cancellation', 'isRefundable']);
  const cancellation = pickString(node, ['cancellation', 'cancellationPolicy', 'cancellation_policy', 'cancelPolicy', 'cancellationText']);
  const board = pickString(node, ['board', 'boardBasis', 'board_basis', 'mealPlan', 'meal_plan', 'boardType']);
  const bed = pickString(node, ['bed', 'bedType', 'bed_type', 'bedding', 'bedConfiguration']);
  const roomName = pickString(node, ['roomName', 'room_name', 'roomType', 'room_type', 'name', 'title', 'description']);
  const maxOccupancy = pickNumber(node, ['maxOccupancy', 'max_occupancy', 'occupancy', 'maxGuests', 'max_guests', 'capacity']);

  const option: RoomRateOption = { ...ids };
  if (roomName !== undefined) option.roomName = roomName;
  if (price !== undefined) option.price = price;
  if (currency !== undefined) option.currency = currency;
  if (cancellation !== undefined) option.cancellation = cancellation;
  if (free !== undefined) option.freeCancellation = free;
  if (board !== undefined) option.board = board;
  if (bed !== undefined) option.bed = bed;
  if (maxOccupancy !== undefined) option.maxOccupancy = maxOccupancy;
  return option;
}

/** Map a get-hotel-details-and-rates result payload → the picker's room/rate options.
 * Tolerant of unknown nesting; drops nodes without both ids; de-dups by recommendationId +
 * roomId (the same ids can appear on nested mirror nodes). Returns [] for an unusable
 * payload — the caller treats empty options as "no rooms available" (warm fallback). */
export function mapRoomRateOptions(payload: unknown): RoomRateOption[] {
  const nodes = collectNodes(payload);
  const seen = new Set<string>();
  const options: RoomRateOption[] = [];
  for (const node of nodes) {
    const ids = extractIds(node);
    if (!ids) continue;
    const key = `${ids.recommendationId}::${ids.roomId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(mapOption(node, ids));
  }
  return options;
}
