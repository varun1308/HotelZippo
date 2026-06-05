/* AccountMenu — the signed-in shell's account control (Phase 4 · Slice 3,
 * specs/04-auth-persistence.md Stage 5: "Signed-in shell: account menu — Google
 * avatar + name/email, Edit profile, Sign out").
 *
 * A compact ghost-button trigger for the ChatShell topbar (38px tall, matching the
 * GhostButton in components/chat/ChatShell.tsx) that opens a small anchored dropdown
 * menu with the user's name/email, an Edit-profile item, and a Sign-out item.
 *
 * Hard rules honoured here:
 *   • Never-broken-image: the Google avatar is an <img> that falls back to derived
 *     initials (or a User icon) on error — a broken image is never shown.
 *   • Tokens only — no raw hex; NO amber/red anywhere. Sign-out is a normal menu item,
 *     not a destructive-red one (amber/red are reserved exclusively for hard flags).
 *   • Every control is keyboard-operable with a focus-visible primary ring; the menu
 *     closes on outside click, Escape, and after selecting an item.
 */
'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { User, UserPen, LogOut, ChevronDown } from 'lucide-react';

export interface AccountMenuProps {
  user: { name: string | null; email: string | null; avatarUrl: string | null };
  onEditProfile: () => void;
  onSignOut: () => void | Promise<void>;
}

/** Derive up-to-two-letter initials from the name (preferred) or email local-part.
 * Returns null when nothing usable is present (caller then shows the User icon). */
function deriveInitials(name: string | null, email: string | null): string | null {
  const source = (name ?? '').trim() || (email ?? '').split('@')[0]?.trim() || '';
  if (source === '') return null;
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return null;
  const letters =
    words.length === 1
      ? words[0].slice(0, 2)
      : words[0][0] + words[words.length - 1][0];
  return letters.toUpperCase();
}

/** The small rounded-square avatar shown in both the trigger and the menu header.
 * Renders the Google image when available and not errored; otherwise initials, or
 * the User icon as a last resort. `onError` flips to the fallback so a broken image
 * is never displayed. */
function Avatar({
  avatarUrl,
  initials,
  size,
}: {
  avatarUrl: string | null;
  initials: string | null;
  size: 'sm' | 'md';
}) {
  const [errored, setErrored] = useState(false);
  const box = size === 'sm' ? 'h-[26px] w-[26px]' : 'h-9 w-9';
  const text = size === 'sm' ? 'text-[11px]' : 'text-[13px]';
  const icon = size === 'sm' ? 'h-[15px] w-[15px]' : 'h-[18px] w-[18px]';
  const showImg = avatarUrl != null && avatarUrl !== '' && !errored;

  return (
    <span
      aria-hidden
      className={[
        'grid flex-none place-items-center overflow-hidden rounded-[7px]',
        'bg-primary-50 text-primary-700',
        box,
      ].join(' ')}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element -- a real <img> with onError is required for the never-broken-image fallback; next/image cannot do this.
        <img
          src={avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setErrored(true)}
          className="h-full w-full object-cover"
        />
      ) : initials ? (
        <span className={['font-semibold leading-none', text].join(' ')}>{initials}</span>
      ) : (
        <User className={icon} strokeWidth={1.75} />
      )}
    </span>
  );
}

export function AccountMenu({ user, onEditProfile, onSignOut }: AccountMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const initials = deriveInitials(user.name, user.email);
  const displayName = (user.name ?? '').trim() || (user.email ?? '').trim() || 'Account';

  // Close on outside click + Escape while open. The listeners are only attached when
  // the menu is open so they don't fire needlessly on every page interaction.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function handleEdit() {
    setOpen(false);
    onEditProfile();
  }

  function handleSignOut() {
    setOpen(false);
    void onSignOut();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu for ${displayName}`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-[38px] items-center gap-2 rounded-btn border border-border bg-surface pl-[7px] pr-[10px] text-[14px] font-medium text-text shadow-xs transition-all duration-fast hover:border-border-strong hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary max-[600px]:pr-[7px]"
      >
        <Avatar avatarUrl={user.avatarUrl} initials={initials} size="sm" />
        <span className="max-w-[140px] truncate max-[600px]:hidden">{displayName}</span>
        <ChevronDown
          aria-hidden
          className={[
            'h-[15px] w-[15px] flex-none text-text-tertiary transition-transform duration-fast motion-reduce:transition-none',
            open ? 'rotate-180' : 'rotate-0',
            'max-[600px]:hidden',
          ].join(' ')}
          strokeWidth={1.75}
        />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-[calc(100%+8px)] z-30 w-[248px] overflow-hidden rounded-card border border-border bg-surface shadow-lg"
        >
          {/* identity header */}
          <div className="flex items-center gap-3 px-[14px] pb-[13px] pt-[14px]">
            <Avatar avatarUrl={user.avatarUrl} initials={initials} size="md" />
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold text-text">{displayName}</div>
              {user.email && (
                <div className="truncate text-[12.5px] text-text-tertiary">{user.email}</div>
              )}
            </div>
          </div>

          <div className="h-px bg-border" aria-hidden />

          {/* items */}
          <div className="p-[6px]">
            <button
              type="button"
              role="menuitem"
              onClick={handleEdit}
              className="flex w-full items-center gap-[10px] rounded-btn px-[10px] py-[9px] text-left text-[14px] font-medium text-text transition-colors duration-fast hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <UserPen aria-hidden className="h-[17px] w-[17px] flex-none text-text-secondary" strokeWidth={1.75} />
              Edit profile
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={handleSignOut}
              className="flex w-full items-center gap-[10px] rounded-btn px-[10px] py-[9px] text-left text-[14px] font-medium text-text transition-colors duration-fast hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <LogOut aria-hidden className="h-[17px] w-[17px] flex-none text-text-secondary" strokeWidth={1.75} />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
