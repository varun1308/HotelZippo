/* ChatWelcome — the destination chips (rollout): renders the canonical covered destinations and
 * prefills the composer when one is clicked. Guards that the user-facing covered set stays in sync
 * with lib/db/schemas DESTINATIONS. */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatWelcome } from '@/components/chat/ChatWelcome';
import { DESTINATIONS } from '@/lib/db/schemas';

describe('ChatWelcome — destination chips', () => {
  it('renders a chip for every covered destination', () => {
    render(<ChatWelcome />);
    for (const d of DESTINATIONS) {
      expect(screen.getByRole('button', { name: `Plan a trip to ${d}` })).toBeInTheDocument();
    }
  });

  it('prefills the composer with the destination when a chip is clicked', async () => {
    const user = userEvent.setup();
    const onSuggestion = jest.fn();
    render(<ChatWelcome onSuggestion={onSuggestion} />);
    await user.click(screen.getByRole('button', { name: 'Plan a trip to Tokyo' }));
    expect(onSuggestion).toHaveBeenCalledWith(expect.stringContaining('Tokyo'));
  });

  it('shows the covered set exactly (no removed destinations like Hong Kong / Maldives)', () => {
    render(<ChatWelcome />);
    expect(screen.queryByRole('button', { name: /Plan a trip to Hong Kong/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Plan a trip to Maldives/i })).not.toBeInTheDocument();
  });
});
