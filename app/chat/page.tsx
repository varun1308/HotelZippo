/* Chat page — wires the real agent-backed chat (3c) together with the Phase 3d
 * onboarding surface: the Trip Brief rail, the Family Profile form, and the
 * Shortlist panel.
 *
 * State lives here. As of Phase 4 it is PERSISTED to Supabase, keyed to the
 * signed-in user (RLS scopes every row to auth.uid()):
 *   • useTripBrief  — filled from the user's own messages (deterministic detector)
 *                     and locked on recommendation arrival, via a tapped source.
 *   • useShortlist  — saved hotels; exposed to the inline cards through
 *                     ShortlistProvider (the cards render deep in the stream). Saved
 *                     hotel ids are persisted to `shortlists` on change.
 *   • family_profile — loaded on mount (Edit-profile prefill) and upserted on submit.
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatShell, type ChatShellRailApi } from '@/components/chat';
import { chatHttpStream } from '@/lib/chat/httpStream';
import type { StreamChunk, StreamSource } from '@/lib/chat/types';
import { TripBrief } from '@/components/brief';
import { ShortlistPanel } from '@/components/shortlist';
import { FamilyProfileForm } from '@/components/profile';
import type { FamilyProfile } from '@/components/profile';
import { AccountMenu } from '@/components/account';
import { useTripBrief } from '@/lib/brief/useTripBrief';
import { useShortlist } from '@/lib/shortlist/useShortlist';
import { ShortlistProvider } from '@/lib/shortlist/context';
import { BookingProvider } from '@/lib/booking/context';
import { useBookingFlow } from '@/lib/booking/useBookingFlow';
import { RoomPickerModal } from '@/components/booking/RoomPickerModal';
import { useUser } from '@/lib/auth/useUser';
import { signOut } from '@/lib/auth/signIn';
import { loadFamilyProfile, saveFamilyProfile, emptyProfile } from '@/lib/db/persistence/family-profiles';
import { saveShortlist, loadShortlistHotels } from '@/lib/db/persistence/shortlists';
import { loadLatestSnapshot } from '@/lib/db/persistence/sessions';
import { loadInflightJob } from '@/lib/recommendations/job-ledger';
import { createSupabaseBrowserClient } from '@/lib/db/ssr';
import { useSessionSnapshot } from '@/lib/chat/useSessionSnapshot';
import type { ChatMessage } from '@/lib/chat/types';

/** What the agent tool's recommendation component carries (per map-recommendation). */
interface RecoProps {
  topPick?: { destination?: string; priceTierLabel?: string | null };
}

/** A minimal profile used only to carry the auth name to the agent for a user who hasn't
 * onboarded yet. Every other field is left at its "unknown" default (empty children, null
 * hometown, etc.) so the concierge still collects them — only the name is pre-known. */
const EMPTY_PROFILE: FamilyProfile = emptyProfile();

