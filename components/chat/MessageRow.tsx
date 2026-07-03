/* MessageRow — renders one chat turn (assistant or user).
 *
 * Assistant turns: the 36px concierge avatar tile + "Concierge" label + an
 * ordered list of parts. Text parts stream via <ChatStreamText>; component parts
 * are mapped through a small registry to the REUSED Phase 3a components
 * (recommendation-set → <RecommendationSet>, hard-flag → <InlineHardFlag>). We do
 * NOT re-implement flags or cards — inline hard-flag rules (amber/red, above the
 * fold, undismissable) come for free from the 3a components.
 *
 * User turns: a right-aligned primary bubble. Mined from
 * `Chat - Active & Streaming.html` (.msg.assistant / .msg.user / .ava). */
import { ConciergeBell } from 'lucide-react';
import { ShortlistableRecommendationSet, InlineHardFlag } from '@/components/recommendation';
import type {
  RecommendationSetProps,
  HardFlagProps,
} from '@/components/recommendation';
import type { ChatMessage, ComponentPart } from '@/lib/chat/types';
import { ChatStreamText } from './ChatStreamText';
import { ProfileUpdatedChip, type ProfileUpdatedChipProps } from './ProfileUpdatedChip';
import { AssemblyProgress } from './AssemblyProgress';
import { ChatErrorBoundary } from './ChatErrorBoundary';
import type { AssemblyProgressProps } from '@/lib/chat/types';

/* ---- inline component registry ------------------------------------------- */
/* Maps a component part name → renderer. `props` is narrowed here (the only
 * place the transport-level `unknown` is cast), keeping the boundary explicit. */
function InlineComponent({
  part,
  onAssemblyComplete,
}: {
  part: ComponentPart;
  onAssemblyComplete?: (result: unknown) => void;
}) {
  switch (part.component) {
    case 'recommendation-set':
      return (
        <div className="mt-2">
          <ShortlistableRecommendationSet {...(part.props as RecommendationSetProps)} />
        </div>
      );
    case 'hard-flag':
      return (
        <div className="mt-2 max-w-card">
          <InlineHardFlag {...(part.props as HardFlagProps)} />
        </div>
      );
    case 'profile-update':
      return <ProfileUpdatedChip {...(part.props as ProfileUpdatedChipProps)} />;
    case 'assembly-progress':
      return (
        <AssemblyProgress
          {...(part.props as AssemblyProgressProps)}
          onComplete={onAssemblyComplete}
        />
      );
    default:
      return null;
  }
}

export interface MessageRowProps {
  message: ChatMessage;
  /** True while THIS message is the live streaming turn (drives the caret). */
  streaming?: boolean;
  /** Fired when an inline async assembly job lands its cards (L17) — the page uses it
   *  to lock the trip-brief gates and surface the post-recommendation action bar. */
  onAssemblyComplete?: (result: unknown) => void;
}

export function MessageRow({ message, streaming = false, onAssemblyComplete }: MessageRowProps) {
  if (message.role === 'user') {
    const text = message.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('');
    return (
      <div className="mb-[26px] flex justify-end motion-safe:animate-rise">
        <div className="max-w-[78%] rounded-[18px_18px_5px_18px] bg-primary-500 px-[17px] py-3 text-[15.5px] leading-[1.5] text-white shadow-sm max-[600px]:max-w-[85%]">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="assistant-message"
      className="mb-[26px] flex items-start gap-[14px] motion-safe:animate-rise"
    >
      <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-sm">
        <ConciergeBell aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1 pt-[2px]">
        <div className="mb-[5px] text-[12.5px] font-semibold tracking-[-0.01em] text-text-secondary">
          Concierge
        </div>
        {message.parts.map((part, i) => {
          if (part.type === 'text') {
            return (
              <ChatStreamText
                key={i}
                text={part.text}
                // Caret only on the trailing text part of the live message.
                streaming={streaming && i === lastTextIndex(message)}
              />
            );
          }
          // Error boundary per inline block (H7): one bad card (e.g. an image loader
          // throwing) degrades to a warm line — it can never take down the chat.
          return (
            <ChatErrorBoundary key={i}>
              <InlineComponent part={part} onAssemblyComplete={onAssemblyComplete} />
            </ChatErrorBoundary>
          );
        })}
      </div>
    </div>
  );
}

/** Index of the last text part — the caret belongs only there while streaming. */
function lastTextIndex(message: ChatMessage): number {
  let idx = -1;
  message.parts.forEach((p, i) => {
    if (p.type === 'text') idx = i;
  });
  return idx;
}
