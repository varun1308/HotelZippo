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

/** A node is a rate option iff it carries both ids (under any of the known aliases). The live
 * RouteStack room node (availability.groups[].rooms[]) uses `recommendationId` + `id` (the room id)
 * with the rate plan under `rateid` (lowercase) — verified against the captured fixture. The literal
 * roomId/room_id aliases stay FIRST (synthetic/legacy payloads name it explicitly), then `id` for the
 * live node. `rateid`/`rateId`/`rate_id` are deliberately NOT roomId aliases: that's the rate-PLAN id,
 * and resolving it as roomId would hand get-payment-url the wrong identifier (10c decision 6); a node
 * carrying only a rate-plan id has no usable room id and is rightly dropped. */
function extractIds(node: Record<string, unknown>): { recommendationId: string; roomId: string } | null {
  const recommendationId = pickString(node, ['recommendationId', 'recommendation_id', 'recommendationID', 'recoId']);
  const roomId = pickString(node, ['roomId', 'room_id', 'roomID', 'id']);
  if (recommendationId && roomId) return { recommendationId, roomId };
  return null;
}

/** Some live fields are objects/arrays rather than scalars. Pull a display string out of the known
 * shapes: `boardBasis` is `{ displayText, type }` live but a plain string in older/synthetic
 * payloads; `beds` is `[{ type, count }]`. */
function pickBoard(node: Record<string, unknown>): string | undefined {
  // boardBasis as a plain string, plus the other scalar aliases.
  const scalar = pickString(node, ['board', 'boardBasis', 'board_basis', 'mealPlan', 'meal_plan', 'boardType']);
  if (scalar) return scalar;
  // boardBasis as the live object shape.
  const bb = node.boardBasis;
  if (bb && typeof bb === 'object') {
    return pickString(bb as Record<string, unknown>, ['displayText', 'description', 'type']);
  }
  return undefined;
}

function pickBed(node: Record<string, unknown>): string | undefined {
  const scalar = pickString(node, ['bed', 'bedType', 'bed_type', 'bedding', 'bedConfiguration']);
  if (scalar) return scalar;
  const beds = node.beds;
  if (Array.isArray(beds) && beds.length > 0 && beds[0] && typeof beds[0] === 'object') {
    const b = beds[0] as Record<string, unknown>;
    const type = pickString(b, ['type', 'name']);
    const count = pickNumber(b, ['count', 'qty']);
    if (type) return count && count > 1 ? `${count} × ${type}` : type;
  }
  return undefined;
}

/** maxOccupancy lives in the live `occupancies` array as numOfAdults (+numOfChildren). */
function pickOccupancy(node: Record<string, unknown>): number | undefined {
  const scalar = pickNumber(node, ['maxOccupancy', 'max_occupancy', 'occupancy', 'maxGuests', 'max_guests', 'capacity']);
  if (scalar !== undefined) return scalar;
  const occ = node.occupancies;
  if (Array.isArray(occ) && occ.length > 0 && occ[0] && typeof occ[0] === 'object') {
    const o = occ[0] as Record<string, unknown>;
    const a = pickNumber(o, ['numOfAdults', 'adults']) ?? 0;
    const c = pickNumber(o, ['numOfChildren', 'children']) ?? 0;
    const total = a + c;
    return total > 0 ? total : undefined;
  }
  return undefined;
}

function mapOption(node: Record<string, unknown>, ids: { recommendationId: string; roomId: string }): RoomRateOption {
  // Price: prefer the all-in total, then the displayed "our price", before other aliases.
  const price = pickNumber(node, ['totalRate', 'total', 'totalPrice', 'ourprice', 'price', 'amount', 'showTotal', 'publishedRate']);
  const currency = pickString(node, ['currency', 'currencyCode', 'priceCurrency']);
  const free = pickBool(node, ['free_cancellation', 'freeCancellation', 'refundable', 'allow_cancellation', 'isRefundable']);
  const cancellation = pickString(node, ['cancellation', 'cancellationPolicy', 'cancellation_policy', 'cancelPolicy', 'cancellationText', 'refundability']);
  const board = pickBoard(node);
  const bed = pickBed(node);
  const roomName = pickString(node, ['roomName', 'room_name', 'roomType', 'room_type', 'name', 'title', 'description']);
  const maxOccupancy = pickOccupancy(node);

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

/** The availability-level `currencyrate` multiplier (the live payload's only currency signal —
 * there is no per-option currency code). Every captured payload has it as 1; the conversion
 * DIRECTION if it ever differs is an open question (10c decision 6), so callers propagate it and
 * warn loudly rather than guessing a conversion. Read from the first node that carries it. */
function pickCurrencyRate(nodes: Record<string, unknown>[]): number | undefined {
  for (const node of nodes) {
    const v = pickNumber(node, ['currencyrate', 'currencyRate', 'currency_rate']);
    if (v !== undefined) return v;
  }
  return undefined;
}

/** Map a get-hotel-details-and-rates result payload → the picker's room/rate options.
 * Tolerant of unknown nesting; drops nodes without both ids; de-dups by recommendationId +
 * roomId (the same ids can appear on nested mirror nodes). Returns [] for an unusable
 * payload — the caller treats empty options as "no rooms available" (warm fallback). */
export function mapRoomRateOptions(payload: unknown): RoomRateOption[] {
  const nodes = collectNodes(payload);
  const currencyRate = pickCurrencyRate(nodes);
  const seen = new Set<string>();
  const options: RoomRateOption[] = [];
  for (const node of nodes) {
    const ids = extractIds(node);
    if (!ids) continue;
    const key = `${ids.recommendationId}::${ids.roomId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const option = mapOption(node, ids);
    if (currencyRate !== undefined) option.currencyRate = currencyRate;
    options.push(option);
  }
  return options;
}
