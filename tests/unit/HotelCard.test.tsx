/* Card invariants: Top Pick distinctness, flags above the fold in every state,
 * graceful degradation of nullable display metadata, and the collapse toggle. */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TopPickCard, StandardCard } from '@/components/recommendation/HotelCard';
import {
  topPick,
  standardPick,
  moderateFlag,
  severeFlag,
} from './fixtures';

describe('TopPickCard', () => {
  it('is visually unmistakable: Award "Top Pick" badge + primary-200 border + shadow-lg', () => {
    const { container } = render(<TopPickCard {...topPick} />);
    expect(screen.getByText('Top Pick')).toBeInTheDocument();
    expect(container.querySelector('.lucide-award')).toBeInTheDocument();
    const article = container.querySelector('article')!;
    expect(article).toHaveClass('border-primary-200');
    expect(article).toHaveClass('shadow-lg');
    expect(article).toHaveClass('rounded-card');
  });

  it('renders EVERY hard flag, above the body, before any positive content', () => {
    const flags = [severeFlag, moderateFlag];
    const { container } = render(<TopPickCard {...topPick} hardFlags={flags} />);
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(flags.length);

    // The flag bars must appear in the DOM before the verdict ("Why this one").
    const html = container.innerHTML;
    expect(html.indexOf('data-severity')).toBeLessThan(html.indexOf('Why this one'));
  });

  it('renders even when there are zero flags (no crash, no alert)', () => {
    render(<TopPickCard {...topPick} hardFlags={[]} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Top Pick')).toBeInTheDocument();
  });

  it('null brand_note hides the loyalty pill', () => {
    render(<TopPickCard {...topPick} brandNote={null} />);
    expect(screen.queryByText('Marriott Bonvoy')).not.toBeInTheDocument();
  });

  it('null hero image renders the .photo-slot placeholder, never a broken <img>', () => {
    const { container } = render(<TopPickCard {...topPick} heroImageUrl={null} />);
    expect(container.querySelector('.photo-slot')).toBeInTheDocument();
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  it('null star_rating hides the stars; null area shows destination only', () => {
    render(<TopPickCard {...topPick} starRating={null} area={null} />);
    expect(screen.queryByLabelText(/star hotel/i)).not.toBeInTheDocument();
    // area null => "Phuket" alone, not "Mai Khao Beach, Phuket".
    expect(screen.getByText('Phuket')).toBeInTheDocument();
    expect(screen.queryByText(/Mai Khao Beach, Phuket/)).not.toBeInTheDocument();
  });

  it('shows a neutral Preview badge only when isPreview (12i)', () => {
    const { rerender } = render(<TopPickCard {...topPick} />);
    expect(screen.queryByText('Preview')).not.toBeInTheDocument();
    rerender(<TopPickCard {...topPick} isPreview />);
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });
});

describe('StandardCard', () => {
  it('has NO Award/"Top Pick" badge (distinct from the hero card)', () => {
    const { container } = render(<StandardCard {...standardPick} />);
    expect(screen.queryByText('Top Pick')).not.toBeInTheDocument();
    expect(container.querySelector('.lucide-award')).not.toBeInTheDocument();
  });

  it('shows hard flags while COLLAPSED — before "See full details" is clicked', () => {
    render(<StandardCard {...standardPick} />);
    // collapsed by default
    expect(screen.getByRole('button', { name: /see full details/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-severity', 'severe');
    expect(within(alert).getByText(severeFlag.category)).toBeInTheDocument();
  });

  it('keeps hard flags visible after expanding', async () => {
    const user = userEvent.setup();
    render(<StandardCard {...standardPick} />);
    await user.click(screen.getByRole('button', { name: /see full details/i }));
    expect(screen.getByRole('button', { name: /show less/i })).toBeInTheDocument();
    // flag still present in expanded state
    expect(screen.getByRole('alert')).toHaveAttribute('data-severity', 'severe');
  });

  it('toggles open/closed and reveals the category grid (aria-expanded flips)', async () => {
    const user = userEvent.setup();
    render(<StandardCard {...standardPick} />);
    expect(screen.queryByText('Rooms')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /see full details/i }));
    expect(screen.getByText('Rooms')).toBeInTheDocument();
    expect(screen.getByText('Location')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /show less/i }));
    expect(screen.queryByText('Rooms')).not.toBeInTheDocument();
  });

  it('null hero image => placeholder, not an <img>', () => {
    const { container } = render(<StandardCard {...standardPick} heroImageUrl={null} />);
    expect(container.querySelector('.photo-slot')).toBeInTheDocument();
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  // Contract fidelity: assembly `other_picks[]` carries ONLY `summary` (no verdict /
  // category_summaries). Such a card must NOT offer "See full details" — but its hard
  // flags must still render, above the fold, undismissable.
  it('summary-only (no verdict/categories) => no expand affordance, flags still shown', () => {
    const summaryOnly = {
      ...standardPick,
      verdict: undefined,
      categorySummaries: undefined,
      hardFlags: [severeFlag],
    };
    render(<StandardCard {...summaryOnly} />);
    expect(screen.queryByRole('button', { name: /see full details/i })).not.toBeInTheDocument();
    // summary visible, flag visible, save + proceed actions present.
    expect(screen.getByText(/solid family option/i)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /proceed to book/i })).toBeInTheDocument();
  });
});
