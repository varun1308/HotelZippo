/* Shared display-ready fixtures for the Phase 3a card tests. */
import type {
  CardFlag,
  StandardCardProps,
  TopPickCardProps,
} from '@/components/recommendation/types';

export const moderateFlag: CardFlag = {
  category: 'Minor refurbishment',
  description:
    'The main lobby restaurant is being refreshed through December. Two alternative restaurants stay open throughout your dates.',
  severity: 'moderate',
  review_evidence_count: 41,
};

export const severeFlag: CardFlag = {
  category: 'Active refurbishment',
  description:
    'Major construction is underway across the main pool and several room blocks through your dates.',
  severity: 'severe',
  review_evidence_count: 18,
};

export const categorySummaries = {
  rooms: 'Two-bedroom family suites sleep six, with a separate kids room.',
  facilities: 'Three pools including a shaded kids pool and a quiet spa.',
  food: 'A dedicated Indian and vegetarian breakfast counter.',
  location: '20 minutes from the airport on calm Mai Khao beachfront.',
};

export const topPick: TopPickCardProps = {
  hotelName: 'JW Marriott Phuket Resort & Spa',
  destination: 'Phuket',
  area: 'Mai Khao Beach',
  priceTierLabel: 'Luxury',
  starRating: 5,
  heroImageUrl: null,
  heroLabel: 'resort hero',
  brandNote: 'Marriott Bonvoy',
  hardFlags: [moderateFlag],
  verdict: 'For your family of six, this is the one I would book.',
  categorySummaries,
  whyTopPick: 'Best fit for a multi-generational, resort-anchored December trip.',
};

export const standardPick: StandardCardProps = {
  hotelName: 'Holiday Inn Resort Karon Beach',
  destination: 'Phuket',
  area: 'Karon Beach',
  priceTierLabel: 'Comfort',
  starRating: 4,
  heroImageUrl: null,
  heroLabel: 'resort hero',
  brandNote: 'IHG One Rewards',
  hardFlags: [severeFlag],
  summary: 'On paper a solid family option — but recent stays have been disrupted by construction.',
  verdict: 'I would normally rank this higher, but I cannot recommend it for your dates.',
  verdictLabel: "Why I'd wait",
  categorySummaries,
  rankLabel: 'Runner-up',
};
