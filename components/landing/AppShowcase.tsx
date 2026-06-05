/* App-showcase carousel — the 4 product proof slides on the landing page,
 * mined from design_handoff/Home Page.html (.showcase / .carousel / .slide-card).
 *
 * The 4 slides are LOCKED (decision #6): chat · top-pick · hard-flag · shortlist.
 * Slide 3 (Holiday Inn Resort Karon Beach refurbishment) is the brand's honesty
 * proof and must never be dropped. It is the ONLY place on this page that uses
 * the reserved red flag palette (CLAUDE.md 1 & 4) — red here is correct.
 *
 * Behaviour: CSS scroll-snap track + auto-advance + clickable dots, matching the
 * prototype's IIFE. Auto-advance is decorative, so it is gated on
 * prefers-reduced-motion (motion-safe users get the rotation; everyone can drive
 * it with the dots or by scrolling). Photo slots reuse the locked .photo-slot
 * placeholder — never a broken image. */
'use client';

import { useEffect, useRef, useState } from 'react';
import {
  MessagesSquare,
  ConciergeBell,
  Sparkles,
  Award,
  Bookmark,
  ShieldAlert,
  OctagonAlert,
  Link2,
  X,
} from 'lucide-react';

const CAPTIONS = [
  'Just have a conversation — no forms, no filters',
  'Get one recommendation you can trust',
  'See the flags other sites quietly bury',
  'Save your shortlist, share with your partner',
];

/* ---- shared slide chrome ------------------------------------------------- */

function SlideHead({
  icon: Icon,
  label,
}: {
  icon: typeof MessagesSquare;
  label: string;
}) {
  return (
    <div className="flex h-[46px] flex-none items-center justify-between border-b border-border bg-surface-2/60 px-4">
      <span className="flex items-center gap-[7px] font-serif text-[15px] font-semibold text-text">
        <span
          aria-hidden
          className="h-[9px] w-[9px] rotate-45 rounded-[2px] bg-primary-500"
        />
        HotelZippo
      </span>
      <span className="inline-flex items-center gap-[5px] font-mono text-[10px] uppercase tracking-[0.05em] text-text-tertiary">
        <Icon aria-hidden className="h-[13px] w-[13px]" strokeWidth={1.75} />
        {label}
      </span>
    </div>
  );
}

/** Photo placeholder — uses the locked .photo-slot so the slide never shows a
 * broken image (no AI imagery rule). */
function PhotoSlot({ label, className = '' }: { label?: string; className?: string }) {
  return (
    <div
      className={`photo-slot ${className}`}
      data-label={label ?? ''}
      role="img"
      aria-label={label ? `${label} (illustrative placeholder)` : 'Placeholder image'}
    />
  );
}

function Stars({ count }: { count: number }) {
  return (
    <span className="inline-flex gap-[1px]" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} className="text-[9px] text-[var(--star)]">
          ★
        </span>
      ))}
    </span>
  );
}

/* ---- slide 1 · conversation ---------------------------------------------- */

function ConciergeAvatar() {
  return (
    <span className="grid h-7 w-7 flex-none place-items-center rounded-[8px] bg-gradient-to-br from-primary-400 to-primary-600 text-white">
      <ConciergeBell aria-hidden className="h-[15px] w-[15px]" strokeWidth={1.75} />
    </span>
  );
}

