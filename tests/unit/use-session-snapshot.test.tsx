/* Phase 5: the trigger hook fires a snapshot save at session-end / navigation-away
 * (tab hidden, pagehide). Asserts it POSTs the conversation to /api/session/snapshot via
 * sendBeacon when the tab is hidden, skips when there's no conversation, and no-ops when
 * disabled (not signed in). The inactivity timer (30 min) is config, exercised lightly. */
import { renderHook } from '@testing-library/react';
import { useSessionSnapshot, INACTIVITY_MS } from '@/lib/chat/useSessionSnapshot';
import type { ChatMessage } from '@/lib/chat/types';

const msg = (text: string): ChatMessage => ({
  id: 'm1',
  role: 'user',
  parts: [{ type: 'text', text }],
});

function hideTab() {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}
function showTab() {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
}

describe('useSessionSnapshot', () => {
  let beacon: jest.Mock;
  beforeEach(() => {
    showTab();
    beacon = jest.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
  });

  it('beacons the conversation when the tab is hidden (session end)', () => {
    renderHook(() =>
      useSessionSnapshot({ getMessages: () => [msg('Phuket in December')], enabled: true }),
    );
    hideTab();
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0];
    expect(url).toBe('/api/session/snapshot');
    expect(blob).toBeInstanceOf(Blob);
  });

  it('does not fire when there is no conversation', () => {
    renderHook(() => useSessionSnapshot({ getMessages: () => [], enabled: true }));
    hideTab();
    expect(beacon).not.toHaveBeenCalled();
  });

  it('does not fire when disabled (not signed in)', () => {
    renderHook(() =>
      useSessionSnapshot({ getMessages: () => [msg('hi')], enabled: false }),
    );
    hideTab();
    expect(beacon).not.toHaveBeenCalled();
  });

  it('reads the LATEST messages at trigger time (not at mount)', () => {
    let convo: ChatMessage[] = [];
    renderHook(() => useSessionSnapshot({ getMessages: () => convo, enabled: true }));
    // Conversation grows after mount; the hook must read it fresh on the trigger.
    convo = [msg('added later')];
    hideTab();
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it('exposes the 30-minute inactivity window', () => {
    expect(INACTIVITY_MS).toBe(30 * 60 * 1000);
  });
});
