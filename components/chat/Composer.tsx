/* Composer — the message input. Auto-grow textarea, Enter sends, Shift+Enter
 * inserts a newline, send disabled until there's non-empty text.
 *
 * a11y: the textarea is labelled (visually-hidden <label>), the send button has
 * an aria-label, and the shell gets a focus-within ring (tokens). Mined from
 * `Chat - Active & Streaming.html` (.composer / .input-shell / .send-btn). */
'use client';

import {
  forwardRef,
  useCallback,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import { ArrowUp } from 'lucide-react';

const MAX_HEIGHT = 160;

/** Imperative handle so suggestion chips can prefill + focus the composer
 *  (matching the prototype, where a chip readies the input rather than sending). */
export interface ComposerHandle {
  prefill: (text: string) => void;
}

export interface ComposerProps {
  onSend: (text: string) => void;
  /** Disable input while the assistant is mid-turn. */
  disabled?: boolean;
  placeholder?: string;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { onSend, disabled = false, placeholder = 'Message your concierge…' },
  handleRef,
) {
  const [value, setValue] = useState('');
  const textareaId = useId();
  const ref = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(handleRef, () => ({
    prefill(text: string) {
      setValue(text);
      requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        el.focus();
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
      });
    },
  }));

  const canSend = value.trim().length > 0 && !disabled;

  const grow = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, []);

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    // Reset the auto-grown height after clearing.
    requestAnimationFrame(() => {
      if (ref.current) ref.current.style.height = 'auto';
    });
  }, [value, disabled, onSend]);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    grow();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline (default behaviour, no submit).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="mx-auto max-w-chat">
      <div className="flex items-end gap-[10px] rounded-[18px] border border-border-strong bg-surface py-[10px] pl-[18px] pr-[10px] shadow-md transition-[border-color,box-shadow] duration-base focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary">
        <label htmlFor={textareaId} className="sr-only">
          Message your concierge
        </label>
        <textarea
          id={textareaId}
          ref={ref}
          rows={1}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          aria-label="Message your concierge"
          className="max-h-[160px] flex-1 resize-none border-0 bg-transparent py-[9px] text-[16px] leading-[1.5] text-text outline-none placeholder:text-text-tertiary disabled:opacity-60"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          aria-label="Send"
          className="grid h-[42px] w-[42px] flex-none place-items-center rounded-[12px] bg-primary-500 text-white transition-[background,transform] duration-fast hover:bg-primary-600 active:scale-[0.94] disabled:cursor-default disabled:bg-surface-3 disabled:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ArrowUp aria-hidden className="h-[19px] w-[19px]" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
});
