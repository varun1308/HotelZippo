/* Phase 3b chat page — hosts <ChatShell> with the scripted mock stream.
 *
 * This is the UI shell ONLY. There is NO real conversation agent here and no
 * /api/chat route (Phase 3c). The mock stream is injected as the `source`; 3c
 * swaps in the real agent-backed source at exactly this seam. */
'use client';

import { ChatShell } from '@/components/chat';
import { mockStream } from '@/lib/chat/mockStream';

export default function ChatPage() {
  return <ChatShell source={mockStream} />;
}
