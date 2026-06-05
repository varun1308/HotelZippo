/* Editorial hero copy + trust row, mined from design_handoff/Home Page.html
 * (.eyebrow / .headline / .sub / .trust). Pure presentational — the sign-in CTA
 * and showcase are composed alongside it in app/page.tsx so the mobile reflow
 * (copy → carousel → CTA) can reorder them at the layout level. */
import { SearchCheck, TriangleAlert, Users, Lock, type LucideIcon } from 'lucide-react';

const TRUST: { icon: LucideIcon; label: string }[] = [
  { icon: SearchCheck, label: 'Real guest reviews' },
  { icon: TriangleAlert, label: 'Red flags surfaced' },
  { icon: Users, label: 'Built for families' },
  { icon: Lock, label: 'Free in beta' },
];

/** Eyebrow + serif headline (italic line 2) + subhead. Centred on mobile. */
export function HeroCopy({ className = '' }: { className?: string }) {
  return (
    <div className={className}>
      <div className="mb-6 flex items-center gap-[10px] font-mono text-[11px] uppercase tracking-[0.14em] text-primary-600 max-[900px]:justify-center">
        <span
          aria-hidden
          className="h-2 w-2 rounded-full bg-primary-500 shadow-[0_0_0_3px_var(--primary-100)]"
        />
        Your family travel concierge
      </div>
      <h1 className="m-0 mb-[22px] max-w-[14ch] font-serif text-[clamp(36px,3.8vw,56px)] font-medium leading-[1.06] tracking-[-0.025em] text-text max-[900px]:mx-auto max-[900px]:max-w-[17ch] max-[560px]:max-w-[20ch]">
        One confident recommendation.{' '}
        <span className="italic text-primary-600">No more research spiral.</span>
      </h1>
      <p className="m-0 max-w-[46ch] text-[clamp(16px,1.3vw,18px)] leading-[1.65] text-text-secondary max-[900px]:mx-auto max-[900px]:max-w-[42ch]">
        Finding the right hotel for a family trip can mean{' '}
        <strong className="font-semibold text-text">30–40 hours</strong> of reviews, maps, and
        YouTube videos. Tell me about your family and where you&apos;re heading — I&apos;ll do the
        research and hand you one recommendation you can trust, with everything you need to know
        before you book.
      </p>
    </div>
  );
}

/** Trust row — terracotta icon + label chips. */
export function TrustRow({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex flex-wrap gap-x-[26px] gap-y-[10px] max-[900px]:justify-center max-[560px]:gap-x-[18px] ${className}`}
    >
      {TRUST.map(({ icon: Icon, label }) => (
        <span key={label} className="flex items-center gap-[9px] text-[13px] text-text-secondary">
          <Icon aria-hidden className="h-[15px] w-[15px] text-primary-500" strokeWidth={1.75} />
          {label}
        </span>
      ))}
    </div>
  );
}
