/* The full recommendation set: one Top Pick + the alternatives divider (.alt-head)
 * + N Standard alternatives. Mined from Recommendation Set.html.
 *
 * The divider heading must match the actual alternative count (1–2 per spec 08b-2):
 * "One more worth a look" / "Two more worth a look". When the caller doesn't supply an
 * explicit altHeading, it's derived from otherPicks.length so the copy never claims "two"
 * when only one renders. */
import type { RecommendationSetProps } from './types';
import { TopPickCard, StandardCard } from './HotelCard';

function defaultAltHeading(count: number): string {
  if (count === 1) return 'One more worth a look';
  return 'Two more worth a look';
}

export function RecommendationSet({
  topPick,
  otherPicks,
  altHeading,
}: RecommendationSetProps) {
  const heading = altHeading ?? defaultAltHeading(otherPicks.length);
  return (
    <div className="mx-auto w-full max-w-card" data-testid="recommendation-set">
      <TopPickCard {...topPick} />

      {otherPicks.length > 0 && (
        <>
          <div className="mx-[2px] mb-[18px] mt-[34px] flex items-center gap-3">
            <span className="whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
              {heading}
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
