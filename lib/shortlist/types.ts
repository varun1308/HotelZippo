/* Shortlist types (Phase 3d). A saved hotel is the display-ready subset needed to
 * render a compact panel row — sourced from the hydrated card props (03b mapping).
 * Client-side only in Phase 3d; persistence is Phase 4 (auth). */
export interface SavedHotel {
  hotelId: string;
  hotelName: string;
  destination: string;
  area: string | null;
  priceTierLabel: string | null;
  heroImageUrl: string | null;
}
