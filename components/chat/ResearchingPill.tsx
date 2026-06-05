/* ResearchingPill — the brief "I'm reading reviews…" notice.
 *
 * This is the ONE place in the whole chat a spinner is allowed (spec 05): the
 * concierge is doing real research, so a spinner reads as honest work, not a UI
 * stall. Everything else (the assistant typing) uses the 3-dot indicator. Mined
 * from `Chat - Active & Streaming.html` (.researching / .spin). Spinner motion is
 * gated on prefers-reduced-motion. */

export interface ResearchingPillProps {
  label?: string;
}

export function ResearchingPill({
  label = 'Researching hotels for your family…',
}: ResearchingPillProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-[26px] ml-[50px] inline-flex items-center gap-3 rounded-pill border border-primary-100 bg-primary-50 py-[10px] pl-[14px] pr-[18px] text-[14px] font-medium text-primary-700 max-[600px]:ml-0"
    >
      <span
        aria-hidden
        className="h-[17px] w-[17px] rounded-full border-2 border-primary-200 border-t-primary-500 motion-safe:animate-spin"
      />
      {label}
    </div>
  );
}
