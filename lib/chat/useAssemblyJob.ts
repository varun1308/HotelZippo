/* useAssemblyJob — polls a recommendation-assembly job to completion (specs/03c-async-assembly.md).
 *
 * The async-assembly path moves the slow LLM call off the /api/chat turn into a JOB (recommendation_jobs).
 * The chat emits an `assembly-progress` component carrying a jobId; this hook drives that block: it polls
 * GET /api/assembly/:jobId every ~2s, advancing the staged status line, and resolves to the hydrated
 * recommendation result (→ cards) or a warm error kind (→ fallback copy). Polling is reconnect-free by
 * construction (each request is independent) and resumes on remount — so a browser close / reload that
 * re-attaches the same jobId picks the progress right back up (the job row is the source of truth). */
'use client';

import { useEffect, useRef, useState } from 'react';

export type AssemblyJobStage = 'queued' | 'finding_hotels' | 'checking_intelligence' | 'writing' | 'done';
export type AssemblyJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';
export type AssemblyJobErrorKind = 'no_eligible_hotels' | 'model_failed' | 'timeout' | 'unknown';

export interface AssemblyJobState {
  status: AssemblyJobStatus | 'unknown';
  stage: AssemblyJobStage;
  /** The hydrated recommendation result once succeeded (raw — mapped to card props by the caller). */
  result: unknown | null;
  errorKind: AssemblyJobErrorKind | null;
}

interface PollResponse {
  status?: AssemblyJobStatus;
  stage?: AssemblyJobStage;
  result?: unknown;
  error_kind?: AssemblyJobErrorKind | null;
}

const POLL_MS = 2000;
const MAX_MS = 5 * 60 * 1000; // stop polling after 5 min — a stuck job shouldn't poll forever

/** Injectable fetch (tests pass a fake). Defaults to GET /api/assembly/:jobId. */
export type AssemblyPoll = (jobId: string) => Promise<PollResponse>;

const defaultPoll: AssemblyPoll = async (jobId) => {
  const res = await fetch(`/api/assembly/${encodeURIComponent(jobId)}`, { cache: 'no-store' });
  if (!res.ok) return {};
  return (await res.json()) as PollResponse;
};

export function useAssemblyJob(jobId: string, poll: AssemblyPoll = defaultPoll): AssemblyJobState {
  const [state, setState] = useState<AssemblyJobState>({ status: 'unknown', stage: 'queued', result: null, errorKind: null });
  const startedRef = useRef<number>(0);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    startedRef.current = Date.now();

    const tick = async () => {
      if (!active) return;
      let r: PollResponse = {};
      try {
        r = await poll(jobId);
      } catch {
        /* transient — try again next tick */
      }
      if (!active) return;

      setState((prev) => ({
        status: r.status ?? prev.status,
        stage: r.stage ?? prev.stage,
        result: r.result ?? prev.result,
        errorKind: r.error_kind ?? prev.errorKind,
      }));

      const terminal = r.status === 'succeeded' || r.status === 'failed';
      const expired = Date.now() - startedRef.current > MAX_MS;
      if (!terminal && !expired) timer = setTimeout(tick, POLL_MS);
    };

    // Kick immediately, then poll on the interval.
    tick();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, poll]);

  return state;
}

/** Staged copy for the progress line (honest — never names a step that didn't run). */
export function stageLabel(stage: AssemblyJobStage, destination: string): string {
  switch (stage) {
    case 'queued':
    case 'finding_hotels':
      return `Finding family-friendly hotels in ${destination}…`;
    case 'checking_intelligence':
      return 'Checking the review intelligence…';
    case 'writing':
      return 'Writing your recommendations…';
    case 'done':
      return 'Ready';
  }
}
