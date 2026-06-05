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
