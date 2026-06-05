/* FormOfferCard — the dashed "prefer to fill everything at once?" offer.
 *
 * Rendered beneath an assistant message that sets `offerForm`. The actual family-
 * profile form is Phase 3d, so the button is a no-op here: it invokes the
 * `onSwitchToForm` callback the shell passes (which 3d will wire to the form
 * flow). Mined from `Chat - Active & Streaming.html` (.form-offer). */
import { ClipboardList, ArrowRight } from 'lucide-react';

export interface FormOfferCardProps {
  /** Invoked when the user opts into the form. 3d wires the real switch. */
  onSwitchToForm?: () => void;
}

export function FormOfferCard({ onSwitchToForm }: FormOfferCardProps) {
  return (
    <div className="mb-[26px] ml-[50px] mt-[-8px] inline-flex max-w-[460px] items-center gap-3 rounded-card border border-dashed border-border-strong bg-surface px-[14px] py-[11px] shadow-xs max-[600px]:ml-0 max-[600px]:flex-col max-[600px]:items-start">
      <ClipboardList
        aria-hidden
        className="h-[17px] w-[17px] flex-none text-primary-500"
        strokeWidth={1.75}
      />
      <span className="flex-1 text-[13.5px] text-text-secondary">
        Prefer to fill everything at once? You can switch to a quick family-profile
        form anytime.
      </span>
      <button
        type="button"
        onClick={onSwitchToForm}
        className="inline-flex flex-none items-center gap-[6px] rounded-btn border border-border bg-surface-2 px-3 py-[7px] text-[13px] font-semibold text-text transition-colors duration-fast hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <ArrowRight aria-hidden className="h-[14px] w-[14px]" strokeWidth={1.75} />
        Switch to form
      </button>
    </div>
  );
}
