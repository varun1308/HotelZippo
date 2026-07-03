/* ChatStreamText — streams assistant prose WITHOUT mid-word reflow.
 *
 * THE hard constraint of 3b (CLAUDE.md 4): words must never split or jump as they
 * arrive. We achieve this by rendering already-committed text as a sequence of
 * WHOLE-WORD tokens (the prototype's `/(\s+)/` semantics), each in its own inline
 * span. Because every span holds a complete word, normal inline wrapping can only
 * ever move a *whole* word to the next line — never break one mid-glyph — and
 * appending the next word cannot reflow earlier words' internal layout.
 *
 * Markdown-lite (L20, dependency-free): the model writes light markdown, so the
 * renderer handles the three shapes that actually occur in concierge prose —
 *   • `**bold**` → <strong> (complete pairs only; an unclosed `**` renders
 *     literally until its close arrives, keeping streaming stable),
 *   • `- ` / `* ` / `• ` bullet lines and `1. ` numbered lines → <ul>/<ol>,
 *   • single `\n` line breaks inside a paragraph → <br/>.
 * Blank lines ("\n\n") still split paragraphs, exactly as before.
 *
 * The blinking caret is an inline element at the very end of the text flow while
 * `streaming`; it's removed when the turn is done. Caret + entrance motion are
 * gated on prefers-reduced-motion via the tokens.css animation utilities. */
import { Fragment, type ReactNode } from 'react';

export interface ChatStreamTextProps {
  /** The text committed so far (may be partial during streaming). */
  text: string;
  /** Show the blinking caret at the end (true while this message streams). */
  streaming?: boolean;
}

/** Whole-word tokenization, whitespace preserved. Identical to mockStream's. */
function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t.length > 0);
}

/* ---- block model ---------------------------------------------------------- */

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] };

const BULLET_RE = /^\s*[-*•]\s+(.*)$/;
const NUMBERED_RE = /^\s*\d+[.)]\s+(.*)$/;

/** Parse the committed text into paragraph/list blocks. Blank lines split blocks;
 *  within a block, consecutive list-marker lines group into one list. */
function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of text.split(/\n{2,}/)) {
    let current: Block | null = null;
    for (const line of chunk.split('\n')) {
      const bullet = BULLET_RE.exec(line);
      const numbered = bullet ? null : NUMBERED_RE.exec(line);
      if (bullet || numbered) {
        const kind = bullet ? 'ul' : 'ol';
        const item = (bullet ?? numbered)![1];
        if (current?.kind === kind) {
          current.items.push(item);
        } else {
          current = { kind, items: [item] } as Block;
          blocks.push(current);
        }
      } else if (current?.kind === 'p') {
        current.lines.push(line);
      } else {
        current = { kind: 'p', lines: [line] };
        blocks.push(current);
      }
    }
  }
  return blocks;
}

/* ---- inline rendering ------------------------------------------------------ */

/** Word tokens as atomic inline spans (whole-word, never split). */
function renderTokens(text: string, keyPrefix: string): ReactNode {
  return tokenize(text).map((token, tIdx) => {
    // Whitespace tokens are rendered verbatim so wrapping behaves naturally;
    // word tokens are atomic (whole-word, never split).
    const isSpace = token.trim().length === 0;
    return (
      <Fragment key={`${keyPrefix}-${tIdx}`}>
        {isSpace ? token : <span className="inline">{token}</span>}
      </Fragment>
    );
  });
}

/** Inline markdown: complete `**bold**` pairs → <strong>; everything else (incl.
 *  an unclosed `**` mid-stream) renders literally. Tokens stay whole-word spans. */
function renderInline(text: string, keyPrefix: string): ReactNode {
  const segments = text.split(/(\*\*[^*]+\*\*)/g);
  return segments.map((seg, sIdx) => {
    if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4) {
      return (
        <strong key={`${keyPrefix}-b${sIdx}`} className="font-semibold">
          {renderTokens(seg.slice(2, -2), `${keyPrefix}-b${sIdx}`)}
        </strong>
      );
    }
    return <Fragment key={`${keyPrefix}-s${sIdx}`}>{renderTokens(seg, `${keyPrefix}-s${sIdx}`)}</Fragment>;
  });
}

/* ---- component ------------------------------------------------------------- */

function blockHasText(block: Block): boolean {
  return block.kind === 'p'
    ? block.lines.some((l) => l.trim().length > 0)
    : block.items.some((l) => l.trim().length > 0);
}

function Caret() {
  return (
    <span
      aria-hidden
      data-testid="stream-caret"
      className="ml-px inline-block h-[1.05em] w-[2px] translate-y-[2px] bg-primary-500 align-text-bottom motion-safe:animate-caret"
    />
  );
}

export function ChatStreamText({ text, streaming = false }: ChatStreamTextProps) {
  const blocks = parseBlocks(text);
  const lastWithText = blocks.reduce((acc, b, i) => (blockHasText(b) ? i : acc), -1);

  // Nothing committed yet but streaming (first frame) → a lone caret paragraph.
  if (lastWithText === -1) {
    if (!streaming) return null;
    return (
      <p className="m-0 mb-3 text-[16px] leading-[1.62] text-text last:mb-0">
        <Caret />
      </p>
    );
  }

  return (
    <>
      {blocks.map((block, bIdx) => {
        if (!blockHasText(block)) return null;
        // Render the caret at the very end of the last non-empty block while streaming.
        const caretHere = streaming && bIdx === lastWithText;

        if (block.kind === 'p') {
          return (
            <p key={bIdx} className="m-0 mb-3 text-[16px] leading-[1.62] text-text last:mb-0">
              {block.lines.map((line, lIdx) => (
                <Fragment key={lIdx}>
                  {lIdx > 0 && <br />}
                  {renderInline(line, `${bIdx}-${lIdx}`)}
                </Fragment>
              ))}
              {caretHere && <Caret />}
            </p>
          );
        }

        const ListTag = block.kind;
        return (
          <ListTag
            key={bIdx}
            className={`m-0 mb-3 pl-[22px] text-[16px] leading-[1.62] text-text last:mb-0 ${
              block.kind === 'ul' ? 'list-disc' : 'list-decimal'
            }`}
          >
            {block.items.map((item, iIdx) => (
              <li key={iIdx} className="mb-1 last:mb-0">
                {renderInline(item, `${bIdx}-${iIdx}`)}
                {caretHere && iIdx === block.items.length - 1 && <Caret />}
              </li>
            ))}
          </ListTag>
        );
      })}
    </>
  );
}