function ChatSlide() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <div className="flex items-start gap-[10px]">
        <ConciergeAvatar />
        <div>
          <div className="mb-1 text-[10px] font-semibold text-text-tertiary">Concierge</div>
          <div className="text-[13.5px] leading-[1.5] text-text">
            Tell me about your family and where you&apos;re headed — I&apos;ll handle the
            research.
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <div className="max-w-[82%] rounded-[14px_14px_4px_14px] bg-primary-500 px-[13px] py-[9px] text-[13px] leading-[1.45] text-white">
          Phuket in December — 2 kids, ages 2 and 7, plus grandparents.
        </div>
      </div>
      <div className="flex items-start gap-[10px]">
        <ConciergeAvatar />
        <div>
          <div className="mb-1 text-[10px] font-semibold text-text-tertiary">Concierge</div>
          <div className="text-[13.5px] leading-[1.5] text-text">
            <em className="font-serif italic">On it.</em> Reading recent family reviews and
            checking for anything you&apos;d want flagged…
          </div>
        </div>
      </div>
      <div className="flex items-start gap-[10px]">
        <ConciergeAvatar />
        <span className="inline-flex items-center gap-1 rounded-[14px_14px_14px_4px] bg-surface-2 px-[14px] py-[11px]">
          {[0, 0.2, 0.4].map((delay) => (
            <span
              key={delay}
              aria-hidden
              className="block h-[6px] w-[6px] rounded-full bg-text-tertiary motion-safe:animate-typing"
              style={{ animationDelay: `${delay}s` }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

/* ---- slide 2 · top pick -------------------------------------------------- */

function TopPickSlide() {
  return (
    <>
      <div className="relative flex-none" style={{ height: 168 }}>
        <PhotoSlot label="resort hero" className="absolute inset-0" />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, rgba(20,15,12,0.82) 0%, rgba(20,15,12,0.05) 72%)',
          }}
        />
        <span className="absolute left-3 top-3 inline-flex items-center gap-[5px] rounded-pill bg-primary-500 px-[10px] py-[5px] text-[9px] font-bold uppercase tracking-[0.07em] text-white">
          <Award aria-hidden className="h-[11px] w-[11px]" strokeWidth={1.75} /> Top Pick
        </span>
        <div className="absolute bottom-3 left-[14px] right-[14px] font-serif text-[16px] font-medium leading-[1.15] text-white">
          JW Marriott Phuket Resort &amp; Spa
          <div className="mt-[5px] flex items-center gap-[6px] text-[11px] text-white/[0.86]">
            <Stars count={5} />
            <span>Mai Khao, Phuket</span>
            <span className="rounded-pill bg-white/[0.18] px-2 py-[1px] text-[10px] font-semibold">
              Luxury
            </span>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 bg-primary-50 px-4 py-[15px]">
        <div className="mb-[7px] font-mono text-[9px] uppercase tracking-[0.1em] text-primary-600">
          Why this one
        </div>
        <div className="font-serif text-[13px] italic leading-[1.5] text-text">
          &ldquo;For your family of six, this is the one I&apos;d book. The Indian breakfast
          counter and calm, shallow beach do the heavy lifting here.&rdquo;
        </div>
      </div>
      <div className="flex flex-none gap-2 border-t border-border px-4 py-3">
        <span className="flex h-[38px] flex-1 items-center justify-center gap-[5px] rounded-[9px] border border-border-strong bg-surface text-[12px] font-semibold text-text">
          <Bookmark aria-hidden className="h-[14px] w-[14px]" strokeWidth={1.75} /> Save
        </span>
        <span className="flex h-[38px] flex-1 items-center justify-center rounded-[9px] bg-primary-500 text-[12px] font-semibold text-white">
          Proceed to book
        </span>
      </div>
    </>
  );
}

/* ---- slide 3 · hard flag (honesty proof — the ONLY red on this page) ------ */

function HardFlagSlide() {
  return (
    <>
      <div className="relative flex-none" style={{ height: 120 }}>
        <PhotoSlot label="resort" className="absolute inset-0" />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, rgba(20,15,12,0.82) 0%, rgba(20,15,12,0.05) 72%)',
          }}
        />
        <div className="absolute bottom-3 left-[14px] right-[14px] font-serif text-[15px] font-medium leading-[1.15] text-white">
          Holiday Inn Resort Karon Beach
          <div className="mt-[5px] flex items-center gap-[6px] text-[11px] text-white/[0.86]">
            <Stars count={4} />
            <span>Karon, Phuket</span>
          </div>
        </div>
      </div>
      {/* Reserved red flag palette — read from CSS vars, never themed. */}
      <div
        role="alert"
        className="flex gap-[11px] border-b px-[15px] py-[13px]"
        style={{ background: 'var(--red-bg)', borderBottomColor: 'var(--red-border)' }}
      >
        <span
          className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[8px] text-white"
          style={{ background: 'var(--red)' }}
        >
          <OctagonAlert aria-hidden className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div>
          <div className="text-[12.5px] font-bold" style={{ color: 'var(--red-text)' }}>
            Active refurbishment — avoid for now
          </div>
          <div className="mt-[3px] text-[12px] leading-[1.45] text-text-secondary">
            Construction across the main pool and room blocks through your dates.
          </div>
          <div className="mt-[6px] font-mono text-[9px] text-text-tertiary">
            Based on recent guest reviews
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 px-4 py-[14px]">
        <div className="mb-[7px] font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary">
          Why I&apos;d wait
        </div>
        <div className="font-serif text-[12.5px] italic leading-[1.5] text-text">
          &ldquo;I&apos;d normally rank this higher — but I won&apos;t send your family into a
          construction site. Worth another look once it&apos;s done.&rdquo;
        </div>
      </div>
    </>
  );
}

/* ---- slide 4 · shortlist ------------------------------------------------- */

