/* Authentic "Continue with Google" button — the ONLY auth affordance on the
 * landing page (Google-only, specs/04 Stage 1 + decision #1). The multi-colour
 * Google "G" SVG and the exact #dadce0 border are mined from
 * design_handoff/Home Page.html (.google-btn). Google brand guidelines require
 * these exact values, so they live as literals here rather than design tokens.
 *
 * Auth UI states (specs/04 · "Auth UI states"): idle / loading (disabled +
 * subtle busy affordance while the OAuth redirect kicks off) / disabled. On
 * click → signInWithGoogle(); a throw bubbles up via onError so the page can
 * show a warm, non-blocking message (it never blocks the page). */
'use client';

import { useState } from 'react';

/** The authentic Google "G". Decorative — the button label carries the meaning. */
function GoogleG() {
  return (
    <svg
      aria-hidden
      width="22"
      height="22"
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      className="flex-none"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  );
}

export interface GoogleSignInButtonProps {
  /** Begins Google OAuth. Resolves into a browser redirect; rejects on failure. */
  onSignIn: () => Promise<void>;
  /** Surface a warm, non-blocking message when the redirect can't be started. */
  onError?: () => void;
  /** Visible label. Defaults to the prototype copy. */
  label?: string;
  className?: string;
}

export function GoogleSignInButton({
  onSignIn,
  onError,
  label = "Sign up to try — it's free",
  className = '',
}: GoogleSignInButtonProps) {
  // `pending` = we've kicked off OAuth and are waiting for the redirect to take
  // over the page; keep the button disabled + busy so it can't be double-fired.
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (pending) return;
    setPending(true);
    try {
      await onSignIn();
      // On success the browser navigates away to Google; leave the button busy.
    } catch {
      // Redirect couldn't start — re-enable and let the page show the warm error.
      setPending(false);
      onError?.();
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-busy={pending}
      // Roboto + the exact Google chrome (white / #dadce0) are brand-mandated.
      style={{ fontFamily: "'Roboto', var(--font-sans)" }}
      className={`inline-flex w-full max-w-[280px] items-center justify-center gap-[14px] rounded-btn border border-[#dadce0] bg-white py-[14px] pl-[18px] pr-6 text-[15.5px] font-medium text-[#3c4043] shadow-[0_1px_3px_rgba(60,64,67,0.08)] transition-all duration-fast hover:border-[#c6c9cc] hover:bg-[#f8f9fa] hover:shadow-[0_2px_8px_rgba(60,64,67,0.14)] active:scale-[0.99] active:bg-[#f1f3f4] disabled:cursor-progress disabled:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}
    >
      <GoogleG />
      <span>{pending ? 'Connecting to Google…' : label}</span>
    </button>
  );
}
