/* Phase 3d — the deterministic brief detector (lib/brief/detect.ts).
 * It must detect signals from the user's own prose and NEVER invent. */
import { detectBriefUpdates } from '@/lib/brief/detect';
import { DESTINATIONS } from '@/lib/db/schemas';

describe('detectBriefUpdates', () => {
  it('detects each of the 5 covered destinations by name', () => {
    for (const d of DESTINATIONS) {
      expect(detectBriefUpdates(`We are thinking about ${d} this winter`).destination).toBe(d);
    }
  });

  it('returns the canonical destination casing regardless of input casing', () => {
    expect(detectBriefUpdates('somewhere in PHUKET please').destination).toBe('Phuket');
    expect(detectBriefUpdates('tokyo sounds fun').destination).toBe('Tokyo');
  });

  it('maps budget words to the tier labels', () => {
    expect(detectBriefUpdates('we want something luxury').budget).toBe('Luxury');
    expect(detectBriefUpdates('a comfortable mid-range place').budget).toBe('Comfort');
    expect(detectBriefUpdates('keep it budget-friendly').budget).toBe('Value');
  });

  it('detects trip type families', () => {
    expect(detectBriefUpdates('a relaxing beach resort').type).toBe('Resort-anchored');
    expect(detectBriefUpdates('lots of city sightseeing and shopping').type).toBe('City / activity');
    expect(detectBriefUpdates('a multi-city road trip').type).toBe('Multi-city');
  });

  it('detects vegetarian and vegan, with vegan implying vegetarian', () => {
    expect(detectBriefUpdates('we are vegetarian').food).toBe('Vegetarian');
    expect(detectBriefUpdates('strictly vegan').food).toBe('Vegan');
  });

  it('combines vegetarian + Indian food into one signal', () => {
    expect(detectBriefUpdates('vegetarian and Indian food matters a lot').food).toBe(
      'Vegetarian · Indian options important',
    );
  });

  it('detects a concrete party signal for who', () => {
    expect(detectBriefUpdates('travelling with two kids and grandparents').who).toBe(
      'Family with young children',
    );
  });

  it('detects rough dates from month names and relative phrases', () => {
    expect(detectBriefUpdates('we travel in December').dates).toBe('December');
    expect(detectBriefUpdates('thinking next month').dates).toBe('Next month');
  });

  it('NEVER invents — unrelated text yields an empty patch', () => {
    expect(detectBriefUpdates('hello, can you help me?')).toEqual({});
    expect(detectBriefUpdates('')).toEqual({});
  });

  it('does not match a destination substring inside another word', () => {
    // "balinese" should not falsely set destination to Bali via word boundaries.
    expect(detectBriefUpdates('I love balinese art galleries').destination).toBeUndefined();
  });
});
