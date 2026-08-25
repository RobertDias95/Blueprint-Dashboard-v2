// ===========================================================================
// ★★★ fix-406 — SITE IS TEAL, UNIT IS PURPLE, AND BOTH ARE READABLE
// ===========================================================================
//
// Bobby, 2026-08-26, looking at the shipped fix-402 screen:
//
//   "i think this ui looks good, but you can see in the site and unit search
//    boxes, there is still a lot of gray on gray clashing with letters,
//    backgrounds, boxes etc."
//
// Round two of the complaint that produced fix-402's split. The STRUCTURE
// landed — two cards, primary tier above a hairline — and the CONTRAST did not.
//
// ---------------------------------------------------------------------------
// ★★★ THE ROOT CAUSE OF THE MONOCHROME SITE CHIP: `--color-ok` DOES NOT EXIST
// ---------------------------------------------------------------------------
//
// fix-402's SITE chip was written as three inline styles reading
// `var(--color-ok-bg)` and `var(--color-ok)`. **Neither variable is defined
// anywhere** — not in `index.css`, not in `App.css`, not in the Tailwind
// config. An undefined custom property with no fallback makes the whole
// declaration invalid at computed-value time, so the chip rendered with no
// background, no border, and inherited text: near-monochrome, exactly as the
// screenshot shows. It was never a colour that was too subtle. It was no
// colour at all.
//
// ★★ THE SAME UNDEFINED TOKEN IS READ BY `planOfRecord.ts` (the `schematic`
// verdict style). Out of this ticket's scope — a different surface, and the
// brief says do not restyle beyond the Library — so it is REPORTED, not
// touched. It is the reason this file states its values instead of pointing at
// another name that might not exist.
//
// ---------------------------------------------------------------------------
// ★★★ WHY HEXES HERE AND NOT `var(--color-is)` IN THE MARKUP
// ---------------------------------------------------------------------------
//
// The brief: *"If the app has established tokens for tinted cards … reuse them
// rather than inventing hexes."* These are NOT invented. Every value below is
// **derived arithmetically from the app's own palette**, and the fix-406 test
// suite recomputes each one from `--color-is` / `--color-jv` / `--color-text` /
// `--color-border` and fails if it drifts. Stating the result lets the same
// test measure the CONTRAST RATIO, which is the thing Bobby actually complained
// about and which `color-mix()` in a stylesheet would leave unmeasurable.
//
// ★ The two hues are the app's existing stage colours, not a new palette:
// `is` (#0891b2, teal — "Issued") and `jv` (#7c3aed, purple — the reports
// accent). They already paint stage badges elsewhere in this very table.
//
// ★★ AND THE TINT IS THE TOKEN VERBATIM. `chipBg` is `--color-is-bg` /
// `--color-jv-bg` unchanged; only the INK is darkened, because the tokens'
// full-strength hue on its own tint is ~2.9:1 — the same washed-out reading
// that produced this ticket.

/** The three places a group's colour is allowed to appear. Three, not more:
 *  the brief's rule is *"the chip, the card border, nothing else needs the
 *  colour"* — a whole card washed in tint is how the panel goes back to
 *  looking like one undifferentiated block. */
export interface LibraryGroupPalette {
  /** The chip's tinted background — the app's `-bg` token, verbatim. */
  chipBg: string;
  /** The chip's ink: the hue darkened toward the app's text colour. */
  chipText: string;
  /** The card's 1px border — the hue softened toward the app's border grey, so
   *  the card is identifiably teal/purple without ringing like an alert. */
  cardBorder: string;
}

/** ★ The mixes, written down so the test can replay them:
 *
 *      chipText   = 70% hue + 30% --color-text    (#1a2540)
 *      cardBorder = 60% hue + 40% --color-border  (#c8d3e0)
 *
 *  70/30 is the lightest ink that clears 4.5:1 on the tint for both hues while
 *  still reading as the hue rather than as navy. 60/40 is the border weight at
 *  which the two cards separate at a glance without either becoming a warning.
 */
export const LIBRARY_GROUP_MIX = {
  chipTextHuePct: 70,
  cardBorderHuePct: 60,
} as const;

/** SITE — the lot. Teal, from the app's `is` palette. */
export const SITE_PALETTE: LibraryGroupPalette = {
  chipBg: '#cffafe', // --color-is-bg, verbatim
  chipText: '#0d7190', // 70% #0891b2 + 30% #1a2540 → 5.0:1 on the tint
  cardBorder: '#55abc4', // 60% #0891b2 + 40% #c8d3e0
};

/** UNIT — the building on it. Purple, from the app's `jv` palette. */
export const UNIT_PALETTE: LibraryGroupPalette = {
  chipBg: '#ede9fe', // --color-jv-bg, verbatim
  chipText: '#5f34b9', // 70% #7c3aed + 30% #1a2540 → 6.6:1 on the tint
  cardBorder: '#9a77e8', // 60% #7c3aed + 40% #c8d3e0
};

/** The style object a chip renders with. One function, so the two chips cannot
 *  drift into different treatments of the same idea. */
export function chipStyle(p: LibraryGroupPalette): {
  background: string;
  color: string;
  border: string;
} {
  return {
    background: p.chipBg,
    color: p.chipText,
    border: `1px solid ${p.chipText}`,
  };
}

/** The style object a group card renders with.
 *
 *  ★★ THE CARD'S FILL IS NOT SET HERE, ON PURPOSE. It keeps the app's neutral
 *  card surface (`bg-s2`); only the border carries the group's colour. Tinting
 *  the fill too would put a coloured wash behind every field box and undo the
 *  layering this ticket is about. */
export function cardBorderStyle(p: LibraryGroupPalette): { borderColor: string } {
  return { borderColor: p.cardBorder };
}
