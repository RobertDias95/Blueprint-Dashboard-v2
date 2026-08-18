import { Link } from 'react-router-dom';
import type { CSSProperties, ReactNode } from 'react';

// fix-290: the one card shape every Project Overview column uses.
//
//     ┌─ BANNER (identical on every card) ─┐
//     │  Section heading                   │
//     │  …fields…                          │
//     ├────────────────────────────────────┤
//     │  Section heading                   │
//     │  …fields…                          │
//     └────────────────────────────────────┘
//
// Before this, the five cards were five different species: DD Phase and Project
// wore a centred title inside their padding, Team wrapped that in a second
// bordered box, Builder/Owner used a fixed 240px column with a left border, and
// the Design Plan of Record card had a real banner of its own — which is the one
// that looked right, so it is the one this generalises.
//
// ★ THE POINT IS THAT A THIRD SECTION COSTS NOTHING. Team may grow Consultants;
// Project may grow Zoning. Stacking is the card's own behaviour — a caller adds
// an <OverviewSection> and the separators, padding and banner stay correct with
// no layout change anywhere. That is why sections are a component rather than a
// convention each card re-implements, which is how the five drifted apart in the
// first place.

// The banner's appearance, defined ONCE and deliberately NOT exported. Nothing
// outside this file should be building a banner: the way the five cards drifted
// apart in the first place was each one styling its own header. A card that
// wants this look renders <OverviewCard>. The parity test asserts the rendered
// banners are identical to each other, which holds whatever these values are —
// so it cannot be satisfied by a second copy of the constants.
//
// (Exporting them would also trip react-refresh/only-export-components, which
// is the lint rule that keeps component files to components.)
const OVERVIEW_BANNER_CLASS =
  'px-2 py-1.5 border-b text-[9.5px] font-extrabold uppercase tracking-[0.07em] ' +
  'text-muted text-center';

const OVERVIEW_BANNER_STYLE: CSSProperties = {
  background: 'var(--color-s2)',
  borderBottomColor: 'var(--color-border)',
};

interface CardProps {
  /** The banner text. One line, uppercased by CSS — pass it in sentence case. */
  title: string;
  children: ReactNode;
  /** Grid placement etc. Merged over the card's own border/background. */
  style?: CSSProperties;
  /** Identifies the card itself. The banner always carries
   *  `overview-card-banner`, whatever this is. */
  testId?: string;
  className?: string;
}

export function OverviewCard({
  title,
  children,
  style,
  testId,
  className = '',
}: CardProps) {
  return (
    <section
      /* ★ fix-309 #55: h-full so a card fills the stretched grid cell rather
         than sitting at its own content height. Outside a stretched grid the
         parent has auto height, so height:100% resolves to auto and nothing
         changes — Notes under Schedule health is unaffected. */
      className={`border rounded-md overflow-hidden bg-surface flex flex-col h-full ${className}`}
      style={{ borderColor: 'var(--color-border)', height: '100%', ...style }}
      data-testid={testId}
    >
      <header
        className={`flex-shrink-0 ${OVERVIEW_BANNER_CLASS}`}
        style={OVERVIEW_BANNER_STYLE}
        data-testid="overview-card-banner"
      >
        {title}
      </header>
      {children}
    </section>
  );
}

