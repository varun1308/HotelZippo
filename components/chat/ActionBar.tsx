/* ActionBar — the post-recommendation action bar (spec 05 §7 / component 7).
 *
 * Appears between the stream and the composer once recommendations have rendered,
 * and stays visible while scrolling (it lives in ChatShell's fixed column, not in
 * the stream). Mined from `HotelZippo Prototype.html` (.actionbar / .ab-btn):
 *   • Save shortlist — opens the shortlist panel (saving individual hotels stays
 *     on the cards, matching the prototype).
 *   • Share with partner — copies the shortlist share link; shows a transient
 *     "Link copied" success state (prototype's ~1.9s flash).
 *   • Proceed to book — PRIMARY; starts the booking flow for the top pick.
 *   • "Tell me what you want to do" — THE ESCAPE HATCH (hard constraint 5:
 *     always accessible, never trapped). Dashed, focuses the composer.
 * Mobile: the bar scrolls horizontally so every action + the escape hatch stays
 * reachable at 375px. Token discipline: no amber/red (reserved for hard flags). */
'use client';

import { useEffect, useRef, useState } from 'react';
import { Bookmark, Share2, CalendarCheck, MessagesSquare, Check } from 'lucide-react';

export interface ActionBarProps {
  /** Open the shortlist panel. */
  onSaveShortlist?: () => void;
  /** Copy the share link. Resolve truthy on success (drives the "Link copied" flash);
   *  resolve null/false (or throw) when there is nothing to share — no flash, no crash. */
  onShare?: () => Promise<unknown> | unknown;
  /** Start the booking flow for the current top pick. */
  onProceedToBook?: () => void;
  /** The escape hatch — must focus the composer (spec 05 §7). */
  onEscapeHatch?: () => void;
}

const COPIED_MS = 1900;

export function ActionBar({ onSaveShortlist, onShare, onProceedToBook, onEscapeHatch }: ActionBarProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleShare = async () => {
    try {
      const ok = await onShare?.();
      if (!ok) return; // nothing to share (signed out / persistence off) — stay quiet, never crash
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      /* warm-fail: the chat keeps working; the user can ask the concierge instead */
    }
  };

  const ghost =
    'inline-flex h-[42px] flex-none items-center gap-2 whitespace-nowrap rounded-btn border border-border-strong bg-surface px-4 text-[13.5px] font-semibold text-text transition-all duration-fast hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

  return (
    <div
      role="toolbar"
      aria-label="Recommendation actions"
      className="flex-none border-t border-border bg-surface px-6 py-3 max-[600px]:px-[14px]"
    >
      <div className="mx-auto flex max-w-chat items-center gap-[10px] overflow-x-auto">
        <button type="button" onClick={onSaveShortlist} className={ghost}>
          <Bookmark aria-hidden className="h-4 w-4" strokeWidth={1.75} />
          Save shortlist
        </button>
        <button type="button" onClick={handleShare} className={ghost} aria-live="polite">
          {copied ? (
            <>
              <Check aria-hidden className="h-4 w-4" strokeWidth={1.75} />
              Link copied
            </>
          ) : (
            <>
              <Share2 aria-hidden className="h-4 w-4" strokeWidth={1.75} />
              Share with partner
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onProceedToBook}
          className="inline-flex h-[42px] flex-none items-center gap-2 whitespace-nowrap rounded-btn bg-primary-500 px-4 text-[13.5px] font-semibold text-white transition-all duration-fast hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <CalendarCheck aria-hidden className="h-4 w-4" strokeWidth={1.75} />
          Proceed to book
        </button>
        <button
          type="button"
          onClick={onEscapeHatch}
          className="ml-auto inline-flex h-[42px] flex-none items-center gap-2 whitespace-nowrap rounded-btn border border-dashed border-border-strong bg-transparent px-4 text-[13.5px] font-semibold text-text-secondary transition-all duration-fast hover:border-primary-300 hover:bg-primary-50 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary max-[600px]:ml-0"
        >
          <MessagesSquare aria-hidden className="h-4 w-4" strokeWidth={1.75} />
          Tell me what you want to do
        </button>
      </div>
    </div>
  );
}
