import lockup from '../assets/brand/blueprint-logo-lockup.png';
import roundel from '../assets/brand/blueprint-logo-icon.png';

// ★★ fix-335 §1 — THE ORIGINAL BLUEPRINT LOGO COMES BACK.
//
// Bobby, pointing at the Bridge illustration in the ribbon: "we have the new
// logo that we were using, and we want to replace that with the original
// Blueprint logo."
//
// ★ THIS IS A DIFFERENT MARK FROM BridgeMark, AND THEY BOTH STAY. The Bridge
// artwork has not been deleted — fix-335 §2 moves it into the white header as
// the tab icon beside "The Bridge". So the app now shows the COMPANY in the
// ribbon and the PRODUCT in the header, which is the split Bobby described, and
// two components say which is which by their names rather than one component
// growing a third meaning for `variant`.
//
// ---------------------------------------------------------------------------
// ★★★ THE ASSET, AND WHAT WAS DONE TO IT — read this before replacing it
// ---------------------------------------------------------------------------
//
// `blueprint-original-logo.png` is Bobby's file, byte for byte, kept in this
// folder as the source of record. It is NOT the file rendered here, and the
// reason is measurable rather than aesthetic. Decoded, its 200x57 canvas is:
//
//     rows  0-13   empty
//     rows 14-41   the mark        (x 19-162 — so 144 x 28 of actual artwork)
//     rows 42-54   empty
//     row  55      a full-width #e4e4e7 rule
//
// ★ Only 49% of the file's height is the logo, and the last row is a capture
// artifact — #e4e4e7 is a UI border colour, spanning the full width, flush to
// the bottom edge with a 13px gap above it. It is the boundary of whatever the
// mark was screenshotted out of, not part of the mark: a designed rule does not
// sit 13px below a logo that is itself floating 14px from the top.
//
// Shipping the canvas as-is would have put that grey line directly above the
// ribbon's own bottom border — two rules, 1px apart, reading as a mistake — and
// rendered the artwork at 78% of the space it was given. So the two files
// imported here are LOSSLESS CROPS of Bobby's original: the pixels are his,
// unresampled and unretouched, with the transparent margin and the captured
// rule removed. Nothing is drawn, traced or cleaned up — the fix-322 rule.
//
//     lockup  144 x 28   the roundel + BLUEPRINT       → the expanded ribbon
//     icon     28 x 28   the roundel alone, squared    → the 56px collapsed rail
//
// ★★ BOTH RENDER AT EXACTLY 1:1 AND THAT IS THE CEILING. 144px of source in a
// 144px slot is as sharp as this file can be; on a 2x display the browser has
// to invent every second pixel and the mark will look soft. There is no
// higher-resolution original in the repo. A 2x PNG (288 x 56) or an SVG would
// fix it with no code change beyond the import — the sizes below are the
// artwork's own, so a larger file simply lands crisper in the same slot.
//
// ★ ASSETS LIVE IN src/assets/brand/ so Vite fingerprints them and a renamed
// file fails the BUILD rather than 404ing in the ribbon. Same reasoning, and
// the same folder, as BridgeMark.

export type BlueprintMarkVariant = 'lockup' | 'icon';

/** Native pixel dimensions of the two crops. Exported as the single source of
 *  the default sizes so a caller cannot silently upscale by passing a number
 *  larger than the artwork — and so the test can assert 1:1 without hardcoding
 *  a second copy of the numbers. */
export const BLUEPRINT_LOCKUP_WIDTH = 144;
export const BLUEPRINT_ICON_SIZE = 28;

interface Props {
  variant?: BlueprintMarkVariant;
  /** `lockup`: rendered WIDTH in px (height follows the artwork's aspect).
   *  `icon`: the square's edge in px. Defaults are native size. */
  size?: number;
}

export default function BlueprintMark({ variant = 'lockup', size }: Props) {
  const isIcon = variant === 'icon';
  return (
    <img
      src={isIcon ? roundel : lockup}
      // ★ Not decoration: an image-only brand mark with no text equivalent is
      // silence to a screen reader. The ribbon carries no wordmark any more
      // (§2), so this alt is the ONLY place the company's name is spoken.
      alt="Blueprint"
      data-testid="blueprint-mark"
      data-logo-variant={variant}
      style={
        isIcon
          ? {
              width: size ?? BLUEPRINT_ICON_SIZE,
              height: size ?? BLUEPRINT_ICON_SIZE,
              flex: `0 0 ${size ?? BLUEPRINT_ICON_SIZE}px`,
              display: 'block',
            }
          : {
              // Width-driven, height auto: the aspect ratio comes from the file,
              // so no caller's number can stretch the artwork.
              width: size ?? BLUEPRINT_LOCKUP_WIDTH,
              height: 'auto',
              maxWidth: '100%',
              display: 'block',
            }
      }
    />
  );
}
