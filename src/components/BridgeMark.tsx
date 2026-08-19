import lockup from '../assets/brand/bridge-logo-2026.png';
import iconSquare from '../assets/brand/bridge-icon-2026-256.png';

// fix-322 #73 follow-up: THE REAL ARTWORK. Bobby supplied it; nothing here is
// drawn, traced or "cleaned up".
//
// fix-313 authored an inline SVG placeholder because the asset did not exist,
// and fix-320 recoloured that placeholder. Both were holding the slot. The slot
// is now filled and the placeholder SVG is GONE from this file — the component
// survives because it is still the one place that answers "show the brand mark",
// and its `data-testid` is a contract five suites already read.
//
// ★★★ fix-351 — ONE ARTWORK REPLACES A MARK AND STYLED TEXT.
//
// Bobby supplied a new lockup, and it already contains both halves of what the
// header was assembling: the bridge, the word "THE", the word "BRIDGE", and the
// two blue rules under them. So the header stopped rendering an icon beside a
// styled <span> and now renders ONE image — see Chrome.tsx.
//
// ★★ THE SHAPE PROBLEM STILL DECIDES THE LAYOUT, and it got sharper. The old
// illustration was 4:1; this lockup is **5.72:1** (2030 × 355). It cannot be
// squashed into a square slot, so the crop is a VARIANT rather than a size:
//
//     lockup  →  the full artwork — bridge, "THE BRIDGE", and the two rules.
//                For the white header, at ~412px wide.
//     icon    →  the bridge and its road, square, cropped from ABOVE the word
//                and above the rules. For the browser tab and anywhere small.
//
// ★★ WHY `favicon` IS GONE AS A SEPARATE VARIANT. fix-335 needed three because
// the old asset set held TWO near-identical squares — `bridge-icon-square-256`
// (a crop of the illustration) and `bridge-favicon-256` (the brand sheet's own
// icon) — and Bobby had named the tab's one specifically: "we want to add the
// logo from the tab". The 2026 set has exactly ONE square, and the tab and the
// app both use it. Keeping two names pointing at one file would be a
// distinction describing nothing, which is the thing fix-351's brief warns is
// how the next person concludes something is meant to come back.
//
// ★ WHY THE SQUARE EXISTS AT ALL — the same reason as before, re-measured on
// the new art. The lockup is 5.72:1: in a 32px tab it is an illegible smear,
// and letterboxed it is ~6px tall. The square is checked at 128 / 64 / 32 / 16
// and the silhouette survives to 16px, which is the practical floor for artwork
// this detailed. Bobby's own brand sheet draws the same line, with separate
// "PRIMARY LOGO (DETAILED)" and "ICON (SIMPLIFIED)" panels.
//
// ★ The assets live in `src/assets/brand/` rather than `public/` so Vite
// fingerprints them (a brand update cannot be served stale from a cache) and so
// a renamed or missing file fails the BUILD instead of 404ing in the header at
// runtime. The tab's copies stay in `public/` for the opposite reason:
// index.html and every bookmarked tab reference them by a stable URL. fix-326
// asserts that split and fix-351 keeps it — the same two files exist in both
// places on purpose.
export type BridgeMarkVariant = 'lockup' | 'icon';

interface Props {
  /** Which crop. Defaults to the full lockup. */
  variant?: BridgeMarkVariant;
  /** `lockup`: rendered HEIGHT in px (width follows the 5.72:1 aspect).
   *  `icon`: the square's edge in px.
   *
   *  ★ fix-351 flipped the lockup from width-driven to HEIGHT-driven, and it is
   *  not a preference: the whole point of the new artwork is that the rule
   *  inside it lands on the header's bottom border, and that alignment is
   *  arithmetic on the HEIGHT (see shellMetrics.BRAND_LOCKUP_DROP). A
   *  width-driven size would make the alignment a function of the aspect ratio
   *  of whatever file is imported. */
  size?: number;
}

export default function BridgeMark({ variant = 'lockup', size }: Props) {
  const isIcon = variant === 'icon';
  const src = isIcon ? iconSquare : lockup;
  // ★ The alt text is not decoration. This replaced an <svg role="img"> that
  // carried an aria-label, and an image-only brand mark with no text equivalent
  // is silence to a screen reader.
  //
  // ★★ fix-351: the alt text now carries the WORDS THAT USED TO BE A <span>.
  // The header rendered "the Bridge" as real text; that text is inside the
  // artwork now, so without this the product's name would have left the
  // accessible name, the clipboard and every screen reader at once — the exact
  // failure fix-345 §2 refused to accept when it wrote the lowercase "t" out in
  // full rather than using text-transform.
  return (
    <img
      src={src}
      alt={isIcon ? 'The Bridge' : 'The Bridge — Blueprint'}
      data-testid="bridge-mark"
      data-logo-variant={variant}
      style={
        isIcon
          ? {
              width: size ?? 34,
              height: size ?? 34,
              flex: `0 0 ${size ?? 34}px`,
              display: 'block',
            }
          : {
              // Height-driven, width auto: the aspect ratio comes from the file,
              // so the artwork can never be stretched by a caller's number.
              height: size ?? 72,
              width: 'auto',
              maxWidth: '100%',
              display: 'block',
            }
      }
    />
  );
}
