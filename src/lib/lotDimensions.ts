// ===========================================================================
// ★★★ fix-411 §2 (P-051) — LOT DIMENSIONS READ AS WHOLE FEET
// ===========================================================================
//
// Bobby, 2026-08-26: *"the lot length dimension, some of them have decimal
// places, like 100.47 or 120.5, and we don't want decimal points… normal
// rounding, .5 or higher rounds up, .49 or lower rounds down."*
//
// ---------------------------------------------------------------------------
// ★★★ DISPLAY ONLY. THE STORED VALUE NEVER MOVES.
// ---------------------------------------------------------------------------
//
// `projects.lot_width` / `lot_depth` are `numeric` and stay exactly as they
// are: no migration, no UPDATE, no rounding on write. Measured on prod
// 2026-08-26 — 14 projects have a fractional width and 23 a fractional depth,
// max scale 2 — and every one of those is a surveyed number somebody typed. The
// complaint is that they are NOISY TO READ, not that they are wrong.
//
// ★★ WHICH IS WHY THIS IS A FORMATTER AND NOT A SETTER, and why it is
// deliberately NOT applied to the editable inputs. The Site card on Project
// Overview, the Project Settings modal and the wizard's Step 1 all render
// `lot_width` into an `<input type="number">` whose blur COMMITS the draft.
// Rounding the draft would write the rounded number back to the database on the
// next blur — a data change through the back door, from a ticket whose first
// line is "display only". Those three are listed in the fix-411 PR as
// deliberately unchanged.
//
// ★ SORTING ALSO KEEPS THE REAL NUMBER. The Library sorts on `row.lotWidth`,
// the unrounded value, so 100.47 and 100.4 keep their true order even though
// both render "100". Rounding first would make the order arbitrary inside each
// whole foot.
//
// ---------------------------------------------------------------------------
// ★★★ AND IT MUST NOT REACH UNIT DIMENSIONS.
// ---------------------------------------------------------------------------
//
// The per-unit `width_ft` / `depth_ft` inside `projects.unit_types` are DESIGN
// dimensions, where half-feet are real and meaningful: measured on prod
// 2026-08-26, **102 of 232 unit rows have a fractional width and 81 a
// fractional depth**. A 20.5ft-wide townhouse is 20.5ft wide. This helper is
// named for the LOT on purpose so that a call site rounding a unit reads
// obviously wrong.

/**
 * ★★★ fix-415 SCOPE B — THE SAME RULE, NOW ON THE WRITE PATH.
 *
 * Bobby, 2026-08-26: *"we want the unrounded numbers to match their updated UI
 * number… you can update the stored values to also reflect that."*
 *
 * ★★ fix-411 §2's header below says the stored value must never move, and says
 * why. That was right for a DISPLAY ticket and Bobby has since ruled the other
 * way, so the note stays as the record of a superseded decision rather than
 * being quietly deleted — but this function is the one the write paths call.
 *
 * ★★★ AND IT IS CALLED ON COMMIT, NEVER ON KEYSTROKE. Rounding an input as it
 * is typed destroys the value before the user has finished it: typing "100.5"
 * would become "100" at the "100." keystroke and the ".5" would land nowhere.
 * Every call site below is a blur or a submit.
 *
 * ★ NULL passes through as NULL. A missing dimension is missing, not zero.
 */
export function roundLotForStorage(
  n: number | null | undefined,
): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return roundLotFeet(n);
}

/** ★ The one place the rule is written down: `Math.round`, which is half-up for
 *  positive numbers — 100.47 → 100, 100.5 → 101, 120.5 → 121. Lot dimensions
 *  are never negative, so the half-up/half-away-from-zero distinction that
 *  makes `Math.round(-0.5) === -0` cannot arise here. */
export function roundLotFeet(n: number): number {
  return Math.round(n);
}

/**
 * A lot dimension as a whole number of feet, for rendering.
 *
 * ★ `null` / `undefined` / a non-finite number return `null` rather than the
 * string "NaN". A missing dimension is a missing dimension: the caller decides
 * what an absent value looks like (every current one renders an em dash), and
 * "NaN×NaN" in a table is the failure this signature exists to prevent.
 */
