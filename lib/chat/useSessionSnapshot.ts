/* useSessionSnapshot — fires a session-snapshot save at the trigger points (Phase 5 ·
 * specs/08b-3-session-snapshot.md): session end / navigation away (tab hidden, pagehide)
 * and 30-min inactivity. Best-effort + idempotent-ish: it POSTs the current conversation
 * to /api/session/snapshot, which generates + persists the snapshot server-side.
 *
 * Unload-time saves use navigator.sendBeacon so the request isn't cancelled as the page
 * goes away; the inactivity timer uses a normal fetch (keepalive) while the page is alive.
 * Only fires when there's actually a conversation to snapshot and the user is signed in
 * (the route no-ops otherwise). */
'use client';

import { useEffect, useRef } from 'react';
import type { ChatMessage } from './types';

/** 30 minutes of inactivity → snapshot (the contract's inactivity trigger). */
export const INACTIVITY_MS = 30 * 60 * 1000;

const ENDPOINT = '/api/session/snapshot';

export interface UseSessionSnapshotArgs {
  /** Returns the current conversation. Called at trigger time, so it always reads latest. */
  getMessages: () => ChatMessage[];
  /** Only snapshot for a signed-in user (the route also guards, this avoids dead calls). */
  enabled: boolean;
}

export function useSessionSnapshot({ getMessages, enabled }: UseSessionSnapshotArgs): void {
  const getRef = useRef(getMessages);
  getRef.current = getMessages;

  useEffect(() => {
    if (!enabled) return;

    const payload = (): string | null => {
      const messages = getRef.current();
      if (!messages || messages.length === 0) return null;
      return JSON.stringify({ messages });
    };

    // Alive-page save (inactivity): a keepalive fetch, response ignored.
    const saveViaFetch = () => {
      const body = payload();
      if (!body) return;
      void fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {
        /* background save — never disrupt the UX */
      });
    };

    // Unload-time save (tab hidden / pagehide): sendBeacon survives the page going away.
    const saveViaBeacon = () => {
      const body = payload();
      if (!body) return;
      try {
        const blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, blob);
        else saveViaFetch();
      } catch {
        /* ignore */
      }
    };

    // ---- inactivity timer (resets on user activity) ----
    let timer: ReturnType<typeof setTimeout> | undefined;
    const resetIdle = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(saveViaFetch, INACTIVITY_MS);
    };
    const activityEvents = ['keydown', 'pointerdown', 'mousemove', 'scroll'] as const;
    activityEvents.forEach((e) => window.addEventListener(e, resetIdle, { passive: true }));
    resetIdle();

    // ---- session end / navigation away ----
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') saveViaBeacon();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', saveViaBeacon);

    return () => {
      if (timer) clearTimeout(timer);
      activityEvents.forEach((e) => window.removeEventListener(e, resetIdle));
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', saveViaBeacon);
    };
  }, [enabled]);
}
