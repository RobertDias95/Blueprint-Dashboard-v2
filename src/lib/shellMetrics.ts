// ★★ fix-345 §2 — the shell's shared vertical metrics.
//
// This file exists because of ONE constraint, and it is the whole reason the
// header could not simply be made taller:
//
//   Ribbon.tsx's brand block and Chrome.tsx's header are the same height ON
//   PURPOSE, so their bottom borders form ONE CONTINUOUS LINE across the top of
//   the screen. fix-325 established it, fix-322 re-derived it after trying the
//   alternative ("a taller brand block pushed the ribbon's rule 22px below the
//   header's and read as a mistake"), and fix-335 §1 kept it.
//
// ★ Two components, two files, one number. It was written twice as the literal
// 56 in both, which survived three tickets only because nobody changed it.
// Bobby's "2-3x bigger" changes it, so the number moves here and neither file
// gets to hold an opinion about it any more.
//
// ---------------------------------------------------------------------------
// ★★ WHY 80, AND WHAT IT COSTS — measured, not chosen by eye
// ---------------------------------------------------------------------------
//
// Bobby: "we want the logo and Bridge at least 2-3x bigger."
//
// Step 1 of the brief was to find the largest that fits the existing 56px bar.
// With enough air to not touch the borders that is a 44px mark and 28px text —
// **1.7x**, under the floor he asked for. So the bar grows.
//
// Rendered at 1x / 2x / 2.5x / 3x side by side and read at 1280 (screenshots in
// the PR). 2.5x is the largest that still looks like a header rather than a
// banner: at 3x the bar is 94px, the ribbon's brand block is 94px holding a
// 144x28 logo — visibly empty — and the company mark reads as an afterthought
// beside the product name.
//
// ★ THE COST IS PERMANENT AND COMES OUT OF THE CONTENT. The shell is h-screen
// with no page scroll (Bobby: "the horizontal width and the vertical width of
// the screen is going to be fixed so there's no scrolling"), so every pixel
// added here is a pixel taken from every screen in the app, forever. 56 -> 80
// is 24px. 3x would have been 38px, for a header nobody asked to be a banner.
//
// ★ If Bobby wants the top of his range after seeing it, these four numbers are
// the entire change: 94 / 78 / 49.5 / 12. It still fits at 1280 — measured, 101px
// of clearance to the bell with the longest name on the roster.

/** Height of BOTH the app header and the ribbon's brand block, in px.
 *  ★ Changing this changes both. That is the point — see above. */
export const SHELL_HEADER_HEIGHT = 80;

// ---------------------------------------------------------------------------
// ★★★ fix-351 — THE LOCKUP, AND THE ARITHMETIC THAT LANDS ITS RULE ON THE BORDER
// ---------------------------------------------------------------------------
//
// Bobby: *"One thing we like is the blue line that comes from the bridge
// connecting to the break line of the white header."*
//
// ★★ THAT SENTENCE IS A 1px REQUIREMENT, so it is arithmetic here rather than a
// number somebody nudged until it looked right. Three things must land on one y:
//
//     the lower rule inside the artwork
//     the header's bottom border          ← SHELL_HEADER_HEIGHT
//     the ribbon's bottom border          ← the SAME constant
//
// ★ SHELL_HEADER_HEIGHT is not touched to make them meet. It is shared by
// Chrome and Ribbon precisely so their borders cannot drift (fix-325's rule,
// re-derived by fix-322 and kept by fix-335), and bending it to suit one image
// would break the thing the image is trying to join. The artwork moves instead.
//
// ★★ MEASURED OFF THE PIXELS OF bridge-logo-2026.png, not read off the brief.
// Sampling alpha per row at x >= 1200 — clear of the bridge illustration, so
// only the full-width rules contribute:
//
//     upper rule   rows 314–323   alpha centroid y = 319.53
//     lower rule   rows 341–350   alpha centroid y = 346.26   ← the baseline
//
// Both rules are ~10px thick in a 355px-tall file. The lower centroid sits at
// 346.26 / 355 = 97.54% of the height, which is what makes "render it so the
// bottom edge lands on the border" nearly right and not quite: bottom-aligned,
// the rule would sit 2.46% of the height ABOVE the border — 1.8px at the size
// below. Hence BRAND_LOCKUP_DROP.
//
// ★ The blue is rgb(79, 99, 177), sampled from those rows. It is NOT fix-320's
// BRAND_NAVY #1d3f6e, which coloured the wordmark this artwork replaces — see
// Chrome.tsx for why that constant is gone rather than repointed.

/** The lockup source file's pixel dimensions. 5.7183:1. */
export const BRAND_LOCKUP_SRC_W = 2030;
export const BRAND_LOCKUP_SRC_H = 355;

/** Alpha centroid of the artwork's LOWER rule, in source rows. Measured. */
export const BRAND_LOCKUP_RULE_ROW = 346.26;

/** The header's bottom border, in px. Tailwind `border-b` is 1px, and the
 *  header is border-box, so the border occupies the last pixel of the 80. */
export const SHELL_BORDER_WIDTH = 1;

/** Rendered HEIGHT of the lockup in the header, in px.
 *
 *  ★ Chosen against the two ceilings, not by eye. The artwork above its rule is
 *  97.54% of its height, and that part has to fit ABOVE the border: at 72 it
 *  occupies 70.2px of the 80px bar, leaving 9.8px of air at the top. Going
 *  taller closes that gap to nothing; going shorter shrinks the bridge below
 *  the 65px mark it replaces. The second ceiling is WIDTH — 72px of height is
 *  412px of width, and the centred block has to clear the bell (see Chrome). */
export const BRAND_LOCKUP_HEIGHT = 72;

/** Rendered width that follows from the height and the file's own aspect. */
export const BRAND_LOCKUP_WIDTH =
  (BRAND_LOCKUP_HEIGHT * BRAND_LOCKUP_SRC_W) / BRAND_LOCKUP_SRC_H;

/** ★★★ How far the artwork hangs BELOW the header's padding box so that its
 *  rule lands on the centre of the header's border.
 *
 *  The centred block is `absolute inset-y-0`, so its bottom is the padding
 *  box's bottom — SHELL_HEADER_HEIGHT minus the border, i.e. the border's TOP
 *  edge. Two terms get the rule from there onto the border's centre line:
 *
 *    SHELL_BORDER_WIDTH / 2          down to the middle of the 1px border
 *    height x (1 - rule fraction)    the artwork below its own rule
 *
 *  = 0.5 + 72 x 0.024620 = 2.273px. Applied as a negative margin-bottom, so
 *  the only part of the image outside the header is the ~1.8px of artwork that
 *  sits below its own rule — which is exactly the tail that should overlap the
 *  border it is joining. */
export const BRAND_LOCKUP_DROP =
  SHELL_BORDER_WIDTH / 2 +
  BRAND_LOCKUP_HEIGHT * (1 - BRAND_LOCKUP_RULE_ROW / BRAND_LOCKUP_SRC_H);
