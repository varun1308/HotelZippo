import { render, screen } from '@testing-library/react';
import { RecommendationSet } from '@/components/recommendation/RecommendationSet';
import { HotelCardSkeleton } from '@/components/recommendation/HotelCardSkeleton';
import { topPick, standardPick } from './fixtures';

describe('RecommendationSet', () => {
  it('renders the top pick, the alternatives divider, and each standard card', () => {
    render(
      <RecommendationSet
        topPick={topPick}
        otherPicks={[standardPick, { ...standardPick, hotelName: 'Angsana Laguna Phuket' }]}
      />,
    );
    expect(screen.getByText('Top Pick')).toBeInTheDocument();
    expect(screen.getByText(/Two more worth a look/i)).toBeInTheDocument();
    expect(screen.getByText('Holiday Inn Resort Karon Beach')).toBeInTheDocument();
    expect(screen.getByText('Angsana Laguna Phuket')).toBeInTheDocument();
  });

  it('omits the divider when there are no alternatives', () => {
    render(<RecommendationSet topPick={topPick} otherPicks={[]} />);
    expect(screen.queryByText(/Two more worth a look/i)).not.toBeInTheDocument();
  });

  it('says "One more worth a look" when there is exactly one alternative', () => {
    render(<RecommendationSet topPick={topPick} otherPicks={[standardPick]} />);
    expect(screen.getByText(/One more worth a look/i)).toBeInTheDocument();
    expect(screen.queryByText(/Two more worth a look/i)).not.toBeInTheDocument();
  });

  it('honours an explicit altHeading override', () => {
    render(
      <RecommendationSet topPick={topPick} otherPicks={[standardPick]} altHeading="Also consider" />,
    );
    expect(screen.getByText('Also consider')).toBeInTheDocument();
  });
});

describe('HotelCardSkeleton', () => {
  it('renders a polite busy status with no crash', () => {
    const { container } = render(<HotelCardSkeleton />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    // shimmer blocks present (card-shaped proportions)
    expect(container.querySelectorAll('.hz-sk').length).toBeGreaterThan(5);
  });
});
