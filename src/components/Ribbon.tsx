import { useCallback, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useIsTenantAdmin } from '../hooks/useIsTenantAdmin';
import { useIsAgendaMember } from '../hooks/useAgendaMember';
import { useAppConfig } from '../hooks/useAppConfig';
import {
  NO_LINKS_YET,
  readJurisdictions,
  type Jurisdiction,
} from '../lib/jurisdictionLinks';
import { useNewErrorCount } from '../hooks/useErrorReports';
import { useWhatsNewEntries, useWhatsNewReads } from '../hooks/useWhatsNew';
import { unreadCount } from '../lib/whatsNew';
import BlueprintMark from './BlueprintMark';
import {
  groupContainsActive,
  isRibbonEntryActive,
  visibleEntries,
  type RibbonExternal,
  type RibbonGroup,
  type RibbonLink,
  RIBBON_ENTRIES,
} from '../lib/ribbonNav';
import {
  loadRibbonCollapsed,
  loadRibbonOpenGroups,
  saveRibbonCollapsed,
  saveRibbonOpenGroups,
} from '../lib/ribbonPrefs';
import { SHELL_HEADER_HEIGHT } from '../lib/shellMetrics';

// fix-313 — the Blueprint Bridge ribbon. Built to Bridge_Shell_Mockup_v1.
//
// ★ THIS TICKET MOVES NAVIGATION. It does not redesign a single page. The top
// tab bar and the logo-as-home-button are gone; everything they reached is
// still reached, from here.
//
// 248px expanded / 56px collapsed, animated, with the collapse control at the
// bottom beside the tenant name — the mockup's layout, unchanged.

// ★ fix-325 #1: 248 -> 212. Bobby: "that ribbon that expands ... it just looks
// like it is a little wider than it should be, and I think that is because of
// the logo." He had the cause exactly right — fix-322 sized the ribbon around a
// 200px logo, not the other way round.
//
// ★ WHAT DECIDES HOW FAR THIS CAN GO is the longest nav label, not the logo.
// "Draw Schedule" and "Saved reports" are the longest, and "Saved reports" is
// the worst case because a group child carries a 30px indent. Rendered at 216 /
// 212 / 208 / 200 side by side: labels are comfortable at all four, but the FOOT
// ROW is the real floor — "Blueprint Services" and the Collapse chip start
// touching below ~210. 212 keeps a visible gap there and still takes 36px off
// the ribbon; 208 and 200 do not.
const WIDTH_EXPANDED = 212;
const WIDTH_COLLAPSED = 56;

// ★ fix-335 §2: the wordmark palette (BRAND_NAVY / BRAND_BLUE_LIGHT, fix-320
// #73) went with the wordmark. It lives in Chrome.tsx now, where the words are.
// Leaving the constants behind would have left this file describing a lockup it
// no longer draws.

// ★ fix-320 #72: the collapse control's chip.
//
// Bobby: "It's so small and subtle that I want users to easily know that this is
// the button to use to adjust that … maybe it's like a highlight or something
// that helps it be identified, so it's easily noticed."
//
// ★★ NO MOTION. A pulse was proposed and REJECTED: permanent movement becomes
// noise within a day and is an accessibility problem for anyone who asked the
// system to reduce it. The diagnosis is not "it needs attention drawn to it" —
// it is that a bare glyph with no border, no background and no label does not
// read as a button at all. Give it those three things and it is permanently
// findable with nothing moving.
const COLLAPSE_CHIP_BG = '#eef4ff';
const COLLAPSE_CHIP_BG_HOVER = '#e0ebff';
const COLLAPSE_CHIP_BORDER = '#c7dbfe';
const COLLAPSE_CHIP_BORDER_HOVER = '#2563eb';
const COLLAPSE_CHIP_TEXT = '#2563eb';

// ★ fix-331 §6: the error badge keeps ErrorTriageBell's exact red — danger, and
// deliberately not the `co` amber, which this app uses for "attention" rather
// than "broken". Carried over verbatim so the signal did not change colour when
// it changed place.
const ERROR_BADGE_RED = '#dc2626';

