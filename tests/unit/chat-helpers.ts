/* Test helper: streamed assistant prose is rendered as whole-word <span>s split
 * across siblings (the no-reflow tokenization). So a phrase like "Happy to help."
 * is NOT a single text node — RTL's getByText can't match it directly. `hasText`
 * matches an element by its full textContent, ignoring the internal span splits. */
import { screen } from '@testing-library/react';

/** Returns true if some <p> in the document has the given combined text. */
export function hasText(expected: string): boolean {
  const normalized = expected.replace(/\s+/g, ' ').trim();
  return screen
    .getAllByRole('paragraph')
    .some((p) => (p.textContent ?? '').replace(/\s+/g, ' ').trim().includes(normalized));
}
