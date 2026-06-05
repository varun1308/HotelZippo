/* Phase 3d — shortlist state (useShortlist) + ShortlistPanel. */
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderHook } from '@testing-library/react';
import { useShortlist } from '@/lib/shortlist/useShortlist';
import { ShortlistPanel } from '@/components/shortlist';
import type { SavedHotel } from '@/lib/shortlist/types';

const HOTEL_A: SavedHotel = {
  hotelId: 'a',
  hotelName: 'Anantara Mai Khao',
  destination: 'Phuket',
  area: 'Mai Khao Beach',
  priceTierLabel: 'Luxury',
  heroImageUrl: null,
};
const HOTEL_B: SavedHotel = {
  hotelId: 'b',
  hotelName: 'Komaneka Bisma',
  destination: 'Bali',
  area: null,
  priceTierLabel: 'Comfort',
  heroImageUrl: 'https://cdn.test/komaneka.jpg',
};

describe('useShortlist', () => {
  it('saves, de-dupes on hotelId, removes, and reports count/isSaved', () => {
    const { result } = renderHook(() => useShortlist());
    expect(result.current.count).toBe(0);
    expect(result.current.isSaved('a')).toBe(false);

    act(() => result.current.save(HOTEL_A));
    act(() => result.current.save(HOTEL_A)); // duplicate — ignored
    expect(result.current.count).toBe(1);
    expect(result.current.isSaved('a')).toBe(true);

    act(() => result.current.save(HOTEL_B));
    expect(result.current.count).toBe(2);

    act(() => result.current.remove('a'));
    expect(result.current.count).toBe(1);
    expect(result.current.isSaved('a')).toBe(false);
  });

  it('toggle adds then removes the same hotel', () => {
    const { result } = renderHook(() => useShortlist());
    act(() => result.current.toggle(HOTEL_A));
    expect(result.current.isSaved('a')).toBe(true);
    act(() => result.current.toggle(HOTEL_A));
    expect(result.current.isSaved('a')).toBe(false);
  });
});

describe('ShortlistPanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ShortlistPanel open={false} items={[]} onRemove={() => {}} onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the empty state with a back action when open and empty', () => {
    render(<ShortlistPanel open items={[]} onRemove={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/nothing saved yet/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /saved shortlist/i })).toBeInTheDocument();
  });

  it('uses the elevated panel treatment (shadow-panel + slide-in)', () => {
    render(<ShortlistPanel open items={[]} onRemove={() => {}} onClose={() => {}} />);
    const panel = screen.getByRole('dialog', { name: /saved shortlist/i });
    expect(panel.className).toContain('shadow-panel');
    expect(panel.className).toContain('animate-panel-in');
  });

  it('lists saved hotels and fires onRemove', async () => {
    const user = userEvent.setup();
    const onRemove = jest.fn();
    render(
      <ShortlistPanel open items={[HOTEL_A, HOTEL_B]} onRemove={onRemove} onClose={() => {}} />,
    );
    expect(screen.getByText('Anantara Mai Khao')).toBeInTheDocument();
    expect(screen.getByText('Komaneka Bisma')).toBeInTheDocument();
    // area + destination joined when area present; destination only otherwise
    expect(screen.getByText('Mai Khao Beach, Phuket')).toBeInTheDocument();
    expect(screen.getByText('Bali')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /remove anantara mai khao/i }));
    expect(onRemove).toHaveBeenCalledWith('a');
  });

  it('renders a placeholder (no broken img) when a hotel has no hero image', () => {
    const { container } = render(
      <ShortlistPanel open items={[HOTEL_A]} onRemove={() => {}} onClose={() => {}} />,
    );
    // HOTEL_A has no image → no <img> for it; HOTEL_B (with image) is not in this set.
    expect(container.querySelector('img')).toBeNull();
  });

  it('fires onClose from the close button and the scrim', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<ShortlistPanel open items={[]} onRemove={() => {}} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /close shortlist/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
