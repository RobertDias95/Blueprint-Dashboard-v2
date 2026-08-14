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

const WIDTH_EXPANDED = 248;
const WIDTH_COLLAPSED = 56;

export default function Ribbon({
  onAddProject,
  onOpenSettings,
}: {
  onAddProject: () => void;
  onOpenSettings: () => void;
}) {
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
      <div
        className="flex items-center gap-2.5 border-b border-border flex-shrink-0 px-4"
        style={{ height: 56 }}
        data-testid="ribbon-brand"
      >
        <BridgeMark size={22} />
        {!collapsed && (
          <span
            className="font-display font-semibold whitespace-nowrap"
            style={{ fontSize: 12.5, letterSpacing: '.055em', color: 'var(--color-de)' }}
          >
            BLUEPRINT{' '}
            <span style={{ fontWeight: 400, color: 'var(--color-dim)' }}>BRIDGE</span>
          </span>
        )}
      </div>

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

        {/* Settings stays a MODAL (Q9.5.a's decision, unchanged). It is a
            button, not a NavLink, because there is no /settings page to go to
            — the legacy route redirects to /dashboard. */}
        <button
          type="button"
          onClick={onOpenSettings}
          data-testid="ribbon-settings"
          title="Settings"
          className="w-full text-left bg-transparent border-none cursor-pointer text-muted hover:bg-s2 rounded-lg flex items-center gap-2.5 whitespace-nowrap"
          style={{
            margin: collapsed ? '2px 8px' : '1px 10px',
            width: collapsed ? 'calc(100% - 16px)' : 'calc(100% - 20px)',
            padding: collapsed ? '8px 0' : '7px 10px',
            justifyContent: collapsed ? 'center' : undefined,
          }}
        >
          <span style={{ width: 17, flex: '0 0 17px', textAlign: 'center', fontSize: 14 }}>
            ⚙
          </span>
          {!collapsed && <span className="flex-1 text-xs">Settings</span>}
        </button>
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
          <button
            type="button"
            onClick={toggleCollapsed}
            data-testid="ribbon-collapse"
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand the ribbon' : 'Collapse the ribbon'}
            className="bg-transparent border-none cursor-pointer text-dim hover:bg-s2 hover:text-muted rounded"
            style={{ fontSize: 14, padding: '3px 5px' }}
          >
            ◧
          </button>
        </div>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------

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
