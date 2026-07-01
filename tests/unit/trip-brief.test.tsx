/* TripBrief rail invariants: all six rows render; pending vs filled (placeholder
 * + check); the n/6 meter + progressbar aria; the "Find hotels" gate (disabled
 * until destination + trip type are both filled, then clickable); pref chips. */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TripBrief } from '@/components/brief';
import { EMPTY_BRIEF, type TripBriefState } from '@/lib/brief/types';

function makeBrief(overrides: Partial<TripBriefState> = {}): TripBriefState {
  return { ...EMPTY_BRIEF, prefs: [], ...overrides };
}

describe('TripBrief', () => {
  it('renders all six field rows by label', () => {
    render(<TripBrief brief={makeBrief()} />);
    expect(screen.getByText('Destination')).toBeInTheDocument();
    expect(screen.getByText('When')).toBeInTheDocument();
    expect(screen.getByText('Trip type')).toBeInTheDocument();
    expect(screen.getByText("Who's travelling")).toBeInTheDocument();
    expect(screen.getByText('Budget')).toBeInTheDocument();
    expect(screen.getByText('Food')).toBeInTheDocument();
  });

  it('a pending field shows its placeholder and no check', () => {
    const { container } = render(<TripBrief brief={makeBrief()} />);
    // every row is pending → no check icons anywhere
    expect(container.querySelector('.lucide-check')).not.toBeInTheDocument();
    // placeholder text visible for the pending destination
    expect(screen.getByText('Where to?')).toBeInTheDocument();
  });

  it('a filled field shows its value AND a check', () => {
    const { container } = render(
      <TripBrief brief={makeBrief({ destination: 'Phuket, Thailand' })} />,
    );
    const value = screen.getByText('Phuket, Thailand');
    expect(value).toBeInTheDocument();
    // placeholder gone for that field
    expect(screen.queryByText('Where to?')).not.toBeInTheDocument();
    // exactly one filled row → exactly one check icon
    const checks = container.querySelectorAll('.lucide-check');
    expect(checks).toHaveLength(1);
    // and it lives in the destination row, alongside the value + success styling
    const row = value.closest('div')!.parentElement as HTMLElement;
    expect(within(row).getByText('Phuket, Thailand')).toBeInTheDocument();
    expect(row.querySelector('.lucide-check')).toBeInTheDocument();
    expect(row.querySelector('.bg-success')).toBeInTheDocument();
  });

  it('shows "n / 6" and a matching progressbar for a partial brief', () => {
    render(
      <TripBrief
        brief={makeBrief({ destination: 'Phuket', dates: 'July', type: 'Beach' })}
      />,
    );
    expect(screen.getByText('3 / 6')).toBeInTheDocument();
    const meter = screen.getByRole('progressbar');
    expect(meter).toHaveAttribute('aria-valuenow', '3');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '6');
  });

  it('disables "Find hotels" when only some gates are filled', () => {
    render(<TripBrief brief={makeBrief({ destination: 'Phuket' })} />);
    expect(screen.getByRole('button', { name: /find hotels/i })).toBeDisabled();
  });

  it('disables "Find hotels" when destination + type are set but dates/who are missing', () => {
    render(<TripBrief brief={makeBrief({ destination: 'Phuket', type: 'Beach getaway' })} />);
    expect(screen.getByRole('button', { name: /find hotels/i })).toBeDisabled();
  });

  it('enables "Find hotels" and fires onFindHotels once all four gates are filled', async () => {
    const user = userEvent.setup();
    const onFindHotels = jest.fn();
    render(
      <TripBrief
        brief={makeBrief({
          destination: 'Phuket',
          type: 'Beach getaway',
          dates: 'Mid-July, one week',
          who: 'Two adults, two kids',
        })}
        onFindHotels={onFindHotels}
      />,
    );
    const button = screen.getByRole('button', { name: /find hotels/i });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onFindHotels).toHaveBeenCalledTimes(1);
  });

  it('renders preference chips when prefs is non-empty', () => {
    render(
      <TripBrief
        brief={makeBrief({
          prefs: [
            { id: 'p1', label: 'Quiet pools' },
            { id: 'p2', label: 'Connecting rooms' },
          ],
        })}
      />,
    );
    expect(screen.getByText('Personal preferences')).toBeInTheDocument();
    expect(screen.getByText('Quiet pools')).toBeInTheDocument();
    expect(screen.getByText('Connecting rooms')).toBeInTheDocument();
  });

  it('omits the preferences section when prefs is empty', () => {
    render(<TripBrief brief={makeBrief()} />);
    expect(screen.queryByText('Personal preferences')).not.toBeInTheDocument();
  });
});
