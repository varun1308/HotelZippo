/* Recommendation-assembly job ledger (specs/03c-async-assembly.md).
 *
 * A durable ledger of assembly jobs (table public.recommendation_jobs). The chat turn CREATES a job
 * and returns fast; a worker route CLAIMS it (atomic pending→running), runs the model, and writes the
 * result; the client POLLS the job for staged progress + the final cards. This decouples the slow LLM
 * assembly from the /api/chat turn's 60s wall-clock cap.
 *
 * Pure over an injected SupabaseClient (like lib/apify/run-ledger.ts / lib/review-intelligence/store.ts).
 * No `import 'server-only'` so a tsx worker/CLI chain can load it too; never imported by a client
 * component (the client reads jobs only through the /api/assembly/:jobId route under owner-read RLS).
 *
 * The worker uses the SERVICE client (writes bypass RLS); the client poll uses the cookie/anon client
 * (owner-read RLS gates rows to auth.uid() = user_id). */
import type { SupabaseClient } from '@supabase/supabase-js';

const TABLE = 'recommendation_jobs';

export const JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STAGES = ['queued', 'finding_hotels', 'checking_intelligence', 'writing', 'done'] as const;
export type JobStage = (typeof JOB_STAGES)[number];

export const JOB_ERROR_KINDS = ['no_eligible_hotels', 'model_failed', 'timeout', 'unknown'] as const;
export type JobErrorKind = (typeof JOB_ERROR_KINDS)[number];

