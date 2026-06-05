/* MessageRow: user bubble, assistant avatar/label, inline component registry. */
import { render, screen } from '@testing-library/react';
import { MessageRow } from '@/components/chat/MessageRow';
import { hasText } from './chat-helpers';
import type { ChatMessage } from '@/lib/chat/types';
import type { RecommendationSetProps } from '@/components/recommendation/types';
import { topPick, standardPick } from './fixtures';

describe('MessageRow', () => {
  it('renders a right-aligned primary bubble for a user message', () => {
    const message: ChatMessage = {
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: 'Phuket, please' }],
    };
    render(<MessageRow message={message} />);
    expect(screen.getByText('Phuket, please')).toBeInTheDocument();
  });

  it('renders the concierge avatar + label for an assistant message', () => {
    const message: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Happy to help.' }],
    };
    render(<MessageRow message={message} />);
    expect(screen.getByText('Concierge')).toBeInTheDocument();
    expect(hasText('Happy to help.')).toBe(true);
  });

  it('renders the 3a RecommendationSet for a recommendation-set component part', () => {
    const recs: RecommendationSetProps = {
      topPick,
      otherPicks: [standardPick],
    };
    const message: ChatMessage = {
      id: 'a2',
      role: 'assistant',
      parts: [
        { type: 'text', text: "Here's where I landed." },
        { type: 'component', component: 'recommendation-set', props: recs },
      ],
    };
    render(<MessageRow message={message} />);
    // A hotel name from the props proves the real card rendered inline.
    expect(screen.getByText('JW Marriott Phuket Resort & Spa')).toBeInTheDocument();
    expect(screen.getByText('Top Pick')).toBeInTheDocument();
  });

  it('renders an inline hard flag for a hard-flag component part (role alert)', () => {
    const message: ChatMessage = {
      id: 'a3',
      role: 'assistant',
      parts: [
        {
          type: 'component',
          component: 'hard-flag',
          props: {
            category: 'Active refurbishment',
            description: 'Construction across the main pool through your dates.',
            severity: 'severe',
            evidenceCount: 18,
          },
        },
      ],
    };
    render(<MessageRow message={message} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-severity', 'severe');
    expect(screen.getByText('Active refurbishment')).toBeInTheDocument();
  });
});
