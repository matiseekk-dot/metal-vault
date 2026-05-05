// ── Landing layout — owns the page <metadata>. ─────────────────
// We extracted this from the (now client) page.js because Next App
// Router only honours `export const metadata` from server modules,
// and the marketing page below uses useT() to localize body copy.

export const metadata = {
  title: 'Metal Vault — Your Vinyl Collection, Tracked & Valued',
  description: 'Sync Discogs, track prices, scan barcodes at vinyl fairs. Free forever.',
};

export default function LandingLayout({ children }) {
  return children;
}
