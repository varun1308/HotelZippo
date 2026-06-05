/* Card-shaped loading skeleton — same proportions as the real card so content
 * arrives with NO layout shift. Shimmer is gated on prefers-reduced-motion
 * (see the .sk rule below). Mined from Interaction States.html (.sk-card). */

/** A single shimmering block. Shimmer animation is reduced-motion aware. */
function SkBlock({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`hz-sk rounded-lg ${className}`} style={style} />;
}

export function HotelCardSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="overflow-hidden rounded-card border border-border bg-surface shadow-sm"
    >
      <span className="sr-only">Loading recommendation…</span>

      {/* Scoped shimmer keyframes (no global CSS edits; reduced-motion safe). */}
      <style>{`
        @keyframes hzShimmer { 100% { background-position: -200% 0; } }
        .hz-sk {
          background: linear-gradient(90deg, var(--surface-3) 0%, var(--surface-2) 40%, var(--surface-3) 80%);
          background-size: 200% 100%;
        }
        @media (prefers-reduced-motion: no-preference) {
          .hz-sk { animation: hzShimmer 1.4s linear infinite; }
        }
      `}</style>

      {/* hero */}
      <SkBlock className="h-[200px] rounded-none" />

      <div className="flex flex-col gap-[18px] p-[22px]">
        {/* name */}
        <SkBlock className="h-[22px]" style={{ width: '62%' }} />
        {/* meta row */}
        <div className="flex items-center gap-3">
          <SkBlock className="h-[14px]" style={{ width: '120px' }} />
          <SkBlock className="h-[14px]" style={{ width: '90px' }} />
        </div>
        {/* verdict */}
        <SkBlock className="h-[92px] rounded-[14px]" />
        {/* 2x2 category grid */}
        <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2">
          {[
            ['60%', '90%'],
            ['55%', '85%'],
            ['50%', '88%'],
            ['58%', '82%'],
          ].map(([w1, w2], i) => (
            <div key={i} className="flex gap-3">
              <SkBlock className="h-[34px] w-[34px] flex-none rounded-[9px]" />
              <div className="flex flex-1 flex-col gap-2">
                <SkBlock className="h-[14px]" style={{ width: w1 }} />
                <SkBlock className="h-[14px]" style={{ width: w2 }} />
              </div>
            </div>
          ))}
        </div>
        {/* ctas */}
        <div className="flex gap-3">
          <SkBlock className="h-[48px] flex-1 rounded-btn" />
          <SkBlock className="h-[48px] flex-1 rounded-btn" />
        </div>
      </div>
    </div>
  );
}
