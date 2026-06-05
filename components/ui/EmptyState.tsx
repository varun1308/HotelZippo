/* Empty state — "always a next step" (specs/05, Interaction States.html .empty).
 * The next action is REQUIRED: callers pass either `action` or `children`. */
import type { ReactNode } from 'react';
import { Compass, type LucideIcon } from 'lucide-react';

export interface EmptyStateProps {
  /** Lucide icon for the headline tile. Defaults to a compass (refine, don't dead-end). */
  icon?: LucideIcon;
  title: string;
  message: string;
  /** The required next action (e.g. a button). Use this OR `children` — one is required. */
  action?: ReactNode;
  children?: ReactNode;
}

export function EmptyState({
  icon: Icon = Compass,
  title,
  message,
  action,
  children,
}: EmptyStateProps) {
  const next = action ?? children;
  return (
    <div className="rounded-card border border-border bg-surface px-6 py-11 text-center">
      <div className="mx-auto mb-[18px] grid h-[60px] w-[60px] place-items-center rounded-[16px] bg-surface-2 text-primary-500">
        <Icon aria-hidden className="h-7 w-7" strokeWidth={1.75} />
      </div>
      <h3 className="mb-2 font-serif text-[21px] font-medium text-text">{title}</h3>
      <p className="mx-auto mb-5 max-w-[38ch] text-[14.5px] leading-[1.6] text-text-secondary">
        {message}
      </p>
      {next && <div className="flex justify-center">{next}</div>}
    </div>
  );
}