export function formatLotFeet(n: number | null | undefined): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return String(roundLotFeet(n));
}

/**
 * The "W×D" pair, or null when either half is missing.
 *
 * ★ BOTH OR NEITHER. A lot with a width and no depth is not "40×" — every
 * surface that shows the pair already treats a half-known lot as unknown, and
 * putting that rule here keeps the two call sites from drifting on it.
 */
export function formatLotPair(
  width: number | null | undefined,
  depth: number | null | undefined,
): string | null {
  const w = formatLotFeet(width);
  const d = formatLotFeet(depth);
  if (w === null || d === null) return null;
  return `${w}×${d}`;
}


// ===========================================================================
// ★★★ fix-488 §A (P-142) — LOT SIZE, AND "VARIES"
// ===========================================================================
//
// Bobby, 2026-09-02:
//
//   *"if I put width 100 and depth 100, lot size is 10,000 — quick math. But if
//    I put width 100 and lot size 10,000 and leave depth blank, that's because
//    the depth is irregular… in Seattle lots are regular, in other
//    jurisdictions there's a lot of multi-angled parcels… instead of Target it
//    would say Varies. What was that 9,000-square-foot lot in Kirkland?"*
//
// ---------------------------------------------------------------------------
// ★★★ THE SIZE IS DISPLAYED AS COMPUTED AND STORED ONLY WHEN TYPED
// ---------------------------------------------------------------------------
// `projects.lot_size_sf` is never written from `lot_width * lot_depth`. If it
// were, a derived rectangle and a surveyed area would be the same bytes — and
// telling those two apart is the entire feature. `sizeDerived` below is how a
// surface knows which one it is looking at.
//
// ---------------------------------------------------------------------------
// ★★★ "VARIES" IS ASSERTED, NOT ASSUMED — AND ONLY WHEN THE OTHER SIDE IS KNOWN
// ---------------------------------------------------------------------------
// A blank depth on its own means NOT RECORDED. A blank depth *beside a typed
// size* means somebody knew the area and could not give a single depth — which
// is precisely Bobby's multi-angled parcel. So the word appears only when a
// size is typed AND the opposite dimension is known:
//
//     60  ·  —      ·  —        →  nothing said about the shape
//     60  ·  —      ·  7,200    →  "60 × varies"          ← the Kirkland case
//     —   ·  —      ·  7,200    →  no pair at all, just the size
//
// ★★ THAT LAST ROW IS COWORK'S CALL, NOT BOBBY'S. With neither dimension known
//    we have an AREA and nothing else; "varies × varies" would assert an
//    irregular parcel from an entry that says only "I know the square footage".
//    Flagged in the fix-488 PR.
//
// ★★★ AND IT SUPERSEDES `formatLotPair`'s "BOTH OR NEITHER". That rule was
//     right while a half-known lot was always an unknown lot. It no longer is,
//     so `formatLotPair` is left exactly as it was for its existing callers and
//     this is the function that knows about size. Two rules, one of them
//     explicitly older — not a silent change of meaning under the old name.

/** ★ The word. One place, because it is asserted in three surfaces and a
 *  fourth would otherwise invent "Varies" or "irregular". */
export const LOT_VARIES_LABEL = 'varies';

/**
 * ★★ How far `width × depth` may sit from a typed size before the lot is called
 * irregular. **5%.**
 *
 * ★★★ THIS NUMBER IS COWORK'S, NOT BOBBY'S — he did not rule on it, and the
 * fix-488 PR says so. It is a NOTE, never an error and never an auto-correct:
 * both numbers are things a person typed, and a tool that "fixed" one of them
 * would be overwriting a survey with arithmetic. 5% is loose enough that a
 * rounded 100.4×72.3 lot does not trip it and tight enough that a genuinely
 * multi-angled parcel does.
 */
export const LOT_IRREGULAR_TOLERANCE = 0.05;

