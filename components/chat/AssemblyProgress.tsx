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

/** Warm fallback copy per error kind (spec 14 — never a raw error, always a next step). */
function failureCopy(kind: AssemblyJobErrorKind | null, destination: string): string {
  switch (kind) {
    case 'no_eligible_hotels':
      return `I couldn't find hotels with enough family review intelligence for ${destination} just yet. Want to try a different destination, or shall I widen the search?`;
    case 'timeout':
    case 'model_failed':
    case 'unknown':
    default:
      return 'I had trouble pulling those recommendations together. Want me to try again?';
  }
}

export interface AssemblyProgressComponentProps extends AssemblyProgressProps {
  /** Injectable poll (tests). Defaults to GET /api/assembly/:jobId. */
  poll?: AssemblyPoll;
}

export function AssemblyProgress({ jobId, destination, poll }: AssemblyProgressComponentProps) {
  const job = useAssemblyJob(jobId, poll);

  if (job.status === 'succeeded') {
    const props = toRecommendationSetProps(job.result);
    if (props) {
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
    return <FallbackLine text={failureCopy(job.errorKind, destination)} />;
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
