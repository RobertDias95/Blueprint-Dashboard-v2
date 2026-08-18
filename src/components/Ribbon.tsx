import { useCallback, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useIsTenantAdmin } from '../hooks/useIsTenantAdmin';
import { useNewErrorCount } from '../hooks/useErrorReports';
import BlueprintMark from './BlueprintMark';
import {
  groupContainsActive,
  isRibbonEntryActive,
  visibleEntries,
  type RibbonExternal,
  type RibbonGroup,
  type RibbonLink,
} from '../lib/ribbonNav';
import {
  loadRibbonCollapsed,
  loadRibbonOpenGroups,
  saveRibbonCollapsed,
  saveRibbonOpenGroups,
} from '../lib/ribbonPrefs';

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

  const entries = visibleEntries(isAdmin);

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

          ★ fix-325's 56px still stands, and for its original reason: it matches
          the app header to the right, so the two bottom borders form ONE line
          across the top of the screen. A taller brand block pushed the ribbon's
          rule below the header's and read as a mistake.

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
        style={{ height: 56, padding: collapsed ? '0 8px' : '0 16px', justifyContent: collapsed ? 'center' : undefined }}
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
      <div
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-2.5"
        data-testid="ribbon-nav"
      >
        {entries.map((entry) => {
          if (entry.kind === 'separator') {
            return collapsed ? null : (
              <div
                key={entry.id}
                className="bg-border"
                style={{ height: 1, margin: '9px 16px' }}
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

/** ★★ fix-335 §4: the SharePoint control. A BUTTON, not a nav row.
 *
 *  Bobby: "We want it to look like a button, so when you click it, it opens the
 *  link to that."
 *
 *  ★ AND THE DISTINCTION IS NOT DECORATION. Every other row in this ribbon
 *  changes what is in <main> and leaves you inside the app; this one navigates
 *  the browser away from it. Making it look like the eight rows above it would
 *  be a promise the click breaks. So it takes the bordered-chip treatment the
 *  collapse control and Add a Project already use — this ribbon's established
 *  vocabulary for "acts on the world" as against "goes somewhere" — and it
 *  never renders an active state, because there is no state in which you are
 *  looking at SharePoint inside this app.
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
      className="flex items-center gap-2.5 rounded-lg whitespace-nowrap no-underline transition text-muted border border-border bg-surface hover:bg-s2 hover:text-text font-display font-semibold"
      style={{
        margin: collapsed ? '6px 8px' : '5px 10px',
        padding: collapsed ? '7px 0' : '6px 10px',
        justifyContent: 'center',
        fontSize: 12.5,
      }}
    >
      {!collapsed && <span className="overflow-hidden text-ellipsis">{external.label}</span>}
      <span
        aria-hidden="true"
        style={{ fontSize: 12, lineHeight: 1 }}
      >
        {external.icon}
      </span>
      {/* Collapsed, the label goes and the glyph carries it — the same rule the
          nav links, Add a Project and the collapse chip already follow, so 56px
          stays one language. The accessible name survives it. */}
      {collapsed && <span className="sr-only">{external.label}</span>}
    </a>
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
