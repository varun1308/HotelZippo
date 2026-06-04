import type { Metadata } from 'next';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'HotelZippo',
  description:
    'An AI concierge that finds the right hotel for Indian families travelling with young children across Asia.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // data-brand defaults to terracotta (the :root tokens). Set e.g.
  // data-brand="ocean" to re-tint at runtime (see styles/brand-themes.css).
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
