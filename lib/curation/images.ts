/* Hero-image download-and-store for Publish-to-Hotels (12g / specs/01b-image-sourcing.md).
 * v1: download the source hero server-side → upload to the public-read `hotel-images`
 * Storage bucket → return the Storage public URL (which is written to hotels.images).
 * On any failure we surface it so publish can be blocked (a hotel needs >= 1 image). */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export const HOTEL_IMAGES_BUCKET = 'hotel-images';

function extFromContentType(ct: string | null): string {
  if (!ct) return 'jpg';
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  return 'jpg';
}

/** Download one source image and upload it to Storage under hotels/<hotelId>/hero.<ext>.
 * Returns the public Storage URL. Throws on download/upload failure. */
export async function storeHeroImage(
  supabase: SupabaseClient,
  hotelId: string,
  sourceUrl: string,
): Promise<string> {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`hero download failed (${res.status}) for ${sourceUrl}`);
  const contentType = res.headers.get('content-type');
  const ext = extFromContentType(contentType);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error(`hero download empty for ${sourceUrl}`);

  const objectPath = `hotels/${hotelId}/hero.${ext}`;
  const { error } = await supabase.storage
    .from(HOTEL_IMAGES_BUCKET)
    .upload(objectPath, bytes, {
      contentType: contentType ?? 'image/jpeg',
      upsert: true,
    });
  if (error) throw new Error(`hero upload failed: ${error.message}`);

  const { data } = supabase.storage.from(HOTEL_IMAGES_BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}
