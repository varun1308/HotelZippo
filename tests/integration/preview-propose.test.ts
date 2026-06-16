/* Preview seeding step 1 — proposeHotels (lib/preview/propose). Uses the injectable `generate` seam
 * (no provider-protocol mock): asserts validation, de-dupe, cap, and the honest prompt. */
import { proposeHotels, buildProposePrompt } from '@/lib/preview/propose';

describe('proposeHotels', () => {
  it('returns the proposed names via the injected generate seam', async () => {
    const generate = async () => ({
      hotels: [
        { name: 'Mulia Resort', oneLineWhy: 'big pools, kids club' },
        { name: 'Padma Resort Legian', oneLineWhy: 'beachfront, family rooms' },
      ],
    });
    const out = await proposeHotels('Bali', { generate, count: 5 });
    expect(out.map((h) => h.name)).toEqual(['Mulia Resort', 'Padma Resort Legian']);
  });

  it('de-dupes by case-insensitive name and caps to count', async () => {
    const generate = async () => ({
      hotels: [
        { name: 'Mulia Resort', oneLineWhy: 'a' },
        { name: 'mulia resort', oneLineWhy: 'dup' },
        { name: 'Padma Resort', oneLineWhy: 'b' },
        { name: 'The Apurva', oneLineWhy: 'c' },
      ],
    });
    const out = await proposeHotels('Bali', { generate, count: 2 });
    expect(out).toHaveLength(2); // capped
    expect(out.map((h) => h.name)).toEqual(['Mulia Resort', 'Padma Resort']); // dup dropped
  });

  it('drops blank names', async () => {
    const generate = async () => ({
      hotels: [
        { name: '   ', oneLineWhy: 'x' },
        { name: 'Real Hotel', oneLineWhy: 'y' },
      ],
    });
    const out = await proposeHotels('Bali', { generate });
    expect(out.map((h) => h.name)).toEqual(['Real Hotel']);
  });

  it('throws on an unknown destination', async () => {
    await expect(proposeHotels('Atlantis', { generate: async () => ({ hotels: [] }) })).rejects.toThrow(/unknown destination/i);
  });

  it('the prompt asks for names + one-line why and forbids invented facts', () => {
    const p = buildProposePrompt('Bali', 5);
    expect(p).toMatch(/Bali/);
    expect(p).toMatch(/family/i);
    expect(p).toMatch(/do not invent/i);
  });
});
