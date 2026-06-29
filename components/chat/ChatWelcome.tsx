/* ChatWelcome — the empty / first-load state of the chat column.
 *
 * Shown when the thread has no messages. Greeting + value framing + a trust micro
 * row + suggestion chips that prefill the composer. Mined from
 * `Chat - Empty State.html` (.welcome / .trustrow / .chips). Entrance motion
 * (`rise`) animates position only and is gated on prefers-reduced-motion. */
import {
  ConciergeBell,
  SearchCheck,
  TriangleAlert,
  Users,
  Sparkles,
  Palmtree,
  Building2,
  MapPin,
  type LucideIcon,
} from 'lucide-react';
import { DESTINATIONS } from '@/lib/db/schemas';

export interface SuggestionChip {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  /** Text inserted into the composer when clicked. */
  prompt: string;
}

const DEFAULT_CHIPS: SuggestionChip[] = [
  {
    icon: Sparkles,
    title: 'Help me plan from scratch',
    subtitle: "I'll ask a few quick questions",
    prompt: 'Help me plan a family trip from scratch.',
  },
  {
    icon: Palmtree,
    title: 'A beach resort in Phuket',
    subtitle: 'Family of 6, two young kids',
    prompt: 'I want a beach resort in Phuket for a family of 6 with two young kids.',
  },
  {
    icon: Building2,
    title: 'Family-friendly Singapore',
    subtitle: 'Easy with grandparents',
    prompt: 'Somewhere family-friendly in Singapore that is easy with grandparents.',
  },
];

export interface ChatWelcomeProps {
  /** Fired when a suggestion chip is chosen (prefills the composer). */
  onSuggestion?: (prompt: string) => void;
  chips?: SuggestionChip[];
}

export function ChatWelcome({ onSuggestion, chips = DEFAULT_CHIPS }: ChatWelcomeProps) {
  return (
    <section
      aria-label="Welcome"
      className="my-auto py-6 motion-safe:animate-rise"
    >
      <div className="mb-[22px] grid h-[46px] w-[46px] place-items-center rounded-[13px] bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-md">
        <ConciergeBell aria-hidden className="h-[23px] w-[23px]" strokeWidth={1.75} />
      </div>

      <h1 className="m-0 mb-4 max-w-[17ch] font-serif text-[clamp(30px,4.6vw,42px)] font-medium leading-[1.1] tracking-[-0.02em] text-text">
        Hi, I&apos;m your <em className="italic text-primary-600">family travel concierge.</em>
      </h1>

      <p className="m-0 mb-7 max-w-[54ch] text-[17px] leading-[1.62] text-text-secondary max-[600px]:text-[16px]">
        Finding the right hotel for a family trip can mean{' '}
        <strong className="font-semibold text-text">30 to 40 hours</strong> across
        reviews, maps, and videos. Tell me about your family and where you&apos;re
        headed — I&apos;ll do that research and come back with a confident
        recommendation, the honest trade-offs, and anything you&apos;d want flagged
        before you book.
      </p>

      <div className="mb-[34px] flex flex-wrap gap-x-6 gap-y-3 max-[600px]:mb-[26px]">
        {[
          { icon: SearchCheck, label: 'Synthesised from real reviews' },
          { icon: TriangleAlert, label: 'Surfaces hidden red flags' },
          { icon: Users, label: 'Built for families with kids' },
        ].map(({ icon: Icon, label }) => (
          <span
            key={label}
            className="flex items-center gap-[9px] whitespace-nowrap text-[13.5px] text-text-secondary"
          >
            <Icon aria-hidden className="h-4 w-4 flex-none text-primary-500" strokeWidth={1.75} />
            {label}
          </span>
        ))}
      </div>

      <p className="mb-[14px] font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary">
        Start with
      </p>
      <div className="flex flex-wrap gap-[10px] max-[600px]:flex-col">
        {chips.map((chip) => {
          const Icon = chip.icon;
          return (
            <button
              key={chip.title}
              type="button"
              onClick={() => onSuggestion?.(chip.prompt)}
              className="group inline-flex items-center gap-[10px] rounded-pill border border-border bg-surface py-[11px] pl-[13px] pr-4 text-left shadow-xs transition duration-base hover:-translate-y-px hover:border-primary-300 hover:bg-primary-50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary max-[600px]:w-full"
            >
              <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[8px] bg-surface-2 text-primary-600 transition-colors duration-base group-hover:bg-surface">
                <Icon aria-hidden className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <span className="flex flex-col leading-[1.25]">
                <span className="text-[14.5px] font-medium text-text">{chip.title}</span>
                <span className="text-[11.5px] font-normal text-text-tertiary">
                  {chip.subtitle}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Destinations we cover — driven by the canonical DESTINATIONS so it never drifts from the
          supported set. Clicking a chip prefills the composer with that destination. */}
      <p className="mb-[14px] mt-[30px] font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary">
        Destinations we cover
      </p>
      <div className="flex flex-wrap gap-[10px]">
        {DESTINATIONS.map((destination) => (
          <button
            key={destination}
            type="button"
            aria-label={`Plan a trip to ${destination}`}
            onClick={() => onSuggestion?.(`I'm planning a family trip to ${destination}.`)}
            className="group inline-flex items-center gap-[8px] rounded-pill border border-border bg-surface py-[9px] pl-[11px] pr-[15px] text-left shadow-xs transition duration-base hover:-translate-y-px hover:border-primary-300 hover:bg-primary-50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <MapPin aria-hidden className="h-[15px] w-[15px] flex-none text-primary-500" strokeWidth={1.75} />
            <span className="text-[14px] font-medium text-text">{destination}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
