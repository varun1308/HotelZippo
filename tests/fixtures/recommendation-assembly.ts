/* RA-01..RA-05 fixtures for the recommendation-assembly contract (spec 08b-4).
 * Each fixture pairs an input set with a representative model OUTPUT and the
 * structural assertions the contract must hold (per 15: structure, not content).
 * These back tests/contract/recommendation-assembly.test.ts. The outputs here stand
 * in for the live model so CI runs with no ANTHROPIC_API_KEY (injectable assembler). */
import type {
  RecommendationAssembly,
} from '@/lib/contracts/recommendation-assembly';

const uuid = (n: number) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;

const emptyPhrases = { rooms: [], facilities: [], food: [], location: [] };

/** RA-01 — Resort-anchored. Anantara (Indian food + strong) top pick; JW Marriott
 * (preferred brand, no Indian guest reviews) in other_picks; Holiday Inn has a hard flag. */
export const RA01: RecommendationAssembly = {
  top_pick: {
    hotel_id: uuid(1),
    hotel_name: 'Anantara Phuket',
    verdict:
      'For your vegetarian grandparents and two young kids, Anantara is the most reassuring choice in Phuket.',
    category_summaries: {
      rooms: 'Families consistently report spacious connecting rooms.',
      facilities: 'Families consistently report a well-run kids club.',
      food: 'Confirmed Indian food — guests note reliable dal and mild curries.',
      location: 'Families consistently report a calm, safe beach.',
    },
    hard_flags: [],
    brand_note: null,
    supporting_phrases: emptyPhrases,
    why_top_pick:
      'Chosen over JW Marriott because your vegetarian grandparents need confirmed Indian food, which only Anantara has.',
  },
  other_picks: [
    {
      hotel_id: uuid(2),
      hotel_name: 'JW Marriott Phuket',
      summary:
        'Your preferred brand with a strong kids club, but note: no reviews from Indian guests found, so the vegetarian situation is unconfirmed.',
      hard_flags: [],
      brand_note: 'Marriott Bonvoy property — eligible for points',
    },
    {
      hotel_id: uuid(3),
      hotel_name: 'Holiday Inn Resort Phuket Karon Beach',
      summary: 'Good value and walkable, but undergoing a major refurbishment.',
      hard_flags: [
        {
          category: 'refurbishment',
          description: 'Resort-wide construction with noise and dust.',
          severity: 'severe',
          review_evidence_count: 47,
        },
      ],
      brand_note: null,
    },
  ],
  recommendation_notes: null,
  evaluate_only_applied: false,
  alternatives_introduced: false,
};

/** RA-02 — low_confidence excluded (Marina Bay Sands gone). Shangri-La top pick;
 * other_picks empty. */
export const RA02: RecommendationAssembly = {
  top_pick: {
    hotel_id: uuid(10),
    hotel_name: 'Shangri-La Singapore',
    verdict: 'For a city trip with young children, Shangri-La is the clear pick.',
    category_summaries: {
      rooms: 'Families consistently report large family rooms.',
      facilities: 'Families consistently report an excellent kids zone.',
      food: 'Strong breakfast variety for children.',
      location: 'Families consistently report easy transport access.',
    },
    hard_flags: [],
    brand_note: null,
    supporting_phrases: emptyPhrases,
    why_top_pick: 'The only eligible hotel with strong, current family reviews for your dates.',
  },
  other_picks: [],
  recommendation_notes: 'Only one hotel met the confidence bar for this destination.',
  evaluate_only_applied: false,
  alternatives_introduced: false,
};

/** RA-03 — evaluate_only. Only the two shortlisted hotels considered; the stronger
 * non-shortlisted Gili Lankanfushi is NOT introduced. */
export const RA03: RecommendationAssembly = {
  top_pick: {
    hotel_id: uuid(20),
    hotel_name: 'Soneva Fushi',
    verdict: 'Of the two you shortlisted, Soneva Fushi is the stronger fit for your family.',
    category_summaries: {
      rooms: 'Families consistently report huge villas.',
      facilities: 'Families consistently report a standout kids club.',
      food: 'Fewer family reviews on this, but guests generally note good variety.',
      location: 'Families consistently report a private, safe island.',
    },
    hard_flags: [],
    brand_note: null,
    supporting_phrases: emptyPhrases,
    why_top_pick: 'Stronger family signal than Six Senses Laamu across rooms and facilities.',
  },
  other_picks: [
    {
      hotel_id: uuid(21),
      hotel_name: 'Six Senses Laamu',
      summary: 'Also on your shortlist; strong but with thinner family review coverage.',
      hard_flags: [],
      brand_note: null,
    },
  ],
  recommendation_notes: 'Limited to the hotels you asked me to evaluate.',
  evaluate_only_applied: true,
  alternatives_introduced: false,
};

/** RA-04 — budget mismatch. value tier, all ultra-luxury available. */
export const RA04: RecommendationAssembly = {
  error: 'budget_mismatch',
  reason:
    'The hotels we cover here at your dates are all ultra-luxury, which is above your value budget.',
  available_tiers: ['ultra-luxury'],
};

/** RA-05 — all hotels flagged. A (moderate, strong) top pick; all flags survive;
 * recommendation_notes states all options are flagged. */
export const RA05: RecommendationAssembly = {
  top_pick: {
    hotel_id: uuid(30),
    hotel_name: 'Hotel A',
    verdict:
      'Hotel A is the strongest overall, though there is one thing to be aware of before booking.',
    category_summaries: {
      rooms: 'Families consistently report good room sizes.',
      facilities: 'Families consistently report a solid pool.',
      food: 'Good breakfast variety.',
      location: 'Central and walkable.',
    },
    hard_flags: [
      {
        category: 'noise',
        description: 'Moderate street noise on lower floors.',
        severity: 'moderate',
        review_evidence_count: 8,
      },
    ],
    brand_note: null,
    supporting_phrases: emptyPhrases,
    why_top_pick: 'Strongest family signal of the three despite a minor noise flag.',
  },
  other_picks: [
    {
      hotel_id: uuid(31),
      hotel_name: 'Hotel B',
      summary: 'Worth considering but undergoing a refurbishment.',
      hard_flags: [
        {
          category: 'refurbishment',
          description: 'Severe ongoing refurbishment.',
          severity: 'severe',
          review_evidence_count: 22,
        },
      ],
      brand_note: null,
    },
    {
      hotel_id: uuid(32),
      hotel_name: 'Hotel C',
      summary: 'An option, but with a reported pest issue.',
      hard_flags: [
        {
          category: 'pests',
          description: 'Severe recurring pest reports.',
          severity: 'severe',
          review_evidence_count: 15,
        },
      ],
      brand_note: null,
    },
  ],
  recommendation_notes:
    'All available hotels for this destination have structural flags worth reviewing. Recommendations are based on the strongest overall match despite these issues.',
  evaluate_only_applied: false,
  alternatives_introduced: false,
};

export const RA_FIXTURES = { RA01, RA02, RA03, RA04, RA05 } as const;
