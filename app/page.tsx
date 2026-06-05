/* HotelZippo landing / home route (Phase 4 · specs/04-auth-persistence.md Stage 1).
 * Translated from design_handoff/Home Page.html into React + locked Tailwind tokens.
 *
 * Locked decisions enforced here:
 *   • Google-ONLY auth: the single authentic "Continue with Google" button. The
 *     prototype's "Continue with email" button + "or" separator are dropped, and
 *     the nav "Sign in" link triggers the same Google flow (decision #1).
 *   • "Continue with Google" → signInWithGoogle() (real OAuth, lib/auth/signIn).
 *   • OAuth failures redirect back to /?error=auth; we read that param and show a
 *     warm, NON-BLOCKING inline message near the button — the page stays usable
 *     (decision #3 / spec 14). useSearchParams lives in a Suspense child as the
 *     App Router requires.
 *   • Mobile reflow copy → carousel → CTA preserved via flex order at ≤900px.
 *   • Amber/red are reserved for hard flags — the only red on this page is the
 *     honesty slide inside <AppShowcase>; nothing here introduces amber/red.
 */
'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { TriangleAlert } from 'lucide-react';
import { signInWithGoogle } from '@/lib/auth/signIn';
import { GoogleSignInButton } from '@/components/landing/GoogleSignInButton';
import { AppShowcase } from '@/components/landing/AppShowcase';
import { HeroCopy, TrustRow } from '@/components/landing/LandingHero';

/* ---- top nav ------------------------------------------------------------- */
function Nav({ onSignIn }: { onSignIn: () => void }) {
  return (
    <nav className="fixed inset-x-0 top-0 z-20 flex h-[68px] items-center justify-between border-b border-border bg-bg/[0.84] px-10 backdrop-blur-[12px] max-[900px]:px-6 max-[560px]:h-14 max-[560px]:px-[18px]">
      <span className="flex cursor-default items-baseline gap-[10px]">
        <span aria-hidden className="h-[13px] w-[13px] rotate-45 rounded-[4px] bg-primary-500" />
        <span className="font-serif text-[22px] font-semibold tracking-[-0.02em] text-text">
          Hotel<b className="text-primary-600">Zippo</b>
        </span>
      </span>
      <button
        type="button"
        onClick={onSignIn}
        className="text-[14px] font-medium text-text-secondary transition-colors duration-fast hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        Sign in
      </button>
    </nav>
  );
}

/* ---- warm, non-blocking auth error --------------------------------------- */
/** Warm, human, non-blocking message shown when sign-in didn't go through —
 * either from ?error=auth (OAuth callback failure) or a thrown redirect. The
 * page stays fully usable; the clear next action is simply "try again". */
function AuthErrorNotice() {
  return (
    <div
      role="status"
      className="mt-4 flex w-full max-w-[340px] items-start gap-[10px] rounded-input border border-border-strong bg-surface-2 px-4 py-3 text-[13px] leading-[1.5] text-text-secondary max-[900px]:text-center"
    >
      <TriangleAlert
        aria-hidden
        className="mt-[2px] h-[15px] w-[15px] flex-none text-text-tertiary"
        strokeWidth={1.75}
      />
      <span>
        That sign-in didn&apos;t go through — no harm done. Give it another try and we&apos;ll get
        you in.
      </span>
    </div>
  );
}

/* ---- sign-in CTA cluster ------------------------------------------------- */
function SignInCluster({ showInlineError }: { showInlineError: boolean }) {
  // Local error flag: set when signInWithGoogle throws (redirect couldn't start).
  // Combined with ?error=auth (showInlineError), either path shows the warm
  // notice while leaving the rest of the page fully interactive.
  const [threw, setThrew] = useState(false);
  const hasError = showInlineError || threw;

  return (
    <div className="flex flex-col items-center text-center max-[900px]:items-center min-[901px]:items-start min-[901px]:text-left">
      <p className="mb-[22px] hidden font-serif text-[23px] font-medium tracking-[-0.01em] text-text max-[900px]:block">
        Ready to find your family&apos;s hotel?
      </p>

      <GoogleSignInButton onSignIn={signInWithGoogle} onError={() => setThrew(true)} />

      {hasError && <AuthErrorNotice />}

      <p className="mt-[18px] max-w-[280px] text-[12px] leading-[1.5] text-text-tertiary max-[900px]:max-w-[340px]">
        By continuing you agree to our{' '}
        <a
          href="#"
          className="text-text-secondary underline underline-offset-2 hover:text-text"
        >
          Terms of Service
        </a>{' '}
        and{' '}
        <a
          href="#"
          className="text-text-secondary underline underline-offset-2 hover:text-text"
        >
          Privacy Policy
        </a>
        . Already have an account? The button above signs you in automatically.
      </p>

      <TrustRow className="mt-11 max-w-[380px]" />
    </div>
  );
}