interface SectionProps {
  /** The small grey sub-heading. OMITTED on a single-section card — DD Phase,
   *  Notes, Plan of Record and Builder/Owner have nothing to disambiguate, and
   *  repeating the banner text under the banner is noise. */
  title?: string;
  children: ReactNode;
  testId?: string;
  /** Extra body padding for cards whose first element needs breathing room
   *  under the banner (the ones with no section heading above it). */
  bodyClassName?: string;
  /** ★ fix-331 §3: something small at the RIGHT END of the heading row — the
   *  chat section's unread pill is the first and only user.
   *
   *  It is here rather than at the top of the section BODY because a count
   *  drawn in the body sits under the word it counts for, which is not where
   *  any other badge in this app sits. Making it the heading row's business
   *  keeps every section heading identical in treatment whether or not it
   *  carries one — which is the whole point of §3: chat has to look like a
   *  section of Team, not a guest inside it. */
  titleRight?: ReactNode;
  /** ★★ fix-335 §6: split this section's spare height ABOVE AND BELOW its
   *  content instead of banking all of it underneath.
   *
   *  Bobby: "We're okay with that empty white space. The only thing we might ask
   *  is, can we center the design plan of record so it's vertically spaced in
   *  that area? So if there is some open white space, it moves down so it
   *  doesn't look like there's a ton of opening. And that way we don't really
   *  have to mess with the vertical height adjustment based on all the
   *  different monitors."
   *
   *  ★★ THIS RETIRES THE CARD-HEIGHT WORK (#93, the old fix-334). He chose it as
   *  the simpler route and confirmed the column heights are already resolved:
   *  the row still stretches, the cards are still equal, and nothing measures a
   *  monitor. The slack simply stops pooling in one place.
   *
   *  ★ OPT-IN, AND ONLY THE PLAN-OF-RECORD CARD OPTS IN. §1's distribution is
   *  untouched and must stay untouched — its rule is that a multi-section card
   *  splits the slack EVENLY BETWEEN SECTIONS and each section stays
   *  TOP-ALIGNED, so Key dates / DD window / Permit intake keep the reading
   *  rhythm the eye expects. Centring those would move three headings off the
   *  line they start on. A single-section card has no rhythm to preserve — the
   *  slack has nowhere else to go, so it goes half above and half below. */
  centerVertically?: boolean;
  /** ★★★ fix-345 §3: take this section OUT of the even distribution and sit it
   *  on the card's floor.
   *
   *  Bobby: "We really like the draw schedule link button. If we can make that
   *  uniform for Connect and chat. Make them all at the bottom and horizontally
   *  equally and vertically equal so it kind of points to here are 3 active
   *  buttons for each category with different functions."
   *
   *  ★★ "VERTICALLY EQUAL" DOES NOT HAPPEN BY BEING LAST, and that is the whole
   *  reason this flag exists. fix-331 §1 gives every section `flexGrow: 1`, so
   *  the spare height is split EVENLY BETWEEN SECTIONS — and the three cards
   *  have different section counts:
   *
   *      Milestones   Key dates · DD window · Permit intake · [button]    4
   *      Project      Proposal · Site · [button]                          3
   *      Team         Internal · Chat · External · [button]               4
   *
   *  A button section that takes a 1/4 share on one card and a 1/3 share on
   *  another puts its content at a different height on each, because the content
   *  sits at the TOP of whatever share it was given. Being last is not enough.
   *
   *  ★ THE FIX IS TO GIVE IT NO SHARE AT ALL. `flexGrow: 0` means the spare goes
   *  entirely to the sections above — so they still distribute it between
   *  themselves, fix-331 §1 intact — and this section ends up flush against the
   *  card's bottom edge on every card, whatever is above it. All three buttons
   *  are then measured from the same edge, and the cards are already equal
   *  heights (fix-309 #55's stretched row), so they land on one line.
   *
   *  ★ `marginTop: auto` is belt and braces for the case where NOTHING above
   *  grows — a card whose sections are all pinned, or one outside a stretched
   *  row. Where the sections above do grow they consume the free space first
   *  and the auto margin resolves to zero, so the two never fight. */
  pinBottom?: boolean;
}

/**
 * One stacked block inside a card.
 *
 * ★ THE SEPARATOR IS THE SECTION'S OWN, via `first:border-t-0`. A card does not
 * count or index its children, so a conditionally-rendered section cannot leave
 * a stray rule at the top: React renders `false` as nothing, so whichever
 * section is really first in the DOM is the one that drops its border.
 *
 * ---------------------------------------------------------------------------
 * ★★ fix-331 §1 — WHY THIS GROWS, and why that is the whole fix
 * ---------------------------------------------------------------------------
 * Bobby, comparing two people's screens on 224 2nd Ave N:
 *
 *   "On my computer there's very little vertical space between the bottom of
 *   Milestones and Intake Accepted — it's filled in… but on other users there's
 *   these massive openings. We want to make sure the vertical height renders
 *   very similar for all users."
 *
 * ★ THE CAUSE, and it was ours. fix-309 #55 put `h-full` on every card in a
 * stretched row, so every card is as tall as the TALLEST. The tallest is Design
 * Plan of Record, and its height follows its THUMBNAIL'S ASPECT RATIO — which
 * changes with the project, the window width and the browser zoom. Bobby's
 * renders short and the row looks tight; a wider window renders it tall and
 * every neighbouring card grows a void underneath its content. Same code, same
 * project, two completely different pages.
 *
 * ★ THE EQUAL HEIGHTS STAY. Going back to a ragged row would undo fix-309, which
 * fixed a real complaint. What changes is where the slack goes.
 *
 * `flexGrow: 1` on every section splits the spare height EVENLY BETWEEN THEM, so
 * a three-section card puts a third of it under Key dates, a third under DD
 * window and a third under Permit intake, instead of banking all of it at the
 * bottom as one hole. The separators spread down the card and it reads as
 * generous spacing rather than an unfinished card.
 *
 * ★ WHAT WAS DELIBERATELY NOT DONE, both named in the brief:
 *   · NOT centred. The content stays TOP-ALIGNED inside its share, so the
 *     reading rhythm survives — Key dates, then DD window, then Permit intake,
 *     each starting where the eye expects it.
 *   · NO single element stretched to swallow the gap. Every section takes an
 *     equal share; none is singled out to absorb the rest, which would just move
 *     the hole rather than remove it.
 *
 * ★ `flexShrink: 0` on purpose: growing must never become shrinking. If a card's
 * own content is taller than the row (a long External team list), the section
 * keeps its natural height and the card scrolls its own overflow — it does not
 * silently compress a section's contents to fit.
 *
 * ★ AND IT IS INERT OUTSIDE A STRETCHED ROW. Notes under Schedule health sits in
 * an auto-height parent, where there is no free space to distribute, so
 * flexGrow resolves to nothing and that card is untouched — the same reasoning
 * fix-309 used for `h-full`.
 */
