/* ProfileUpdatedChip — the quiet inline confirmation chip (agent profile persistence).
 * Neutral palette only: it must NOT use the reserved hard-flag amber/red tokens. */
import { render, screen } from '@testing-library/react';
import { ProfileUpdatedChip } from '@/components/chat/ProfileUpdatedChip';

describe('ProfileUpdatedChip', () => {
  it('renders the confirmation label and the changed-field labels', () => {
    render(<ProfileUpdatedChip updated={['budget', 'food preference']} />);
    expect(screen.getByText(/Family profile updated/i)).toBeInTheDocument();
    expect(screen.getByText(/budget, food preference/)).toBeInTheDocument();
  });

  it('exposes a polite status role (non-disruptive)', () => {
    render(<ProfileUpdatedChip updated={['budget']} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders nothing when there are no changed fields', () => {
    const { container } = render(<ProfileUpdatedChip updated={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('uses the neutral success palette, never the reserved hard-flag amber/red', () => {
    const { container } = render(<ProfileUpdatedChip updated={['budget']} />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/flag-amber|flag-red/);
    expect(html).toMatch(/success/);
  });
});
