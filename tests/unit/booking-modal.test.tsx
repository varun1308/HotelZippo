/* Phase 7 · Slice B — RoomPickerModal presentational behaviour: each step renders, the
 * confirm gate, room selection, and the warm error fallback. Token discipline (no amber/red)
 * is enforced structurally in the component; here we test behaviour + a11y affordances. */
import { render, screen, fireEvent } from '@testing-library/react';
import { RoomPickerModal, type RoomPickerModalProps } from '@/components/booking/RoomPickerModal';
import type { RoomRateOption } from '@/lib/booking/types';

const OPTION: RoomRateOption = {
  recommendationId: 'reco-A',
  roomId: 'room-A',
  roomName: 'Deluxe Twin',
  price: 482.5,
  currency: 'USD',
  board: 'Breakfast included',
  bed: '2 Twin',
  maxOccupancy: 3,
  freeCancellation: true,
};

/** Future dates relative to "now" (LOCAL, matching the component) so the date-sanity gate
 * (checkIn >= today, checkOut > checkIn) always sees valid defaults — fixed dates would rot. */
function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const FUTURE_DATES = { checkIn: isoDaysFromNow(30), checkOut: isoDaysFromNow(34) };

function props(over: Partial<RoomPickerModalProps> = {}): RoomPickerModalProps {
  return {
    open: true,
    step: 'confirm',
    hotelName: 'The Family Beach Resort',
    party: { adults: 2, childAges: [2, 7], rooms: 2 },
    grandparentHint: false,
    dates: FUTURE_DATES,
    onPartyChange: jest.fn(),
    onDatesChange: jest.fn(),
    onConfirm: jest.fn(),
    options: [OPTION],
    onSelectRoom: jest.fn(),
    error: null,
    onRetry: jest.fn(),
    onClose: jest.fn(),
    ...over,
  };
}

describe('RoomPickerModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<RoomPickerModal {...props({ open: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is a labelled dialog naming the hotel', () => {
    render(<RoomPickerModal {...props()} />);
    expect(screen.getByRole('dialog', { name: /Book The Family Beach Resort/i })).toBeInTheDocument();
    expect(screen.getByText(/Booking The Family Beach Resort/i)).toBeInTheDocument();
  });

  it('confirm: Continue enabled with valid dates fires onConfirm', () => {
    const onConfirm = jest.fn();
    render(<RoomPickerModal {...props({ onConfirm })} />);
    const btn = screen.getByRole('button', { name: 'Continue' });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalled();
  });

  it('confirm: Continue disabled until dates are set (month-only path)', () => {
    render(<RoomPickerModal {...props({ dates: null })} />);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    // Date inputs are shown to collect them.
    expect(screen.getByLabelText('Check-in date')).toBeInTheDocument();
    expect(screen.getByLabelText('Check-out date')).toBeInTheDocument();
  });

  it('confirm: a PAST check-in blocks Continue with inline error copy (L33a)', () => {
    // Past dates must never reach the paid live call — they'd surface as a generic failure.
    render(<RoomPickerModal {...props({ dates: { checkIn: isoDaysFromNow(-2), checkOut: isoDaysFromNow(2) } })} />);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.getByText(/check-in can’t be in the past/i)).toBeInTheDocument();
    // The inputs open for correction instead of the collapsed summary row.
    expect(screen.getByLabelText('Check-in date')).toBeInTheDocument();
  });

  it('confirm: check-out on/before check-in blocks Continue with inline error copy (L33a)', () => {
    render(<RoomPickerModal {...props({ dates: { checkIn: isoDaysFromNow(30), checkOut: isoDaysFromNow(30) } })} />);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.getByText(/check-out needs to be after check-in/i)).toBeInTheDocument();

    // …and an inverted range too.
    render(<RoomPickerModal {...props({ dates: { checkIn: isoDaysFromNow(30), checkOut: isoDaysFromNow(28) } })} />);
    expect(screen.getAllByText(/check-out needs to be after check-in/i).length).toBeGreaterThan(0);
  });

  it('confirm: today as check-in is VALID (boundary)', () => {
    render(<RoomPickerModal {...props({ dates: { checkIn: isoDaysFromNow(0), checkOut: isoDaysFromNow(1) } })} />);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('confirm: grandparent hint nudge shows only when hinted', () => {
    const { rerender } = render(<RoomPickerModal {...props({ grandparentHint: false })} />);
    expect(screen.queryByText(/grandparents/i)).not.toBeInTheDocument();
    rerender(<RoomPickerModal {...props({ grandparentHint: true })} />);
    expect(screen.getByText(/grandparents/i)).toBeInTheDocument();
  });

  it('confirm: stepping adults calls onPartyChange', () => {
    const onPartyChange = jest.fn();
    render(<RoomPickerModal {...props({ onPartyChange })} />);
    fireEvent.click(screen.getByRole('button', { name: /increase adults/i }));
    expect(onPartyChange).toHaveBeenCalledWith(expect.objectContaining({ adults: 3 }));
  });

  it('picking: renders room detail (name/price/board/bed/occupancy) and selects', () => {
    const onSelectRoom = jest.fn();
    render(<RoomPickerModal {...props({ step: 'picking', onSelectRoom })} />);
    expect(screen.getByText('Deluxe Twin')).toBeInTheDocument();
    expect(screen.getByText(/482\.50 USD/)).toBeInTheDocument();
    expect(screen.getByText('Breakfast included')).toBeInTheDocument();
    expect(screen.getByText('2 Twin')).toBeInTheDocument();
    expect(screen.getByText(/Sleeps 3/)).toBeInTheDocument();
    expect(screen.getByText('Free cancellation')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Deluxe Twin').closest('button')!);
    expect(onSelectRoom).toHaveBeenCalledWith(OPTION);
  });

  it('picking: omits absent fields gracefully and shows price fallback', () => {
    render(<RoomPickerModal {...props({ step: 'picking', options: [{ recommendationId: 'r', roomId: 'm' }] })} />);
    expect(screen.getByText('Room')).toBeInTheDocument(); // name fallback
    expect(screen.getByText('Price on request')).toBeInTheDocument();
  });

  it('searching + finalizing render calm loading status', () => {
    const { rerender } = render(<RoomPickerModal {...props({ step: 'searching' })} />);
    expect(screen.getByRole('status')).toHaveTextContent(/checking live availability/i);
    rerender(<RoomPickerModal {...props({ step: 'finalizing' })} />);
    expect(screen.getByRole('status')).toHaveTextContent(/secure checkout/i);
  });

  it('error: shows the warm message + Try again / Close, never the raw kind', () => {
    const onRetry = jest.fn();
    const onClose = jest.fn();
    render(
      <RoomPickerModal
        {...props({ step: 'error', error: { kind: 'offer-expired', message: 'That rate just expired — let’s look again.' }, onRetry, onClose })}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/that rate just expired/i);
    expect(screen.queryByText(/offer-expired/)).not.toBeInTheDocument(); // never the raw kind
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('Escape and scrim click close the modal', () => {
    const onClose = jest.fn();
    render(<RoomPickerModal {...props({ onClose })} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /close booking/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
