/* Curation top-N selection (lib/curation/select). Prefer 4&5-star by Traveller Ranking; backfill
 * with the next-best-ranked if fewer than N; de-dup by name; null rank sorts last. Pure, no I/O. */
import { selectTopHotels } from '@/lib/curation/select';
import type { FetchedHotel } from '@/lib/curation/types';

/** Build a fetched hotel with the fields selection cares about. */
function hotel(name: string, rank: number | null, star: 3 | 4 | 5 | null): FetchedHotel {
  return { name, destination: 'Phuket', tripadvisor_rank: rank, star_rating: star };
}

describe('selectTopHotels', () => {
  it('keeps only 4&5-star, ordered by Traveller Ranking, capped at topN', () => {
    const pool = [
      hotel('A', 3, 5),
      hotel('B', 1, 4),
      hotel('C', 2, 5),
      hotel('D', 4, 3), // 3-star excluded while enough 4&5-star exist
      hotel('E', 5, 4),
    ];
    const out = selectTopHotels(pool, { topN: 3 });
    expect(out.map((h) => h.name)).toEqual(['B', 'C', 'A']); // ranks 1,2,3 — all 4/5-star
  });

  it('backfills with the next-best-ranked (incl. 3-star/unrated) when fewer than N four/five-star', () => {
    const pool = [
      hotel('Five', 10, 5),
      hotel('Four', 20, 4),
      hotel('ThreeBest', 5, 3), // best-ranked overall but 3-star → only used as backfill
      hotel('ThreeMid', 15, 3),
      hotel('NoStar', 25, null),
    ];
    const out = selectTopHotels(pool, { topN: 4 });
    // 2 preferred (Five r10, Four r20) first, then backfill by ranking: ThreeBest r5, ThreeMid r15.
    expect(out.map((h) => h.name)).toEqual(['Five', 'Four', 'ThreeBest', 'ThreeMid']);
  });

  it('returns fewer than N only when the pool is smaller than N', () => {
    const out = selectTopHotels([hotel('A', 1, 5), hotel('B', 2, 4)], { topN: 50 });
    expect(out).toHaveLength(2);
  });

  it('de-dups by name, keeping the better-ranked copy', () => {
    const pool = [hotel('Dup', 30, 4), hotel('Dup', 3, 5), hotel('Other', 10, 4)];
    const out = selectTopHotels(pool, { topN: 50 });
    expect(out).toHaveLength(2);
    const dup = out.find((h) => h.name === 'Dup');
    expect(dup?.tripadvisor_rank).toBe(3); // the better-ranked duplicate survived
  });

  it('null/missing rank sorts last', () => {
    const pool = [hotel('NoRank', null, 5), hotel('Ranked', 100, 5)];
    const out = selectTopHotels(pool, { topN: 50 });
    expect(out.map((h) => h.name)).toEqual(['Ranked', 'NoRank']);
  });

  it('defaults: topN=50, preferred=[4,5]', () => {
    const pool = Array.from({ length: 80 }, (_, i) => hotel(`H${i}`, i + 1, i % 2 === 0 ? 4 : 5));
    const out = selectTopHotels(pool);
    expect(out).toHaveLength(50);
    expect(out[0].name).toBe('H0'); // best rank first
  });
});
