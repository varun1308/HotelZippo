/* Chat page — hosts <ChatShell> with the real agent-backed stream source (Phase 3c).
 *
 * `chatHttpStream` POSTs to /api/chat and adapts the Vercel AI SDK UI-message stream
 * into the 3b StreamChunk protocol — the seam ChatShell was built around. The scripted
 * `mockStream` (3b) remains available for tests/local preview. */
'use client';

import { ChatShell } from '@/components/chat';
import { chatHttpStream } from '@/lib/chat/httpStream';

export default function ChatPage() {
  return <ChatShell source={chatHttpStream} />;
}
