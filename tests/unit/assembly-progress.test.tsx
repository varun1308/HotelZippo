/* AssemblyProgress component + useAssemblyJob poll hook (specs/03c-async-assembly.md).
 * Drives the injectable poll seam so no network is touched: a job advances stage → succeeds → cards,
 * or fails → warm fallback. */
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { AssemblyProgress } from '@/components/chat/AssemblyProgress';
import { stageLabel, useAssemblyJob } from '@/lib/chat/useAssemblyJob';
import type { AssemblyPoll } from '@/lib/chat/useAssemblyJob';

const SUCCESS_RESULT = {
  top_pick: {
    hotel_id: 'h1',
    hotel_name: 'Anantara Phuket',
    verdict: 'The strongest match',
    why_for_you: 'Pools + kids club',
    category_summaries: {},
    hard_flags: [],
    _hotel: { id: 'h1', destination: 'Phuket', area: 'Layan', price_tier: 'comfort', star_rating: 5, images: [], source: 'curated' },
  },
  other_picks: [],
  destination: 'Phuket',
};

describe('stageLabel', () => {
  it('maps each stage to honest advancing copy', () => {
    expect(stageLabel('queued', 'Phuket')).toMatch(/Finding family-friendly hotels in Phuket/);
    expect(stageLabel('finding_hotels', 'Phuket')).toMatch(/Finding family-friendly hotels/);
    expect(stageLabel('checking_intelligence', 'Phuket')).toMatch(/review intelligence/);
    expect(stageLabel('writing', 'Phuket')).toMatch(/Writing your recommendations/);
  });
});

describe('AssemblyProgress', () => {
  it('shows the staged status line while running, then swaps to cards on success', async () => {
    // First poll: running/checking; second: succeeded with the result.
    let call = 0;
    const poll: AssemblyPoll = async () => {
      call += 1;
      return call === 1
        ? { status: 'running', stage: 'checking_intelligence' }
        : { status: 'succeeded', stage: 'done', result: SUCCESS_RESULT };
    };

    render(<AssemblyProgress jobId="job-1" destination="Phuket" poll={poll} />);

    // Initial progress line (the one allowed spinner).
    expect(await screen.findByText(/Checking the review intelligence/)).toBeInTheDocument();

    // After the next poll resolves → cards (the top pick name renders).
    await waitFor(() => expect(screen.getByText('Anantara Phuket')).toBeInTheDocument(), { timeout: 4000 });
  });

  it('renders a warm fallback on a failed job (no_eligible_hotels)', async () => {
    const poll: AssemblyPoll = async () => ({ status: 'failed', stage: 'done', error_kind: 'no_eligible_hotels' });
    render(<AssemblyProgress jobId="job-2" destination="Tokyo" poll={poll} />);
    expect(await screen.findByText(/couldn't find hotels with enough family review intelligence for Tokyo/)).toBeInTheDocument();
  });

  it('renders the generic retry fallback on a model failure', async () => {
    const poll: AssemblyPoll = async () => ({ status: 'failed', stage: 'done', error_kind: 'model_failed' });
    render(<AssemblyProgress jobId="job-3" destination="Bali" poll={poll} />);
    expect(await screen.findByText(/had trouble pulling those recommendations together/)).toBeInTheDocument();
  });

  it('renders budget-mismatch copy naming the AVAILABLE tiers (from the persisted variant)', async () => {
    // The worker persists the full assembly error variant in `result` on failure (M7 fix).
    const poll: AssemblyPoll = async () => ({
      status: 'failed',
      stage: 'done',
      error_kind: 'budget_mismatch',
      result: { error: 'budget_mismatch', reason: 'nothing in tier', available_tiers: ['mid-range', 'luxury'] },
    });
    render(<AssemblyProgress jobId="job-4" destination="Singapore" poll={poll} />);
    const line = await screen.findByText(/quite fits that budget/);
    expect(line.textContent).toMatch(/Singapore/);
    expect(line.textContent).toMatch(/mid-range and luxury/);
    expect(line.textContent).toMatch(/widen the budget/i);
  });

  it('surfaces recommendation_notes beneath the cards on success (08b-2 caveats)', async () => {
    const poll: AssemblyPoll = async () => ({
      status: 'succeeded',
      stage: 'done',
      result: {
        ...SUCCESS_RESULT,
        recommendation_notes:
          'All available hotels for this destination have structural flags worth reviewing.',
      },
    });
    render(<AssemblyProgress jobId="job-5" destination="Phuket" poll={poll} />);
    expect(await screen.findByText('Anantara Phuket')).toBeInTheDocument();
    expect(screen.getByText(/structural flags worth reviewing/)).toBeInTheDocument();
  });
});

describe('useAssemblyJob poll-budget expiry (H8)', () => {
  it('transitions to failed/timeout when the budget expires on a non-terminal status', async () => {
    // maxMs=0 → the first poll response already exceeds the budget; the job never went terminal.
    const poll: AssemblyPoll = async () => ({ status: 'running', stage: 'writing' });
    const { result } = renderHook(() => useAssemblyJob('job-6', poll, undefined, 0));
    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.errorKind).toBe('timeout');
  });

  it('the timed-out state renders the warm retry fallback, never an eternal spinner', async () => {
    // Same path through the component: a failed/timeout job shows the spec-14 fallback copy.
    const poll: AssemblyPoll = async () => ({ status: 'failed', stage: 'writing', error_kind: 'timeout' });
    render(<AssemblyProgress jobId="job-7" destination="Orlando" poll={poll} />);
    expect(await screen.findByText(/Want me to try again\?/)).toBeInTheDocument();
  });
});
