/* Chat page — wires the real agent-backed chat (3c) together with the Phase 3d
 * onboarding surface: the Trip Brief rail, the Family Profile form, and the
 * Shortlist panel.
 *
 * State lives here (client-side only for 3d — persistence is Phase 4):
 *   • useTripBrief  — filled from the user's own messages (deterministic detector)
 *                     and locked on recommendation arrival, via a tapped source.
 *   • useShortlist  — saved hotels; exposed to the inline cards through
 *                     ShortlistProvider (the cards render deep in the stream).
 * The "Find hotels" button injects a chat turn (keeps the agent's wrapper +
 * profile resolution; does not bypass to the assemble route).
 *
 * RUN REQUIREMENTS: this page (and the whole chat shell) RENDERS with no env, no DB,
 * and no API key — everything here is client-side. A real recommendation, however,
 * needs the server side wired up: local/remote Supabase reachable + seeded demo data,
 * and ANTHROPIC_API_KEY set (server-side only). Without those, sending a message that
 * triggers `assemble_recommendations` fails gracefully (a warm error; the page never
 * crashes). See README "Running it locally → Tier 2" for the full setup + seeding. */
'use client';

import { useCallback, useMemo, useState } from 'react';
import { ChatShell, type ChatShellRailApi } from '@/components/chat';
import { chatHttpStream } from '@/lib/chat/httpStream';
import type { StreamChunk, StreamSource } from '@/lib/chat/types';
import { TripBrief } from '@/components/brief';
import { ShortlistPanel } from '@/components/shortlist';
import { FamilyProfileForm } from '@/components/profile';
import type { FamilyProfile } from '@/components/profile';
import { useTripBrief } from '@/lib/brief/useTripBrief';
import { useShortlist } from '@/lib/shortlist/useShortlist';
import { ShortlistProvider } from '@/lib/shortlist/context';

/** What the agent tool's recommendation component carries (per map-recommendation). */
interface RecoProps {
  topPick?: { destination?: string; priceTierLabel?: string | null };
}

export default function ChatPage() {
  const brief = useTripBrief();
  const shortlist = useShortlist();
  const [formOpen, setFormOpen] = useState(false);
  const [shortlistOpen, setShortlistOpen] = useState(false);

  const { applyUserText, applyRecommendationGates, applyProfile } = brief;

  // Wrap the real source so each USER turn feeds the detector, and each
  // recommendation arrival locks the gate fields (destination/type/budget known).
  const source: StreamSource = useCallback(
    (input, history) => {
      applyUserText(input);
      const inner = chatHttpStream(input, history);
      return (async function* tap(): AsyncIterable<StreamChunk> {
        for await (const chunk of inner) {
          if (chunk.type === 'component' && chunk.component === 'recommendation-set') {
            const props = chunk.props as RecoProps;
            applyRecommendationGates({
              destination: props.topPick?.destination || null,
              // By the time cards exist, destination + trip type are confirmed; we
              // can't read trip type off the card, so just ensure the gate shows met.
              type: brief.brief.type ?? 'Confirmed',
            });
          }
          yield chunk;
        }
      })();
    },
    [applyUserText, applyRecommendationGates, brief.brief.type],
  );

  const shortlistActions = useMemo(
    () => ({
      save: shortlist.save,
      remove: shortlist.remove,
      toggle: shortlist.toggle,
      isSaved: shortlist.isSaved,
    }),
    [shortlist.save, shortlist.remove, shortlist.toggle, shortlist.isSaved],
  );

  // Submitting the structured form seeds the brief and returns to the chat.
  const handleProfileSubmit = useCallback(
    (profile: FamilyProfile) => {
      applyProfile({
        budget:
          profile.budgetTier === 'luxury'
            ? 'Luxury'
            : profile.budgetTier === 'value'
              ? 'Value'
              : 'Comfort',
        food:
          profile.food === 'vegan'
            ? 'Vegan'
            : profile.food === 'vegetarian'
              ? `Vegetarian${profile.indianFoodMatters ? ' · Indian options important' : ''}`
              : null,
        who: profile.children.length > 0 ? 'Family with young children' : null,
      });
      setFormOpen(false);
    },
    [applyProfile],
  );

  return (
    <ShortlistProvider actions={shortlistActions}>
      <ChatShell
        source={source}
        briefCount={brief.filledCount}
        shortlistCount={shortlist.count}
        onSwitchToForm={() => setFormOpen(true)}
        onOpenShortlist={() => setShortlistOpen(true)}
        rail={(api: ChatShellRailApi) => (
          <TripBrief
            brief={brief.brief}
            onFindHotels={() => {
              if (api.isBusy) return;
              api.sendMessage("Let's find hotels now — show me your recommendations.");
            }}
          />
        )}
      />

      <ShortlistPanel
        open={shortlistOpen}
        items={shortlist.items}
        onRemove={shortlist.remove}
        onClose={() => setShortlistOpen(false)}
      />

      {formOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-bg">
          <div className="mx-auto w-full max-w-[680px] px-6 py-10">
            <FamilyProfileForm
              onSubmit={handleProfileSubmit}
              onBack={() => setFormOpen(false)}
            />
          </div>
        </div>
      )}
    </ShortlistProvider>
  );
}
