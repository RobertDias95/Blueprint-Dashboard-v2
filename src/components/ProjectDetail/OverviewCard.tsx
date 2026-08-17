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
}: SectionProps) {
  return (
    <section
      className="border-t border-border first:border-t-0"
      style={{ flexGrow: 1, flexShrink: 0, flexBasis: 'auto' }}
      data-testid={testId}
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
