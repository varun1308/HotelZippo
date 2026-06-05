/* Hard-flag alert — the product's most important trust signal (CLAUDE.md 1 & 4).
 *
 * Invariants this component OWNS:
 *   • moderate → amber palette, severe → red palette. NEVER grey/muted.
 *     Amber/red hues are reserved for flags only (specs/05). They read from
 *     CSS vars (--amber-* / --red-*) because the design system does NOT theme them.
 *   • A flag is structurally un-collapsible and un-dismissible — there is no
 *     toggle, no close button, by design.
 *
 * Two presentations, same data:
 *   • <HardFlag>       — the flag *bar* that sits ABOVE a card's body, before any
 *                        positive content (mined from Top Pick Card.html .flag-bar).
 *   • <InlineHardFlag> — the standalone chat-message form (Hard Flag - Inline
 *                        Message.html .flag-msg).
 */
import { TriangleAlert, OctagonAlert, MessageSquareQuote, Star } from 'lucide-react';
import type { CardFlag } from './types';

type Severity = CardFlag['severity'];

export interface HardFlagProps {
  category: string;
  description: string;
  severity: Severity;
  /** review_evidence_count — shown as the "N reviews" pill in the inline variant. */
  evidenceCount?: number;
}

/** Palette + icon resolved purely from severity. Centralised so both variants agree. */
const FLAG_THEME = {
  moderate: {
    icon: TriangleAlert,
    bg: 'var(--amber-bg)',
    border: 'var(--amber-border)',
    solid: 'var(--amber)',
    text: 'var(--amber-text)',
  },
  severe: {
    icon: OctagonAlert,
    bg: 'var(--red-bg)',
    border: 'var(--red-border)',
    solid: 'var(--red)',
    text: 'var(--red-text)',
  },
} as const satisfies Record<Severity, unknown>;

const SOURCE_LINE = 'Based on recent guest reviews';

/* ---------------------------------------------------------------------------
 * Flag BAR — sits above the card body. (Top Pick Card.html .flag-bar)
 * ------------------------------------------------------------------------- */
export function HardFlag({ category, description, severity, evidenceCount }: HardFlagProps) {
  const theme = FLAG_THEME[severity];
  const Icon = theme.icon;
  return (
    <div
      role="alert"
      data-severity={severity}
      className="flex items-start gap-[13px] border-b px-6 py-4"
      style={{ background: theme.bg, borderBottomColor: theme.border }}
    >
      <span
        className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[9px] text-white"
        style={{ background: theme.solid }}
      >
        <Icon aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </span>
      <div className="min-w-0">
        <div className="text-[13px] font-bold" style={{ color: theme.text }}>
          {category}
        </div>
        <p className="mt-[3px] text-[13.5px] leading-[1.5] text-text-secondary">{description}</p>
        <div className="mt-[7px] inline-flex items-center gap-[5px] font-mono text-[11px] text-text-tertiary">
          <MessageSquareQuote aria-hidden className="h-3 w-3" strokeWidth={1.75} />
          {SOURCE_LINE}
          {evidenceCount != null && (
            <span className="ml-1">· {evidenceCount} reviews</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Inline chat-message variant. (Hard Flag - Inline Message.html .flag-msg)
 * ------------------------------------------------------------------------- */
const SEV_BADGE_LABEL = {
  moderate: 'Worth knowing',
  severe: 'Avoid for your dates',
} as const satisfies Record<Severity, string>;

export function InlineHardFlag({
  category,
  description,
  severity,
  evidenceCount,
}: HardFlagProps) {
  const theme = FLAG_THEME[severity];
  const Icon = theme.icon;
  return (
    <div
      role="alert"
      data-severity={severity}
      className="overflow-hidden rounded-[16px_16px_16px_5px] border bg-surface shadow-md"
      style={{ borderColor: theme.border }}
    >
      <div
        className="flex items-center gap-3 border-b px-[18px] py-[14px]"
        style={{ background: theme.bg, borderBottomColor: theme.border }}
      >
        <span
          className="grid h-[38px] w-[38px] flex-none place-items-center rounded-[10px] text-white shadow-sm"
          style={{ background: theme.solid }}
        >
          <Icon aria-hidden className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <span
            className="inline-flex items-center gap-[6px] rounded-pill px-[9px] py-[3px] font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-white"
            style={{ background: theme.solid }}
          >
            <Icon aria-hidden className="h-[13px] w-[13px]" strokeWidth={1.75} />
            {SEV_BADGE_LABEL[severity]}
          </span>
          <div className="mt-[6px] text-[15px] font-bold" style={{ color: theme.text }}>
            {category}
          </div>
        </div>
      </div>
      <div className="px-[18px] pb-[18px] pt-4">
        <p className="m-0 mb-[14px] text-[15px] leading-[1.6] text-text">{description}</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-[7px] font-mono text-[11.5px] text-text-tertiary">
            <MessageSquareQuote aria-hidden className="h-[13px] w-[13px]" strokeWidth={1.75} />
            {SOURCE_LINE}
          </span>
          {evidenceCount != null && (
            <span className="inline-flex items-center gap-[6px] whitespace-nowrap rounded-pill bg-surface-2 px-[11px] py-[5px] text-[12.5px] font-medium text-text-secondary">
              <Star
                aria-hidden
                className="h-[13px] w-[13px] text-[var(--star)]"
                strokeWidth={1.75}
              />
              {evidenceCount} reviews · last 3 months
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