export interface LotSizeView {
  /** "60" · "varies" · null (nothing recorded). */
  widthText: string | null;
  depthText: string | null;
  /** Which half is the WORD rather than a number — so a surface can style it
   *  (the v10 mock renders it dim and italic) without string-matching. */
  widthVaries: boolean;
  depthVaries: boolean;
  /** "60 × varies", "60 × 100", or null when neither side can be shown. */
  pairText: string | null;
  /** The area in whole square feet — typed, or computed for display. */
  sizeSf: number | null;
  /** "7,200 sf", or null. */
  sizeText: string | null;
  /** ★ TRUE when `sizeSf` is `width × depth` rather than a stored value. The
   *  one thing a surface must not lose: a derived area is arithmetic, a typed
   *  one is a survey. */
  sizeDerived: boolean;
  /** ★ All three typed, and `width × depth` is more than 5% from the size. */
  irregular: boolean;
}

function n(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** ★ "7,200" — grouped, because a lot size is a four- or five-digit number that
 *  is read at a glance and misread without separators. `toLocaleString` with an
 *  explicit locale, so a test does not depend on the machine's. */
export function formatLotSizeSf(sf: number | null | undefined): string | null {
  const v = n(sf);
  if (v === null) return null;
  return `${Math.round(v).toLocaleString('en-US')} sf`;
}

// ===========================================================================
// ★★★ fix-512 §B (P-192) — A LOT SIZE IS DERIVED ONLY WHEN BOTH DIMENSIONS EXIST
// ===========================================================================
//
// Bobby, 2026-09-09:
//
//   *"if it has a lot width AND a lot depth, we are giving you permission to
//    put in all the lot sizes. If it does not have the width and/or depth — if
//    it's missing one — then someone needs to manually go in and update all
//    that."*
//
// A lot with one dimension missing has an unknown shape, so a computed area is
// a guess wearing a number's clothes.
//
// ★★★ MEASURED ON PROD 2026-09-09, BEFORE WRITING THIS, and the read is the
//     reason this section is small: of 219 projects, **zero** have exactly one
//     dimension. Dimensions are both-or-neither in the data — 213 have both,
//     6 have neither. So the population Bobby's rule is protecting against
//     (a derived size on a half-known lot) **does not exist today**, and
//     nothing anybody has been reading needs clearing. `lotSizeView` also
//     already required both, because its `derived` term is a product and a
//     product needs two operands.
//
// ★★★ SO WHY WRITE IT DOWN AT ALL. Because "it happens to be impossible" is
//     not the same as "it is refused", and the thing that made this a problem
//     was never the arithmetic — it was that the rule had no name, so the next
//     surface to want a lot size would re-derive it and nobody would notice.
//     fix-508 shipped three half-done sections for exactly that reason. A
//     named predicate is what makes the rule enumerable.
//
// ---------------------------------------------------------------------------
// ★★★ ONE PREDICATE, TWO CONSUMERS — AND P-161 IS THE SECOND ONE
// ---------------------------------------------------------------------------
//
// [[P-161-lot-shape-is-implied-by-its-dimensions-not-labelled]] reads the same
// fact from the other end. fix-506 §C removed the Regular/Irregular row on
// Bobby's ruling that *"the shape is IMPLIED BY THE DIMENSIONS — width × depth
// both present reads as a rectangle; one of them plus a lot size reads as
// irregular."* That is this predicate and its negation. They agree, and they
// now agree by construction rather than by two people having written the same
// condition twice.
//
// ★★ WHERE THEY DO NOT AGREE IS THE STORED COLUMN, AND THAT IS REPORTED RATHER
//    THAN CHANGED. `projects.is_regular_shape` survives fix-506 §C (fix-410's
//    ruling, still rendered in the Library's Shape column) and on prod it
//    contradicts the implied shape on **10 of 219** rows: 6 say `regular` with
//    no dimensions recorded at all, and 4 say `irregular` with both dimensions
//    present — only 2 of those 4 also disagree by more than the 5% tolerance.
//    A stored opinion and a derived one are allowed to differ; which wins is a
//    ruling nobody has made, so this ticket names the gap instead of closing
//    it. See the fix-512 PR.

/**
 * ★★★ Whether this lot's dimensions are COMPLETE — the single condition both
 * P-192 and P-161 turn on.
 *
 * ★ Zero is not a dimension. `LibraryRow` uses a 0 sentinel for "not recorded"
 *   and maps it back to null at its call sites; this guards the other callers.
 */
export function lotDimensionsComplete(
  width: number | null | undefined,
  depth: number | null | undefined,
): boolean {
  const w = n(width);
  const d = n(depth);
  return w !== null && d !== null && w > 0 && d > 0;
}

/**
 * ★★★ P-192: may this app compute a lot size for these dimensions?
 *
 * ★ A separate name from `lotDimensionsComplete` on purpose, even though it is
 *   the same boolean today. The question "are both dimensions recorded?" and
 *   the question "are we permitted to multiply them?" are one condition and two
 *   sentences, and a call site reading the wrong one reads obviously wrong —
 *   the same reason `roundLotForStorage` is not `roundLotFeet`.
 */
export function mayDeriveLotSize(
  width: number | null | undefined,
  depth: number | null | undefined,
): boolean {
  return lotDimensionsComplete(width, depth);
}

/**
 * ★★★ THE ONE RULE, over all eight combinations of {width, depth, size}.
 *
 *   w  d  s   →  what comes out
 *   ─────────────────────────────────────────────────────────────────────────
 *   ·  ·  ·   →  nothing at all
 *   ✓  ·  ·   →  "60" and a blank depth. NOT "varies" — nobody said so.
 *   ·  ✓  ·   →  the mirror of the above
 *   ✓  ✓  ·   →  "60 × 100", size 6,000 sf DERIVED (never stored)
 *   ·  ·  ✓   →  the size alone, no pair (see the header — Cowork's call)
 *   ✓  ·  ✓   →  "60 × varies", size as typed          ← Bobby's case
 *   ·  ✓  ✓   →  "varies × 100", size as typed
 *   ✓  ✓  ✓   →  all three as typed, plus `irregular` if they disagree by >5%
 *
 * ★ Dimensions render through `formatLotFeet`, so fix-411's whole-feet rule
 *   still owns how a dimension looks. This function owns only what is SAID.
 */
export function lotSizeView(
  width: number | null | undefined,
  depth: number | null | undefined,
  sizeSf: number | null | undefined,
): LotSizeView {
  const w = n(width);
  const d = n(depth);
  const typed = n(sizeSf);

  const widthVaries = typed !== null && w === null && d !== null;
  const depthVaries = typed !== null && d === null && w !== null;

  const widthText = w !== null ? formatLotFeet(w) : widthVaries ? LOT_VARIES_LABEL : null;
  const depthText = d !== null ? formatLotFeet(d) : depthVaries ? LOT_VARIES_LABEL : null;

  const pairText =
    widthText !== null && depthText !== null ? `${widthText} × ${depthText}` : null;

  // ★★ THE PRODUCT IS COMPUTED FROM THE ROUNDED FEET, not the raw numeric.
  //    The card shows "60 × 100"; a size of 6,047 under it would read as an
  //    arithmetic bug rather than as the two hidden decimals it actually is.
  // ★★★ fix-512 §B: through `mayDeriveLotSize`, so P-192's rule has a name
  //     here rather than being an implication of `*` needing two operands.
  //     Every surface that shows a lot size — the Site card, the Project Data
  //     editor, the Library's two columns and the Reuse picker — reads this
  //     one function, so this is the rule's only enforcement point.
  const derived =
    mayDeriveLotSize(w, d) ? roundLotFeet(w as number) * roundLotFeet(d as number) : null;

  const size = typed ?? derived;
  const sizeDerived = typed === null && derived !== null;

  const irregular =
    typed !== null &&
    derived !== null &&
    typed > 0 &&
    Math.abs(derived - typed) / typed > LOT_IRREGULAR_TOLERANCE;

  return {
    widthText,
    depthText,
    widthVaries,
    depthVaries,
    pairText,
    sizeSf: size,
    sizeText: formatLotSizeSf(size),
    sizeDerived,
    irregular,
  };
}

// ===========================================================================
// ★★★ fix-511 §C (P-198) — TWO UNBOUNDED INPUTS MULTIPLY INTO A BOUNDED COLUMN
// ===========================================================================
//
// PROD, 2026-09-09 12:31 PT. Cam, on `10150 NE 64th St`:
//
//     invalid input syntax for type integer: "1.015e+68"
//
// His edit was lost and the sentence he read was the Postgres driver's. He
// retried a minute later and the row took `lot_size_sf = 10500` — the app
// recovered nothing, the user did.
//
// ★★★ THE MECHANISM, MEASURED, and it is an asymmetry nobody would guess:
//
//     projects.lot_width    numeric   no ceiling
//     projects.lot_depth    numeric   no ceiling
//     projects.lot_size_sf  INTEGER   2,147,483,647
//
// Two fields that accept anything feed a third that does not. And the shape of
// the value says exactly how it got there: `<input type="number">` ACCEPTS
// EXPONENT NOTATION — `1.015e+68` is a valid value for it, `Number()` parses it
// happily, `Math.round` leaves it alone and `Number.isFinite` says yes. Every
// guard on the old commit path passed a number 60 orders of magnitude past the
// column. It is not a typo somebody made; it is a keystroke the browser turned
// into scientific notation.
//
// ★★★ SO THE BOUND GOES AT THE FIELD, AND IT REFUSES RATHER THAN CLAMPS.
// Clamping 1.015e+68 to 2,147,483,647 would store a number the person never
// typed and never sees — a silent wrong answer in place of a loud right one,
// which is [[P-192]]'s complaint about derived lot sizes arriving one ticket
// early. The ceiling is the column's real one and the message is a person's.
// ★ Widening the column is not the answer either: 2.1 billion sq ft is 77
//   square miles, which is larger than Seattle.

/** `projects.lot_size_sf` is `integer`. This is the ceiling, not a policy. */
export const LOT_SIZE_SF_MAX = 2_147_483_647;

/** What a rejected entry says. ★ One per REASON, because "too big" and "the
 *  browser gave us scientific notation" need different next actions from the
 *  person reading them. Neither of them is the driver's sentence. */
export const LOT_SIZE_MESSAGES = {
  exponent:
    'Type the lot size in full — 10500, not 1.05e4. Nothing was saved.',
  range: `Lot size can’t be more than ${LOT_SIZE_SF_MAX.toLocaleString('en-US')} sq ft (about 77 square miles). Check for an extra digit — nothing was saved.`,
  invalid: 'Lot size must be a whole number of square feet. Nothing was saved.',
} as const;

export type LotSizeRejection = keyof typeof LOT_SIZE_MESSAGES;

export type LotSizeParse =
  | { ok: true; value: number | null }
  | { ok: false; reason: LotSizeRejection; message: string };

/**
 * Parse what somebody typed into the lot-size box.
 *
 * ★ EMPTY IS `null`, NOT A REJECTION — clearing the field is how an irregular
 *   parcel goes back to being unrecorded, and it always was.
 * ★ ZERO AND NEGATIVES ALSO CLEAR, which is the behaviour this box already had;
 *   §C bounds the top end, and turning a long-standing silent clear into a new
 *   error message is a separate decision from the one this ticket was asked to
 *   make.
 */
export function parseLotSizeSf(raw: string): LotSizeParse {
  const t = raw.trim();
  if (t === '') return { ok: true, value: null };
  // ★★ FIRST, because `Number('1e400')` is Infinity and `Number('1e5')` is a
  //    perfectly ordinary 100000 — the notation is the thing being refused, not
  //    the magnitude. A person who meant 100000 should be told to type it.
  if (/e/i.test(t)) {
    return { ok: false, reason: 'exponent', message: LOT_SIZE_MESSAGES.exponent };
  }
  const n = Number(t);
  if (!Number.isFinite(n)) {
    return { ok: false, reason: 'invalid', message: LOT_SIZE_MESSAGES.invalid };
  }
  const rounded = Math.round(n);
  if (rounded <= 0) return { ok: true, value: null };
  if (rounded > LOT_SIZE_SF_MAX) {
    return { ok: false, reason: 'range', message: LOT_SIZE_MESSAGES.range };
  }
  return { ok: true, value: rounded };
}

// ===========================================================================
// ★★★ fix-532 §A4 — THE SAME BOUNDS, ON THE TWO NUMBERS THAT MULTIPLY
// ===========================================================================
//
// `parseLotSizeSf` above guards the box somebody types a SQUARE FOOTAGE into.
// The Library edits the two dimensions that produce one, and they need the same
// refusals for the same reason: `lot_size_sf` is an `integer` downstream
// (P-198), and `1.05e4 × 1.05e4` reaches it as a number no column can hold.
//
// ★★★ AND THE CEILING IS DERIVED, NOT CHOSEN. A single dimension may not exceed
//     the square root of `LOT_SIZE_SF_MAX`, because that is the largest value
//     whose SQUARE still fits — 46,340 ft, about nine miles. Picking a
//     "sensible" number instead (1,000? 5,000?) would be a policy nobody ruled
//     on, and the first genuinely enormous parcel would hit it.
//
// ★ Feet are not whole: a 36.5 ft lot is ordinary, so this keeps the decimal
//   where `parseLotSizeSf` rounds. What it refuses is the notation and the
//   magnitude, which are the two things that break the column.

/** The largest dimension whose square still fits `lot_size_sf`. ★ Derived from
 *  `LOT_SIZE_SF_MAX` so the two cannot drift apart. */
export const LOT_DIMENSION_FT_MAX = Math.floor(Math.sqrt(LOT_SIZE_SF_MAX));

export const LOT_DIMENSION_MESSAGES = {
  exponent:
    'Type the measurement in full — 105, not 1.05e2. Nothing was saved.',
  range: `A lot dimension can’t be more than ${LOT_DIMENSION_FT_MAX.toLocaleString('en-US')} ft — check for an extra digit. Nothing was saved.`,
  invalid: 'A lot dimension must be a number of feet. Nothing was saved.',
} as const;

export type LotDimensionParse =
  | { ok: true; value: number | null }
  | { ok: false; reason: keyof typeof LOT_DIMENSION_MESSAGES; message: string };

/**
 * Parse what somebody typed into a lot width or depth box.
 *
 * ★ EMPTY CLEARS, and so do zero and negatives — the same behaviour
 *   `parseLotSizeSf` already has, because an irregular parcel going back to
 *   unrecorded is a real thing somebody does and turning it into an error is a
 *   separate decision from the one this ticket was asked to make.
 */
export function parseLotDimensionFt(raw: string): LotDimensionParse {
  const t = raw.trim();
  if (t === '') return { ok: true, value: null };
  // ★★ FIRST, for `parseLotSizeSf`'s reason: `Number('1e400')` is Infinity and
  //    `Number('1e2')` is an ordinary 100. The NOTATION is what is refused, not
  //    the magnitude — somebody who meant 100 should be told to type it.
  if (/e/i.test(t)) {
    return { ok: false, reason: 'exponent', message: LOT_DIMENSION_MESSAGES.exponent };
  }
  const n = Number(t);
  if (!Number.isFinite(n)) {
    return { ok: false, reason: 'invalid', message: LOT_DIMENSION_MESSAGES.invalid };
  }
  if (n <= 0) return { ok: true, value: null };
  if (n > LOT_DIMENSION_FT_MAX) {
    return { ok: false, reason: 'range', message: LOT_DIMENSION_MESSAGES.range };
  }
  // ★ Two decimals is what a survey gives and what the existing displays show;
  //   more is float noise arriving from a paste.
  return { ok: true, value: Math.round(n * 100) / 100 };
}
