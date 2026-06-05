/* TripBrief — the right-hand "Trip brief" rail (Phase 3d).
 *
 * Pure presentational: renders from a `TripBriefState` (lib/brief/types) — no
 * agent, no detection, no key. It fills the `rail` slot of ChatShell.
 *
 * Behaviour mined from `design_handoff/Chat - Active & Streaming.html` (.brief aside):
 *   • Desktop: an always-visible 344px column (lg:flex). Below lg it becomes a
 *     fixed slide-in sheet from the right, gated on the optional `open` prop, with
 *     a backdrop scrim + a close button. Used as ChatShell's desktop rail (no
 *     `open` prop) it renders the always-visible variant.
 *   • Six core rows (BRIEF_FIELDS); a filled row gets a check + tinted icon tile.
 *   • A meter + "Find hotels" button that is only enabled once the recommendation
 *     hard gates (destination + trip type, coreReady) are filled.
 *
 * Token rules (CRITICAL): amber/red are RESERVED for hard flags and are NOT used
 * here. Entrance motion animates transform only (translate-x), never opacity-from-0,
 * and respects prefers-reduced-motion via motion-reduce: utilities.
 */
'use client';

import {
  NotebookPen,
  Sparkles,
  Search,
  Check,
  X,
  MapPin,
  CalendarDays,
  Umbrella,
  Users,
  Wallet,
  Utensils,
  type LucideIcon,
} from 'lucide-react';
import {
  BRIEF_FIELDS,
  filledCount,
  coreReady,
  type BriefIconName,
  type TripBriefState,
} from '@/lib/brief/types';

export interface TripBriefProps {
  brief: TripBriefState;
  /** Called when the user clicks "Find hotels" (enabled only when coreReady). */
  onFindHotels?: () => void;
  /** Mobile sheet controls (desktop rail is always visible). Optional. */
  open?: boolean;
  onClose?: () => void;
}

/** lucide component for each BriefIconName. */
const ICONS: Record<BriefIconName, LucideIcon> = {
  'map-pin': MapPin,
  'calendar-days': CalendarDays,
  umbrella: Umbrella,
  users: Users,
  wallet: Wallet,
  utensils: Utensils,
};

/* ---- one brief row ------------------------------------------------------- */

function BriefRow({
  label,
  pending,
  icon,
  value,
}: {
  label: string;
  pending: string;
  icon: BriefIconName;
  value: string | null;
}) {
  const Icon = ICONS[icon];
  const filled = value != null;
  return (
    <div
      className={
        'flex gap-[13px] rounded-input border p-[13px_12px] transition-colors motion-reduce:transition-none ' +
        (filled ? 'border-border bg-surface shadow-xs' : 'border-transparent')
      }
    >
      <span
        className={
          'flex-none grid h-[34px] w-[34px] place-items-center rounded-[9px] ' +
          (filled ? 'bg-primary-50 text-primary-600' : 'bg-surface-2 text-text-tertiary')
        }
      >
        <Icon aria-hidden className="h-[17px] w-[17px]" strokeWidth={1.75} />
      </span>

      <div className="flex-1 min-w-0">
        <div
          className={
            'text-[11px] uppercase tracking-[0.04em] font-semibold ' +
            (filled ? 'text-text-secondary' : 'text-text-tertiary')
          }
        >
          {label}
        </div>
        {filled ? (
          <span className="mt-1 block text-[14.5px] font-medium text-text">{value}</span>
        ) : (
          <span className="mt-1 block text-[13.5px] italic text-text-tertiary">{pending}</span>
        )}
      </div>

      {filled && (
        <span className="flex-none grid h-[18px] w-[18px] place-items-center rounded-full bg-success text-on-primary mt-2">
          <Check aria-hidden className="h-3 w-3" strokeWidth={3} />
        </span>
      )}
    </div>
  );
}

/* ---- the brief content (shared by desktop rail + mobile sheet) ----------- */

