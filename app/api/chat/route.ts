/* POST /api/chat — the Conversation Agent endpoint (specs 08b / 08b-1).
 *
 * Streams an assistant turn as newline-delimited JSON (NDJSON) StreamChunks — the SAME
 * protocol the 3b chat hook consumes — so the client adapter is a trivial reader and the
 * UI is fully decoupled from the AI SDK wire format. We consume streamText's fullStream
 * server-side and translate: text-delta → {text-delta}, the assemble_recommendations
 * tool-result → {component: 'recommendation-set'} (hydrated cards), finish → {done}.
 *
 * Body: { messages: ChatMessage[], familyProfile?, sessionSnapshot? }.
 * Server-side only; ANTHROPIC_API_KEY never reaches the client. */
import { cookies } from 'next/headers';
import { runConversation, type ProfileUpdateResult } from '@/lib/chat/agent';
import { toRecommendationSetProps } from '@/lib/chat/map-recommendation';
import { toModelMessages } from '@/lib/chat/to-model-messages';
import { createSupabaseServerClient } from '@/lib/db/ssr';
import { e2eEnabled } from '@/lib/chat/e2e-stub';
import type { ChatMessage, StreamChunk } from '@/lib/chat/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

function encodeChunk(chunk: StreamChunk): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(chunk) + '\n');
}

export async function POST(req: Request) {
  let body: { messages?: ChatMessage[]; familyProfile?: unknown; sessionSnapshot?: string | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: 'messages required' }, { status: 400 });
  }

  // E2E stub seam (specs/15a §1.1): when the Playwright harness sets NEXT_PUBLIC_E2E=1,
  // serve a deterministic, key-free scripted stream instead of the live Anthropic agent.
  // Read at call time + lazy-import so the live bundle is untouched and prod is impossible.
  if (e2eEnabled()) {
    const { e2eChatStub } = await import('@/lib/chat/e2e-stub');
    return e2eChatStub(body.messages);
  }

  // Resolve the signed-in user (cookie SSR) so the agent can persist confirmed profile
  // changes under RLS. Best-effort: unauthenticated / no env → no userId, the update_profile
  // tool simply isn't registered and chat works unchanged (CI + env-free build stay green).
  let userId: string | undefined;
  let profileClient: ReturnType<typeof createSupabaseServerClient> | undefined;
  try {
    const cookieStore = await cookies();
    const supabase = createSupabaseServerClient({
      getAll: () => cookieStore.getAll(),
      setAll: () => {},
    });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      userId = user.id;
      profileClient = supabase;
    }
  } catch {
    /* no env / no cookies → run without profile persistence */
  }

  let result;
  try {
    result = await runConversation({
      messages: toModelMessages(body.messages),
      familyProfile: body.familyProfile,
      sessionSnapshot: body.sessionSnapshot ?? null,
      userId,
      profileClient,
    });
  } catch (e) {
    return Response.json(
      {
        error: 'chat_failed',
        message: "Hmm — I lost my footing for a second. That's on me, not you. Give me another go?",
        reason: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }

  // Translate the SDK fullStream → our NDJSON StreamChunk protocol.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encodeChunk({ type: 'typing' }));
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            controller.enqueue(encodeChunk({ type: 'text-delta', delta: part.text }));
          } else if (part.type === 'tool-result' && part.toolName === 'assemble_recommendations') {
            const props = toRecommendationSetProps(part.output);
            if (props) {
              controller.enqueue(
                encodeChunk({ type: 'component', component: 'recommendation-set', props }),
              );
            }
          } else if (part.type === 'tool-result' && part.toolName === 'update_profile') {
            // Confirmed profile change persisted → emit the inline "profile updated" chip.
            // Only when fields actually changed (the tool returns [] for a no-op).
            const { updated } = (part.output ?? { updated: [] }) as ProfileUpdateResult;
            if (Array.isArray(updated) && updated.length > 0) {
              controller.enqueue(
                encodeChunk({ type: 'component', component: 'profile-update', props: { updated } }),
              );
            }
          } else if (part.type === 'error') {
            controller.enqueue(
              encodeChunk({
                type: 'text-delta',
                delta: "\n\nHmm — something went sideways on my end. Give me another go?",
              }),
            );
          }
        }
        controller.enqueue(encodeChunk({ type: 'done' }));
      } catch (e) {
        controller.enqueue(
          encodeChunk({
            type: 'text-delta',
            delta: "\n\nI lost the thread there for a moment — try me again?",
          }),
        );
        controller.enqueue(encodeChunk({ type: 'done' }));
        void e;
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
    },
  });
}
