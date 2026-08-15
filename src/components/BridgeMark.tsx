// fix-313 #64: the Blueprint Bridge mark.
//
// ★ PLACEHOLDER. Bobby's brand sheet shows a bridge arch over water in blue,
// with a simplified rounded-square icon for small sizes, but the asset file was
// not supplied — this is authored from that description so the app stops
// shipping Vite's purple lightning bolt. It is drawn to read at 16px: one arch,
// one deck, two piers, no hairlines. Swap the real export in over
// public/bridge-mark.svg and this component's paths.
//
// Kept as a component (rather than an <img> at the SVG) so the ribbon can size
// it without a network round-trip and so the collapsed ribbon shows the mark
// alone, which is the mockup's behaviour.
//
// ★ fix-320 #73 — RECOLOURED, NOT REDRAWN. Bobby: "the logo looks darker than I
// remember sharing." Every path below is byte-for-byte the fix-313 drawing; the
// square went #1e3a5f -> #4a72b0, the brand blue from Bridge_Shell_Mockup_v1.
//
// ★ The strokes moved WITH it, and had to: the arch and piers were #2563eb and
// the water #3f6ea8, which read against near-navy and would have all but
// disappeared against the lighter square — a legible mark turned muddy is not
// what "the logo looks too dark" asked for. They are now the mockup's own
// palette, white for the structure and #8fb8e8 for the deck and water.
// public/bridge-mark.svg (the favicon) carries the identical change, because one
// mark rendered two colours in two places is the drift this file exists to
// avoid.

export default function BridgeMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="Blueprint Bridge"
      data-testid="bridge-mark"
      style={{ flex: `0 0 ${size}px`, display: 'block' }}
    >
      <rect width="32" height="32" rx="8" fill="#4a72b0" />
      {/* the arch */}
      <path
        d="M5 21c0-6.1 4.9-11 11-11s11 4.9 11 11"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      {/* the deck sweeping under it */}
      <path d="M4 21.5h24" stroke="#d6e6fa" strokeWidth="2.2" strokeLinecap="round" />
      {/* piers */}
      <path d="M10.5 21.5v4M21.5 21.5v4" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
      {/* water */}
      <path
        d="M5 28.2c2.2 0 2.2-1.3 4.4-1.3s2.2 1.3 4.4 1.3 2.2-1.3 4.4-1.3 2.2 1.3 4.4 1.3 2.2-1.3 4.4-1.3"
        fill="none"
        stroke="#8fb8e8"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
