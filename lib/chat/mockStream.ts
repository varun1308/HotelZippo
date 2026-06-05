/* mockStream — a scripted Phuket conversation that drives the chat UI in 3b.
 *
 * This is the DEFAULT injected StreamSource (see types.ts). It replays the
 * prototype's concierge script (`Chat - Active & Streaming.html`) including a
 * final inline `recommendation-set` component part rendered by the 3a cards.
 *
 * Phase 3c replaces this with a real agent-backed source; nothing else changes.
 * It tokenizes assistant prose by whole words (the `/(\s+)/` split the prototype
 * uses) and yields one text-delta per token so the UI streams word-by-word with
 * no mid-word reflow. Timing is gentle; tests can pass `{ delayMs: 0 }` for
 * instant, deterministic playback. */
import type { StreamChunk, StreamSource } from './types';
import type { RecommendationSetProps } from '@/components/recommendation/types';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Split prose into whole-word tokens, keeping whitespace attached so reassembly
 *  is lossless. Mirrors the prototype's `text.split(/(\s+)/)`. */
export function tokenizeWords(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t.length > 0);
}

interface AssistantStep {
  role: 'assistant';
  /** Paragraphs of prose, streamed word-by-word in order. */
  paragraphs: string[];
  offerForm?: boolean;
  researching?: string;
  /** When set, emit a recommendation-set component part after the prose. */
  recommendations?: RecommendationSetProps;
}
interface UserStep {
  role: 'user';
  text: string;
}
type ScriptStep = AssistantStep | UserStep;

/* The display-ready recommendation set emitted at the end of the script.
 * (Same shape the 3a tests use — flat, presentational; no DB rows.) */
const phuketRecommendations: RecommendationSetProps = {
  altHeading: 'Two more worth a look',
  topPick: {
    hotelName: 'JW Marriott Phuket Resort & Spa',
    destination: 'Phuket',
    area: 'Mai Khao Beach',
    priceTierLabel: 'Luxury',
    starRating: 5,
    heroImageUrl: null,
    heroLabel: 'resort hero',
    brandNote: 'Marriott Bonvoy',
    hardFlags: [
      {
        category: 'Minor lobby refurbishment',
        description:
          'The lobby restaurant is being refreshed through December. Two alternative restaurants stay open throughout your dates.',
        severity: 'moderate',
        review_evidence_count: 41,
      },
    ],
    verdict:
      'For a multi-generational family on a calm beach, this is the one I would book.',
    categorySummaries: {
      rooms: 'Two-bedroom family suites sleep six, with a separate kids room.',
      facilities: 'A shaded kids pool, a dedicated kids club, and a quiet spa.',
      food: 'A dedicated Indian and vegetarian breakfast counter every morning.',
      location: 'Calm, shallow Mai Khao beachfront, 20 minutes from the airport.',
    },
    whyTopPick:
      'Best fit for a calm-beach, kids-club, vegetarian-friendly December trip.',
  },
  otherPicks: [
    {
      hotelName: 'Angsana Laguna Phuket',
      destination: 'Phuket',
      area: 'Bang Tao Beach',
      priceTierLabel: 'Luxury',
      starRating: 5,
      heroImageUrl: null,
      heroLabel: 'resort hero',
      brandNote: 'Banyan Tree',
      hardFlags: [],
      summary:
        'A vast lagoon resort with great kids facilities — a touch livelier than the top pick, and slightly further from the night markets.',
      rankLabel: 'Runner-up',
    },
    {
      hotelName: 'Holiday Inn Resort Karon Beach',
      destination: 'Phuket',
      area: 'Karon Beach',
      priceTierLabel: 'Comfort',
      starRating: 4,
      heroImageUrl: null,
      heroLabel: 'resort hero',
      brandNote: 'IHG One Rewards',
      hardFlags: [
        {
          category: 'Active refurbishment',
          description:
            'Major construction is underway across the main pool and several room blocks through your dates.',
          severity: 'severe',
          review_evidence_count: 18,
        },
      ],
      summary:
        'On paper a solid-value family option — but recent stays have been disrupted by construction.',
      verdict:
        'I would normally rank this higher, but I cannot recommend it for your dates.',
      verdictLabel: "Why I'd wait",
    },
  ],
};