export interface RecommendationJob {
  id: string;
  userId: string | null;
  tripBriefId: string | null;
  destination: string;
  inputHash: string;
  /** The RunAssemblyInput (family_profile + trip_brief) the worker re-runs. */
  input: unknown;
  status: JobStatus;
  stage: JobStage;
  result: unknown | null;
  errorKind: JobErrorKind | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface JobRow {
  id: string;
  user_id: string | null;
  trip_brief_id: string | null;
  destination: string;
  input_hash: string;
  input: unknown;
  status: JobStatus;
  stage: JobStage;
  result: unknown | null;
  error_kind: JobErrorKind | null;
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

const SELECT =
  'id, user_id, trip_brief_id, destination, input_hash, input, status, stage, result, error_kind, attempts, created_at, started_at, finished_at';

function fromRow(r: JobRow): RecommendationJob {
  return {
    id: r.id,
    userId: r.user_id,
    tripBriefId: r.trip_brief_id,
    destination: r.destination,
    inputHash: r.input_hash,
    input: r.input,
    status: r.status,
    stage: r.stage,
    result: r.result,
    errorKind: r.error_kind,
    attempts: r.attempts,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

export interface CreateJobInput {
  userId?: string | null;
  tripBriefId?: string | null;
  destination: string;
  inputHash: string;
  /** The RunAssemblyInput the worker re-runs (family_profile + trip_brief). */
  input: unknown;
}

/** Insert a fresh job row in `pending`/`queued`. Returns the created job. */
export async function createJob(client: SupabaseClient, input: CreateJobInput): Promise<RecommendationJob> {
  const { data, error } = await client
    .from(TABLE)
    .insert({
      user_id: input.userId ?? null,
      trip_brief_id: input.tripBriefId ?? null,
      destination: input.destination,
      input_hash: input.inputHash,
      input: input.input,
      status: 'pending',
      stage: 'queued',
    })
    .select(SELECT)
    .single();
  if (error || !data) throw error ?? new Error('createJob: insert returned no row');
  return fromRow(data as JobRow);
}

/** Atomically claim a pending job for a worker: pending → running, stamp started_at, bump attempts.
 * Conditional on status='pending' so two concurrent workers can't both claim it — the loser gets null.
 * Returns the claimed job, or null if it wasn't claimable (already running/terminal, or gone). */
export async function claimJob(client: SupabaseClient, id: string): Promise<RecommendationJob | null> {
  const { data, error } = await client
    .from(TABLE)
    .update({ status: 'running', stage: 'finding_hotels', started_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select(SELECT)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // attempts bump in a follow-up (single statement can't read-modify-write a column portably).
  await client.from(TABLE).update({ attempts: (data as JobRow).attempts + 1 }).eq('id', id);
  return fromRow(data as JobRow);
}

/** Advance the stage of a running job (drives the progress UX). No-op-safe on a terminal job. */
export async function markStage(client: SupabaseClient, id: string, stage: JobStage): Promise<void> {
  const { error } = await client.from(TABLE).update({ stage }).eq('id', id).eq('status', 'running');
  if (error) throw error;
}

/** Write a successful result: status=succeeded, stage=done, persist the hydrated recommendation props. */
export async function markSucceeded(client: SupabaseClient, id: string, result: unknown): Promise<void> {
  const { error } = await client
    .from(TABLE)
    .update({ status: 'succeeded', stage: 'done', result, finished_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Mark a job failed with a warm error kind (spec 14). */
export async function markFailed(client: SupabaseClient, id: string, errorKind: JobErrorKind): Promise<void> {
  const { error } = await client
    .from(TABLE)
    .update({ status: 'failed', error_kind: errorKind, finished_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Reclaim a STUCK job — one stuck in `running` past `staleMs` (its worker died mid-run). Under the
 * attempts cap → flip back to `pending` so the poll re-kick runs it again; at/over the cap → `failed`
 * (no infinite spin). Returns the resulting status, or null if the job wasn't stale/claimable. Pure
 * over the injected client; the conditional eq('status','running') makes it race-safe. */
export async function reclaimStale(
  client: SupabaseClient,
  job: Pick<RecommendationJob, 'id' | 'status' | 'startedAt' | 'attempts'>,
  opts: { staleMs?: number; maxAttempts?: number } = {},
): Promise<'pending' | 'failed' | null> {
  const staleMs = opts.staleMs ?? 90_000; // > the worker's 60s budget + margin
  const maxAttempts = opts.maxAttempts ?? 2;
  if (job.status !== 'running') return null;
  const startedAt = job.startedAt ? Date.parse(job.startedAt) : 0;
  if (!startedAt || Date.now() - startedAt < staleMs) return null;

  const next = job.attempts >= maxAttempts ? 'failed' : 'pending';
  const patch =
    next === 'failed'
      ? { status: 'failed', error_kind: 'timeout', finished_at: new Date().toISOString() }
      : { status: 'pending', stage: 'queued', started_at: null };
  const { data, error } = await client
    .from(TABLE)
    .update(patch)
    .eq('id', job.id)
    .eq('status', 'running')
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return data ? next : null;
}

/** Load one job by id, or null if absent. */
export async function loadJob(client: SupabaseClient, id: string): Promise<RecommendationJob | null> {
  const { data, error } = await client.from(TABLE).select(SELECT).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as JobRow) : null;
}

/** The signed-in user's most-recent IN-FLIGHT job (pending/running) within `withinMs`, or null. Read
 * through the user's RLS-scoped client so it only ever returns their own job. Used on chat mount to
 * RE-ATTACH a recommendation that was still assembling when the page was closed (03c durability). */
export async function loadInflightJob(
  client: SupabaseClient,
  withinMs = 5 * 60 * 1000,
): Promise<RecommendationJob | null> {
  const since = new Date(Date.now() - withinMs).toISOString();
  const { data, error } = await client
    .from(TABLE)
    .select(SELECT)
    .in('status', ['pending', 'running'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as JobRow) : null;
}

/** Reuse guard: the most-recent non-failed job for this input within `withinMs`, or null. Lets two
 * identical recommendation turns re-attach to ONE job (one model call) instead of double-spending. */
export async function findReusable(
  client: SupabaseClient,
  inputHash: string,
  withinMs = 10 * 60 * 1000,
): Promise<RecommendationJob | null> {
  const since = new Date(Date.now() - withinMs).toISOString();
  const { data, error } = await client
    .from(TABLE)
    .select(SELECT)
    .eq('input_hash', inputHash)
    .neq('status', 'failed')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as JobRow) : null;
}
