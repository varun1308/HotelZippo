/* AssemblyProgress — the async-assembly progress block (specs/03c-async-assembly.md).
 *
 * Emitted inline by the concierge when a recommendation assembly is dispatched as a JOB (instead of
 * blocking the chat turn on the slow LLM call). It self-polls the job by `jobId` and:
 *   - while pending/running → shows the advancing staged status line (the ONE allowed spinner, reusing
 *     the ResearchingPill visual);
 *   - on succeeded → swaps to the recommendation-set cards (the hydrated result, mapped to card props);
 *   - on failed → a warm conversational fallback (spec 14), never a dead-end.
 *
 * Because it polls by jobId on mount, a browser close / reload that re-attaches the same jobId resumes
 * the progress automatically — the recommendation_jobs row is the source of truth. */
'use client';

import { useEffect, useRef } from 'react';
import { ShortlistableRecommendationSet } from '@/components/recommendation';
import { toRecommendationSetProps } from '@/lib/chat/map-recommendation';
import {
  useAssemblyJob,
  stageLabel,
  type AssemblyPoll,
  type AssemblyJobErrorKind,
} from '@/lib/chat/useAssemblyJob';
import type { AssemblyProgressProps } from '@/lib/chat/types';
import { ResearchingPill } from './ResearchingPill';

/** Warm fallback copy per error kind (spec 14 — never a raw error, always a next step).
 * `detail` is the persisted job result — on failure the worker stores the full assembly error
 * variant there, so budget_mismatch can name the tiers that ARE available (08b-2 Step 1). */
function failureCopy(kind: AssemblyJobErrorKind | null, destination: string, detail?: unknown): string {
  switch (kind) {
    case 'no_eligible_hotels':
      return `I couldn't find hotels with enough family review intelligence for ${destination} just yet. Want to try a different destination, or shall I widen the search?`;
    case 'budget_mismatch': {
      const tiers = (detail as { available_tiers?: string[] } | null)?.available_tiers ?? [];
      const tierNote = tiers.length > 0 ? ` — the options I do have are ${formatTiers(tiers)}` : '';
      return `Nothing in ${destination} quite fits that budget${tierNote}. Want me to widen the budget, or try a different destination?`;
    }
    case 'timeout':
    case 'model_failed':
    case 'unknown':
    default:
      return 'I had trouble pulling those recommendations together. Want me to try again?';
  }
}

/** "a", "a and b", "a, b and c" — matches the concierge's conversational voice. */
function formatTiers(tiers: string[]): string {
  if (tiers.length === 1) return tiers[0];
  return `${tiers.slice(0, -1).join(', ')} and ${tiers[tiers.length - 1]}`;
}

export interface AssemblyProgressComponentProps extends AssemblyProgressProps {
  /** Injectable poll (tests). Defaults to GET /api/assembly/:jobId. */
  poll?: AssemblyPoll;
  /** Fired ONCE when the job succeeds with a result (L17) — lets the page apply the same
   *  trip-brief gate locks / action-bar reveal as the sync recommendation-set chunk path. */
  onComplete?: (result: unknown) => void;
}

export function AssemblyProgress({
  jobId,
  destination,
  conversationId,
  poll,
  onComplete,
}: AssemblyProgressComponentProps) {
  const job = useAssemblyJob(jobId, poll, conversationId);

  // Notify completion exactly once (the poll keeps the state stable afterwards).
  const completedRef = useRef(false);
  useEffect(() => {
    if (job.status === 'succeeded' && job.result != null && !completedRef.current) {
      completedRef.current = true;
      onComplete?.(job.result);
    }
  }, [job.status, job.result, onComplete]);

  if (job.status === 'succeeded') {
    const props = toRecommendationSetProps(job.result);
    if (props) {
      // recommendation_notes (08b-2) ride on the mapped props — the set component renders
      // them deterministically beneath the cards (same path as the sync chunk render).
      return (
        <div className="mt-2">
          <ShortlistableRecommendationSet {...props} />
        </div>
      );
    }
    // Succeeded but the result didn't map to cards (shouldn't happen) → treat as a warm miss.
    return <FallbackLine text={failureCopy('unknown', destination)} />;
  }

  if (job.status === 'failed') {
    return <FallbackLine text={failureCopy(job.errorKind, destination, job.result)} />;
  }

  // pending / running / unknown → the advancing staged status line.
  return <ResearchingPill label={stageLabel(job.stage, destination)} />;
}

function FallbackLine({ text }: { text: string }) {
  return (
    <p role="status" className="mt-2 text-[15.5px] leading-[1.55] text-text-secondary">
      {text}
    </p>
  );
}
