/* Curation rules (12a). Enforced both before approval and before publish. */
import { MIN_REVIEWS, type CurationRow } from './types';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** A hotel may be APPROVED only with >= 100 reviews (12 / 12a). */
export function canApprove(row: Pick<CurationRow, 'review_count'>): ValidationResult {
  const errors: string[] = [];
  if (row.review_count == null || row.review_count < MIN_REVIEWS) {
    errors.push(`Needs at least ${MIN_REVIEWS} reviews to approve (has ${row.review_count ?? 0}).`);
  }
  return { ok: errors.length === 0, errors };
}

/** Publish-to-Hotels blockers: required fields + at least one image (12a + 12g). */
export function canPublish(row: CurationRow): ValidationResult {
  const errors: string[] = [];
  if (!row.name?.trim()) errors.push('Missing name.');
  if (!row.destination) errors.push('Missing destination.');
  if (!row.tripadvisor_url) errors.push('Missing tripadvisor_url.');
  if (!row.images || row.images.length === 0) errors.push('Needs at least one image (see 12g).');
  if (row.review_count == null || row.review_count < MIN_REVIEWS) {
    errors.push(`Needs at least ${MIN_REVIEWS} reviews.`);
  }
  if (row.status !== 'approved') errors.push('Only approved rows can be published.');
  return { ok: errors.length === 0, errors };
}
