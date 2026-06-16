/* Apify Run Ledger (12h · specs/12h-apify-run-ledger.md). CRUD over public.apify_runs (migration
 * 0012) — the durable record that decouples "the actor ran" from "we ingested it."
 *
 * One row per actor invocation. We persist the Apify run id + dataset id the moment a run starts, so
 * a SUCCEEDED run's dataset (which persists on Apify) can be re-pulled for free, a crashed ingestion
 * can be recovered, history is queryable, and refresh is a deliberate new run.
 *
 * Status lifecycle: pending → running → succeeded → ingested   (or → failed).
 *
 * Server-side; service client (apify_runs is service-role only — no client policy). Injectable
 * SupabaseClient like lib/review-intelligence/store.ts. No `import 'server-only'` so the tsx
 * worker/CLI chain can load it too; never imported by a client component. */
import type { SupabaseClient } from '@supabase/supabase-js';

export const RUN_PURPOSES = ['curation_search', 'ta_reviews', 'google_reviews'] as const;
export type RunPurpose = (typeof RUN_PURPOSES)[number];

export const RUN_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'ingested'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export type ScopeType = 'destination' | 'hotel';

export interface ApifyRun {
  id: string;
  actorId: string;
  purpose: RunPurpose;
  scopeType: ScopeType;
  scopeValue: string;
  input: Record<string, unknown>;
  apifyRunId: string | null;
  apifyDatasetId: string | null;
  status: RunStatus;
  itemCount: number | null;
  ingestedAt: string | null;
  error: string | null;
  costEstimate: number | null;
  startedAt: string;
  finishedAt: string | null;
}

const TABLE = 'apify_runs';

/* Input keys that vary run-to-run without changing the meaningful result — excluded when comparing
 * "is this the same query?" for the reuse guard (same idea as lib/dev/actor-cache.ts VOLATILE_KEYS). */
const VOLATILE_KEYS = new Set(['lastReviewDate', 'since']);

/** Truncate a failure detail before it goes into the ledger / a UI (actor errors / anti-bot HTML
 * pages can be huge). Mirrors lib/apify/client.ts `snippet`. */
function truncateError(message: string): string {
  const clean = message.replace(/\s+/g, ' ').trim();
  return clean.length > 500 ? `${clean.slice(0, 500)}…` : clean;
}

/** Stable, volatile-key-stripped stringify so two same-query inputs compare equal regardless of key
 * order or a shifting date floor. */
export function normalizeInput(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(normalizeInput).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => !VOLATILE_KEYS.has(k))
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${normalizeInput(obj[k])}`).join(',')}}`;
}

interface ApifyRunRow {
  id: string;
  actor_id: string;
  purpose: RunPurpose;
  scope_type: ScopeType;
  scope_value: string;
  input: Record<string, unknown>;
  apify_run_id: string | null;
  apify_dataset_id: string | null;
  status: RunStatus;
  item_count: number | null;
  ingested_at: string | null;
  error: string | null;
  cost_estimate: number | null;
  started_at: string;
  finished_at: string | null;
}

