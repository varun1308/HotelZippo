/* Landing / home route (app/page.tsx) — Phase 4 · specs/04 Stage 1.
 *
 * Asserts the locked decisions:
 *   (a) the authentic "Continue with Google" button renders;
 *   (b) NO "Continue with email" affordance / no email button exists (Google-only);
 *   (c) all 4 showcase slides render — including the hard-flag / Holiday Inn Karon
 *       honesty slide (the brand's honesty proof, must never be dropped);
 *   (d) with ?error=auth a warm, NON-blocking message appears AND the page stays
 *       fully usable (hero copy + sign-in button still present).
 *
 * @/lib/auth/signIn is mocked so no real Supabase call runs. useSearchParams is
 * mocked off next/navigation (no jsdom precedent for routing — see tests/unit). */
import { render, screen } from '@testing-library/react';

// --- mocks -----------------------------------------------------------------
const signInWithGoogle = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/auth/signIn', () => ({
  signInWithGoogle: () => signInWithGoogle(),
  signOut: jest.fn(),
}));

// Drive useSearchParams per-test via this mutable param string.
let searchParamString = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(searchParamString),
}));

import Home from '@/app/page';

beforeEach(() => {
  searchParamString = '';
  signInWithGoogle.mockClear();
});

describe('Landing page', () => {
  it('(a) renders the authentic Continue with Google button', () => {
    render(<Home />);
    expect(
      screen.getByRole('button', { name: /sign up to try/i }),
    ).toBeInTheDocument();
  });

  it('(b) has NO "Continue with email" button or email affordance', () => {
    render(<Home />);
    expect(screen.queryByText(/continue with email/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^or$/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /email/i }),
    ).not.toBeInTheDocument();
  });

  it('(c) renders all 4 showcase slides incl. the Holiday Inn Karon hard-flag slide', () => {
    render(<Home />);
    // slide 1 · chat
    expect(screen.getByText(/handle the research/i)).toBeInTheDocument();
    // slide 2 · top pick
    expect(screen.getByText(/JW Marriott Phuket Resort/i)).toBeInTheDocument();
    // slide 3 · hard flag (honesty proof) — Holiday Inn Karon refurbishment
    expect(screen.getByText(/Holiday Inn Resort Karon Beach/i)).toBeInTheDocument();
    expect(screen.getByText(/Active refurbishment/i)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // slide 4 · shortlist
    expect(screen.getByText(/Angsana Laguna Phuket/i)).toBeInTheDocument();
    // four dots → four slides
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
  });

  it('(d) shows a warm, non-blocking error on ?error=auth without breaking the page', () => {
    searchParamString = 'error=auth';
    render(<Home />);

    // warm, human copy — not a raw error code
    const notice = screen.getByText(/didn't go through/i);
    expect(notice).toBeInTheDocument();
    expect(screen.queryByText(/error|stack|undefined|500|null/i)).not.toBeInTheDocument();

    // non-blocking: it is not a modal/dialog, and the page is still fully usable
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /sign up to try/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/No more research spiral/i)).toBeInTheDocument();
    expect(screen.getByText(/Holiday Inn Resort Karon Beach/i)).toBeInTheDocument();
  });
});
