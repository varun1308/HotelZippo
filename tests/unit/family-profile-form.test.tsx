/* FamilyProfileForm contract: required-name validation, the food-toggle collapse
 * (vegan implies vegetarian → food:'vegan'), child-row add/drop, budget default +
 * selection, brand multi-select with the "No preference" sentinel, and the back
 * escape hatch. Tests validate the OUTPUT CONTRACT handed to onSubmit, not prose. */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FamilyProfileForm } from '@/components/profile';
import type { FamilyProfile } from '@/components/profile';

function setup(overrides?: Partial<Parameters<typeof FamilyProfileForm>[0]>) {
  const onSubmit = jest.fn();
  const onBack = jest.fn();
  render(<FamilyProfileForm onSubmit={onSubmit} onBack={onBack} {...overrides} />);
  return { onSubmit, onBack };
}

const save = () => screen.getByRole('button', { name: /save profile/i });

describe('FamilyProfileForm — validation', () => {
  it('does NOT submit with an empty name and shows the error', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.click(save());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Please add your name')).toBeInTheDocument();
    expect(screen.getByLabelText(/your name/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('clears the error and submits once the name is filled', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.click(save());
    expect(screen.getByText('Please add your name')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/your name/i), 'Varun');
    expect(screen.queryByText('Please add your name')).not.toBeInTheDocument();

    await user.click(save());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const profile = onSubmit.mock.calls[0][0] as FamilyProfile;
    expect(profile.name).toBe('Varun');
    expect(profile.budgetTier).toBe('comfort'); // default pre-selection
  });
});

describe('FamilyProfileForm — children', () => {
  it('adds a row; a filled child is included and an empty-name row is dropped', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.type(screen.getByLabelText(/your name/i), 'Varun');

    // first child — fully filled
    await user.click(screen.getByRole('button', { name: /add a child/i }));
    // second child — empty name, should be dropped
    await user.click(screen.getByRole('button', { name: /add a child/i }));

    const names = screen.getAllByRole('textbox', { name: /^child$/i });
    const ages = screen.getAllByRole('spinbutton', { name: /^age$/i });
    expect(names).toHaveLength(2);

    await user.type(names[0], 'Aanya');
    await user.type(ages[0], '2');
    // leave second row name empty, give it an age — still dropped (no name)
    await user.type(ages[1], '7');

    await user.click(save());

    const profile = onSubmit.mock.calls[0][0] as FamilyProfile;
    expect(profile.children).toEqual([{ name: 'Aanya', age: 2 }]);
  });
});

describe('FamilyProfileForm — food collapse', () => {
  it('toggling Vegan ON forces food:"vegan" (vegetarian implied)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.type(screen.getByLabelText(/your name/i), 'Varun');
    await user.click(screen.getByRole('switch', { name: /^vegan$/i }));

    expect(screen.getByRole('switch', { name: /^vegan$/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('switch', { name: /^vegetarian$/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await user.click(save());
    const profile = onSubmit.mock.calls[0][0] as FamilyProfile;
    expect(profile.food).toBe('vegan');
  });

  it('defaults to food:"none" when no diet toggles are on', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    await user.type(screen.getByLabelText(/your name/i), 'Varun');
    await user.click(save());
    expect((onSubmit.mock.calls[0][0] as FamilyProfile).food).toBe('none');
  });
});

describe('FamilyProfileForm — budget', () => {
  it('selecting Luxury yields budgetTier:"luxury"', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.type(screen.getByLabelText(/your name/i), 'Varun');
    await user.click(screen.getByRole('radio', { name: /luxury/i }));
    await user.click(save());

    expect((onSubmit.mock.calls[0][0] as FamilyProfile).budgetTier).toBe('luxury');
  });
});

describe('FamilyProfileForm — loyalty programmes', () => {
  it('selecting a brand sets it; then "No preference" clears it', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.type(screen.getByLabelText(/your name/i), 'Varun');

    await user.click(screen.getByRole('checkbox', { name: /marriott bonvoy/i }));
    expect(
      screen.getByRole('checkbox', { name: /marriott bonvoy/i }),
    ).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('checkbox', { name: /no preference/i }));
    expect(
      screen.getByRole('checkbox', { name: /marriott bonvoy/i }),
    ).toHaveAttribute('aria-checked', 'false');

    await user.click(save());
    const profile = onSubmit.mock.calls[0][0] as FamilyProfile;
    expect(profile.brandPreferences).toEqual([]);
    expect(profile.brandPreferences).not.toContain('No preference');
  });

  it('a selected brand is present in brandPreferences output', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.type(screen.getByLabelText(/your name/i), 'Varun');
    await user.click(screen.getByRole('checkbox', { name: /marriott bonvoy/i }));
    await user.click(save());

    expect((onSubmit.mock.calls[0][0] as FamilyProfile).brandPreferences).toEqual([
      'Marriott Bonvoy',
    ]);
  });
});

describe('FamilyProfileForm — escape hatch', () => {
  it('"Back to chat" calls onBack', async () => {
    const user = userEvent.setup();
    const { onBack } = setup();
    await user.click(screen.getByRole('button', { name: /back to chat/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
