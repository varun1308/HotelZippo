/* Composer: send/disable/keyboard semantics (spec 05). */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from '@/components/chat/Composer';

describe('Composer', () => {
  it('disables send when empty and enables once non-empty text is typed', async () => {
    const user = userEvent.setup();
    render(<Composer onSend={jest.fn()} />);
    const send = screen.getByRole('button', { name: /send/i });
    expect(send).toBeDisabled();

    await user.type(screen.getByLabelText(/message your concierge/i), 'Hi');
    expect(send).toBeEnabled();
  });

  it('stays disabled for whitespace-only input', async () => {
    const user = userEvent.setup();
    render(<Composer onSend={jest.fn()} />);
    await user.type(screen.getByLabelText(/message your concierge/i), '   ');
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('Enter calls onSend with the value and clears the textarea', async () => {
    const onSend = jest.fn();
    const user = userEvent.setup();
    render(<Composer onSend={onSend} />);
    const ta = screen.getByLabelText(/message your concierge/i) as HTMLTextAreaElement;

    await user.type(ta, 'Phuket in December');
    await user.keyboard('{Enter}');

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('Phuket in December');
    expect(ta.value).toBe('');
  });

  it('Shift+Enter inserts a newline and does NOT send', async () => {
    const onSend = jest.fn();
    const user = userEvent.setup();
    render(<Composer onSend={onSend} />);
    const ta = screen.getByLabelText(/message your concierge/i) as HTMLTextAreaElement;

    await user.type(ta, 'line one');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await user.type(ta, 'line two');

    expect(onSend).not.toHaveBeenCalled();
    expect(ta.value).toBe('line one\nline two');
  });

  it('clicking send calls onSend with the trimmed value', async () => {
    const onSend = jest.fn();
    const user = userEvent.setup();
    render(<Composer onSend={onSend} />);
    await user.type(screen.getByLabelText(/message your concierge/i), '  hello  ');
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(onSend).toHaveBeenCalledWith('hello');
  });
});
