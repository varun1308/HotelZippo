/* Phase 7 · Slice B — ShortlistableRecommendationSet wires each card's "Proceed to book" to
 * BookingContext.proceed with the card's hotel identity (id + name + destination). Also
 * proves it degrades to an inert no-op outside a BookingProvider. */
import { render, screen, fireEvent } from '@testing-library/react';
import { ShortlistableRecommendationSet } from '@/components/recommendation/ShortlistableRecommendationSet';
import { BookingProvider } from '@/lib/booking/context';
import type { RecommendationSetProps } from '@/components/recommendation/types';

function setProps(): RecommendationSetProps {
  return {
    topPick: {
      hotelId: 'H-top',
      hotelName: 'The Family Beach Resort',
      destination: 'Phuket',
      area: 'Karon',
      priceTierLabel: 'Luxury',
      starRating: 5,
      heroImageUrl: null,
      hardFlags: [],
      brandNote: null,
      verdict: 'A calm, family-first base.',
      categorySummaries: { rooms: 'r', facilities: 'f', food: 'd', location: 'l' },
    },
    otherPicks: [
      {
        hotelId: 'H-alt',
        hotelName: 'Karon Quiet Stay',
        destination: 'Phuket',
        area: null,
        priceTierLabel: 'Comfort',
        starRating: 4,
        heroImageUrl: null,
        hardFlags: [],
        brandNote: null,
        summary: 'A quieter alternative.',
      },
    ],
  };
}

describe('ShortlistableRecommendationSet booking wiring', () => {
  it('fires booking.proceed with the top pick identity', () => {
    const proceed = jest.fn();
    render(
      <BookingProvider actions={{ proceed }}>
        <ShortlistableRecommendationSet {...setProps()} />
      </BookingProvider>,
    );
    // The top-pick card renders the "Proceed to book" CTA.
    const buttons = screen.getAllByRole('button', { name: /proceed to book/i });
    fireEvent.click(buttons[0]);
    expect(proceed).toHaveBeenCalledWith({ hotelId: 'H-top', hotelName: 'The Family Beach Resort', destination: 'Phuket' });
  });

  it('degrades to a no-op with no provider (does not throw)', () => {
    render(<ShortlistableRecommendationSet {...setProps()} />);
    const buttons = screen.getAllByRole('button', { name: /proceed to book/i });
    expect(() => fireEvent.click(buttons[0])).not.toThrow();
  });
});