/* ---- footer -------------------------------------------------------------- */
function Footer() {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-20 py-6 text-[13px] text-text-tertiary max-[900px]:px-7 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-2 max-[560px]:px-5">
      <span>© 2026 HotelZippo · AI-powered travel research for families</span>
      <span className="flex gap-5">
        <a href="#" className="text-text-tertiary hover:text-text-secondary">
          Privacy
        </a>
        <a href="#" className="text-text-tertiary hover:text-text-secondary">
          Terms
        </a>
        <a href="#" className="text-text-tertiary hover:text-text-secondary">
          Contact
        </a>
      </span>
    </footer>
  );
}

/* ---- page ---------------------------------------------------------------- */
/** Inner content reads ?error=auth, so it lives under the page's Suspense. */
function LandingContent() {
  const params = useSearchParams();
  const hasAuthError = params.get('error') === 'auth';

  // The nav "Sign in" link triggers the same Google flow (decision #1). On a
  // thrown redirect we route through the same warm error by setting the param —
  // but to avoid a full reload we just kick off OAuth; failures are surfaced by
  // the CTA's own onError, matching the inline message.
  function handleNavSignIn() {
    void signInWithGoogle().catch(() => {
      // Mirror the CTA's warm path: append ?error=auth without a hard reload so
      // the inline notice appears (page stays fully usable).
      const url = new URL(window.location.href);
      url.searchParams.set('error', 'auth');
      window.history.replaceState(null, '', url.toString());
      // Nudge a re-render by dispatching popstate (useSearchParams listens).
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
  }

  return (
    <div className="min-h-screen">
      <Nav onSignIn={handleNavSignIn} />

      <section className="flex min-h-[100dvh] items-stretch pt-[68px] max-[900px]:flex-col max-[560px]:pt-14">
        {/* LEFT column on desktop; dissolves into the column flow on mobile so
            the order becomes copy(1) → showcase(2) → CTA(3). */}
        <div className="flex flex-[0_0_52%] flex-col justify-center max-[900px]:contents">
          <div className="px-14 pb-7 pl-20 pt-[60px] max-[900px]:order-1 max-[900px]:flex max-[900px]:flex-col max-[900px]:items-center max-[900px]:px-6 max-[900px]:pb-[10px] max-[900px]:pt-[46px] max-[560px]:px-5 max-[560px]:pt-[38px]">
            <HeroCopy />
          </div>

          <div className="px-14 pb-[72px] pl-20 max-[900px]:order-3 max-[900px]:flex max-[900px]:flex-col max-[900px]:items-center max-[900px]:px-6 max-[900px]:pb-12 max-[900px]:pt-3 max-[560px]:px-5 max-[560px]:pb-10">
            <SignInCluster showInlineError={hasAuthError} />
          </div>
        </div>

        {/* RIGHT column on desktop (showcase); order 2 on mobile. */}
        <div className="relative order-2 flex flex-1 items-center justify-center overflow-hidden bg-surface-2 max-[900px]:flex-none max-[900px]:bg-transparent max-[900px]:px-5 max-[900px]:pb-2 max-[900px]:pt-[18px] max-[560px]:px-4 max-[560px]:pb-1 max-[560px]:pt-[14px]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 max-[900px]:hidden"
            style={{
              background:
                'repeating-linear-gradient(135deg, rgba(31,27,23,0.028) 0 1px, transparent 1px 13px)',
            }}
          />
          <div className="relative z-[1] w-full max-w-[392px] max-[900px]:max-w-[400px]">
            <AppShowcase />
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

export default function Home() {
  return (
    <main>
      <Suspense fallback={null}>
        <LandingContent />
      </Suspense>
    </main>
  );
}
