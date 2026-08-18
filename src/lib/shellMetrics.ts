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

/** The tab mark in the header lockup, in px. 2.5x fix-335's 26.
 *  ★ Safe to enlarge: the source is bridge-favicon-256.png, 256px square, so
 *  there is resolution to spare and it does not soften. */
export const BRAND_MARK_SIZE = 65;

/** "the Bridge", in px. 2.5x fix-335's 16.5. */
export const BRAND_TITLE_SIZE = 41;

/** Space between the mark and the words, in px. Scaled with them — a gap left
 *  at 8 would have read as the two colliding once both trebled in area. */
export const BRAND_LOCKUP_GAP = 11;
