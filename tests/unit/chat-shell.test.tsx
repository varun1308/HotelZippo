/* ChatShell: empty greeting, mock-driven turn, rail placeholder. */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatShell } from '@/components/chat/ChatShell';
import type { StreamSource } from '@/lib/chat/types';
import { createMockStream } from '@/lib/chat/mockStream';
import { hasText } from './chat-helpers';

// A noop source that never produces content — keeps the empty state up.
const idleSource: StreamSource = async function* () {
  yield { type: 'done' };
};

describe('ChatShell', () => {
  it('renders the welcome greeting when there are no messages', () => {
    render(<ChatShell source={idleSource} />);
    expect(screen.getByText(/family travel concierge/i)).toBeInTheDocument();
    // suggestion chips present
    expect(screen.getByText(/Help me plan from scratch/i)).toBeInTheDocument();
  });

  it('renders the topbar brand and ghost buttons with counts', () => {
    render(<ChatShell source={idleSource} briefCount={2} shortlistCount={3} />);
    expect(screen.getByRole('button', { name: /brief/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /shortlist/i })).toBeInTheDocument();
  });

  it('drives a scripted assistant turn from the injected mock stream', async () => {
    const user = userEvent.setup();
    // Instant playback for the test (no timers).
    render(<ChatShell source={createMockStream({ delayMs: 0, thinkMs: 0 })} />);

    await user.type(screen.getByLabelText(/message your concierge/i), 'Hi there');
    await user.keyboard('{Enter}');

    // The user's message and the first scripted assistant reply both appear.
    await waitFor(() => {
      expect(screen.getByText('Hi there')).toBeInTheDocument();
      expect(screen.getByText('Concierge')).toBeInTheDocument();
    });
    await waitFor(() => expect(hasText("let's get to know your crew")).toBe(true));
  });

  it('renders a custom rail when provided', () => {
    render(<ChatShell source={idleSource} rail={<aside>CUSTOM RAIL</aside>} />);
    expect(screen.getByText('CUSTOM RAIL')).toBeInTheDocument();
  });
});
