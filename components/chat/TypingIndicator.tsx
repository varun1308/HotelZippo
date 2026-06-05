/* TypingIndicator — the 3-dot "concierge is thinking" bubble.
 *
 * Per spec 05 / CLAUDE.md: typing is ALWAYS the 3-dot indicator, NEVER a spinner.
 * (The one allowed spinner in the whole chat is the "researching" pill.) The dots
 * blink via the `animate-typing` token; motion is gated on prefers-reduced-motion
 * so reduced-motion users see static dots rather than nothing. Mined from
 * `Chat - Active & Streaming.html` (.typing-row / .typing). */
import { ConciergeBell } from 'lucide-react';

export function TypingIndicator() {
  return (
    <div
      className="mb-[26px] flex items-start gap-[14px]"
      role="status"
      aria-label="Concierge is typing"
    >
      <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-sm">
        <ConciergeBell aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </span>
      <span className="mt-[2px] inline-flex items-center gap-[6px] rounded-[18px_18px_18px_5px] border border-border bg-surface px-[18px] py-[14px] shadow-xs">
        {[0, 0.2, 0.4].map((delay) => (
          <span
            key={delay}
            aria-hidden
            className="block h-2 w-2 rounded-full bg-text-tertiary motion-safe:animate-typing"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
      </span>
    </div>
  );
}
