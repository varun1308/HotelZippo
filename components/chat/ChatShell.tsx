/* ChatShell — the full chat experience layout (Phase 3b).
 *
 * Composition: topbar (brand + ghost buttons w/ count badges) · workspace
 * (chat column + a RAIL SLOT) · composer. The chat column shows <ChatWelcome>
 * when the thread is empty, otherwise the streamed message list, the live typing
 * indicator / researching pill, and per-message form offers.
 *
 * The conversation is driven by useChatStream over an INJECTED `source` — the
 * page passes the mock; Phase 3c passes the real agent. Nothing in the UI knows
 * which. The rail is a PLACEHOLDER `<aside>` here; Phase 3d fills it (the prop
 * `rail` lets 3d inject content without touching this file).
 *
 * Mined from `Chat - Active & Streaming.html` + `Chat - Empty State.html`. */
'use client';

import { useEffect, useRef } from 'react';
import {
  ConciergeBell,
  NotebookPen,
  RotateCcw,
  Bookmark,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { StreamSource } from '@/lib/chat/types';
import { useChatStream } from '@/lib/chat/useChatStream';
import { MessageRow } from './MessageRow';
import { TypingIndicator } from './TypingIndicator';
import { ResearchingPill } from './ResearchingPill';
import { FormOfferCard } from './FormOfferCard';
import { ChatWelcome } from './ChatWelcome';
import { Composer, type ComposerHandle } from './Composer';
import { WarmError } from '@/components/ui/WarmError';

/** Imperative-ish API the shell hands to a render-prop rail so the rail's
 *  "Find hotels" button can inject a chat turn into the live conversation. */
export interface ChatShellRailApi {
  sendMessage: (text: string) => void;
  isBusy: boolean;
}

export interface ChatShellProps {
  /** The injected stream source (mock for 3b, real agent for 3c). */
  source: StreamSource;
  /** Trip-brief rail content. 3d injects this; 3b renders a placeholder if absent.
   *  Accepts a render function so the rail can reach `sendMessage` (3d Find hotels). */
  rail?: ReactNode | ((api: ChatShellRailApi) => ReactNode);
  /** Counts for the topbar badges (3d wires real values). */
  briefCount?: number;
  shortlistCount?: number;
  /** No-op hooks the page/3d can supply. */
  onSwitchToForm?: () => void;
  onOpenBrief?: () => void;
  onOpenShortlist?: () => void;
}

function GhostButton({
  icon: Icon,
  label,
  count,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  count?: number;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex h-[38px] items-center gap-2 rounded-btn border border-border bg-surface px-[14px] text-[14px] font-medium text-text shadow-xs transition-all duration-fast hover:border-border-strong hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary max-[600px]:px-[11px]"
    >
      <Icon aria-hidden className="h-4 w-4" strokeWidth={1.75} />
      <span className="max-[600px]:hidden">{label}</span>
      {count != null && (
        <span className="grid h-[19px] min-w-[19px] place-items-center rounded-pill bg-surface-3 px-[5px] text-[11px] font-semibold text-text-secondary">
          {count}
        </span>
      )}
    </button>
  );
}

export function ChatShell({
  source,
  rail,
  briefCount = 0,
  shortlistCount = 0,
  onSwitchToForm,
  onOpenBrief,
  onOpenShortlist,
}: ChatShellProps) {
  const { messages, status, researching, streamingMessageId, sendMessage, isBusy } =
    useChatStream({ source });

  const streamRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);

  // Auto-scroll to the latest content on any change (messages / typing / pill).
  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status, researching]);

  const isEmpty = messages.length === 0;
  // Show the typing indicator only while thinking AND nothing is streaming yet.
  const showTyping = status === 'thinking' && streamingMessageId == null;

  // Suggestion chips prefill the composer (matching the prototype) rather than
  // auto-sending, so the user can edit before committing.
  const handleSuggestion = (prompt: string) => {
    composerRef.current?.prefill(prompt);
  };

  // Resolve the rail: a render function gets the send API (3d Find-hotels button);
  // a plain node renders as-is; absent → the placeholder.
  const railNode =
    typeof rail === 'function' ? rail({ sendMessage, isBusy }) : (rail ?? <RailPlaceholder />);

  return (
    <div className="flex h-[100dvh] flex-col">
      {/* ---------- top bar ---------- */}
      <header className="relative z-20 flex h-16 flex-none items-center justify-between border-b border-border bg-bg/[0.86] px-6 backdrop-blur-[10px] max-[600px]:h-14 max-[600px]:px-4">
        <div className="flex items-baseline gap-[9px]">
          <span
            aria-hidden
            className="h-3 w-3 rotate-45 rounded-[3px] bg-primary-500"
          />
          <span className="font-serif text-[21px] font-semibold tracking-[-0.02em] text-text">
            Hotel<b className="font-semibold text-primary-600">Zippo</b>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <GhostButton
            icon={NotebookPen}
            label="Brief"
            count={briefCount}
            onClick={onOpenBrief}
          />
          <GhostButton icon={RotateCcw} label="Replay" onClick={() => window.location.reload()} />
          <GhostButton
            icon={Bookmark}
            label="Shortlist"
            count={shortlistCount}
            onClick={onOpenShortlist}
          />
        </div>
      </header>

      {/* ---------- workspace ---------- */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* stream */}
          <main
            ref={streamRef}
            className="min-h-0 flex-1 overflow-y-auto scroll-smooth"
            aria-busy={isBusy}
          >
            <div className="mx-auto flex min-h-full w-full max-w-chat flex-col px-6 pb-2 pt-[30px] max-[600px]:px-4 max-[600px]:pt-5">
              {isEmpty ? (
                <ChatWelcome onSuggestion={handleSuggestion} />
              ) : (
                <div role="log" aria-label="Conversation" aria-live="polite" className="pt-0">
                  {messages.map((message) => (
                    <div key={message.id}>
                      <MessageRow
                        message={message}
                        streaming={message.id === streamingMessageId}
                      />
                      {message.offerForm && (
                        <FormOfferCard onSwitchToForm={onSwitchToForm} />
                      )}
                    </div>
                  ))}
                  {showTyping && <TypingIndicator />}
                  {researching && <ResearchingPill label={researching.label} />}
                </div>
              )}
            </div>
          </main>

          {/* composer */}
          <div className="relative z-[4] flex-none bg-gradient-to-t from-bg from-[64%] to-transparent px-6 pb-[18px] pt-3 max-[600px]:px-[14px] max-[600px]:pb-[14px] max-[600px]:pt-2">
            <Composer ref={composerRef} onSend={sendMessage} disabled={isBusy} />
            <div className="mx-auto mt-[10px] flex max-w-chat items-center justify-between px-1">
              <span className="text-[12.5px] text-text-tertiary">
                <span className="max-[600px]:hidden">Press </span>
                <kbd className="rounded-[5px] border border-border bg-surface-2 px-[6px] py-px font-mono text-[11px] text-text-secondary">
                  Enter
                </kbd>{' '}
                to send ·{' '}
                <kbd className="rounded-[5px] border border-border bg-surface-2 px-[6px] py-px font-mono text-[11px] text-text-secondary">
                  Shift
                </kbd>
                +
                <kbd className="rounded-[5px] border border-border bg-surface-2 px-[6px] py-px font-mono text-[11px] text-text-secondary">
                  Enter
                </kbd>{' '}
                for new line
              </span>
            </div>
          </div>
        </div>

        {/* ---------- rail slot (Phase 3d) ---------- */}
        {railNode}
      </div>
    </div>
  );
}

