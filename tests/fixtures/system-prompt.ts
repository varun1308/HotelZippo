/* SP-01…SP-05 — Conversation Agent system-prompt fixtures (spec 08b-4).
 *
 * Per spec 15, tests validate STRUCTURE / FORMAT / CONTRACT, not model output. Each
 * fixture is a typed scenario: the injected context blocks, an inbound transcript,
 * and `expectBehaviours` — the set of behaviour TAGS the prompt artifact must encode
 * for this scenario. The structural test (system-prompt-fixtures.test.ts) asserts
 * each tagged behaviour is present in `prompts/conversation-agent/system-prompt.md`
 * (without asserting any specific live-model response). */
import {
  STANDARD_FAMILY_PROFILE,
  STANDARD_TRIP_BRIEF,
  type FixtureFamilyProfile,
  type FixtureTripBrief,
} from './family-profile';

/** A behaviour the prompt must encode, plus the substrings that prove it's encoded. */
export type PromptBehaviour =
  | 'one-question-at-a-time'
  | 'first-question-name-only'
  | 'never-reask-known-fields'
  | 'transactional-direct-to-assemble'
  | 'hard-flag-acknowledged-in-wrapper'
  | 'recommendation-wrapper-one-line-no-restate'
  | 'out-of-scope-decline-names-five'
  | 'confirmed-change-must-call-update-profile';

export interface FixtureTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface SystemPromptFixture {
  id: 'SP-01' | 'SP-02' | 'SP-03' | 'SP-04' | 'SP-05' | 'SP-06';
  title: string;
  /** Injected <family_profile> content (empty string = new user). */
  familyProfile: FixtureFamilyProfile | null;
  /** Injected <session_snapshot> content (empty string = no prior session). */
  sessionSnapshot: string | null;
  /** The inbound transcript that sets up the scenario. */
  messages: FixtureTurn[];
  /** Behaviours the prompt artifact must encode for this scenario. */
  expectBehaviours: PromptBehaviour[];
}

export const SP_FIXTURES: SystemPromptFixture[] = [
  {
    id: 'SP-01',
    title: 'New-user onboarding — one question at a time; first question is name only',
    familyProfile: null,
    sessionSnapshot: null,
    messages: [{ role: 'user', text: 'Hi, I want help planning a family trip.' }],
    expectBehaviours: ['one-question-at-a-time', 'first-question-name-only'],
  },
  {
    id: 'SP-02',
    title: 'Returning user — complete profile + partial brief; do not re-ask confirmed fields',
    familyProfile: STANDARD_FAMILY_PROFILE,
    sessionSnapshot:
      'Returning user Raj (Mumbai). Vegetarian family of four + grandparents. ' +
      'Comfort budget. Destination Phuket confirmed; trip type not yet captured.',
    messages: [{ role: 'user', text: 'Back again — where were we?' }],
    expectBehaviours: ['never-reask-known-fields', 'one-question-at-a-time'],
  },
  {
    id: 'SP-03',
    title: 'Transactional — all required fields in one message; proceed directly to assemble',
    familyProfile: null,
    sessionSnapshot: null,
    messages: [
      {
        role: 'user',
        text:
          "We're a vegetarian family of four from Mumbai, comfort budget, want a " +
          'resort-anchored trip to Phuket in December. Just give me your pick.',
      },
    ],
    expectBehaviours: ['transactional-direct-to-assemble'],
  },
  {
    id: 'SP-04',
    title: 'Hard-flag acknowledgement — severe flag surfaced in the conversational wrapper',
    familyProfile: STANDARD_FAMILY_PROFILE,
    sessionSnapshot: null,
    messages: [{ role: 'user', text: 'Phuket, a beach resort trip. What do you recommend?' }],
    expectBehaviours: [
      'hard-flag-acknowledged-in-wrapper',
      'recommendation-wrapper-one-line-no-restate',
    ],
  },
  {
    id: 'SP-05',
    title: 'Out-of-scope destination (Bangkok) — decline warmly, list the five, no hotel names',
    familyProfile: STANDARD_FAMILY_PROFILE,
    sessionSnapshot: null,
    messages: [{ role: 'user', text: 'Actually can you find us a hotel in Bangkok?' }],
    expectBehaviours: ['out-of-scope-decline-names-five'],
  },
  {
    id: 'SP-06',
    title: 'Returning user confirms a saved-field change → MUST call update_profile, not narrate',
    familyProfile: STANDARD_FAMILY_PROFILE,
    sessionSnapshot:
      'Returning user Raj (Mumbai). Saved profile present: vegetarian, comfort budget.',
    messages: [{ role: 'user', text: 'Actually, change my budget to luxury.' }],
    expectBehaviours: ['confirmed-change-must-call-update-profile'],
  },
];

/** Re-export the standard data so SP consumers can build the injection blocks. */
export { STANDARD_FAMILY_PROFILE, STANDARD_TRIP_BRIEF };
export type { FixtureFamilyProfile, FixtureTripBrief };
