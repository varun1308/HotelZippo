/* Hotel recommendation cards — Top Pick (hero) + Standard (collapsible alternative).
 *
 * Hard rules enforced here (CLAUDE.md 1 & 4 / specs/05):
 *   • The Top Pick is visually unmistakable: border-primary-200, rounded-card,
 *     shadow-lg, and the Award "Top Pick" badge. Standard cards have none of these.
 *   • EVERY hard flag renders ABOVE the body, before any positive content — on the
 *     #1 pick too, and on Standard cards in BOTH collapsed and expanded states.
 *     Flags are never inside the collapsible region.
 *   • Missing hero image → elegant .photo-slot placeholder, never a broken <img>.
 *   • Expand animation moves POSITION only (animate-rise), never opacity-from-0,
 *     and is gated on prefers-reduced-motion via tokens.css.
 *
 * Values mined from Top Pick Card.html and Recommendation Set.html.
 */
'use client';

import { useId, useState } from 'react';
import {
  Award,
  BadgeCheck,
  Bookmark,
  ArrowRight,
  ChevronDown,
} from 'lucide-react';
import type { StandardCardProps, TopPickCardProps } from './types';
import { Hero, MetaRow, Verdict, CategoryGrid } from './internal';
import { HardFlag } from './HardFlag';

/* ---- shared hero pieces -------------------------------------------------- */

function TopPickBadge() {
  return (
    <span className="inline-flex items-center gap-[7px] whitespace-nowrap rounded-pill bg-primary-500 py-2 pl-3 pr-[15px] text-[12px] font-bold uppercase tracking-[0.07em] text-white shadow-md">
      <Award aria-hidden className="h-[15px] w-[15px]" strokeWidth={1.75} /> Top Pick
    </span>
  );
}

function LoyaltyPill({ note }: { note: string }) {
  return (
    <span className="inline-flex items-center gap-[7px] whitespace-nowrap rounded-pill border border-white/[0.28] bg-white/[0.16] px-3 py-[7px] text-[12px] font-semibold text-white backdrop-blur-md">
      <BadgeCheck aria-hidden className="h-[14px] w-[14px]" strokeWidth={1.75} /> {note}
    </span>
  );
}

function RankPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-[6px] whitespace-nowrap rounded-pill border border-white/[0.28] bg-white/[0.18] px-3 py-[6px] text-[11px] font-semibold uppercase tracking-[0.06em] text-white backdrop-blur-md">
      {label}
    </span>
  );
}

/* 12i — preview tier. NEUTRAL, honest label (no hard-flag amber/red): this hotel is bookable but
 * not yet review-intelligence-backed. */
function PreviewBadge() {
  return (
    <span
      title="Bookable now — full review intelligence coming soon"
      className="inline-flex items-center whitespace-nowrap rounded-pill border border-white/[0.28] bg-white/[0.16] px-3 py-[6px] text-[11px] font-semibold uppercase tracking-[0.06em] text-white backdrop-blur-md"
    >
      Preview
    </span>
  );
}

/* CTA buttons mirror .hz-btn from the prototype. */
function CTAs({
  onSave,
  onProceed,
  saved = false,
}: {
  onSave?: () => void;
  onProceed?: () => void;
  saved?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 pt-[2px] sm:flex-row">
      <button
        type="button"
        onClick={onSave}
        aria-pressed={saved}
        className={`inline-flex h-[50px] flex-1 items-center justify-center gap-[9px] rounded-btn border text-[15px] font-semibold transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          saved
            ? 'border-primary-500 bg-primary-500 text-white'
            : 'border-border-strong bg-surface text-text hover:bg-surface-2'
        }`}
      >
        <Bookmark aria-hidden className="h-[17px] w-[17px]" strokeWidth={1.75} />{' '}
        {saved ? 'Saved to shortlist' : 'Save to shortlist'}
      </button>
      <button
        type="button"
        onClick={onProceed}
        className="inline-flex h-[50px] flex-1 items-center justify-center gap-[9px] rounded-btn bg-primary-500 text-[15px] font-semibold text-white transition-colors duration-fast hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        Proceed to book{' '}
        <ArrowRight aria-hidden className="h-[17px] w-[17px]" strokeWidth={1.75} />
      </button>
    </div>
  );
}

