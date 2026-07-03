/* ChatErrorBoundary — a warm error boundary around inline chat components (H7).
 *
 * Inline blocks (recommendation cards, flags, progress) render deep inside the
 * message stream; a single bad card (e.g. an image loader throwing) must never
 * take down the whole chat page. On error we render a warm, concierge-voice
 * fallback line (spec 14: never raw, always a next step) and the rest of the
 * conversation keeps working. */
'use client';

import { Component, type ReactNode } from 'react';

export interface ChatErrorBoundaryProps {
  children: ReactNode;
  /** Override the fallback copy (defaults to the warm card-level miss). */
  fallback?: ReactNode;
}

interface State {
  failed: boolean;
}

export class ChatErrorBoundary extends Component<ChatErrorBoundaryProps, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    // Surface for debugging without breaking the UX (spec 14 — warm above, trace below).
    // eslint-disable-next-line no-console
    console.error('[chat] inline component failed to render', error);
  }

  render() {
    if (this.state.failed) {
      return (
        this.props.fallback ?? (
          <p role="status" className="mt-2 text-[15.5px] leading-[1.55] text-text-secondary">
            I couldn&apos;t display this one — that&apos;s on me, not you. Ask me about it and
            I&apos;ll describe it instead.
          </p>
        )
      );
    }
    return this.props.children;
  }
}
