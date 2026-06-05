/* ChatStreamText — streams assistant prose WITHOUT mid-word reflow.
 *
 * THE hard constraint of 3b (CLAUDE.md 4): words must never split or jump as they
 * arrive. We achieve this by rendering already-committed text as a sequence of
 * WHOLE-WORD tokens (the prototype's `/(\s+)/` semantics), each in its own inline
 * span. Because every span holds a complete word, normal inline wrapping can only
 * ever move a *whole* word to the next line — never break one mid-glyph — and
 * appending the next word cannot reflow earlier words' internal layout.
 *
 * The blinking caret is an inline element at the very end of the text flow while
 * `streaming`; it's removed when the turn is done. Caret + entrance motion are
 * gated on prefers-reduced-motion via the tokens.css animation utilities.
 *
 * Paragraphs are separated by blank lines ("\n\n") in the incoming text; we split
 * on them so each paragraph is its own <p> with proper spacing. */
import { Fragment } from 'react';

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

export function ChatStreamText({ text, streaming = false }: ChatStreamTextProps) {
  // Split into paragraphs on blank lines; drop empties from trailing "\n\n".
  const paragraphs = text.split(/\n{2,}/);
  const lastNonEmpty = paragraphs.reduce(
    (acc, p, i) => (p.trim().length > 0 ? i : acc),
    -1,
  );

  return (
    <>
      {paragraphs.map((para, pIdx) => {
        const tokens = tokenize(para);
        const isLastParagraph = pIdx === lastNonEmpty;
        // Render the caret on the last non-empty paragraph while streaming, OR
        // on its own if everything is still empty (first frame).
        const showCaretHere = streaming && (isLastParagraph || lastNonEmpty === -1) && pIdx === Math.max(lastNonEmpty, 0);

        if (tokens.length === 0 && !showCaretHere) return null;

        return (
          <p
            key={pIdx}
            className="m-0 mb-3 text-[16px] leading-[1.62] text-text last:mb-0"
          >
            {tokens.map((token, tIdx) => {
              // Whitespace tokens are rendered verbatim so wrapping behaves
              // naturally; word tokens are atomic (whole-word, never split).
              const isSpace = token.trim().length === 0;
              return (
                <Fragment key={tIdx}>
                  {isSpace ? token : <span className="inline">{token}</span>}
                </Fragment>
              );
            })}
            {showCaretHere && (
              <span
                aria-hidden
                data-testid="stream-caret"
                className="ml-px inline-block h-[1.05em] w-[2px] translate-y-[2px] bg-primary-500 align-text-bottom motion-safe:animate-caret"
              />
            )}
          </p>
        );
      })}
    </>
  );
}