/* ========================================================================== *
 * TOP PICK
 * ========================================================================== */
export function TopPickCard(props: TopPickCardProps) {
  const {
    hotelName,
    heroImageUrl,
    heroLabel,
    brandNote,
    hardFlags,
    verdict,
    categorySummaries,
    saved,
    onSave,
    onProceed,
  } = props;

  return (
    <article
      data-testid="top-pick-card"
      className="overflow-hidden rounded-card border border-primary-200 bg-surface shadow-lg"
    >
      <div className="relative h-[240px] sm:h-[300px]">
        <Hero src={heroImageUrl} alt={hotelName} label={heroLabel} />
        <div
          className="absolute inset-0"
          aria-hidden
          style={{
            background:
              'linear-gradient(to top, rgba(20,15,12,0.80) 0%, rgba(20,15,12,0.12) 44%, rgba(20,15,12,0.04) 100%)',
          }}
        />
        <div className="absolute left-[18px] right-[18px] top-[18px] flex items-start justify-between gap-3">
          <TopPickBadge />
          <div className="flex items-start gap-2">
            {props.isPreview && <PreviewBadge />}
            {brandNote && <LoyaltyPill note={brandNote} />}
          </div>
        </div>
        <div className="absolute bottom-[22px] left-6 right-6">
          <h2 className="font-serif text-[26px] font-medium leading-[1.1] tracking-[-0.02em] text-white sm:text-[32px]">
            {hotelName}
          </h2>
          <MetaRow display={props} />
        </div>
      </div>

      {/* Hard flags ABOVE the body, before any positive content. Every flag. */}
      {hardFlags.map((flag, i) => (
        <HardFlag key={`${flag.category}-${i}`} {...flag} evidenceCount={flag.review_evidence_count} />
      ))}

      <div className="flex flex-col gap-[22px] p-[18px] sm:p-6">
        <Verdict label="Why this one" text={verdict} />
        {/* Preview top picks (12i) carry no category summaries — skip the grid, never fabricate it. */}
        {categorySummaries && <CategoryGrid summaries={categorySummaries} />}
        <CTAs onSave={onSave} onProceed={onProceed} saved={saved} />
      </div>
    </article>
  );
}

/* ========================================================================== *
 * STANDARD (collapsible alternative)
 * ========================================================================== */
