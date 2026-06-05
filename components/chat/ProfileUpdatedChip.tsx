/* ProfileUpdatedChip — a quiet inline confirmation that the concierge persisted a confirmed
 * change to the family's saved profile (Phase 4-fix · agent profile persistence).
 *
 * Rendered inline in the concierge's message (via the MessageRow component registry), so it
 * lives in the conversation history. NEUTRAL palette only — uses the `success` token, NEVER
 * amber/red (those are RESERVED for hard flags, spec 05). One short pill: a check + the human
 * labels of the fields just saved, e.g. "Family profile updated · budget, food preference". */
import { Check } from 'lucide-react';

export interface ProfileUpdatedChipProps {
  /** Human field labels actually changed (from the update_profile tool result). */
  updated: string[];
}

export function ProfileUpdatedChip({ updated }: ProfileUpdatedChipProps) {
  if (!updated || updated.length === 0) return null;
  return (
    <div
      className="mt-2 inline-flex items-center gap-2 rounded-full border border-success/25 bg-success-bg px-3 py-1 text-caption text-success-text"
      role="status"
    >
      <Check aria-hidden className="h-[14px] w-[14px] flex-none" strokeWidth={2.25} />
      <span>
        Family profile updated
        <span className="text-success-text/70"> · {updated.join(', ')}</span>
      </span>
    </div>
  );
}
