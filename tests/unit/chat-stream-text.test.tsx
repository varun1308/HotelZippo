/* ChatStreamText: no mid-word reflow + caret lifecycle (CLAUDE.md 4). */
import { render, screen } from '@testing-library/react';
import { ChatStreamText } from '@/components/chat/ChatStreamText';

describe('ChatStreamText', () => {
  it('renders each committed word as a complete, intact token (never split)', () => {
    // Mid-stream the text is a partial sentence ending on a whole word.
    const { container } = render(<ChatStreamText text="Hello world" streaming />);
    // "Hello" must appear as one intact span — not "Hel" / "lo".
    const spans = Array.from(container.querySelectorAll('span.inline')).map(
      (s) => s.textContent,
    );
    expect(spans).toContain('Hello');
    expect(spans).toContain('world');
    // No fragment of a word leaked out on its own.
    expect(spans).not.toContain('Hel');
    expect(spans).not.toContain('Hell');
  });

  it('shows the blinking caret while streaming and removes it when done', () => {
    const { rerender } = render(<ChatStreamText text="Phuket in December" streaming />);
    expect(screen.getByTestId('stream-caret')).toBeInTheDocument();

    rerender(<ChatStreamText text="Phuket in December" streaming={false} />);
    expect(screen.queryByTestId('stream-caret')).not.toBeInTheDocument();
  });

  it('keeps already-committed words stable when more text arrives (no reflow)', () => {
    const { container, rerender } = render(<ChatStreamText text="Perfect — Phuket" streaming />);
    const firstWords = () =>
      Array.from(container.querySelectorAll('span.inline')).map((s) => s.textContent);
    expect(firstWords()).toEqual(expect.arrayContaining(['Perfect', '—', 'Phuket']));

    // Append more — earlier words remain present and intact (no re-tokenization
    // that splits or drops them).
    rerender(<ChatStreamText text="Perfect — Phuket in late December" streaming />);
    expect(firstWords()).toEqual(
      expect.arrayContaining(['Perfect', '—', 'Phuket', 'in', 'late', 'December']),
    );
  });

  it('renders blank-line-separated paragraphs as separate <p> elements', () => {
    const { container } = render(
      <ChatStreamText text={'First para.\n\nSecond para.'} streaming={false} />,
    );
    expect(container.querySelectorAll('p').length).toBe(2);
  });
});