function fromRow(r: ApifyRunRow): ApifyRun {
  return {
    id: r.id,
    actorId: r.actor_id,
    purpose: r.purpose,
    scopeType: r.scope_type,
    scopeValue: r.scope_value,
    input: r.input,
    apifyRunId: r.apify_run_id,
    apifyDatasetId: r.apify_dataset_id,
    status: r.status,
    itemCount: r.item_count,
    ingestedAt: r.ingested_at,
    error: r.error,
    costEstimate: r.cost_estimate,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

const SELECT = '*';

export interface CreateRunInput {
  actorId: string;
  purpose: RunPurpose;
  scopeType: ScopeType;
  scopeValue: string;
  input: Record<string, unknown>;
}

/** Insert a fresh ledger row in `pending`. Returns the created run. */
export async function createRun(client: SupabaseClient, run: CreateRunInput): Promise<ApifyRun> {
  const { data, error } = await client
    .from(TABLE)
    .insert({
      actor_id: run.actorId,
      purpose: run.purpose,
      scope_type: run.scopeType,
      scope_value: run.scopeValue,
      input: run.input,
      status: 'pending',
    })
    .select(SELECT)
    .single();
  if (error || !data) throw error ?? new Error('createRun: insert returned no row');
  return fromRow(data as ApifyRunRow);
}

/** Record that Apify accepted the run: store its run id + dataset id, flip to `running`. */
export async function markRunning(
  client: SupabaseClient,
  id: string,
  apify: { apifyRunId: string; apifyDatasetId: string },
): Promise<void> {
  const { error } = await client
    .from(TABLE)
    .update({ apify_run_id: apify.apifyRunId, apify_dataset_id: apify.apifyDatasetId, status: 'running' })
    .eq('id', id);
  if (error) throw error;
}

/** Update a run's status from a poll. `succeeded`/`failed` stamp finished_at; `failed` stores the
 * (truncated) error; item_count / cost_estimate are set when known. */
export async function markStatus(
  client: SupabaseClient,
  id: string,
  status: RunStatus,
  extra: { itemCount?: number | null; costEstimate?: number | null; error?: string | null } = {},
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === 'succeeded' || status === 'failed') patch.finished_at = new Date().toISOString();
  if (extra.itemCount != null) patch.item_count = extra.itemCount;
  if (extra.costEstimate != null) patch.cost_estimate = extra.costEstimate;
  if (extra.error != null) patch.error = truncateError(extra.error);
  const { error } = await client.from(TABLE).update(patch).eq('id', id);
  if (error) throw error;
}

/** Mark a succeeded run as consumed downstream (stamps ingested_at + status=ingested). */
export async function markIngested(
  client: SupabaseClient,
  id: string,
  extra: { itemCount?: number | null } = {},
): Promise<void> {
  const patch: Record<string, unknown> = { status: 'ingested', ingested_at: new Date().toISOString() };
  if (extra.itemCount != null) patch.item_count = extra.itemCount;
  const { error } = await client.from(TABLE).update(patch).eq('id', id);
  if (error) throw error;
}

/** Load one run by id, or null if absent. */
export async function loadRun(client: SupabaseClient, id: string): Promise<ApifyRun | null> {
  const { data, error } = await client.from(TABLE).select(SELECT).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as ApifyRunRow) : null;
}

/** List runs for a scope (history + the un-ingested reuse list), newest first. */
export async function listRuns(
  client: SupabaseClient,
  filter: { purpose?: RunPurpose; scopeValue?: string; limit?: number } = {},
): Promise<ApifyRun[]> {
  let q = client.from(TABLE).select(SELECT).order('started_at', { ascending: false });
  if (filter.purpose) q = q.eq('purpose', filter.purpose);
  if (filter.scopeValue) q = q.eq('scope_value', filter.scopeValue);
  if (filter.limit) q = q.limit(filter.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data as ApifyRunRow[]).map(fromRow);
}

/** The reuse guard: the most recent succeeded/ingested run for the same (purpose, scopeValue,
 * normalised input) within `withinDays`, or null. The UI WARNS with this (reuse free / force fresh)
 * — it never auto-skips a run (locked policy). */
export async function findReusable(
  client: SupabaseClient,
  query: { purpose: RunPurpose; scopeValue: string; input: Record<string, unknown>; withinDays?: number },
): Promise<ApifyRun | null> {
  const withinDays = query.withinDays ?? 7;
  const since = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from(TABLE)
    .select(SELECT)
    .eq('purpose', query.purpose)
    .eq('scope_value', query.scopeValue)
    .in('status', ['succeeded', 'ingested'])
    .gte('started_at', since)
    .order('started_at', { ascending: false });
  if (error) throw error;
  const wanted = normalizeInput(query.input);
  const match = (data as ApifyRunRow[]).find((r) => normalizeInput(r.input) === wanted);
  return match ? fromRow(match) : null;
}
