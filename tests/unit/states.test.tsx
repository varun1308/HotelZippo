/* Warm error + empty state: a way forward is always present (specs/05, /14). */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WarmError, CardError } from '@/components/ui/WarmError';
import { EmptyState } from '@/components/ui/EmptyState';

describe('WarmError', () => {
  it('renders the concierge default copy and a Try again button that calls onRetry', async () => {
    const onRetry = jest.fn();
    const user = userEvent.setup();
    render(<WarmError onRetry={onRetry} />);
    expect(screen.getByText(/lost my footing/i)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /try again/i });
    await user.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows no raw error codes or stack traces', () => {
    render(<WarmError message="Something gentle happened." />);
    expect(screen.queryByText(/error|stack|undefined|500|null/i)).not.toBeInTheDocument();
  });
});

describe('CardError', () => {
  it('offers Retry (and Skip when onSkip is given)', async () => {
    const onRetry = jest.fn();
    const onSkip = jest.fn();
    const user = userEvent.setup();
    render(<CardError onRetry={onRetry} onSkip={onSkip} />);
    expect(screen.getByText(/couldn't load this one/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry/i }));
    await user.click(screen.getByRole('button', { name: /skip for now/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('hides Skip when no onSkip handler is supplied', () => {
    render(<CardError onRetry={() => {}} />);
    expect(screen.queryByRole('button', { name: /skip/i })).not.toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('always renders a next action', () => {
    render(
      <EmptyState
        title="Nothing felt right to recommend"
        message="Loosen one constraint and I'll find you something."
        action={<button type="button">Adjust the brief</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: /Nothing felt right/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Adjust the brief/i })).toBeInTheDocument();
  });
});
