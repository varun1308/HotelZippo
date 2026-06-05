/* AccountMenu contract (Phase 4 · Slice 3): the trigger shows the user's name; the
 * menu opens on click revealing email + Edit profile + Sign out; selecting an item
 * fires the right callback; and a broken avatar URL falls back without rendering a
 * broken image (the never-broken-image rule). */
import { render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { AccountMenu } from '@/components/account';

const USER = {
  name: 'Raj Mehta',
  email: 'raj@example.com',
  avatarUrl: null as string | null,
};

function setup(overrides?: Partial<Parameters<typeof AccountMenu>[0]>) {
  const onEditProfile = jest.fn();
  const onSignOut = jest.fn();
  render(
    <AccountMenu
      user={USER}
      onEditProfile={onEditProfile}
      onSignOut={onSignOut}
      {...overrides}
    />,
  );
  return { onEditProfile, onSignOut };
}

const trigger = () => screen.getByRole('button', { name: /account menu/i });

describe('AccountMenu', () => {
  it('renders the trigger with the user name', () => {
    setup();
    expect(trigger()).toBeInTheDocument();
    expect(screen.getByText('Raj Mehta')).toBeInTheDocument();
  });

  it('is closed initially and opens on click revealing email + items', async () => {
    const user = userEvent.setup();
    setup();

    // Closed: no menu, trigger not expanded.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger());

    const menu = screen.getByRole('menu');
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(within(menu).getByText('raj@example.com')).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: /edit profile/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument();
  });

  it('calls onEditProfile when Edit profile is selected (and closes)', async () => {
    const user = userEvent.setup();
    const { onEditProfile, onSignOut } = setup();

    await user.click(trigger());
    await user.click(screen.getByRole('menuitem', { name: /edit profile/i }));

    expect(onEditProfile).toHaveBeenCalledTimes(1);
    expect(onSignOut).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('calls onSignOut when Sign out is selected', async () => {
    const user = userEvent.setup();
    const { onEditProfile, onSignOut } = setup();

    await user.click(trigger());
    await user.click(screen.getByRole('menuitem', { name: /sign out/i }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(onEditProfile).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(trigger());
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('falls back to initials when the avatar image errors (never a broken image)', async () => {
    const user = userEvent.setup();
    setup({ user: { ...USER, avatarUrl: 'https://example.com/broken.jpg' } });

    // Image renders first.
    const img = document.querySelector('img') as HTMLImageElement | null;
    expect(img).not.toBeNull();

    // Simulate a load failure → the component must drop the img and show the fallback.
    fireEvent.error(img!);

    expect(document.querySelector('img')).toBeNull();
    // Fallback initials are derived from the name "Raj Mehta" → "RM".
    expect(screen.getAllByText('RM').length).toBeGreaterThan(0);

    // The menu still works after the fallback.
    await user.click(trigger());
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});
