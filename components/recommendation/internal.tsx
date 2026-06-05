/* Shared building blocks for the recommendation cards (Top Pick + Standard).
 * Values mined verbatim from design_handoff/Top Pick Card.html and
 * design_handoff/Recommendation Set.html. Tailwind utilities map the locked tokens;
 * arbitrary [var(--token)] is used only where no utility exists (amber/red are NOT
 * themed by design — see specs/05 — so flag colours always read from CSS vars). */
import Image from 'next/image';
import {
  BedDouble,
  Waves,
  Utensils,
  MapPin,
  Star,
  ConciergeBell,
  type LucideIcon,
} from 'lucide-react';
import type { CategoryKey, CategorySummaries, HotelDisplay } from './types';

/** Per-category icon + label, co-located so both variants stay in sync. */
export const categoryMeta: Record<CategoryKey, { icon: LucideIcon; label: string }> = {
  rooms: { icon: BedDouble, label: 'Rooms' },
  facilities: { icon: Waves, label: 'Facilities' },
  food: { icon: Utensils, label: 'Food' },
  location: { icon: MapPin, label: 'Location' },
};

const CATEGORY_ORDER: CategoryKey[] = ['rooms', 'facilities', 'food', 'location'];

/** Elegant photo placeholder (.photo-slot in tokens.css). NEVER a broken <img>. */
export function PhotoSlot({ label }: { label?: string }) {
  return (
    <div
      className="photo-slot absolute inset-0"
      data-label={label ?? 'hotel photo'}
      role="img"
      aria-label={label ? `${label} (photo unavailable)` : 'Photo unavailable'}
    />
  );
}

/** Hero image — real photo when a url exists, else the placeholder. */
export function Hero({
  src,
  alt,
  label,
}: {
  src: string | null;
  alt: string;
  label?: string;
}) {
  if (!src) return <PhotoSlot label={label} />;
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes="(max-width: 680px) 100vw, 680px"
      className="object-cover"
      priority={false}
    />
  );
}

/** Star rating row — gold filled stars. null rating → renders nothing. */
export function Stars({ rating }: { rating: 3 | 4 | 5 | null }) {
  if (rating == null) return null;
  return (
    <span className="inline-flex gap-[2px] text-white" aria-label={`${rating} star hotel`}>
      {Array.from({ length: rating }).map((_, i) => (
        <Star
          key={i}
          aria-hidden
          className="h-[14px] w-[14px] fill-[var(--star)] text-[var(--star)]"
          strokeWidth={1.75}
        />
      ))}
    </span>
  );
}

/** stars · area, Destination · tier — rendered on the dark hero scrim. */
export function MetaRow({
  display,
}: {
  display: Pick<HotelDisplay, 'starRating' | 'area' | 'destination' | 'priceTierLabel'>;
}) {
  const place = display.area
    ? `${display.area}, ${display.destination}`
    : display.destination;
  return (
    <div className="mt-[9px] flex flex-wrap items-center gap-[9px] text-body-sm text-white/90">
      <Stars rating={display.starRating} />
      {display.starRating != null && <span className="opacity-50" aria-hidden>·</span>}
      <span>{place}</span>
      {display.priceTierLabel && (
        <>
          <span className="opacity-50" aria-hidden>·</span>
          <span className="rounded-pill bg-white/[0.18] px-[11px] py-[2px] text-[12.5px] font-semibold text-white backdrop-blur-sm">
            {display.priceTierLabel}
          </span>
        </>
      )}
    </div>
  );
}

/** Claude's serif-italic verdict callout ("Why this one"). */
export function Verdict({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-[14px] border border-primary-100 bg-primary-50 px-[22px] py-5">
      <div className="mb-3 flex items-center gap-[10px]">
        <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-sm">
          <ConciergeBell aria-hidden className="h-[17px] w-[17px]" strokeWidth={1.75} />
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-primary-600">
          {label}
        </span>
      </div>
      <p className="m-0 font-serif text-body-lg italic leading-[1.55] text-text">{text}</p>
    </div>
  );
}

/** 2x2 category grid (→ 1 column at 375px). */
export function CategoryGrid({ summaries }: { summaries: CategorySummaries }) {
  return (
    <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2">
      {CATEGORY_ORDER.map((key) => {
        const { icon: Icon, label } = categoryMeta[key];
        return (
          <div key={key} className="flex items-start gap-3">
            <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[9px] bg-primary-50 text-primary-600">
              <Icon aria-hidden className="h-[17px] w-[17px]" strokeWidth={1.75} />
            </span>
            <div>
              <div className="mb-[3px] text-[13.5px] font-semibold text-text">{label}</div>
              <p className="m-0 text-[13px] leading-[1.5] text-text-secondary">
                {summaries[key]}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
