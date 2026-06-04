/* Unit tests for curation rules (12a / 12b). Pure functions — no DB. */
import { canApprove, canPublish } from '@/lib/curation/validator';
import type { CurationRow } from '@/lib/curation/types';

const base: CurationRow = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Test Hotel',
  destination: 'Phuket',
  tripadvisor_url: 'https://www.tripadvisor.com/x',
  review_count: 150,
  images: ['https://example.test/hero.jpg'],
  status: 'approved',
};

describe('canApprove — 100-review minimum (12a)', () => {
  it('allows >= 100 reviews', () => {
    expect(canApprove({ review_count: 100 }).ok).toBe(true);
    expect(canApprove({ review_count: 5000 }).ok).toBe(true);
  });
  it('blocks < 100 reviews and null', () => {
    expect(canApprove({ review_count: 99 }).ok).toBe(false);
    expect(canApprove({ review_count: null }).ok).toBe(false);
  });
});

describe('canPublish — required fields + image + reviews + approved', () => {
  it('passes a complete approved row', () => {
    expect(canPublish(base).ok).toBe(true);
  });
  it('blocks missing tripadvisor_url', () => {
    const r = canPublish({ ...base, tripadvisor_url: null });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/tripadvisor_url/);
  });
  it('blocks zero images (12g)', () => {
    const r = canPublish({ ...base, images: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/image/i);
  });
  it('blocks under 100 reviews', () => {
    expect(canPublish({ ...base, review_count: 40 }).ok).toBe(false);
  });
  it('blocks non-approved rows', () => {
    expect(canPublish({ ...base, status: 'pending' }).ok).toBe(false);
  });
});
