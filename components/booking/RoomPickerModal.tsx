/* RoomPickerModal — the deterministic 3-step booking overlay (Phase 7).
 *
 * Opened over the chat when a recommendation card's "Proceed to book" is clicked.
 * Presentational only — the parent hook (useBookingFlow) drives `step`, supplies the
 * confirmed party/dates/options and owns all RouteStack I/O. No data fetching, no
 * Anthropic, no business logic here.
 *
 * Mirrors components/shortlist/ShortlistPanel.tsx for the overlay shell: same scrim,
 * role="dialog" aria-modal panel, mono-uppercase label + serif title header, and the
 * exact X close button. Token discipline (locked design system):
 *   • NO amber/red — those are RESERVED for hard-flag alerts. Neutral palette only.
 *   • No <img> at all (this modal shows no hotel imagery).
 *   • motion-reduce respected exactly as ShortlistPanel (animate-none / transition-none).
 *   • a11y: dialog + aria-label, focus-visible close button, Escape + scrim-click close.
 */
'use client';

import { useEffect, useState } from 'react';
import {
  BedDouble,
  CalendarDays,
  Coffee,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  Users,
  X,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import type {
  BookingDates,
  BookingErrorKind,
  RoomRateOption,
  TravelParty,
} from '@/lib/booking/types';

export type RoomPickerStep =
  | 'confirm'
  | 'searching'
  | 'picking'
  | 'finalizing'
  | 'error';

export interface RoomPickerModalProps {
  open: boolean;
  step: RoomPickerStep;
  hotelName: string;
  // confirm screen (editable):
  party: TravelParty;
  grandparentHint: boolean;
  dates: BookingDates | null;
  onPartyChange: (party: TravelParty) => void;
  onDatesChange: (dates: BookingDates) => void;
  onConfirm: () => void;
  // picking screen:
  options: RoomRateOption[];
  onSelectRoom: (option: RoomRateOption) => void;
  // error screen:
  error: { kind: BookingErrorKind; message: string } | null;
  onRetry: () => void;
  onClose: () => void;
}

/* The mono-uppercase eyebrow label, matching ShortlistPanel's header treatment. */
const LABEL = 'BOOKING';

export function RoomPickerModal({
  open,
  step,
  hotelName,
  party,
  grandparentHint,
  dates,
  onPartyChange,
  onDatesChange,
  onConfirm,
  options,
  onSelectRoom,
  error,
  onRetry,
  onClose,
}: RoomPickerModalProps) {
  // Escape closes — registered while open, cleaned up on unmount/close.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const title = TITLES[step];

  return (
    <>
      {/* scrim — mirrors ShortlistPanel */}
      <div
        className="fixed inset-0 z-40 bg-text/40 backdrop-blur-[1px] motion-reduce:transition-none"
        aria-hidden
        onClick={onClose}
      />
      {/* centered dialog panel */}
      <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Book ${hotelName}`}
          className="flex max-h-[92vh] w-full flex-col rounded-t-panel bg-surface shadow-panel animate-panel-in motion-reduce:animate-none sm:max-h-[88vh] sm:w-[min(560px,94vw)] sm:rounded-panel"
        >
          <header className="flex flex-none items-start justify-between border-b border-border px-6 pb-4 pt-[22px]">
            <div className="min-w-0">
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
                {LABEL}
              </div>
              <h2 className="m-0 mt-3 font-serif text-[22px] font-medium tracking-[-0.01em] text-text">
                {title}
              </h2>
              <p className="mt-1 truncate text-[13px] text-text-secondary">
                Booking {hotelName}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close booking"
              className="grid h-9 w-9 flex-none place-items-center rounded-btn border border-border bg-surface text-text-secondary transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {step === 'confirm' && (
              <ConfirmScreen
                party={party}
                grandparentHint={grandparentHint}
                dates={dates}
                onPartyChange={onPartyChange}
                onDatesChange={onDatesChange}
                onConfirm={onConfirm}
              />
            )}
            {step === 'searching' && (
              <CalmLoading
                title="Checking live availability…"
                message="Pulling current rooms and rates for your dates."
                skeleton
              />
            )}
            {step === 'picking' && (
              <PickingScreen options={options} onSelectRoom={onSelectRoom} />
            )}
            {step === 'finalizing' && (
              <CalmLoading
                title="Getting your secure checkout link…"
                message="One moment while we hand you to the secure payment page."
              />
            )}
            {step === 'error' && (
              <ErrorScreen error={error} onRetry={onRetry} onClose={onClose} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

const TITLES: Record<RoomPickerStep, string> = {
  confirm: "Let's confirm the details",
  searching: 'Finding your rooms',
  picking: 'Choose your room',
  finalizing: 'Almost there',
  error: 'Let’s try that again',
};

/* ========================================================================== *
 * CONFIRM
 * ========================================================================== */
function ConfirmScreen({
  party,
  grandparentHint,
  dates,
  onPartyChange,
  onDatesChange,
  onConfirm,
}: {
  party: TravelParty;
  grandparentHint: boolean;
  dates: BookingDates | null;
  onPartyChange: (party: TravelParty) => void;
  onDatesChange: (dates: BookingDates) => void;
  onConfirm: () => void;
}) {
  const childCount = party.childAges.length;

  function setAdults(next: number) {
    onPartyChange({ ...party, adults: Math.max(1, next) });
  }
  function setRooms(next: number) {
    onPartyChange({ ...party, rooms: Math.max(1, next) });
  }
  function setChildCount(next: number) {
    const target = Math.max(0, next);
    const childAges = [...party.childAges];
    while (childAges.length < target) childAges.push(8);
    while (childAges.length > target) childAges.pop();
    onPartyChange({ ...party, childAges });
  }
  function setChildAge(index: number, age: number) {
    const childAges = party.childAges.map((a, i) =>
      i === index ? clamp(age, 0, 17) : a,
    );
    onPartyChange({ ...party, childAges });
  }

  const datesValid = Boolean(dates && dates.checkIn && dates.checkOut);
  const canContinue = datesValid && party.adults >= 1;

  return (
    <div className="flex flex-col gap-6">
      <Section icon={Users} title="Travellers">
        <Stepper
          label="Adults"
          value={party.adults}
          min={1}
          onChange={setAdults}
        />
        <Stepper
          label="Children"
          value={childCount}
          min={0}
          onChange={setChildCount}
        />
        {childCount > 0 && (
          <div className="mt-1 flex flex-col gap-2">
            {party.childAges.map((age, i) => (
              <label
                key={i}
                className="flex items-center justify-between gap-3 text-[14px] text-text-secondary"
              >
                <span>Child {i + 1} age</span>
                <input
                  type="number"
                  min={0}
                  max={17}
                  value={age}
                  aria-label={`Child ${i + 1} age`}
                  onChange={(e) => setChildAge(i, Number(e.target.value))}
                  className="h-9 w-[72px] rounded-input border border-border bg-surface px-3 text-[14px] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </label>
            ))}
          </div>
        )}
        {grandparentHint && (
          <p className="mt-1 rounded-input bg-surface-2 px-3 py-2 text-[13px] leading-[1.5] text-text-secondary">
            Your notes mention grandparents — add them to the adult count if
            they’re travelling.
          </p>
        )}
      </Section>

      <Section icon={BedDouble} title="Rooms">
        <Stepper label="Rooms" value={party.rooms} min={1} onChange={setRooms} />
      </Section>

      <Section icon={CalendarDays} title="Dates">
        <DateFields dates={dates} onDatesChange={onDatesChange} />
      </Section>

      <button
        type="button"
        onClick={onConfirm}
        disabled={!canContinue}
        className="inline-flex h-[50px] w-full items-center justify-center gap-[9px] rounded-btn bg-primary-500 text-[15px] font-semibold text-white transition-colors duration-fast hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary-500"
      >
        Continue
      </button>
    </div>
  );
}

function DateFields({
  dates,
  onDatesChange,
}: {
  dates: BookingDates | null;
  onDatesChange: (dates: BookingDates) => void;
}) {
  const hasDates = Boolean(dates?.checkIn && dates?.checkOut);
  // Collapsed-to-text only when we arrive with both dates resolved; otherwise
  // (month-only trip) we open straight into the inputs to collect them.
  const [editing, setEditing] = useState(!hasDates);

  const checkIn = dates?.checkIn ?? '';
  const checkOut = dates?.checkOut ?? '';

  function update(next: Partial<BookingDates>) {
    onDatesChange({ checkIn, checkOut, ...next });
  }

  if (hasDates && !editing) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-input border border-border bg-surface px-3 py-[10px]">
        <span className="text-[14.5px] text-text">
          {formatDateRange(checkIn, checkOut)}
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary-600 transition-colors hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Pencil aria-hidden className="h-[13px] w-[13px]" strokeWidth={1.75} />
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <label className="flex flex-1 flex-col gap-1 text-[13px] text-text-secondary">
        Check-in
        <input
          type="date"
          value={checkIn}
          aria-label="Check-in date"
          onChange={(e) => update({ checkIn: e.target.value })}
          className="h-[42px] rounded-input border border-border bg-surface px-3 text-[14px] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </label>
      <label className="flex flex-1 flex-col gap-1 text-[13px] text-text-secondary">
        Check-out
        <input
          type="date"
          value={checkOut}
          min={checkIn || undefined}
          aria-label="Check-out date"
          onChange={(e) => update({ checkOut: e.target.value })}
          className="h-[42px] rounded-input border border-border bg-surface px-3 text-[14px] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </label>
    </div>
  );
}

/* ========================================================================== *
 * PICKING
 * ========================================================================== */
function PickingScreen({
  options,
  onSelectRoom,
}: {
  options: RoomRateOption[];
  onSelectRoom: (option: RoomRateOption) => void;
}) {
  if (options.length === 0) {
    // Safety net — the parent usually routes "no rooms" to the error step.
    return (
      <EmptyState
        icon={BedDouble}
        title="No rooms available for these dates"
        message="Try shifting your check-in or check-out by a night, or a different room count."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {options.map((opt, i) => (
        <li key={`${opt.roomId}-${i}`}>
          <RoomOptionRow option={opt} onSelect={() => onSelectRoom(opt)} />
        </li>
      ))}
    </ul>
  );
}

function RoomOptionRow({
  option,
  onSelect,
}: {
  option: RoomRateOption;
  onSelect: () => void;
}) {
  const cancellationNote =
    option.freeCancellation
      ? 'Free cancellation'
      : option.cancellation ?? null;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex w-full items-start justify-between gap-4 rounded-card border border-border bg-surface p-4 text-left shadow-xs transition-colors duration-fast hover:border-border-strong hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="min-w-0 flex-1">
        <p className="font-serif text-[16px] font-medium text-text">
          {option.roomName ?? 'Room'}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-secondary">
          {option.board && (
            <span className="inline-flex items-center gap-1">
              <Coffee aria-hidden className="h-[13px] w-[13px] text-text-tertiary" strokeWidth={1.75} />
              {option.board}
            </span>
          )}
          {option.bed && (
            <span className="inline-flex items-center gap-1">
              <BedDouble aria-hidden className="h-[13px] w-[13px] text-text-tertiary" strokeWidth={1.75} />
              {option.bed}
            </span>
          )}
          {typeof option.maxOccupancy === 'number' && (
            <span className="inline-flex items-center gap-1">
              <Users aria-hidden className="h-[13px] w-[13px] text-text-tertiary" strokeWidth={1.75} />
              Sleeps {option.maxOccupancy}
            </span>
          )}
        </div>
        {cancellationNote && (
          <span className="mt-2 inline-flex rounded-pill bg-surface-2 px-[10px] py-[2px] text-[12px] font-medium text-text-secondary">
            {cancellationNote}
          </span>
        )}
      </div>
      <div className="flex flex-none flex-col items-end gap-2">
        <span className="font-serif text-[17px] font-medium text-text">
          {formatPrice(option.price, option.currency)}
        </span>
        <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary-600 transition-colors group-hover:text-primary-700">
          Select
        </span>
      </div>
    </button>
  );
}

/* ========================================================================== *
 * CALM LOADING (searching / finalizing) — skeletons, no spinner. specs/14.
 * ========================================================================== */
function CalmLoading({
  title,
  message,
  skeleton = false,
}: {
  title: string;
  message: string;
  skeleton?: boolean;
}) {
  return (
    <div className="flex flex-col gap-5" role="status" aria-live="polite">
      <div>
        <p className="font-serif text-[18px] font-medium text-text">{title}</p>
        <p className="mt-1 text-[14px] leading-[1.55] text-text-secondary">
          {message}
        </p>
      </div>
      {skeleton && (
        <ul className="flex flex-col gap-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              className="flex items-start justify-between gap-4 rounded-card border border-border bg-surface p-4"
            >
              <div className="flex-1 space-y-2">
                <div className="h-4 w-2/5 animate-pulse rounded-pill bg-surface-2 motion-reduce:animate-none" />
                <div className="h-3 w-3/5 animate-pulse rounded-pill bg-surface-2 motion-reduce:animate-none" />
              </div>
              <div className="h-5 w-16 animate-pulse rounded-pill bg-surface-2 motion-reduce:animate-none" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ========================================================================== *
 * ERROR — warm, never a dead-end. specs/14. Neutral palette (NOT a hard flag).
 * ========================================================================== */
function ErrorScreen({
  error,
  onRetry,
  onClose,
}: {
  error: { kind: BookingErrorKind; message: string } | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const message =
    error?.message ??
    'Something interrupted the booking. Nothing was charged — let’s try again.';

  return (
    <div className="flex flex-col gap-6" role="alert">
      <p className="font-serif text-[17px] leading-[1.5] text-text">{message}</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-[48px] flex-1 items-center justify-center gap-2 rounded-btn bg-primary-500 text-[14.5px] font-semibold text-white transition-colors duration-fast hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <RefreshCw aria-hidden className="h-[17px] w-[17px]" strokeWidth={1.75} />
          Try again
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-[48px] flex-1 items-center justify-center rounded-btn border border-border-strong bg-surface text-[14.5px] font-semibold text-text transition-colors duration-fast hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Close
        </button>
      </div>
    </div>
  );
}

/* ========================================================================== *
 * SHARED PIECES
 * ========================================================================== */
function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Users;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        <Icon aria-hidden className="h-[14px] w-[14px] text-primary-500" strokeWidth={1.75} />
        {title}
      </div>
      {children}
    </section>
  );
}

function Stepper({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[14.5px] text-text">{label}</span>
      <div className="inline-flex items-center gap-2">
        <StepButton
          ariaLabel={`Decrease ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
          icon={Minus}
        />
        <span
          aria-live="polite"
          className="w-7 text-center text-[15px] font-semibold tabular-nums text-text"
        >
          {value}
        </span>
        <StepButton
          ariaLabel={`Increase ${label.toLowerCase()}`}
          onClick={() => onChange(value + 1)}
          icon={Plus}
        />
      </div>
    </div>
  );
}

function StepButton({
  ariaLabel,
  onClick,
  icon: Icon,
  disabled = false,
}: {
  ariaLabel: string;
  onClick: () => void;
  icon: typeof Plus;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className="grid h-9 w-9 place-items-center rounded-btn border border-border bg-surface text-text-secondary transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface"
    >
      <Icon aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} />
    </button>
  );
}

/* ========================================================================== *
 * HELPERS
 * ========================================================================== */
function clamp(n: number, lo: number, hi: number) {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function formatDateRange(checkIn: string, checkOut: string) {
  const fmt = (iso: string) => {
    // iso is yyyy-mm-dd; parse as local date to avoid TZ drift.
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return iso;
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  };
  return `${fmt(checkIn)} – ${fmt(checkOut)}`;
}

function formatPrice(price?: number, currency?: string) {
  if (typeof price !== 'number') return 'Price on request';
  const amount = Number.isInteger(price) ? price.toString() : price.toFixed(2);
  return currency ? `${amount} ${currency}` : `$${amount}`;
}
