/* Warm, concierge-voice errors — never raw, never a dead end (specs/14, CLAUDE.md).
 * No codes, no stack traces. Always a way forward.
 *
 *   • <WarmError> — inline chat bubble: Claude lost its footing, "Try again".
 *   • <CardError> — card-level: "I couldn't load this one." with Retry + Skip.
 * Mined from Interaction States.html (.chat-err / .err-card). */
import { RotateCcw, RefreshCw, ArrowRight, ConciergeBell, CloudOff } from 'lucide-react';

const DEFAULT_MESSAGE =
  "Hmm — I lost my footing for a second pulling those reviews together. That's on me, not you. Give me another go?";

export interface WarmErrorProps {
  /** Concierge-voice copy. A warm default is provided. */
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

/** Inline chat-bubble error with Claude's avatar. */
export function WarmError({
  message = DEFAULT_MESSAGE,
  onRetry,
  retryLabel = 'Try again',
}: WarmErrorProps) {
  return (
    <div role="alert" className="flex items-start gap-[14px]">
      <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-sm">
        <ConciergeBell aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </span>
      <div className="max-w-[80%] rounded-[16px_16px_16px_5px] border border-border bg-surface px-[18px] py-[15px] shadow-xs">
        <p className="m-0 mb-3 text-[15px] leading-[1.55] text-text">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-[7px] rounded-btn border border-primary-100 bg-primary-50 px-[14px] py-2 text-[13.5px] font-semibold text-primary-600 transition-colors duration-fast hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <RotateCcw aria-hidden className="h-[14px] w-[14px]" strokeWidth={1.75} />
          {retryLabel}
        </button>
      </div>
    </div>
  );
}

export interface CardErrorProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  onSkip?: () => void;
}

/** Card-level failure (a single recommendation failed to load). */
export function CardError({
  title = "I couldn't load this one",
  message = "This hotel's details didn't come through just now — likely a brief hiccup on our side. Your other recommendations are unaffected.",
  onRetry,
  onSkip,
}: CardErrorProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-4 rounded-card border border-border bg-surface p-[22px] shadow-sm sm:flex-row"
    >
      <span className="grid h-11 w-11 flex-none place-items-center rounded-[12px] bg-surface-2 text-primary-600">
        <CloudOff aria-hidden className="h-[22px] w-[22px]" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="mb-[6px] mt-[2px] font-serif text-[19px] font-medium text-text">{title}</h3>
        <p className="mb-4 max-w-[52ch] text-[14.5px] leading-[1.55] text-text-secondary">
          {message}
        </p>
        <div className="flex flex-wrap gap-[10px]">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-[42px] items-center gap-2 whitespace-nowrap rounded-btn bg-primary-500 px-[18px] text-[14px] font-semibold text-white transition-colors duration-fast hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <RefreshCw aria-hidden className="h-4 w-4" strokeWidth={1.75} /> Retry
          </button>
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className="inline-flex h-[42px] items-center gap-2 whitespace-nowrap rounded-btn border border-border-strong bg-surface px-[18px] text-[14px] font-semibold text-text transition-colors duration-fast hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ArrowRight aria-hidden className="h-4 w-4" strokeWidth={1.75} /> Skip for now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
