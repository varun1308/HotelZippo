/* ShortlistPanel — the slide-in panel of saved hotels (Phase 3d).
 *
 * Opened by the topbar "Shortlist" button. A right-anchored sheet (shadow-panel,
 * animate-panel-in) over a scrim. Each row shows a small hero thumbnail (or the
 * placeholder — NEVER a broken <img>), name + destination/area + tier, and a remove
 * button. Empty state reuses components/ui/EmptyState. Token discipline: no amber/red
 * (reserved for hard flags). Mined from the .shortlist panel pattern (05 / panel). */
'use client';

import { Bookmark, MapPin, Trash2, X } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import type { SavedHotel } from '@/lib/shortlist/types';

export interface ShortlistPanelProps {
  open: boolean;
  items: SavedHotel[];
  onRemove: (hotelId: string) => void;
  onClose: () => void;
}

export function ShortlistPanel({ open, items, onRemove, onClose }: ShortlistPanelProps) {
  if (!open) return null;

  return (
    <>
      {/* scrim */}
      <div
        className="fixed inset-0 z-40 bg-text/40 backdrop-blur-[1px] motion-reduce:transition-none"
        aria-hidden
        onClick={onClose}
      />
      {/* panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Saved shortlist"
        className="fixed inset-y-0 right-0 z-50 flex w-[min(420px,92vw)] flex-col bg-surface shadow-panel animate-panel-in motion-reduce:animate-none"
      >
        <header className="flex flex-none items-center justify-between border-b border-border px-6 pb-4 pt-[22px]">
          <div>
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
              <Bookmark aria-hidden className="h-[14px] w-[14px] text-primary-500" strokeWidth={1.75} />
              Shortlist
            </div>
            <h2 className="m-0 mt-3 font-serif text-[22px] font-medium tracking-[-0.01em] text-text">
              Saved for later
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortlist"
            className="grid h-9 w-9 flex-none place-items-center rounded-btn border border-border bg-surface text-text-secondary transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <EmptyState
              icon={Bookmark}
              title="Nothing saved yet"
              message="When you find a hotel you like, tap “Save to shortlist” on its card and it'll land here."
            >
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-[42px] items-center rounded-btn bg-primary-500 px-5 text-[14.5px] font-semibold text-on-primary shadow-sm transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Back to the chat
              </button>
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-3">
              {items.map((h) => (
                <li
                  key={h.hotelId}
                  className="flex gap-3 rounded-card border border-border bg-surface p-3 shadow-xs"
                >
                  <Thumb hotel={h} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-serif text-[16px] font-medium text-text">
                      {h.hotelName}
                    </p>
                    <p className="mt-1 flex items-center gap-1 text-[13px] text-text-secondary">
                      <MapPin aria-hidden className="h-[13px] w-[13px] text-text-tertiary" strokeWidth={1.75} />
                      {h.area ? `${h.area}, ${h.destination}` : h.destination}
                    </p>
                    {h.priceTierLabel && (
                      <span className="mt-2 inline-flex rounded-pill bg-surface-2 px-[10px] py-[2px] text-[12px] font-medium text-text-secondary">
                        {h.priceTierLabel}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(h.hotelId)}
                    aria-label={`Remove ${h.hotelName} from shortlist`}
                    className="grid h-9 w-9 flex-none place-items-center self-start rounded-btn border border-border bg-surface text-text-tertiary transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Trash2 aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}

/** A small hero thumbnail — placeholder when no image, NEVER a broken <img> (12g rule). */
function Thumb({ hotel }: { hotel: SavedHotel }) {
  if (hotel.heroImageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={hotel.heroImageUrl}
        alt=""
        className="h-[60px] w-[72px] flex-none rounded-input object-cover"
      />
    );
  }
  return (
    <div
      aria-hidden
      className="grid h-[60px] w-[72px] flex-none place-items-center rounded-input bg-surface-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary"
    >
      hotel
    </div>
  );
}