export default function Ribbon({ onAddProject }: { onAddProject: () => void }) {
  const { pathname } = useLocation();
  const isAdmin = useIsTenantAdmin();
  const userId = useAuthStore((s) => s.user?.id ?? null);

  // ★ Read the stored preference in the LAZY INITIALISER and write it back in
  // the handlers — no effects at all. An effect that setStates on mount is the
  // React Compiler's `set-state-in-effect`, and it also renders one frame of
  // the wrong width before correcting itself, which the user sees as a flinch.
  //
  // Chrome keys this component on the user id, so when auth resolves the
  // ribbon remounts and re-reads for the right person. That is what makes a
  // lazy initialiser sufficient here — see the `key` at the call site.
  //
  // Default expanded: a first-time viewer should see the words, not eight
  // glyphs they have to hover to decode.
  const [collapsed, setCollapsed] = useState(
    () => loadRibbonCollapsed(userId) ?? false,
  );
  const [openGroups, setOpenGroups] = useState<string[]>(
    () => loadRibbonOpenGroups(userId) ?? [],
  );

  const toggleCollapsed = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    saveRibbonCollapsed(userId, next);
  }, [collapsed, userId]);

  const toggleGroup = useCallback(
    (id: string) => {
      const next = openGroups.includes(id)
        ? openGroups.filter((g) => g !== id)
        : [...openGroups, id];
      setOpenGroups(next);
      saveRibbonOpenGroups(userId, next);
    },
    [openGroups, userId],
  );

  // ★★ fix-462: the second gate. `useIsAgendaMember` resolves through the
  //    roster (useSelfScope's email→name), the same identity every self-scoped
  //    surface uses — never a second resolution.
  const isAgendaMember = useIsAgendaMember();
  const entries = visibleEntries(isAdmin, isAgendaMember);

  return (
    <nav
      data-testid="ribbon"
      data-collapsed={collapsed ? 'true' : 'false'}
      aria-label="Main"
      className="bg-surface border-r border-border flex flex-col flex-shrink-0"
      style={{
        width: collapsed ? WIDTH_COLLAPSED : WIDTH_EXPANDED,
        flexBasis: collapsed ? WIDTH_COLLAPSED : WIDTH_EXPANDED,
        transition: 'width .16s ease, flex-basis .16s ease',
      }}
    >
      {/* ── brand ─────────────────────────────────────────────── */}
      {/* ★★ fix-335 §1: THE ORIGINAL BLUEPRINT LOGO. Bobby: "we have the new
          logo that we were using, and we want to replace that with the original
          Blueprint logo." The Bridge illustration is not deleted — §2 moves it
          into the white header beside the words. Company here, product there.

          ★★ fix-345 §2: THE BLOCK GREW, AND ONLY BECAUSE THE HEADER DID.
          fix-325's rule is unchanged and is now unbreakable: this height and the
          app header's are ONE CONSTANT in lib/shellMetrics, so the two bottom
          borders cannot stop forming a single line across the top of the screen.
          They were two literal 56s in two files before, which survived three
          tickets only because nobody changed the number. Bobby's "2-3x bigger"
          changed it.

          ★ THE LOGO DID NOT GROW WITH IT. 144px IS the artwork (fix-335 §1
          decoded the file); anything larger upscales a 144px source and softens
          the one mark in the app that is already at its ceiling. So the block
          got taller and the mark stayed 1:1, which is the right trade — a soft
          logo is worse than an airy one.

          ★★ THE PROPORTIONS WERE CHECKED, NOT ASSUMED — the brief's instruction,
          and they do not match. The old artwork is 4:1 and filled 156 of the
          ribbon's 180px of content width. This mark's real artwork is 144 x 28
          (5.14:1) inside a 200 x 57 canvas that is half empty — see BlueprintMark
          for the decode. Rendering the canvas at 156 would have drawn a 112px
          logo floating in a 44px box. Cropped, it renders at its native 144 and
          fits the same 180px with room to spare, so the RIBBON DOES NOT NEED TO
          MOVE: fix-325's 212px was set by the longest nav label and the foot row,
          not by the logo, and both are unchanged. */}
      <div
        className="flex items-center border-b border-border flex-shrink-0"
        style={{
          height: SHELL_HEADER_HEIGHT,
          padding: collapsed ? '0 8px' : '0 16px',
          justifyContent: collapsed ? 'center' : undefined,
        }}
        data-testid="ribbon-brand"
      >
        {/* Collapsed takes the roundel alone — 56px of rail has no room for a
            5:1 lockup, and squashing it into one is the thing BlueprintMark
            makes impossible. Both sizes are the artwork's own, so neither
            variant is ever upscaled. */}
        <BlueprintMark variant={collapsed ? 'icon' : 'lockup'} />
      </div>

      {/* ★★ fix-335 §2: THE WORDMARK ROW IS GONE FROM THE RIBBON.
          "we want to remove the wording Blueprint The Bridge, and we actually
          want to move that to the white header on all the screens."

          fix-320 #73 built it (BLUEPRINT small and light above, The Bridge as
          the navy hero) and fix-322 moved it below the brand block when the
          illustration took the full width. It is not restyled or hidden here —
          it has MOVED, in one piece, to Chrome's header, where it is centred
          beside the tab icon. Deleting the row rather than leaving an empty
          container is deliberate: the next person should find one place that
          renders the product's name, not two with one switched off. */}

      {/* ── nav ───────────────────────────────────────────────── */}
      {/* ★★ fix-485 §A1: a FLEX COLUMN now, so the `spacer` entry can push the
          utility block to the foot (the mock's `.util{margin-top:auto}`).
          `overflow-y-auto` is unchanged and still wins on a short viewport: a
          `flex-1` spacer collapses to nothing once the content fills the box,
          so a tall ribbon scrolls exactly as it did rather than hiding rows
          under a stretched gap. */}
      <div
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-2.5 flex flex-col"
        data-testid="ribbon-nav"
      >
        {entries.map((entry) => {
          // ★★★ fix-485 §A1 — THE SECTION CAPTION. Mock v9's `.cat` + `.grp`:
          //     an 8.5px/800 uppercase dim label with the section's rule above
          //     it. It is a LABEL, not a container — the entries after it are
          //     its section by position, which is how the separators it
          //     replaces worked and is why the order stays the one truth.
          //
          // ★ COLLAPSED, IT DRAWS THE RULE AND DROPS THE WORD. 56px has no room
          //   for "Reports", and the boundary is the half that still means
          //   something at that width — the same trade every other row on this
          //   ribbon makes (the nav labels, Add a Project, the collapse chip).
          if (entry.kind === 'caption') {
            return (
              <div
                key={entry.id}
                data-testid={`ribbon-caption-${entry.id}`}
                className="flex-none"
                style={{
                  borderTop: isFirstEntry(entry.id)
                    ? undefined
                    : '1px solid var(--color-s3)',
                  marginTop: isFirstEntry(entry.id) ? 0 : 8,
                  paddingTop: isFirstEntry(entry.id) ? 0 : 8,
                }}
              >
                {!collapsed && (
                  <div
                    className="uppercase"
                    style={{
                      padding: '8px 16px 2px',
                      fontSize: 8.5,
                      fontWeight: 800,
                      letterSpacing: '.08em',
                      color: 'var(--color-dim)',
                    }}
                  >
                    {entry.label}
                  </div>
                )}
              </div>
            );
          }
          // ★★★ fix-485 §A1 — THE PUSH. Everything after this sits at the foot.
          //     `flex-1` rather than `margin-top: auto` because the container
          //     scrolls: an auto margin inside a scroll box resolves against
          //     the CONTENT height and stops pushing the moment the list is
          //     taller than the box, which is the case a 13-entry ribbon on a
          //     laptop actually hits.
          if (entry.kind === 'spacer') {
            return (
              <div
                key={entry.id}
                data-testid={`ribbon-spacer-${entry.id}`}
                className="flex-1"
                // ★ The utility block gets the same 1px rule a caption draws,
                //   from the BOTTOM of the spacer — it has no caption of its
                //   own (mock v9's `.grp.util` has none), and "Utilities" would
                //   name a category nobody thinks in. The position is the
                //   statement.
                style={{
                  minHeight: 8,
                  borderBottom: '1px solid var(--color-s3)',
                  marginBottom: 8,
                }}
              />
            );
          }
          if (entry.kind === 'jurisdictions') {
            return (
              <RibbonJurisdictions
                key={entry.id}
                entry={entry}
                collapsed={collapsed}
                open={openGroups.includes(entry.id)}
                onToggle={() => toggleGroup(entry.id)}
              />
            );
          }
          if (entry.kind === 'link') {
            return (
              <RibbonItem
                key={entry.link.to}
                link={entry.link}
                collapsed={collapsed}
                pathname={pathname}
              />
            );
          }
          if (entry.kind === 'external') {
            return (
              <RibbonExternalItem
                key={entry.external.id}
                external={entry.external}
                collapsed={collapsed}
              />
            );
          }
          // ★ fix-331: visibleEntries has ALREADY narrowed group.children to
          // what this viewer may see, so the group renders what it is given
          // rather than re-deciding — one place decides who sees what.
          return (
            <RibbonGroupItem
              key={entry.group.id}
              group={entry.group}
              collapsed={collapsed}
              pathname={pathname}
              open={openGroups.includes(entry.group.id)}
              onToggle={() => toggleGroup(entry.group.id)}
            />
          );
        })}

      </div>

      {/* ── foot: Add a Project, tenant, collapse ─────────────── */}
      <div className="flex-shrink-0 border-t border-border p-2.5" data-testid="ribbon-foot">
        {/* fix-313 #61: the ONE entry point to the wizard. The Pipeline page's
            own "+ Add New Project" button was removed in the same change so
            there is exactly one, not two that can drift apart. */}
        <button
          type="button"
          onClick={onAddProject}
          data-testid="ribbon-add-project"
          title="Add a Project"
          className="w-full flex items-center justify-center gap-2 border border-border rounded-lg bg-surface text-text hover:bg-s2 transition font-display font-semibold whitespace-nowrap"
          style={{ padding: 8, fontSize: 12.5 }}
        >
          <span>＋</span>
          {!collapsed && <span>Add a Project</span>}
        </button>
        <div
          className="flex items-center mt-2"
          style={{
            justifyContent: collapsed ? 'center' : 'space-between',
            padding: '0 3px',
          }}
        >
          {!collapsed && (
            <small className="text-dim" style={{ fontSize: 10.5 }}>
              Blueprint Services
            </small>
          )}
          <CollapseControl collapsed={collapsed} onToggle={toggleCollapsed} />
        </div>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------

/** ★ fix-320 #72: the collapse control, built as the mockup's labelled chip —
 *  bordered, tinted blue, rounded, and carrying the WORD beside the glyph. The
 *  three things a bare glyph was missing.
 *
 *  ★ Collapsed, the word goes and the glyph stays: 56px has no room for it, and
 *  it is the same rule the nav links and the Add a Project button already
 *  follow, so the collapsed ribbon stays one language rather than one button's
 *  exception.
 *
 *  ★ NO ANIMATION AND NO TRANSITION IS DECLARED HERE — see the constants above.
 *  The hover tint is a state swap rather than a keyframe or a timed effect, so
 *  nothing on this control moves on its own, ever. */
function CollapseControl({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      data-testid="ribbon-collapse"
      aria-expanded={!collapsed}
      title={collapsed ? 'Expand the ribbon' : 'Collapse the ribbon'}
      className="cursor-pointer flex items-center font-display"
      style={{
        color: COLLAPSE_CHIP_TEXT,
        background: hover ? COLLAPSE_CHIP_BG_HOVER : COLLAPSE_CHIP_BG,
        border: `1px solid ${hover ? COLLAPSE_CHIP_BORDER_HOVER : COLLAPSE_CHIP_BORDER}`,
        borderRadius: 7,
        padding: collapsed ? '5px 7px' : '5px 10px',
        fontSize: 12,
        fontWeight: 600,
        gap: 6,
      }}
    >
      <span aria-hidden="true">◧</span>
      {!collapsed && <span data-testid="ribbon-collapse-label">Collapse</span>}
    </button>
  );
}

function itemClass(active: boolean): string {
  return [
    'flex items-center gap-2.5 rounded-lg whitespace-nowrap no-underline transition',
    active ? 'bg-s2 text-de font-semibold' : 'text-muted hover:bg-s2',
  ].join(' ');
}

function itemStyle(collapsed: boolean): React.CSSProperties {
  return {
    margin: collapsed ? '2px 8px' : '1px 10px',
    padding: collapsed ? '8px 0' : '7px 10px',
    justifyContent: collapsed ? 'center' : undefined,
    fontSize: 12.5,
  };
}

function RibbonItem({
  link,
  collapsed,
  pathname,
}: {
  link: RibbonLink;
  collapsed: boolean;
  pathname: string;
}) {
  // ★ fix-335 §5: the resolver, not the raw prefix match — see ribbonNav.
  const active = isRibbonEntryActive(link.to, pathname, link.exact);
  return (
    <NavLink
      to={link.to}
      data-testid={`ribbon-link-${link.to}`}
      data-active={active ? 'true' : 'false'}
      title={link.hint ?? link.label}
      className={`relative ${itemClass(active)}`}
      style={itemStyle(collapsed)}
    >
      <span style={{ width: 17, flex: '0 0 17px', textAlign: 'center', fontSize: 14 }}>
        {link.icon}
      </span>
      {!collapsed && <span className="flex-1 overflow-hidden text-ellipsis">{link.label}</span>}
      {link.badge === 'errors' && <ErrorTriageCount collapsed={collapsed} />}
      {link.badge === 'whats-new' && <WhatsNewMarker collapsed={collapsed} />}
    </NavLink>
  );
}

/** ★ fix-331 §6: the count that moved with the control.
 *
 *  Same `useNewErrorCount` hook the top-bar bell used, same red — the entry
 *  would otherwise be a link that never tells you there is anything to triage,
 *  which is the whole reason anybody looked at the bell. Collapsed it becomes a
 *  corner dot, because 56px has no room for a number and "there is something"
 *  is the part that matters at that width. */
function ErrorTriageCount({ collapsed }: { collapsed: boolean }) {
  const { data } = useNewErrorCount();
  const n = data ?? 0;
  if (n <= 0) return null;
  if (collapsed) {
    return (
      <span
        className="absolute rounded-full"
        style={{ top: 5, right: 8, width: 7, height: 7, background: ERROR_BADGE_RED }}
        aria-label={`${n} errors needing triage`}
        data-testid="ribbon-error-badge"
      />
    );
  }
  return (
    <span
      className="text-[9px] font-extrabold text-white rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center flex-shrink-0"
      style={{ background: ERROR_BADGE_RED }}
      data-testid="ribbon-error-badge"
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}

/** ★★★ fix-350: the unread marker on What's New.
 *
 *  Bobby asked for the entry to announce itself once and then go quiet, and this
 *  is the whole announcement mechanism — the brief rules out a modal on login, a
 *  forced tour and a banner across the app, so one dot on one rail entry is all
 *  there is.
 *
 *  ★★ A MARKER, NOT A COUNT, which is the one place it deliberately differs from
 *  its red neighbour. fix-307's lesson: a badge counting outstanding things
 *  never reaches zero, so it stops being a signal and becomes decoration. This
 *  one genuinely reaches zero — you read the page and it is gone — so "there is
 *  something" is the entire message and a number would only invite the reader to
 *  decide it is not worth 14 of anything.
 *
 *  ★ THE COLOUR IS fix-335 §9's, not a new one. `var(--color-de)` already means
 *  "this concerns you" on every unread row in the bell and the notification
 *  centre; the brief forbids a second unread vocabulary and this reuses the
 *  first. No hex literal — the same rule UnreadBellFix335 asserts.
 *
 *  ★ PER PERSON, and enforced below the client: the read rows this counts come
 *  back RLS-filtered to `auth.uid()`, so Bobby reading an entry cannot clear
 *  Cam's dot even if the query asked for everyone's.
 *
 *  ★ Same shape in both rail widths, unlike the error count — there is no number
 *  to lose when it collapses, so it stays a dot and simply moves to the corner. */
function WhatsNewMarker({ collapsed }: { collapsed: boolean }) {
  const entriesQ = useWhatsNewEntries();
  const readsQ = useWhatsNewReads();
  const n = unreadCount(entriesQ.data ?? [], new Set(readsQ.data ?? []));
  if (n <= 0) return null;
  return (
    <span
      className="absolute rounded-full"
      style={
        collapsed
          ? { top: 5, right: 8, width: 7, height: 7, background: 'var(--color-de)' }
          : { top: 9, right: 10, width: 7, height: 7, background: 'var(--color-de)' }
      }
      aria-label={`${n} unread What's New ${n === 1 ? 'entry' : 'entries'}`}
      title={`${n} you have not read yet`}
      data-testid="ribbon-whats-new-badge"
      data-unread-count={n}
    />
  );
}

/** ★★ fix-345 §4: the SharePoint row — AND IT IS A ROW NOW, not a button.
 *
 *  fix-335 §4 built it as a bordered chip, on the reasoning that a control which
 *  leaves the app should not look like one that does not. Bobby has seen it:
 *
 *    "Should SharePoint look like this in the ribbon, sticks out. Maybe it is
 *    just another word like the other options so it is more uniform."
 *
 *  ★ HE IS RIGHT, AND THE OLD REASONING WAS HALF RIGHT. The distinction is real
 *  — this one navigates the browser away — but a bordered chip in a column of
 *  eight text rows makes the loudest thing in the ribbon the one nobody uses
 *  daily. The fix is not to erase the distinction, it is to spend far less on
 *  it: identical type, spacing and hover to Pipeline and Library, with a small
 *  `↗` that says the click leaves. Uniform in weight, still honest about where
 *  it goes.
 *
 *  ★★ WHAT DID NOT CHANGE IS EVERYTHING STRUCTURAL. It is still its own entry
 *  KIND with an href and no route, so `allRibbonRoutes()` cannot see it, the
 *  fix-315 coverage guard cannot mistake it for a route, and `activeRibbonTarget`
 *  never considers it — there is no state in which you are looking at SharePoint
 *  inside this app, so it can never render active. This is a restyle and a
 *  reorder, not a change of kind, and a test holds each of those separately.
 *
 *  ★ target=_blank so the app is not unloaded mid-task, and rel=noopener
 *  noreferrer with it: without `noopener` the opened tab gets a live
 *  `window.opener` handle back into this one. */
function RibbonExternalItem({
  external,
  collapsed,
}: {
  external: RibbonExternal;
  collapsed: boolean;
}) {
  return (
    <a
      href={external.href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={`ribbon-external-${external.id}`}
      data-external="true"
      title={external.hint ?? external.label}
      /* ★ fix-345 §4: itemClass(false) and itemStyle() — the SAME functions the
         nav links use, called rather than copied, so this row cannot drift out
         of uniformity the next time the ribbon's spacing is tuned. `false`
         because it is never active; see the header note. */
      className={itemClass(false)}
      style={itemStyle(collapsed)}
    >
      {/* The glyph sits in the same 17px gutter every nav row uses, so the
          labels all start on one vertical line. */}
      <span style={{ width: 17, flex: '0 0 17px', textAlign: 'center', fontSize: 14 }}>
        {external.icon}
      </span>
      {!collapsed && (
        <span className="flex-1 overflow-hidden text-ellipsis">{external.label}</span>
      )}
      {/* ★ THE ONE THING THAT IS NOT UNIFORM, deliberately. A row identical to
          Pipeline would be a promise the click breaks, so the trailing ↗ marks
          it as leaving — small and dim, a footnote rather than a badge. Bobby
          asked for uniform WEIGHT, not for the difference to be hidden. */}
      {!collapsed && (
        <span
          aria-hidden="true"
          className="text-dim flex-shrink-0"
          style={{ fontSize: 9.5, lineHeight: 1 }}
          data-testid="ribbon-external-glyph"
        >
          ↗
        </span>
      )}
      {/* Collapsed, the label goes and the glyph carries it — the same rule the
          nav links, Add a Project and the collapse chip already follow, so the
          rail stays one language. The accessible name survives it. */}
      {collapsed && <span className="sr-only">{external.label}</span>}
    </a>
  );
}

/** ★ The FIRST caption draws no rule: there is nothing above it to separate
 *  from, and a hairline directly under the brand block reads as a mistake.
 *  Derived from the model rather than hard-coded to 'cap-work', so re-ordering
 *  the sections cannot leave a stray rule at the top (the `first:border-t-0`
 *  instinct, without needing the entries to be siblings in one element). */
function isFirstEntry(id: string): boolean {
  const first = RIBBON_ENTRIES[0];
  return !!first && 'id' in first && first.id === id;
}

// ===========================================================================
// ★★★ fix-485 §A2 (P-147) — JURISDICTIONS: A FOLDER OF FOLDERS
// ===========================================================================
//
// Bobby: *"a drop-down of Seattle, Kirkland, Bellevue with folders inside that
// take you to their GIS, their code, whatever."*
//
// ★★★ THREE LEVELS, AND EVERY LEAF LEAVES THE APP. The cities come from
// `app_config.jurisdictionLinks` (lib/jurisdictionLinks), so a fourth city
// needs no deploy — and each leaf is an `<a href target="_blank">`, never a
// `NavLink`. `activeRibbonTarget()` never considers this subtree, so you are
// never "at" Seattle's GIS, which is the same rule fix-335 §4 wrote for the
// studio's site.
//
// ★★ COLLAPSED BY DEFAULT AND REMEMBERED PER USER — it shares `openGroups`
//    with the Reports group, so the ribbon has ONE memory of what is open
//    rather than a second one that could disagree.
function RibbonJurisdictions({
  entry,
  collapsed,
  open,
  onToggle,
}: {
  entry: { id: string; label: string; icon: string };
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const cfg = useAppConfig();
  const cities: Jurisdiction[] = useMemo(
    () => readJurisdictions(cfg.map),
    [cfg.map],
  );
  // ★ Which CITY is expanded — local, and one at a time. This is a browse, not
  //   a workspace: remembering it across sessions would be state nobody asked
  //   for, and the ribbon already persists the thing that matters (whether the
  //   folder itself is open).
  const [openCity, setOpenCity] = useState<string | null>(null);

  return (
    <div data-testid="ribbon-jurisdictions" className="flex-none">
      <button
        type="button"
        onClick={onToggle}
        data-testid="ribbon-jurisdictions-toggle"
        aria-expanded={open}
        title={entry.label}
        className={`w-full text-left bg-transparent border-none cursor-pointer ${itemClass(false)}`}
        style={{
          ...itemStyle(collapsed),
          width: collapsed ? 'calc(100% - 16px)' : 'calc(100% - 20px)',
        }}
      >
        <span style={{ width: 17, flex: '0 0 17px', textAlign: 'center', fontSize: 14 }}>
          {entry.icon}
        </span>
        {!collapsed && (
          <>
            <span className="flex-1 overflow-hidden text-ellipsis">{entry.label}</span>
            <span
              className="text-dim"
              style={{
                fontSize: 9,
                transition: 'transform .15s',
                transform: open ? 'rotate(90deg)' : undefined,
              }}
            >
              ▶
            </span>
          </>
        )}
      </button>
      {open && !collapsed && (
        <div data-testid="ribbon-jurisdiction-cities" style={{ padding: '1px 0 4px' }}>
          {cities.length === 0 && (
            <div
              className="text-dim italic"
              style={{ margin: '1px 10px', padding: '5px 10px 5px 30px', fontSize: 11.5 }}
              data-testid="ribbon-jurisdictions-empty"
            >
              {NO_LINKS_YET}
            </div>
          )}
          {cities.map((c) => {
            const cityOpen = openCity === c.city;
            return (
              <div key={c.city} data-testid={`ribbon-jurisdiction-${c.city}`}>
                <button
                  type="button"
                  onClick={() => setOpenCity(cityOpen ? null : c.city)}
                  aria-expanded={cityOpen}
                  data-testid={`ribbon-jurisdiction-toggle-${c.city}`}
                  className="w-full flex items-center gap-2 rounded-lg whitespace-nowrap bg-transparent border-none cursor-pointer text-muted hover:bg-s2 transition text-left"
                  style={{ margin: '1px 10px', padding: '5px 10px 5px 30px', fontSize: 12.5, width: 'calc(100% - 20px)' }}
                >
                  <span className="flex-1 overflow-hidden text-ellipsis">{c.city}</span>
                  <span
                    className="text-dim"
                    style={{
                      fontSize: 9,
                      transition: 'transform .15s',
                      transform: cityOpen ? 'rotate(90deg)' : undefined,
                    }}
                  >
                    ▶
                  </span>
                </button>
                {cityOpen && (
                  <div data-testid={`ribbon-jurisdiction-links-${c.city}`}>
                    {/* ★★★ A CITY WITH NO LINKS SAYS SO, and is not clickable.
                        Bobby named the three cities and has not supplied the
                        URLs; inventing a GIS address is the fix-306 defect
                        class (a link to the wrong place is worse than none).
                        The copy is `NO_LINKS_YET` — one string, so this and the
                        Settings editor cannot describe the state two ways. */}
                    {c.links.length === 0 ? (
                      <div
                        className="text-dim italic"
                        style={{ margin: '1px 10px', padding: '4px 10px 4px 44px', fontSize: 11 }}
                        data-testid={`ribbon-jurisdiction-empty-${c.city}`}
                      >
                        {NO_LINKS_YET}
                      </div>
                    ) : (
                      c.links.map((l) => (
                        <a
                          key={`${l.label}|${l.url}`}
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-testid={`ribbon-jurisdiction-link-${c.city}-${l.label}`}
                          title={`${c.city} — ${l.label} (opens in a new tab)`}
                          className="flex items-center gap-2 rounded-lg whitespace-nowrap no-underline text-muted hover:bg-s2 transition"
                          style={{ margin: '1px 10px', padding: '4px 10px 4px 44px', fontSize: 11.5 }}
                        >
                          <span className="flex-1 overflow-hidden text-ellipsis">
                            {l.label}
                          </span>
                          {/* ★ The same ↗ footnote the studio's link wears —
                              one vocabulary for "this leaves the app". */}
                          <span className="text-dim" style={{ fontSize: 9 }}>
                            ↗
                          </span>
                        </a>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RibbonGroupItem({
  group,
  collapsed,
  pathname,
  open,
  onToggle,
}: {
  group: RibbonGroup;
  collapsed: boolean;
  pathname: string;
  open: boolean;
  onToggle: () => void;
}) {
  // ★ The group shows as active when it CONTAINS the active route, whether or
  // not it is open. A collapsed group that hides where you are reads as "you
  // are nowhere" — the state the mockup's active styling exists to prevent.
  const containsActive = groupContainsActive(group, pathname);
  return (
    <div data-testid={`ribbon-group-${group.id}`} data-contains-active={containsActive ? 'true' : 'false'}>
      <button
        type="button"
        onClick={onToggle}
        data-testid={`ribbon-group-toggle-${group.id}`}
        aria-expanded={open}
        title={group.label}
        className={`w-full text-left bg-transparent border-none cursor-pointer ${itemClass(containsActive)}`}
        style={{ ...itemStyle(collapsed), width: collapsed ? 'calc(100% - 16px)' : 'calc(100% - 20px)' }}
      >
        <span style={{ width: 17, flex: '0 0 17px', textAlign: 'center', fontSize: 14 }}>
          {group.icon}
        </span>
        {!collapsed && (
          <>
            <span className="flex-1 overflow-hidden text-ellipsis">{group.label}</span>
            <span
              className="text-dim"
              style={{
                fontSize: 9,
                transition: 'transform .15s',
                transform: open ? 'rotate(90deg)' : undefined,
              }}
            >
              ▶
            </span>
          </>
        )}
      </button>
      {/* Collapsed hides the children entirely — 56px has no room for them, and
          the parent already carries the active state. */}
      {open && !collapsed && (
        <div data-testid={`ribbon-kids-${group.id}`} style={{ padding: '1px 0 4px' }}>
          {group.children.map((child) => {
            const active = isRibbonEntryActive(child.to, pathname, child.exact);
            return (
              <NavLink
                key={child.to}
                to={child.to}
                data-testid={`ribbon-link-${child.to}`}
                data-active={active ? 'true' : 'false'}
                title={child.hint ?? child.label}
                className={`flex items-center gap-2 rounded-lg whitespace-nowrap no-underline transition ${
                  active ? 'bg-s2 text-de font-semibold' : 'text-muted hover:bg-s2'
                }`}
                style={{ margin: '1px 10px', padding: '5px 10px 5px 30px', fontSize: 12.5 }}
              >
                <span
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    flex: '0 0 4px',
                    background: active ? 'var(--color-de)' : 'var(--color-border)',
                  }}
                />
                {child.label}
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
}
