/* Hard-flag invariants (CLAUDE.md 1 & 4 / specs/05). The flag is the product's
 * core trust signal: severity drives an amber/red treatment, never grey/muted,
 * and the flag is structurally un-dismissible. */
import { render, screen } from '@testing-library/react';
import { HardFlag, InlineHardFlag } from '@/components/recommendation/HardFlag';
import { moderateFlag, severeFlag } from './fixtures';

describe('HardFlag (bar)', () => {
  it('moderate renders the amber treatment (TriangleAlert + --amber tokens)', () => {
    const { container } = render(<HardFlag {...moderateFlag} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-severity', 'moderate');
    // amber background token is applied inline, never a grey/muted colour.
    expect(alert).toHaveStyle({ background: 'var(--amber-bg)' });
    // TriangleAlert => lucide adds the icon class.
    expect(container.querySelector('.lucide-triangle-alert')).toBeInTheDocument();
    expect(container.querySelector('.lucide-octagon-alert')).not.toBeInTheDocument();
    expect(screen.getByText(moderateFlag.category)).toBeInTheDocument();
  });

  it('severe renders the red treatment (OctagonAlert + --red tokens)', () => {
    const { container } = render(<HardFlag {...severeFlag} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-severity', 'severe');
    expect(alert).toHaveStyle({ background: 'var(--red-bg)' });
    expect(container.querySelector('.lucide-octagon-alert')).toBeInTheDocument();
    expect(container.querySelector('.lucide-triangle-alert')).not.toBeInTheDocument();
  });

  it('always shows the review source line', () => {
    render(<HardFlag {...moderateFlag} />);
    expect(screen.getByText(/Based on recent guest reviews/i)).toBeInTheDocument();
  });

  it('exposes NO dismiss / collapse control', () => {
    render(<HardFlag {...severeFlag} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('InlineHardFlag (chat message)', () => {
  it('severe uses the red palette and the "Avoid" badge', () => {
    const { container } = render(<InlineHardFlag {...severeFlag} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-severity', 'severe');
    expect(container.querySelector('.lucide-octagon-alert')).toBeInTheDocument();
    expect(screen.getByText(/Avoid for your dates/i)).toBeInTheDocument();
  });

  it('moderate shows the evidence-count pill when provided', () => {
    const { container } = render(
      <InlineHardFlag
        category={moderateFlag.category}
        description={moderateFlag.description}
        severity={moderateFlag.severity}
        evidenceCount={moderateFlag.review_evidence_count}
      />,
    );
    const pill = Array.from(container.querySelectorAll('span')).find(
      (el) =>
        (el.textContent ?? '').includes('41') &&
        (el.textContent ?? '').includes('last 3 months'),
    );
    expect(pill).toBeDefined();
  });

  it('is also un-dismissible (no buttons)', () => {
    render(<InlineHardFlag {...severeFlag} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
