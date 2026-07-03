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

describe('ChatStreamText markdown-lite (L20 — no literal asterisks, no collapsed lists)', () => {
  it('renders **bold** as <strong> without the asterisks, words still whole-token spans', () => {
    const { container } = render(
      <ChatStreamText text="The pool is **absolutely great** for toddlers." streaming={false} />,
    );
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe('absolutely great');
    expect(container.textContent).not.toContain('**');
    // Bold words remain atomic whole-word spans (no mid-word reflow).
    const boldSpans = Array.from(strong!.querySelectorAll('span.inline')).map((s) => s.textContent);
    expect(boldSpans).toEqual(['absolutely', 'great']);
  });

  it('leaves an UNCLOSED ** literal mid-stream (streaming-safe, transforms only complete pairs)', () => {
    const { container } = render(<ChatStreamText text="This is **very" streaming />);
    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent).toContain('**very');
  });

  it('renders single-newline bullet lines as a real <ul>, not one collapsed paragraph', () => {
    const { container } = render(
      <ChatStreamText
        text={'Two things stand out:\n- Kids club until 8pm\n- Shallow lagoon pool'}
        streaming={false}
      />,
    );
    const ul = container.querySelector('ul');
    expect(ul).not.toBeNull();
    const items = Array.from(ul!.querySelectorAll('li')).map((li) => li.textContent);
    expect(items).toEqual(['Kids club until 8pm', 'Shallow lagoon pool']);
    // The intro line stays its own paragraph.
    expect(container.querySelector('p')!.textContent).toContain('Two things stand out:');
  });

  it('renders numbered lines as an <ol>', () => {
    const { container } = render(
      <ChatStreamText text={'1. Check the dates\n2. Pick a room'} streaming={false} />,
    );
    const ol = container.querySelector('ol');
    expect(ol).not.toBeNull();
    expect(ol!.querySelectorAll('li').length).toBe(2);
  });

  it('renders a single \\n inside a paragraph as a line break (not collapsed)', () => {
    const { container } = render(
      <ChatStreamText text={'Line one\nLine two'} streaming={false} />,
    );
    expect(container.querySelectorAll('p').length).toBe(1);
    expect(container.querySelector('p br')).not.toBeNull();
  });

  it('mixed streaming chunks: caret sits at the end of a growing list, then bold lands intact', () => {
    const { container, rerender } = render(
      <ChatStreamText text={'My picks:\n- **Anantara**'} streaming />,
    );
    // Mid-stream: list already real, caret inside the last item.
    expect(container.querySelector('ul li [data-testid="stream-caret"]')).not.toBeNull();

    rerender(
      <ChatStreamText text={'My picks:\n- **Anantara** for the beach\n- Angsana'} streaming={false} />,
    );
    const items = Array.from(container.querySelectorAll('ul li'));
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('strong')!.textContent).toBe('Anantara');
    expect(container.textContent).not.toContain('**');
    expect(container.querySelector('[data-testid="stream-caret"]')).toBeNull();
  });
});
