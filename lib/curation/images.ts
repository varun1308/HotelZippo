/* Hero-image download-and-store for Publish-to-Hotels (12g / specs/01b-image-sourcing.md).
 * v1: download the source hero server-side → upload to the public-read `hotel-images`
 * Storage bucket → return the Storage public URL (which is written to hotels.images).
 * On any failure we surface it so publish can be blocked (a hotel needs >= 1 image).
 *
 * 01b validation ("broken/oversized source → skip + log; never a broken image"): the response
 * MUST declare an image/* content-type (a CDN anti-bot HTML page must never upload as hero.jpg
 * and publish a broken hero) and must be ≤ MAX_HERO_BYTES. Violations throw (the publish path
 * catches per-hotel → skipped-with-reason) and are logged here. */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export const HOTEL_IMAGES_BUCKET = 'hotel-images';

/** 01b size cap — a hero larger than this is "oversized source → skip + log". */
export const MAX_HERO_BYTES = 10 * 1024 * 1024; // 10MB

/** Only called with a validated image/* content-type; default jpg for image/jpeg + friends. */
function extFromContentType(ct: string): string {
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  return 'jpg';
}

/** Skip-and-log helper: 01b requires the skip to be visible in logs, not just the thrown error. */
function skip(hotelId: string, sourceUrl: string, reason: string): never {
  // eslint-disable-next-line no-console
  console.warn(`[images] skipping hero for ${hotelId}: ${reason} (${sourceUrl})`);
  throw new Error(`hero source rejected: ${reason} for ${sourceUrl}`);
}

/** Download one source image and upload it to Storage under hotels/<hotelId>/hero.<ext>.
 * Returns the public Storage URL. Throws on download/validation/upload failure. */
export async function storeHeroImage(
  supabase: SupabaseClient,
  hotelId: string,
  sourceUrl: string,
): Promise<string> {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`hero download failed (${res.status}) for ${sourceUrl}`);

  // 01b: require a real image — anti-bot/interstitial pages come back 200 text/html.
  const contentType = res.headers.get('content-type')?.toLowerCase().trim() ?? null;
  if (!contentType || !contentType.startsWith('image/')) {
    skip(hotelId, sourceUrl, `non-image content-type "${contentType ?? 'none'}"`);
  }

  // 01b: oversized source → skip (check the declared length first to avoid buffering a monster).
  const declaredLength = Number(res.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_HERO_BYTES) {
    skip(hotelId, sourceUrl, `oversized (${declaredLength} bytes > ${MAX_HERO_BYTES})`);
  }

  const ext = extFromContentType(contentType);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error(`hero download empty for ${sourceUrl}`);
  if (bytes.byteLength > MAX_HERO_BYTES) {
    skip(hotelId, sourceUrl, `oversized (${bytes.byteLength} bytes > ${MAX_HERO_BYTES})`);
  }

  const objectPath = `hotels/${hotelId}/hero.${ext}`;
  const { error } = await supabase.storage
    .from(HOTEL_IMAGES_BUCKET)
    .upload(objectPath, bytes, {
      contentType,
      upsert: true,
    });
  if (error) throw new Error(`hero upload failed: ${error.message}`);

  const { data } = supabase.storage.from(HOTEL_IMAGES_BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}