/* Placeholder rail. 3d replaces this with the live Trip Brief. Kept simple and
 * clearly labelled so the layout (and the 344px column) is real for 3b. */
function RailPlaceholder() {
  return (
    <aside
      aria-label="Trip brief"
      className="hidden w-[344px] flex-none flex-col border-l border-border bg-surface lg:flex"
    >
      <div className="flex-none border-b border-border px-6 pb-4 pt-[22px]">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          <NotebookPen aria-hidden className="h-[14px] w-[14px] text-primary-500" strokeWidth={1.75} />
          Trip brief
        </div>
        <h2 className="m-0 mb-1 mt-3 font-serif text-[22px] font-medium tracking-[-0.01em] text-text">
          What I&apos;m gathering
        </h2>
        <p className="m-0 text-[13px] leading-[1.5] text-text-secondary">
          I take notes as we talk. Once the essentials are in, I&apos;ll start the
          research.
        </p>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="flex items-center gap-2 text-center text-[13px] italic text-text-tertiary">
          <ConciergeBell aria-hidden className="h-4 w-4" strokeWidth={1.75} />
          Your trip brief fills in here as we talk.
        </p>
      </div>
    </aside>
  );
}

/* Re-export so a host page can render the warm error inline if a source throws
 * before producing any message (the shell itself stays resilient — useChatStream
 * always returns to idle in `finally`). */
export { WarmError };