/** The scripted concierge conversation, mined from the prototype. */
export const phuketScript: ScriptStep[] = [
  {
    role: 'assistant',
    paragraphs: [
      "I'll do the deep research so you don't have to. First, let's get to know your crew.",
      "Who's travelling on this trip — and are there any little ones I should plan around?",
    ],
  },
  { role: 'user', text: 'Me, my wife, our two kids — 2 and 7 — and my parents.' },
  {
    role: 'assistant',
    paragraphs: [
      "A full house across three generations — I'll make sure everyone's looked after, from the toddler to the grandparents.",
      'Any food preferences I should keep front of mind?',
    ],
  },
  { role: 'user', text: 'We’re vegetarian. My parents really prefer Indian food.' },
  {
    role: 'assistant',
    offerForm: true,
    paragraphs: [
      'Noted — vegetarian throughout, with reliable Indian options so your parents feel at home. That’s a detail I weigh heavily.',
      'Now, where are you dreaming of heading?',
    ],
  },
  { role: 'user', text: 'Somewhere nice and warm, on a beach.' },
  {
    role: 'assistant',
    paragraphs: [
      'I need a little more to work with before I can recommend honestly — “warm and beachy” covers half the map.',
      'Which country or city are you leaning toward, and roughly when are you travelling?',
    ],
  },
  {
    role: 'user',
    text: 'Phuket, Thailand — last two weeks of December. Beach resort, ideally.',
  },
  {
    role: 'assistant',
    paragraphs: [
      'Perfect — Phuket in late December, a beach resort.',
      'What kind of budget are we working with — value, comfort, or happy to splurge for the right place?',
    ],
  },
  {
    role: 'user',
    text: 'Comfort as a baseline, but I’ll happily pay more for the right resort.',
  },
  {
    role: 'assistant',
    paragraphs: [
      'Understood — comfort as your floor, with room to step up when a place truly earns it.',
      'Last thing: anything that would make this trip special, or anything you’d want to avoid?',
    ],
  },
  {
    role: 'user',
    text: "We'd love to be near the main attractions and night markets, a calm beach for our 2-year-old, and a kids' club would be a real bonus.",
  },
  {
    role: 'assistant',
    researching: 'Researching Phuket hotels for your family…',
    paragraphs: [
      'Wonderful — I’ll prioritise a calm, shallow beach for your little one, easy reach to Phuket’s main attractions and night markets, and a proper kids’ club.',
      'Give me a moment. I’m reading through recent family reviews and checking for anything you’d want flagged before booking.',
    ],
  },
  {
    role: 'assistant',
    paragraphs: [
      'Here’s where I’ve landed. One clear recommendation for your family, plus two worth a look — with the honest trade-offs and anything I’d flag before you book.',
    ],
    recommendations: phuketRecommendations,
  },
];

export interface MockStreamOptions {
  /** Per-word delay (ms). 0 → instant playback (tests). */
  delayMs?: number;
  /** Delay before the assistant starts "typing" (ms). 0 → instant. */
  thinkMs?: number;
}

/** Build a deterministic mock StreamSource that walks the script one assistant
 *  turn per `sendMessage`. It ignores the user's actual text (it's scripted) and
 *  advances an internal cursor — exactly the seam shape 3c will satisfy. */
export function createMockStream(options: MockStreamOptions = {}): StreamSource {
  const delayMs = options.delayMs ?? 26;
  const thinkMs = options.thinkMs ?? 700;

  // The script alternates user/assistant. We replay only the assistant turns,
  // advancing past the matching scripted user turn each send.
  let cursor = 0;

  return async function* mockSource(): AsyncIterable<StreamChunk> {
    // Skip any leading user step (the real user just spoke).
    while (cursor < phuketScript.length && phuketScript[cursor].role === 'user') {
      cursor += 1;
    }
    if (cursor >= phuketScript.length) {
      yield { type: 'done' };
      return;
    }

    const step = phuketScript[cursor] as AssistantStep;
    cursor += 1;

    yield { type: 'typing' };
    if (thinkMs > 0) await wait(thinkMs);

    for (const paragraph of step.paragraphs) {
      const tokens = tokenizeWords(paragraph);
      for (const token of tokens) {
        yield { type: 'text-delta', delta: token };
        if (delayMs > 0 && token.trim().length > 0) await wait(delayMs);
      }
      // Paragraph break (rendered as a blank line by ChatStreamText).
      yield { type: 'text-delta', delta: '\n\n' };
    }

    if (step.offerForm) yield { type: 'offer-form' };
    if (step.researching) yield { type: 'researching', label: step.researching };
    if (step.recommendations) {
      yield { type: 'component', component: 'recommendation-set', props: step.recommendations };
    }

    yield { type: 'done' };
  };
}

/** The default source used by the chat page. */
export const mockStream: StreamSource = createMockStream();
