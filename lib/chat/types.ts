/* Chat message + stream types for the Phase 3b chat shell.
 *
 * These shapes are deliberately kept close to the Vercel AI SDK `UIMessage`
 * (a message has an id, a role, and an ordered array of `parts`) so that Phase
 * 3c can map the real agent's output onto them with minimal glue — but we do
 * NOT depend on the SDK here. 3b is pure UI driven by an injected stream source.
 *
 * The key idea: an assistant turn can interleave streamed prose AND inline UI.
 * A `component` part lets the concierge "emit" a rendered block (e.g. the 3a
 * RecommendationSet, or a standalone hard flag) right in the message body. The
 * MessageRow component maps `component` part names through a small registry. */

/** A run of streamed/typed text within a message. */
export interface TextPart {
  type: 'text';
  text: string;
}

/** Names of the inline UI blocks the assistant may emit.
 *  Add a name here + a renderer in the MessageRow registry to extend. */
export type ComponentName = 'recommendation-set' | 'hard-flag' | 'profile-update' | 'assembly-progress';

/** Props for the async-assembly progress block (03c). The block self-polls the job by `jobId` and
 *  renders an advancing status line, then swaps to the recommendation-set cards on success (or a warm
 *  fallback on failure). `destination` is shown in the staged copy. */
export interface AssemblyProgressProps {
  jobId: string;
  destination: string;
}

/** An inline rendered UI block emitted mid-conversation.
 *  `props` is intentionally `unknown` at the transport boundary — the registry
 *  narrows it per component name at render time (3c sends, 3b renders). */
export interface ComponentPart {
  type: 'component';
  component: ComponentName;
  props: unknown;
}

/** A single message part: either streamed text or an inline component. */
export type ChatPart = TextPart | ComponentPart;

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  parts: ChatPart[];
  /** When set on an assistant message, the chat renders the dashed "switch to
   *  form" offer beneath it (the form itself is Phase 3d). */
  offerForm?: boolean;
}

/* ---------------------------------------------------------------------------
 * Stream protocol — what an injected StreamSource yields.
 *
 * This is the seam 3c swaps the real agent into. A source is just an async
 * generator of chunks; the hook reduces the chunks into messages. Tests drive
 * the UI deterministically by yielding scripted chunks.
 * ------------------------------------------------------------------------- */

/** Append text to the in-progress assistant message (word/token granularity). */
export interface TextDeltaChunk {
  type: 'text-delta';
  delta: string;
}

/** The assistant is "thinking" — render the 3-dot typing indicator until the
 *  first text-delta or component arrives. */
export interface TypingChunk {
  type: 'typing';
}

/** Emit an inline UI block as a component part on the assistant message. */
export interface ComponentChunk {
  type: 'component';
  component: ComponentName;
  props: unknown;
}

/** Flag the in-progress assistant message as offering the "switch to form" CTA. */
export interface OfferFormChunk {
  type: 'offer-form';
}

/** The "researching…" pill — the ONE allowed spinner (spec 05). */
export interface ResearchingChunk {
  type: 'researching';
  label?: string;
}

/** The assistant turn is complete; finalise the message and return to idle. */
export interface DoneChunk {
  type: 'done';
}

export type StreamChunk =
  | TextDeltaChunk
  | TypingChunk
  | ComponentChunk
  | OfferFormChunk
  | ResearchingChunk
  | DoneChunk;

/** The injection seam. 3c provides a real agent-backed source; 3b/tests provide
 *  a scripted mock. `input` is the user's text, `history` is the prior thread. */
export type StreamSource = (
  input: string,
  history: ChatMessage[],
) => AsyncIterable<StreamChunk>;

/** Coarse conversation status, surfaced to the shell for a11y + indicators. */
export type ChatStatus = 'idle' | 'thinking' | 'streaming';