function BriefContent({
  brief,
  onFindHotels,
  onClose,
}: {
  brief: TripBriefState;
  onFindHotels?: () => void;
  onClose?: () => void;
}) {
  const filled = filledCount(brief);
  const ready = coreReady(brief);
  const pct = Math.round((filled / 6) * 100);

  const hint =
    filled === 0
      ? "A few more details and I'll begin."
      : !ready
        ? 'Almost there — just the essentials left.'
        : 'Ready — the more you share, the sharper the match.';

  return (
    <>
      {/* ---------- header ---------- */}
      <div className="flex-none border-b border-border px-6 pb-4 pt-[22px]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            <NotebookPen
              aria-hidden
              className="h-[14px] w-[14px] text-primary-500"
              strokeWidth={1.75}
            />
            Trip brief
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close trip brief"
              className="lg:hidden grid h-8 w-8 place-items-center rounded-btn text-text-secondary transition-colors hover:bg-surface-2 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </button>
          )}
        </div>
        <h2 className="m-0 mb-1 mt-3 font-serif text-[22px] font-medium tracking-[-0.01em] text-text">
          What I&apos;m gathering
        </h2>
        <p className="m-0 text-[13px] leading-[1.5] text-text-secondary">
          I take notes as we talk. Once the essentials are in, I&apos;ll start the
          research.
        </p>
      </div>

      {/* ---------- body: the six core rows + prefs ---------- */}
      <div className="flex-1 overflow-y-auto p-[14px] flex flex-col gap-[6px]">
        {BRIEF_FIELDS.map((field) => (
          <BriefRow
            key={field.key}
            label={field.label}
            pending={field.pending}
            icon={field.icon}
            value={brief[field.key]}
          />
        ))}

        {brief.prefs.length > 0 && (
          <div>
            <div className="h-px bg-border mx-3 my-2" />
            <div className="flex items-center gap-2 px-3 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
              <Sparkles
                aria-hidden
                className="h-[14px] w-[14px] text-primary-500"
                strokeWidth={1.75}
              />
              Personal preferences
            </div>
            <div className="flex flex-wrap gap-2 px-3 pt-2">
              {brief.prefs.map((pref) => (
                <span
                  key={pref.id}
                  className="inline-flex items-center gap-[7px] rounded-pill bg-primary-50 border border-primary-100 px-[13px] py-[7px] text-[13px] font-medium text-primary-800"
                >
                  {pref.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ---------- footer: meter + Find hotels ---------- */}
      <div className="flex-none border-t border-border p-4">
        <div
          className="flex items-center gap-[10px] mb-[14px]"
          role="progressbar"
          aria-valuenow={filled}
          aria-valuemin={0}
          aria-valuemax={6}
          aria-label="Trip brief completeness"
        >
          <span className="flex-1 h-[5px] rounded-[3px] bg-surface-3 overflow-hidden">
            <i
              className="block h-full rounded-[3px] bg-gradient-to-r from-primary-400 to-primary-600 transition-[width] duration-slow ease-out motion-reduce:transition-none"
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="font-mono text-[12px] text-text-secondary">{filled} / 6</span>
        </div>

        <button
          type="button"
          disabled={!ready}
          onClick={onFindHotels}
          className={
            'w-full h-[46px] rounded-btn font-semibold text-[15px] inline-flex items-center justify-center gap-[9px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
            (ready
              ? 'bg-primary-500 text-on-primary shadow-sm hover:bg-primary-600 active:scale-[0.99] motion-reduce:active:scale-100'
              : 'bg-surface-2 text-text-tertiary cursor-not-allowed')
          }
        >
          <Search aria-hidden className="h-[17px] w-[17px]" strokeWidth={1.75} />
          Find hotels
        </button>

        <p className="mt-[10px] text-center text-[12px] text-text-tertiary">{hint}</p>
      </div>
    </>
  );
}

/* ---- the rail / sheet shell ---------------------------------------------- */

export function TripBrief({ brief, onFindHotels, open, onClose }: TripBriefProps) {
  // No mobile-sheet props supplied → render the plain always-visible desktop rail
  // (this is the ChatShell usage). The hidden/lg:flex keeps it desktop-only there.
  const sheetMode = open !== undefined || onClose !== undefined;

  if (!sheetMode) {
    return (
      <aside
        aria-label="Trip brief"
        className="hidden w-[344px] flex-none flex-col border-l border-border bg-surface lg:flex"
      >
        <BriefContent brief={brief} onFindHotels={onFindHotels} />
      </aside>
    );
  }

  return (
    <>
      {/* mobile-only backdrop scrim */}
      {open && (
        <div
          aria-hidden
          onClick={onClose}
          className="lg:hidden fixed inset-0 z-30 bg-text/40"
        />
      )}

      <aside
        aria-label="Trip brief"
        className={
          'flex-col border-l border-border bg-surface ' +
          // desktop: always-visible 344px column
          'lg:static lg:z-auto lg:flex lg:w-[344px] lg:translate-x-0 ' +
          // mobile: fixed slide-in sheet from the right
          'fixed inset-y-0 right-0 z-40 flex w-[min(360px,88vw)] transition-transform duration-panel ease-out motion-reduce:transition-none ' +
          (open ? 'translate-x-0' : 'translate-x-full lg:translate-x-0')
        }
      >
        <BriefContent brief={brief} onFindHotels={onFindHotels} onClose={onClose} />
      </aside>
    </>
  );
}
