import { useCallback, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useIsTenantAdmin } from '../hooks/useIsTenantAdmin';
import BridgeMark from './BridgeMark';
import {
  groupContainsActive,
  isLinkActive,
  visibleEntries,
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

// ★ fix-320 #73: the wordmark palette, straight off Bridge_Shell_Mockup_v1.
// Literals rather than theme tokens because these are BRAND colours — they
// belong to the mark, not to the app's semantic palette, and pointing them at
// --color-de would mean the logo changed the day someone retuned the "design"
// accent. Named here so the two lines of the wordmark and the mark's square
// cannot drift apart.
const BRAND_NAVY = '#1d3f6e'; // "The Bridge" — the hero line
const BRAND_BLUE_LIGHT = '#7ba3d8'; // "BLUEPRINT" — the small line above it

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
      {/* ★ fix-322: the real logo, and the layout it forced.

          The artwork is 4:1 and fills the ribbon's width minus its padding,
          leaving no room beside it for the wordmark. The brief's tie-break: the
          illustration wins, the wordmark moves. So the wordmark drops BELOW the
          divider into its own row rather than shrinking to fit next to a
          thumbnail.

          ★ fix-325 narrowed both together — 200px of logo in a 248px ribbon
          became 156px in a 212px one. The pair moves as a pair on purpose: the
          logo is what set the ribbon's width, so shrinking one without the
          other would just add whitespace where the complaint already was.

          ★ WHY NOT SIMPLY MAKE THIS BLOCK TALLER: its 56px matches the app
          header to its right, so the two bottom borders form ONE line across the
          top of the screen. Rendered both ways side by side; a taller brand block
          pushed the ribbon's rule 22px below the header's and read as a mistake.
          The 56px stays, the logo fills it, the words sit under it. */}
      <div
        className="flex items-center border-b border-border flex-shrink-0"
        style={{ height: 56, padding: collapsed ? '0 8px' : '0 16px', justifyContent: collapsed ? 'center' : undefined }}
        data-testid="ribbon-brand"
      >
        {/* Collapsed takes the SQUARE crop — 56px of rail has no room for a 4:1
            illustration, and squashing it into one is the thing this component
            makes impossible. */}
        <BridgeMark variant={collapsed ? 'icon' : 'full'} size={collapsed ? 34 : 156} />
      </div>

      {/* ── wordmark ──────────────────────────────────────────── */}
      {!collapsed && (
        <div
          className="flex-shrink-0"
          style={{ padding: '8px 16px 2px' }}
          data-testid="ribbon-wordmark-row"
        >
        {/* ★ fix-320 #73 — the wordmark leads with The Bridge.
            Bobby: "The grey for bridge blends in with the white background —
            you want BRIDGE to be bold and identifiable." It had been the other
            way round: BLUEPRINT in brand blue with BRIDGE trailing it in faint
            grey, so the name of the product was the part that vanished.

            BLUEPRINT is now the small light-blue line ABOVE; The Bridge is the
            large navy hero below it, per Bridge_Shell_Mockup_v1.

            ★ Title case, not all caps — Bobby, on seeing it: "maybe it doesn't
            need to be all caps". Mixed case has ascenders and descenders, so
            the word carries a silhouette and reads faster at 16.5px than a
            uniform block of capitals.

            ★ fix-322 moved this OUT of the brand block and under it, at the same
            size and colours — the illustration needed the full width. It is
            still one lockup, read top to bottom: picture, then name. */}
          <span
            className="font-display whitespace-nowrap"
            style={{ lineHeight: 1 }}
            data-testid="ribbon-wordmark"
          >
            <span
              style={{
                display: 'block',
                fontSize: 8.5,
                fontWeight: 600,
                letterSpacing: '.17em',
                color: BRAND_BLUE_LIGHT,
                marginBottom: 2,
              }}
            >
              BLUEPRINT
            </span>
            <span
              style={{
                display: 'block',
                fontSize: 16.5,
                fontWeight: 750,
                letterSpacing: '-.005em',
                color: BRAND_NAVY,
              }}
              data-testid="ribbon-wordmark-hero"
            >
              The Bridge
            </span>
          </span>
        </div>
      )}

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
  const active = isLinkActive(link.to, pathname, link.exact);
  return (
    <NavLink
      to={link.to}
      data-testid={`ribbon-link-${link.to}`}
      data-active={active ? 'true' : 'false'}
      title={link.hint ?? link.label}
      className={itemClass(active)}
      style={itemStyle(collapsed)}
    >
      <span style={{ width: 17, flex: '0 0 17px', textAlign: 'center', fontSize: 14 }}>
        {link.icon}
      </span>
      {!collapsed && <span className="flex-1 overflow-hidden text-ellipsis">{link.label}</span>}
    </NavLink>
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
            const active = isLinkActive(child.to, pathname, child.exact);
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
