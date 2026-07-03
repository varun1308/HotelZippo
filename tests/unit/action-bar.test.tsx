/* M13 — post-recommendation action bar (spec 05 §7).
 * Save · Share · Proceed to book (primary) · escape hatch ("Tell me what you want
 * to do") that focuses the composer. Share flashes a transient "Link copied" only
 * when the share handler resolves truthy. */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionBar } from '@/components/chat/ActionBar';
import { ChatShell } from '@/components/chat/ChatShell';
import type { StreamSource } from '@/lib/chat/types';

describe('ActionBar', () => {
  it('renders all four actions (spec 05 §7)', () => {
    render(<ActionBar />);
    expect(screen.getByRole('toolbar', { name: /recommendation actions/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save shortlist/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /share with partner/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /proceed to book/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /tell me what you want to do/i }),
    ).toBeInTheDocument();
  });

  it('fires the save / proceed / escape-hatch handlers', async () => {
    const user = userEvent.setup();
    const onSaveShortlist = jest.fn();
    const onProceedToBook = jest.fn();
    const onEscapeHatch = jest.fn();
    render(
      <ActionBar
        onSaveShortlist={onSaveShortlist}
        onProceedToBook={onProceedToBook}
        onEscapeHatch={onEscapeHatch}
      />,
    );
    await user.click(screen.getByRole('button', { name: /save shortlist/i }));
    await user.click(screen.getByRole('button', { name: /proceed to book/i }));
    await user.click(screen.getByRole('button', { name: /tell me what you want to do/i }));
    expect(onSaveShortlist).toHaveBeenCalledTimes(1);
    expect(onProceedToBook).toHaveBeenCalledTimes(1);
    expect(onEscapeHatch).toHaveBeenCalledTimes(1);
  });

  it('shows the transient "Link copied" state when share succeeds', async () => {
    const user = userEvent.setup();
    const onShare = jest.fn().mockResolvedValue('https://x.test/shortlist/shared/tok');
    render(<ActionBar onShare={onShare} />);
    await user.click(screen.getByRole('button', { name: /share with partner/i }));
    expect(await screen.findByText(/link copied/i)).toBeInTheDocument();
  });

  it('stays quiet (no copied flash, no crash) when share yields nothing', async () => {
    const user = userEvent.setup();
    const onShare = jest.fn().mockResolvedValue(null);
    render(<ActionBar onShare={onShare} />);
    await user.click(screen.getByRole('button', { name: /share with partner/i }));
    await waitFor(() => expect(onShare).toHaveBeenCalled());
    expect(screen.queryByText(/link copied/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /share with partner/i })).toBeInTheDocument();
  });
});

describe('ChatShell action-bar slot', () => {
  const silentSource: StreamSource = async function* () {
    yield { type: 'done' } as const;
  };

  it('renders the action bar between stream and composer, and the escape hatch focuses the composer', async () => {
    const user = userEvent.setup();
    render(
      <ChatShell
        source={silentSource}
        actionBar={(api) => <ActionBar onEscapeHatch={api.focusComposer} />}
      />,
    );
    const hatch = screen.getByRole('button', { name: /tell me what you want to do/i });
    await user.click(hatch);
    const composer = screen.getByRole('textbox', { name: /message your concierge/i });
    expect(composer).toHaveFocus();
  });

  it('renders no bar when the slot is absent (pre-recommendation)', () => {
    render(<ChatShell source={silentSource} />);
    expect(screen.queryByRole('toolbar', { name: /recommendation actions/i })).not.toBeInTheDocument();
  });
});
