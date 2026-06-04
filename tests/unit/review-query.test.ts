/* Unit tests for the consumption-contract pure helpers (spec 02 / 08a-5).
 * No DB — pure functions + the budget→price-tier map. */
import {
  BUDGET_TO_PRICE_TIERS,
  MAX_CANDIDATES,
  normaliseName,
} from '@/lib/review-intelligence/query';

describe('normaliseName', () => {
  it('lowercases, collapses whitespace, strips punctuation', () => {
    expect(normaliseName('JW Marriott Phuket Resort & Spa')).toBe('jw marriott phuket resort spa');
    expect(normaliseName('  The   Mulia  Bali ')).toBe('the mulia bali');
    expect(normaliseName('Sri-Panwa, Phuket')).toBe('sri panwa phuket');
  });
  it('matches across punctuation/spacing differences', () => {
    expect(normaliseName('Holiday Inn Resort Phuket Karon Beach')).toBe(
      normaliseName('holiday inn resort  phuket karon beach!'),
    );
  });
});

describe('BUDGET_TO_PRICE_TIERS (spec 02 pre-filter)', () => {
  it('value → mid-range only', () => {
    expect(BUDGET_TO_PRICE_TIERS.value).toEqual(['mid-range']);
  });
  it('comfort → mid-range + luxury', () => {
    expect(BUDGET_TO_PRICE_TIERS.comfort).toEqual(['mid-range', 'luxury']);
  });
  it('luxury → luxury + ultra-luxury', () => {
    expect(BUDGET_TO_PRICE_TIERS.luxury).toEqual(['luxury', 'ultra-luxury']);
  });
});

describe('MAX_CANDIDATES', () => {
  it('is 15 per spec 02 / 03b', () => {
    expect(MAX_CANDIDATES).toBe(15);
  });
});
