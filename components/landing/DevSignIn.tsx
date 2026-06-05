/* DevSignIn — a LOCAL-ONLY email/password sign-in affordance (never production).
 *
 * Renders NOTHING unless NEXT_PUBLIC_ENABLE_DEV_LOGIN === 'true' (set only in .env.local),
 * so production shows Google-only, unchanged. It lets a developer reach the hard-gated
 * /chat without Google OAuth by signing in a seeded dev user (scripts/dev/seed-dev-user.ts)
 * against local Supabase. Visually de-emphasised + clearly labelled "Local dev only" so it
 * is never mistaken for a product surface. See lib/auth/devSignIn.ts for the matching guard. */
'use client';

import { useState } from 'react';
import { devLoginEnabled, devSignIn } from '@/lib/auth/devSignIn';

const DEFAULT_EMAIL = 'dev@hotelzippo.local';
const DEFAULT_PASSWORD = 'dev-password-123!';

export function DevSignIn() {
  // Hard gate: the component is inert in any build without the explicit local flag.
  if (!devLoginEnabled()) return null;
  return <DevSignInForm />;
}

function DevSignInForm() {
  const [email, setEmail] = useState(DEFAULT_EMAIL);
  const [password, setPassword] = useState(DEFAULT_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await devSignIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dev sign-in failed');
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-6 w-full max-w-[340px] rounded-input border border-dashed border-border-strong bg-surface-2 p-4"
    >
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        Local dev only · not production
      </p>
      <div className="flex flex-col gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Dev email"
          autoComplete="off"
          className="h-9 rounded-input border border-border bg-surface px-3 text-[13px] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="Dev password"
          autoComplete="off"
          className="h-9 rounded-input border border-border bg-surface px-3 text-[13px] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <button
          type="submit"
          disabled={busy}
          className="h-9 rounded-btn border border-border bg-surface text-[13px] font-semibold text-text-secondary transition-colors hover:bg-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Dev sign-in'}
        </button>
      </div>
      {error && <p className="mt-2 text-[12px] leading-[1.5] text-text-secondary">{error}</p>}
    </form>
  );
}