export function OverviewSection({
  title,
  children,
  testId,
  bodyClassName = '',
  titleRight,
  centerVertically = false,
  pinBottom = false,
}: SectionProps) {
  return (
    <section
      className="border-t border-border first:border-t-0"
      style={{
        // ★ fix-345 §3: a pinned section takes NO share of the spare height, so
        // everything above it keeps distributing exactly as fix-331 §1 says.
        flexGrow: pinBottom ? 0 : 1,
        flexShrink: 0,
        flexBasis: 'auto',
        ...(pinBottom ? { marginTop: 'auto' } : null),
        // ★ fix-335 §6: the section already GROWS to take the spare height —
        // that is §1, unchanged. All this adds is where the content sits inside
        // the space it was given: `justify-content: center` on a column splits
        // the leftover half above, half below.
        //
        // ★ It is inert without spare height, exactly like flexGrow above it. In
        // an auto-height parent (Notes under Schedule health) the section is
        // its content's height, so there is nothing to centre and nothing
        // moves — the same reasoning fix-309 used for `h-full` and fix-331 for
        // the distribution.
        ...(centerVertically
          ? { display: 'flex', flexDirection: 'column', justifyContent: 'center' }
          : null),
      }}
      data-testid={testId}
      data-center-vertically={centerVertically ? 'true' : undefined}
      data-pin-bottom={pinBottom ? 'true' : undefined}
    >
      {title && (
        <div className="px-2.5 pt-1.5 pb-0.5 flex items-baseline justify-between gap-2">
          <span className="text-[8.5px] font-extrabold uppercase tracking-[0.06em] text-dim">
            {title}
          </span>
          {titleRight}
        </div>
      )}
      <div className={`px-2.5 pb-2 ${title ? 'pt-0.5' : 'pt-2'} ${bodyClassName}`}>
        {children}
      </div>
    </section>
  );
}

// ===========================================================================
// ★★★ fix-345 §3 — the card action: one button shape, three cards
// ===========================================================================
//
// Bobby: "We really like the draw schedule link button. If we can make that
// uniform for Connect and chat… so it kind of points to here are 3 active
// buttons for each category with different functions."
//
// ★ THE DRAW SCHEDULE BUTTON IS THE MODEL, so this is its treatment extracted
// rather than a fourth opinion invented. Same height, same padding, same type
// scale, same full card width, on all three.
//
// ★★ ONE FIXED HEIGHT, NOT "whatever the content comes to". Two of the three
// have a second element inside them — Connect's "no link yet" tag, and the
// draw-schedule quarter — and a row sized by its content would land a pixel or
// two off on each card. That is exactly the misalignment §3 exists to remove, so
// the height is declared once here and `whitespace-nowrap` stops a long label
// wrapping its way out of it.
const OVERVIEW_ACTION_BASE =
  'flex items-center justify-center gap-1.5 w-full h-[26px] rounded border ' +
  'font-bold text-[10.5px] px-2 whitespace-nowrap transition no-underline';

// ★ The live treatment — the draw-schedule button's own colours, unchanged.
const OVERVIEW_ACTION_LIVE =
  'border-de bg-de-bg text-de hover:bg-de hover:text-white';

// ★ And the inert one. fix-335 §8's Connect placeholder keeps its dashed
// border and muted fill: the point of that control is that it reads as
// not-yet-working BEFORE it is clicked, and making it look identical to two
// buttons that DO something would undo the only thing that made it honest.
// Uniform in geometry, not in promise.
const OVERVIEW_ACTION_INERT =
  'border-dashed border-border bg-s2 text-dim cursor-not-allowed';

interface ActionProps {
  /** Renders a react-router <Link>. Mutually exclusive with onClick/disabled. */
  to?: string;
  onClick?: () => void;
  /** Renders a disabled <button>. The Connect placeholder is the only user. */
  disabled?: boolean;
  title?: string;
  testId: string;
  children: ReactNode;
  /** Extra data-* attributes. Kept explicit rather than spread from props so a
   *  typo cannot silently become an unrendered attribute. */
  data?: Record<string, string | undefined>;
}

/**
 * One card action, at the foot of a card. Pair it with
 * `<OverviewSection pinBottom>` — the section does the alignment, this does the
 * appearance, and neither knows about the other's job.
 */
export function OverviewAction({
  to,
  onClick,
  disabled = false,
  title,
  testId,
  children,
  data,
}: ActionProps) {
  const className = `${OVERVIEW_ACTION_BASE} ${
    disabled ? OVERVIEW_ACTION_INERT : OVERVIEW_ACTION_LIVE
  }`;
  const attrs = { ...data, 'data-testid': testId, title, className };
  if (to !== undefined) {
    return (
      <Link to={to} {...attrs}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-disabled={disabled || undefined} {...attrs}>
      {children}
    </button>
  );
}