function ShortlistItem({
  name,
  meta,
  /** amber here is the reserved flag palette (a saved note), per the prototype. */
  note,
}: {
  name: string;
  meta: string;
  note?: boolean;
}) {
  return (
    <div className="flex items-center gap-[11px] rounded-[12px] border border-border p-[10px]">
      <PhotoSlot className="h-[46px] w-[46px] flex-none rounded-[9px]" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold leading-[1.2] text-text">{name}</div>
        <div className="mt-[3px] flex flex-wrap items-center gap-[6px] text-[11px] text-text-secondary">
          <span>{meta}</span>
          {note && (
            <span
              className="inline-flex items-center gap-1 font-semibold"
              style={{ color: 'var(--amber-text)' }}
            >
              <span
                aria-hidden
                className="h-[6px] w-[6px] rounded-full"
                style={{ background: 'var(--amber)' }}
              />
              Note
            </span>
          )}
        </div>
      </div>
      <X aria-hidden className="h-4 w-4 flex-none text-text-tertiary" strokeWidth={1.75} />
    </div>
  );
}

function ShortlistSlide() {
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-[10px] p-[14px]">
        <ShortlistItem name="JW Marriott Phuket" meta="Mai Khao · Luxury" note />
        <ShortlistItem name="Angsana Laguna Phuket" meta="Bang Tao · Comfort" />
      </div>
      <div className="mx-[14px] mb-[14px] flex h-[38px] flex-none items-center justify-center gap-[7px] rounded-[9px] border border-border-strong bg-surface text-[12.5px] font-semibold text-text">
        <Link2 aria-hidden className="h-[14px] w-[14px]" strokeWidth={1.75} /> Share with partner
      </div>
    </>
  );
}

/* ---- slides registry ----------------------------------------------------- */

const SLIDES = [
  { key: 'chat', head: { icon: MessagesSquare, label: 'Chat' }, body: <ChatSlide /> },
  { key: 'top-pick', head: { icon: Sparkles, label: 'Top Pick' }, body: <TopPickSlide /> },
  { key: 'hard-flag', head: { icon: ShieldAlert, label: 'Honesty' }, body: <HardFlagSlide /> },
  {
    key: 'shortlist',
    head: { icon: Bookmark, label: 'Shortlist · 2' },
    body: <ShortlistSlide />,
  },
] as const;

/* ---- carousel ------------------------------------------------------------ */

export function AppShowcase() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  // Auto-advance — decorative, so motion-safe only. Pauses on user interaction.
  const pausedRef = useRef(false);
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const prefersReduced = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (prefersReduced) return;

    const id = window.setInterval(() => {
      if (pausedRef.current) return;
      setActive((prev) => {
        const next = (prev + 1) % SLIDES.length;
        track.scrollTo({ left: next * track.clientWidth, behavior: 'smooth' });
        return next;
      });
    }, 4500);
    return () => window.clearInterval(id);
  }, []);

  function goTo(i: number) {
    const track = trackRef.current;
    if (!track) return;
    pausedRef.current = true; // stop rotating once the user takes over
    setActive(i);
    track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
  }

  // Keep the dots in sync when the user free-scrolls the track.
  function handleScroll() {
    const track = trackRef.current;
    if (!track) return;
    const i = Math.round(track.scrollLeft / track.clientWidth);
    if (i !== active) setActive(i);
  }

  return (
    <div className="flex w-full max-w-[392px] flex-col gap-[22px]">
      <div
        ref={trackRef}
        onScroll={handleScroll}
        onPointerDown={() => {
          pausedRef.current = true;
        }}
        className="hz-carousel flex snap-x snap-mandatory overflow-x-auto scroll-smooth"
        style={{ scrollbarWidth: 'none' }}
      >
        {SLIDES.map((slide) => (
          <div
            key={slide.key}
            className="flex min-w-full snap-center justify-center px-2 pb-[18px] pt-[10px]"
          >
            <div className="flex h-[460px] w-full flex-col overflow-hidden rounded-panel border border-border bg-surface shadow-[0_20px_44px_-18px_rgba(31,27,23,0.30)]">
              <SlideHead icon={slide.head.icon} label={slide.head.label} />
              {slide.body}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center gap-[14px]">
        <p
          aria-live="polite"
          className="max-w-[32ch] min-h-[21px] text-center text-[14px] font-medium leading-[1.4] text-text-secondary"
        >
          {CAPTIONS[active]}
        </p>
        <div className="flex gap-2" role="tablist" aria-label="App preview slides">
          {SLIDES.map((slide, i) => (
            <button
              key={slide.key}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`Slide ${i + 1}: ${CAPTIONS[i]}`}
              onClick={() => goTo(i)}
              className={`h-[7px] rounded-pill border-0 p-0 transition-all duration-slow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                i === active ? 'w-[22px] bg-primary-500' : 'w-[7px] bg-border-strong'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
