/* Maps assembly JSON (+ hydrated _hotel) → RecommendationSet props (spec 03b). Pure. */
import { toRecommendationSetProps } from '@/lib/chat/map-recommendation';

const hydratedTopPick = {
  hotel_id: '00000000-0000-0000-0000-000000000001',
  hotel_name: 'JW Marriott Phuket Resort & Spa',
  verdict: 'This is the one I would book for your family.',
  category_summaries: { rooms: 'r', facilities: 'f', food: 'fo', location: 'l' },
  hard_flags: [
    { category: 'refurbishment', description: 'partial', severity: 'moderate' as const },
  ],
  brand_note: 'Marriott Bonvoy',
  supporting_phrases: { rooms: [], facilities: [], food: [], location: [] },
  why_top_pick: 'best Indian food signal',
  _hotel: {
    destination: 'Phuket',
    area: 'Mai Khao Beach',
    price_tier: 'luxury',
    star_rating: 5 as const,
    images: ['https://cdn.test/jw.jpg'],
  },
};

const assembly = {
  top_pick: hydratedTopPick,
  other_picks: [
    {
      hotel_id: '00000000-0000-0000-0000-000000000002',
      hotel_name: 'Angsana Laguna',
      summary: 'A clean, strong alternative.',
      hard_flags: [],
      brand_note: null,
      _hotel: { destination: 'Phuket', area: null, price_tier: 'luxury', star_rating: 5 as const, images: [] },
    },
  ],
  recommendation_notes: null,
  evaluate_only_applied: false,
  alternatives_introduced: false,
};

describe('toRecommendationSetProps', () => {
  it('maps a success assembly with hydrated hotels', () => {
    const props = toRecommendationSetProps(assembly)!;
    expect(props).not.toBeNull();
    expect(props.topPick.hotelName).toBe('JW Marriott Phuket Resort & Spa');
    expect(props.topPick.area).toBe('Mai Khao Beach');
    expect(props.topPick.priceTierLabel).toBe('Luxury');
    expect(props.topPick.starRating).toBe(5);
    expect(props.topPick.heroImageUrl).toBe('https://cdn.test/jw.jpg');
    expect(props.topPick.brandNote).toBe('Marriott Bonvoy');
    expect(props.topPick.hardFlags).toHaveLength(1);
    expect(props.otherPicks).toHaveLength(1);
    expect(props.otherPicks[0].summary).toMatch(/clean/);
    // null area → destination only; empty images → placeholder (null hero)
    expect(props.otherPicks[0].area).toBeNull();
    expect(props.otherPicks[0].heroImageUrl).toBeNull();
    // curated (no source) → not a preview card
    expect(props.topPick.isPreview).toBe(false);
  });

  it('flags isPreview when the hydrated hotel is source=preview (12i)', () => {
    const previewAssembly = {
      ...assembly,
      top_pick: { ...hydratedTopPick, _hotel: { ...hydratedTopPick._hotel, source: 'preview' as const } },
    };
    const props = toRecommendationSetProps(previewAssembly)!;
    expect(props.topPick.isPreview).toBe(true);
  });

  it('maps a preview_recommendations variant → cards (verdict, no category grid, isPreview)', () => {
    const preview = {
      result: 'preview_recommendations',
      destination: 'Bali',
      top_pick: {
        hotel_id: 'pv-1',
        hotel_name: 'Alassari Plantation',
        hard_flags: [],
        brand_note: null,
        verdict: 'Bookable now — full family review intelligence is on the way for this destination.',
        why_top_pick: 'preview',
        _hotel: { destination: 'Bali', area: null, price_tier: 'mid-range', star_rating: 4 as const, images: ['x'], source: 'preview' as const },
      },
      other_picks: [
        { hotel_id: 'pv-2', hotel_name: 'Saridevi Ecolodge', hard_flags: [], brand_note: null, summary: 'A bookable option — full review intelligence coming soon.', _hotel: { destination: 'Bali', area: null, price_tier: 'mid-range', star_rating: 3 as const, images: null, source: 'preview' as const } },
      ],
    };
    const props = toRecommendationSetProps(preview)!;
    expect(props.topPick.hotelName).toBe('Alassari Plantation');
    expect(props.topPick.isPreview).toBe(true);
    expect(props.topPick.verdict).toMatch(/bookable now/i);
    expect(props.topPick.categorySummaries).toBeUndefined(); // never fabricate a category grid
    expect(props.topPick.hardFlags).toEqual([]);
    expect(props.otherPicks[0].isPreview).toBe(true);
  });

  it('returns null for an error variant (no cards)', () => {
    expect(toRecommendationSetProps({ error: 'budget_mismatch', reason: 'x', available_tiers: [] })).toBeNull();
    expect(toRecommendationSetProps({ error: 'no_eligible_hotels', reason: 'x' })).toBeNull();
  });

  it('returns null for null/garbage input', () => {
    expect(toRecommendationSetProps(null)).toBeNull();
    expect(toRecommendationSetProps({})).toBeNull();
    expect(toRecommendationSetProps('nope')).toBeNull();
  });

  it('degrades gracefully when _hotel is missing', () => {
    const noHydration = { ...assembly, top_pick: { ...hydratedTopPick, _hotel: undefined } };
    const props = toRecommendationSetProps(noHydration)!;
    expect(props.topPick.area).toBeNull();
    expect(props.topPick.priceTierLabel).toBeNull();
    expect(props.topPick.starRating).toBeNull();
    expect(props.topPick.heroImageUrl).toBeNull();
    expect(props.topPick.destination).toBe('');
  });
});