export default function ChatPage() {
  const brief = useTripBrief();
  const shortlist = useShortlist();
  const { user } = useUser();
  const [formOpen, setFormOpen] = useState(false);
  const [shortlistOpen, setShortlistOpen] = useState(false);
  // The saved family profile (Phase 4) — loaded once on mount, used to prefill the
  // Edit-profile form. null until loaded or if the user has none yet.
  const [savedProfile, setSavedProfile] = useState<FamilyProfile | null>(null);
  // The resumed session snapshot (Phase 5) — the latest session_summary for the user,
  // injected into the agent so the concierge picks up where they left off. A ref (not
  // state) because it only needs to be read when a turn is sent, not to trigger a render.
  const sessionSnapshotRef = useRef<string | null>(null);
  // Latest conversation, kept for the snapshot trigger hook (read at trigger time).
  const messagesRef = useRef<ChatMessage[]>([]);
  // 03c durability: a recommendation that was still ASSEMBLING when the page closed. Loaded on mount
  // from the user's in-flight recommendation_jobs row (owner-read RLS) and seeded as an
  // assembly-progress block so the chat resumes the progress + lands the cards. `reattachReady` keys
  // ChatShell so it re-inits with the seed once the (async) load settles.
  const [reattachMessages, setReattachMessages] = useState<ChatMessage[] | null>(null);
  const [reattachReady, setReattachReady] = useState(false);
  // The family profile to hand the agent each turn (so it greets by name + never re-asks
  // known fields). A ref because it's only read when a turn is sent. Holds the saved profile
  // when there is one; otherwise a minimal profile seeded with the user's auth name (Google
  // full_name / dev name) so a signed-in user is never anonymous to the concierge.
  const profileRef = useRef<FamilyProfile | null>(null);

  const { applyUserText, applyRecommendationGates, applyProfile } = brief;

  // Phase 5: silent auto-resume — load the user's most recent session snapshot on mount.
  // No picker, no UI prompt (locked v1 default); the agent injects it on the next turn.
  useEffect(() => {
    if (!user) return;
    let active = true;
    loadLatestSnapshot(createSupabaseBrowserClient())
      .then((s) => {
        if (active) sessionSnapshotRef.current = s;
      })
      .catch(() => {
        /* no prior session / no env → fresh onboarding */
      });
    return () => {
      active = false;
    };
  }, [user]);

  // 03c: on mount, re-attach an in-flight assembly job (page closed mid-assembly) so the user resumes
  // the progress and still gets their cards. Owner-read RLS scopes it to their own job. Best-effort:
  // any failure → no seed (fresh chat), never blocks the page. `reattachReady` always flips so ChatShell
  // mounts whether or not a job was found.
  useEffect(() => {
    if (!user) {
      setReattachReady(true);
      return;
    }
    let active = true;
    loadInflightJob(createSupabaseBrowserClient())
      .then((job) => {
        if (!active) return;
        if (job) {
          setReattachMessages([
            {
              id: `reattach-${job.id}`,
              role: 'assistant',
              parts: [
                { type: 'text', text: 'Picking your recommendations back up…' },
                { type: 'component', component: 'assembly-progress', props: { jobId: job.id, destination: job.destination } },
              ],
            },
          ]);
        }
      })
      .catch(() => {
        /* no job / no env → fresh chat */
      })
      .finally(() => {
        if (active) setReattachReady(true);
      });
    return () => {
      active = false;
    };
  }, [user]);

  // Fire a snapshot at the trigger points (session end / inactivity / navigation away).
  useSessionSnapshot({ getMessages: () => messagesRef.current, enabled: !!user });

  // Load the signed-in user's saved profile once (Edit-profile prefill + brief seed).
  // If they have none yet but signed in with a display name (Google full_name / dev name),
  // persist a starter profile carrying just that name — so the name is durable across
  // reloads and reaches the agent, while onboarding still collects the rest.
  useEffect(() => {
    if (!user) return;
    let active = true;
    loadFamilyProfile()
      .then((p) => {
        if (!active) return;
        if (p) {
          setSavedProfile(p);
          applyProfileToBrief(p);
        } else if (user.name?.trim()) {
          const starter: FamilyProfile = { ...EMPTY_PROFILE, name: user.name.trim() };
          setSavedProfile(starter);
          saveFamilyProfile(starter, user.id).catch(() => {
            /* best-effort: the in-memory starter still reaches the agent */
          });
        }
      })
      .catch(() => {
        /* no profile / no env → ignore; the page still works */
      });
    return () => {
      active = false;
    };
    // applyProfileToBrief is stable (defined below via useCallback over applyProfile).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Keep the profile we hand the agent current. Prefer the saved profile; if it has no name
  // yet (or there's no saved profile), seed the name from the auth identity (Google
  // full_name / dev name) so the concierge can greet a signed-in user immediately. Onboarding
  // still confirms/overrides the name — this only ensures the agent isn't blind to it.
  useEffect(() => {
    const authName = user?.name?.trim() || null;
    if (savedProfile) {
      profileRef.current =
        savedProfile.name?.trim() || !authName ? savedProfile : { ...savedProfile, name: authName };
    } else if (authName) {
      profileRef.current = { ...EMPTY_PROFILE, name: authName };
    } else {
      profileRef.current = null;
    }
  }, [savedProfile, user]);

  // Wrap the real source so each USER turn feeds the detector, and each
  // recommendation arrival locks the gate fields (destination/type/budget known).
  const source: StreamSource = useCallback(
    (input, history) => {
      applyUserText(input);
      // Resume context (Phase 5): pass the loaded snapshot so the agent injects
      // <session_snapshot> and continues without repetition. Empty ⇒ fresh onboarding.
      // Also pass the signed-in user's profile (Phase 4) so the agent greets by name and
      // skips re-asking known fields.
      const inner = chatHttpStream(input, history, sessionSnapshotRef.current, profileRef.current);
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
          } else if (chunk.type === 'component' && chunk.component === 'profile-update') {
            // The agent just persisted a confirmed profile change (server-side, RLS-scoped).
            // Re-load the saved profile so profileRef carries the fresh values on the NEXT turn
            // — keeping the injected <family_profile> consistent with what was just written.
            loadFamilyProfile()
              .then((p) => {
                if (p) setSavedProfile(p);
              })
              .catch(() => {
                /* best-effort refresh; the chip already confirmed the save to the user */
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

  // Phase 7 booking flow. The card's "Proceed to book" opens a deterministic modal:
  // confirm (travellers · rooms · dates, seeded from the saved profile) → live rooms/rates →
  // room picker → deep-link checkout (opened in a new tab). The brief's `dates` is free-text
  // (e.g. "early July"), not a resolvable start+end, so we pass null and let the confirm
  // screen collect exact dates — the month-only path from the spec.
  const bookingFlow = useBookingFlow({ profile: savedProfile, dates: null });
  const bookingActions = useMemo(() => ({ proceed: bookingFlow.proceed }), [bookingFlow.proceed]);

  // Re-hydrate the working shortlist from Supabase on mount (keyed to the user), so a saved
  // shortlist survives a page reload. We load the saved ids → display-ready SavedHotel rows
  // (from `hotels`) and seed the in-memory shortlist ONCE. Best-effort: a failure leaves an
  // empty shortlist rather than crashing. `shortlistHydrated` flips true when the load settles
  // — the persist effect below waits for it, so re-hydration never round-trips back to a write.
  const shortlistHydrated = useRef(false);
  const { hydrate: hydrateShortlist } = shortlist;
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    loadShortlistHotels()
      .then((saved) => {
        if (cancelled) return;
        if (saved.length > 0) hydrateShortlist(saved);
      })
      .catch(() => {
        /* warm-fail: start with an empty shortlist */
      })
      .finally(() => {
        if (!cancelled) shortlistHydrated.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [user, hydrateShortlist]);

  // Persist the shortlist (saved hotel ids) whenever it changes, keyed to the user — but only
  // AFTER the initial re-hydration has settled, so loading the saved set doesn't immediately
  // re-write it (and an empty first render never clobbers a stored shortlist). Best-effort.
  const shortlistIds = shortlist.items.map((h) => h.hotelId).join(',');
  useEffect(() => {
    if (!user) return;
    if (!shortlistHydrated.current) return; // wait for the load to settle
    const ids = shortlistIds ? shortlistIds.split(',') : [];
    saveShortlist(ids, user.id).catch(() => {
      /* warm-fail: keep the in-memory shortlist; do not crash */
    });
    // shortlistIds is the stable signal for "the set changed".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortlistIds, user]);

  // Map a family profile → the trip-brief enrichment fields (budget / food / who).
  const applyProfileToBrief = useCallback(
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
    },
    [applyProfile],
  );

  // Submitting the structured form seeds the brief, PERSISTS the profile (user-scoped),
  // and returns to the chat. Persistence is best-effort: a save failure surfaces in the
  // console trace but never blocks the UX (the brief still updates).
  const handleProfileSubmit = useCallback(
    (profile: FamilyProfile) => {
      applyProfileToBrief(profile);
      setSavedProfile(profile);
      setFormOpen(false);
      if (user) {
        saveFamilyProfile(profile, user.id).catch(() => {
          /* warm-fail: keep the local update; do not crash the page */
        });
      }
    },
    [applyProfileToBrief, user],
  );

  return (
    <ShortlistProvider actions={shortlistActions}>
      <BookingProvider actions={bookingActions}>
      <ChatShell
        // Key on the re-attach load so ChatShell re-inits with the seeded in-flight job once it settles.
        key={reattachReady ? (reattachMessages ? 'reattached' : 'fresh') : 'loading'}
        initialMessages={reattachMessages ?? undefined}
        source={source}
        briefCount={brief.filledCount}
        shortlistCount={shortlist.count}
        onSwitchToForm={() => setFormOpen(true)}
        onOpenShortlist={() => setShortlistOpen(true)}
        onMessages={(m) => {
          messagesRef.current = m;
        }}
        accountMenu={
          user ? (
            <AccountMenu
              user={{ name: user.name, email: user.email, avatarUrl: user.avatarUrl }}
              onEditProfile={() => setFormOpen(true)}
              onSignOut={signOut}
            />
          ) : null
        }
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
              initial={savedProfile ?? undefined}
            />
          </div>
        </div>
      )}

      <RoomPickerModal
        open={bookingFlow.state.step !== 'idle'}
        step={bookingFlow.state.step === 'idle' ? 'confirm' : bookingFlow.state.step}
        hotelName={bookingFlow.state.hotel?.hotelName ?? ''}
        party={bookingFlow.state.party}
        grandparentHint={bookingFlow.state.grandparentHint}
        dates={bookingFlow.state.dates}
        onPartyChange={bookingFlow.setParty}
        onDatesChange={bookingFlow.setDates}
        onConfirm={bookingFlow.confirm}
        options={bookingFlow.state.options}
        onSelectRoom={bookingFlow.selectRoom}
        error={bookingFlow.state.error}
        onRetry={bookingFlow.retry}
        onClose={bookingFlow.close}
      />
      </BookingProvider>
    </ShortlistProvider>
  );
}
