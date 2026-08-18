import logoFull from '../assets/brand/bridge-logo-400.png';
import iconSquare from '../assets/brand/bridge-icon-square-256.png';
import favicon from '../assets/brand/bridge-favicon-256.png';

// fix-322 #73 follow-up: THE REAL ARTWORK. Bobby supplied it; nothing here is
// drawn, traced or "cleaned up".
//
// fix-313 authored an inline SVG placeholder because the asset did not exist,
// and fix-320 recoloured that placeholder. Both were holding the slot. The slot
// is now filled and the placeholder SVG is GONE from this file — the component
// survives because it is still the one place that answers "show the brand mark",
// and its `data-testid` is a contract three suites already read.
//
// ★ THE SHAPE PROBLEM DECIDES THE LAYOUT. The real logo is 4:1 horizontal; the
// thing it replaced was a 26px square. They are not interchangeable, so this
// component takes the crop as a VARIANT rather than a size:
//
//     full  →  the illustration — skyline, arch, roadway, docks, water.
//              For the 248px expanded ribbon, at ~200px wide.
//     icon  →  the arch alone, square. For the 56px collapsed rail.
//
// A caller that wants "small" must ask for `icon`; there is deliberately no way
// to squash the 4:1 image into a square slot.
//
// ★★ THE FAVICON IS NOT IN HERE, AND THAT IS THE POINT. `public/bridge-mark.svg`
// keeps the SIMPLIFIED drawing. The illustration is a Seattle skyline, a bridge,
// cranes, water and trees — at 16×16 that resolves to a smudge. Bobby's own
// brand sheet draws the same line: separate "PRIMARY LOGO (DETAILED)", "ICON
// (SIMPLIFIED)" and "SMALL SIZE / FAVICON" panels, because the detailed mark is
// not meant to shrink. Verified at real sizes: the illustration reads at 200px
// wide, the square crop holds at ~34px, and below that both degrade.
//
// ★ The assets live in `src/assets/brand/` rather than `public/` so Vite
// fingerprints them (a future brand update cannot be served stale from a cache)
// and so a renamed or missing file fails the BUILD instead of 404ing in the
// ribbon at runtime. The favicon stays in `public/` for the opposite reason:
// index.html and every bookmarked tab reference it by a stable URL.

// ★★ fix-335 §1/§2 — THE BRIDGE MARK LEFT THE RIBBON, AND DID NOT LEAVE.
//
// The ribbon carries the original Blueprint logo now (§1, BlueprintMark). This
// component's artwork moved to the white header, where §2 puts it beside the
// words "The Bridge":
//
//   Bobby: "we want to add the logo from the tab to the left of that. So in the
//   center of all the screens in that white area, it's going to read logo, The
//   Bridge."
//
// ★ "THE LOGO FROM THE TAB" IS LITERAL, hence the third variant. `icon` is the
// square crop of the illustration; `favicon` is bridge-favicon-256.png — the
// same file index.html serves as the browser tab's icon. They are near
// neighbours and they are not the same drawing, and Bobby named the tab, so the
// header shows the tab's mark rather than something that merely resembles it.
//
// ★ IT IS THE SAME FILE AND NOT THE SAME URL. The tab loads /bridge-favicon-256.png
// from public/ by a stable path, because index.html and every bookmark reference
// it that way. This import is the copy in src/assets/brand/, which Vite
// fingerprints — see the note above on why brand art lives there.
export type BridgeMarkVariant = 'full' | 'icon' | 'favicon';

interface Props {
  /** Which crop. Defaults to the wide illustration. */
  variant?: BridgeMarkVariant;
  /** `full`: rendered WIDTH in px (height follows the 4:1 aspect).
   *  `icon` / `favicon`: the square's edge in px. */
  size?: number;
}

export default function BridgeMark({ variant = 'full', size }: Props) {
  const isIcon = variant === 'icon' || variant === 'favicon';
  const src =
    variant === 'favicon' ? favicon : variant === 'icon' ? iconSquare : logoFull;
  // ★ The alt text is not decoration. This replaced an <svg role="img"> that
  // carried an aria-label, and an image-only brand mark with no text equivalent
  // is silence to a screen reader.
  return (
    <img
      src={src}
      alt="Blueprint Bridge"
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
              // Width-driven, height auto: the aspect ratio comes from the file,
              // so the artwork can never be stretched by a caller's number.
              width: size ?? 200,
              height: 'auto',
              maxWidth: '100%',
              display: 'block',
            }
      }
    />
  );
}