export function StandardCard(props: StandardCardProps) {
  const {
    hotelName,
    heroImageUrl,
    heroLabel,
    brandNote,
    hardFlags,
    summary,
    verdict,
    verdictLabel = 'Why it ranks here',
    categorySummaries,
    rankLabel,
    defaultOpen = false,
    saved: savedProp,
    onSave,
    onProceed,
  } = props;

  // Expandable only when richer detail was hydrated (assembly `other_picks` alone has
  // just `summary`). Without it we never offer "See full details" — see types.ts note.
  const expandable = verdict != null || categorySummaries != null;
  const [open, setOpen] = useState(defaultOpen && expandable);
  const [localSaved, setLocalSaved] = useState(false);
  // Controlled (Phase 3d shortlist) when `saved` is provided; else self-managed.
  const controlled = savedProp != null;
  const saved = controlled ? savedProp : localSaved;
  const detailId = useId();

  function handleSave() {
    const next = !saved;
    if (!controlled) setLocalSaved(next);
    onSave?.(next);
  }

  return (
    <article
      data-testid="alt-card"
      className="overflow-hidden rounded-card border border-border bg-surface shadow-sm transition-shadow duration-base hover:shadow-md"
    >
      <div className="relative h-[170px] sm:h-[188px]">
        <Hero src={heroImageUrl} alt={hotelName} label={heroLabel} />
        <div
          className="absolute inset-0"
          aria-hidden
          style={{
            background:
              'linear-gradient(to top, rgba(20,15,12,0.82) 0%, rgba(20,15,12,0.14) 46%, rgba(20,15,12,0.04) 100%)',
          }}
        />
        <div className="absolute left-4 right-4 top-4 flex items-start justify-between gap-3">
          {rankLabel ? <RankPill label={rankLabel} /> : <span />}
          <div className="flex items-start gap-2">
            {props.isPreview && <PreviewBadge />}
            {brandNote && <LoyaltyPill note={brandNote} />}
          </div>
        </div>
        <div className="absolute bottom-[18px] left-[22px] right-[22px]">
          <h3 className="font-serif text-[22px] font-medium leading-[1.1] tracking-[-0.02em] text-white">
            {hotelName}
          </h3>
          <MetaRow display={props} />
        </div>
      </div>

      {/* Hard flags ABOVE the body — visible whether collapsed OR expanded. */}
      {hardFlags.map((flag, i) => (
        <HardFlag key={`${flag.category}-${i}`} {...flag} evidenceCount={flag.review_evidence_count} />
      ))}

      <div className="flex flex-col gap-4 px-[22px] pb-5 pt-[18px] sm:px-[22px]">
        {!open && (
          <p className="m-0 text-[15px] leading-[1.55] text-text-secondary">{summary}</p>
        )}

        {open && (
          <div className="flex animate-rise flex-col gap-5" id={detailId}>
            {verdict != null && <Verdict label={verdictLabel} text={verdict} />}
            {categorySummaries != null && <CategoryGrid summaries={categorySummaries} />}
          </div>
        )}

        {!expandable ? (
          /* No richer detail to expand into — summary + actions only. */
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label={saved ? 'Remove from shortlist' : 'Save to shortlist'}
              aria-pressed={saved}
              onClick={handleSave}
              className={`inline-flex h-[46px] flex-1 items-center justify-center gap-2 rounded-btn border text-[14px] font-semibold transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                saved
                  ? 'border-primary-500 bg-primary-500 text-white'
                  : 'border-border-strong bg-surface text-text hover:bg-surface-2'
              }`}
            >
              <Bookmark aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.75} />
              {saved ? 'Saved' : 'Save to shortlist'}
            </button>
            <button
              type="button"
              onClick={onProceed}
              className="inline-flex h-[46px] flex-1 items-center justify-center gap-[9px] rounded-btn bg-primary-500 text-[14px] font-semibold text-white transition-colors duration-fast hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Proceed to book{' '}
              <ArrowRight aria-hidden className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        ) : !open ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-expanded={false}
              aria-controls={detailId}
              onClick={() => setOpen(true)}
              className="inline-flex h-[46px] flex-1 items-center justify-center gap-2 rounded-btn border border-border-strong bg-surface text-[14px] font-semibold text-text transition-colors duration-fast hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              See full details
              <ChevronDown aria-hidden className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              aria-label={saved ? 'Remove from shortlist' : 'Save to shortlist'}
              aria-pressed={saved}
              onClick={handleSave}
              className={`grid h-[46px] w-[46px] flex-none place-items-center rounded-btn border transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                saved
                  ? 'border-primary-500 bg-primary-500 text-white'
                  : 'border-border-strong bg-surface text-text-secondary hover:border-primary-300 hover:bg-primary-50 hover:text-primary-600'
              }`}
            >
              <Bookmark aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              aria-expanded
              aria-controls={detailId}
              onClick={() => setOpen(false)}
              className="inline-flex h-[48px] flex-1 items-center justify-center gap-[9px] rounded-btn border border-border-strong bg-surface text-[14.5px] font-semibold text-text transition-colors duration-fast hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ChevronDown
                aria-hidden
                className="h-4 w-4 rotate-180"
                strokeWidth={1.75}
              />{' '}
              Show less
            </button>
            <button
              type="button"
              onClick={onProceed}
              className="inline-flex h-[48px] flex-1 items-center justify-center gap-[9px] rounded-btn bg-primary-500 text-[14.5px] font-semibold text-white transition-colors duration-fast hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Proceed to book{' '}
              <ArrowRight aria-hidden className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

/* Unified entry: pick the variant by prop. */
export type HotelCardProps =
  | ({ variant: 'top-pick' } & TopPickCardProps)
  | ({ variant: 'standard' } & StandardCardProps);

export function HotelCard(props: HotelCardProps) {
  if (props.variant === 'top-pick') {
    const { variant: _v, ...rest } = props;
    return <TopPickCard {...rest} />;
  }
  const { variant: _v, ...rest } = props;
  return <StandardCard {...rest} />;
}
