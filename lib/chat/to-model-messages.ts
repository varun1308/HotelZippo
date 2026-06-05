/* Map our ChatMessage[] (text parts only) → AI SDK ModelMessages. Shared by the chat
 * route and the session-snapshot route (Phase 5) so the conversion stays in one place. */
import type { ModelMessage } from 'ai';
import type { ChatMessage } from './types';

export function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.parts
      .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
      .map((p) => p.text)
      .join(''),
  }));
}
