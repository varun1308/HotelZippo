/* Copies Vercel AI SDK telemetry metadata back into the bare `hz.*` namespace (specs/14).
 *
 * The AI SDK prefixes everything passed via `experimental_telemetry.metadata`:
 * `metadata: { 'hz.conversation_id': id }` lands on its spans as
 * `ai.telemetry.metadata.hz.conversation_id` (see node_modules/ai — `attributes[
 * `ai.telemetry.metadata.${key}`] = value`). That silently drops every ai.streamText /
 * ai.toolCall / model-usage span out of the spec-14 `hz.conversation_id` Dash0 filter.
 *
 * This SpanProcessor runs on span END (before export) and copies any
 * `ai.telemetry.metadata.hz.*` attribute onto its bare `hz.*` key, so the SDK's spans join
 * the same conversation view as every withSpan-made span. Never overwrites an existing bare
 * key. Registered in BOTH tracer bootstraps (lib/otel/register.ts for the Next.js server,
 * scripts/pipeline/otel-bootstrap.ts for the worker) ahead of the exporting processor —
 * MultiSpanProcessor calls onEnd in registration order, so the copy lands before the span
 * is buffered for export. */
import type { Context } from '@opentelemetry/api';
import type { Span, ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base';

/** The AI SDK's metadata prefix + our namespace: `ai.telemetry.metadata.hz.*`. */
const AI_METADATA_HZ_PREFIX = 'ai.telemetry.metadata.hz.';
/** Where the bare key starts inside the prefixed one (`hz.` is kept). */
const BARE_KEY_OFFSET = AI_METADATA_HZ_PREFIX.length - 'hz.'.length;

export class AiMetadataSpanProcessor implements SpanProcessor {
  onStart(_span: Span, _parentContext: Context): void {
    /* attributes are copied on end — metadata may be set at any point in the span's life */
  }

  onEnd(span: ReadableSpan): void {
    // ReadableSpan types `attributes` as readonly, but at runtime it is the span's live
    // attribute record — mutating it here (synchronously, before the exporting processor's
    // onEnd buffers the span) is the sanctioned "enrich on end" pattern.
    const attrs = span.attributes as Record<string, unknown>;
    for (const key of Object.keys(attrs)) {
      if (!key.startsWith(AI_METADATA_HZ_PREFIX)) continue;
      const bare = key.slice(BARE_KEY_OFFSET);
      if (attrs[bare] === undefined) attrs[bare] = attrs[key];
    }
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
