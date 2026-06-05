/* The full recommendation set: one Top Pick + the "Two more worth a look"
 * divider (.alt-head) + N Standard alternatives. Mined from Recommendation Set.html. */
import type { RecommendationSetProps } from './types';
import { TopPickCard, StandardCard } from './HotelCard';

export function RecommendationSet({
  topPick,
  otherPicks,
  altHeading = 'Two more worth a look',
}: RecommendationSetProps) {
  return (
    <div className="mx-auto w-full max-w-card">
      <TopPickCard {...topPick} />

      {otherPicks.length > 0 && (
        <>
          <div className="mx-[2px] mb-[18px] mt-[34px] flex items-center gap-3">
            <span className="whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
              {altHeading}
            </span>
            <span className="h-px flex-1 bg-border" aria-hidden />
          </div>

          <div className="flex flex-col gap-4">
            {otherPicks.map((pick, i) => (
              <StandardCard key={`${pick.hotelName}-${i}`} {...pick} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
