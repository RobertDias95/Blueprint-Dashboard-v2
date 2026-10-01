import { useCallback, useMemo, useState } from 'react';
import { buildStamp } from '../lib/buildInfo';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import AdminAccountTab from '../components/Settings/AdminAccountTab';
import AdminTeamTab from '../components/Settings/AdminTeamTab';
import AdminProjectsTab from '../components/Settings/AdminProjectsTab';
import AdminPermitsTab from '../components/Settings/AdminPermitsTab';
import AdminScheduleTab from '../components/Settings/AdminScheduleTab';
import { useIsTenantAdmin } from '../hooks/useIsTenantAdmin';
import { useSettingsSearchIndex } from '../hooks/useSettingsSearchIndex';
import {
  SETTINGS_RAIL_WIDTH,
  SETTINGS_SECTIONS,
  sectionForPath,
  visibleSettingsSections,
  type SettingsSectionId,
} from '../lib/settingsSections';
import {
  SETTINGS_BLOCKS,
  type SettingsBlock as SettingsBlockMeta,
} from '../lib/settingsBlocks';
import { SettingsBlockContext } from '../lib/settingsBlockContext';
import {
  highlightParts,
  searchSettings,
  SETTINGS_SEARCH_MIN,
} from '../lib/settingsSearch';

// ===========================================================================
// ★★★ fix-611 (P-166 step 3a) — SEVEN CATEGORIES, A SEARCH, ONE BLOCK OPEN
// ===========================================================================
//
// fix-319 made Settings a page and its sections URLs. This keeps all of that —
// the build stamp, the page-never-scrolls contract (fix-313), the single scroll
// container (fix-319's test), AdminRoute at the router — and changes the shape of
// what is inside: seven categories instead of five tabs, each one a list of
// collapsed block rows, with a search box over the lot.
//
// ---------------------------------------------------------------------------
// ★★★ WHY THE FIVE TAB COMPONENTS ARE STILL HERE, AND MOUNTED MORE THAN ONCE
// ---------------------------------------------------------------------------
// The brief's ONE RULE is *"Move and group the existing editors. Change none of
// them inside."* A block's content therefore stays in the tab that already
// renders it, with its hooks, its helpers and its early returns intact — all that
// changed inside those files is that each block's wrapper became
// `<SettingsBlock id="…">`.
//
// ★★ Which means one tab contributes blocks to SEVERAL categories: AdminTeamTab
//    holds the roster (People), the structure and routing editors (Teams &
//    routing) AND three read-outs (Health & tools). So the tabs that can
//    contribute to the open category are all mounted, and `SettingsBlock`
//    renders only the blocks whose registry category matches. A tab with nothing
//    to contribute here is not mounted at all.
//
// ★ The alternative — extracting 35 editors into 35 components — would have
//   meant re-homing the shared data each tab loads at its top and the helpers
//   built on it. That is rewriting five containers, and the ONE RULE exists
//   because every rewritten line is a chance for one editor to lose a prop.

/** Which tab components can contribute blocks to each category. */
const TABS_BY_CATEGORY: Record<SettingsSectionId, readonly string[]> = {
  account: ['account'],
  people: ['team'],
  teams: ['team'],
  lists: ['projects'],
  permits: ['permits'],
  // ★ AdminScheduleTab owns the whole "Per-type schedule" card now — both the
  //   target-submit formulas (moved out of AdminPermitsTab) and the per-type
  //   defaults. Mounting both tabs would have produced TWO collapsed rows with
  //   the same title, which is the opposite of merging them.
  dates: ['schedule'],
  // ★ Four read-outs from three different tabs, plus Export backup from Account.
  health: ['account', 'team', 'permits'],
};

export default function SettingsPage() {
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();
  const isAdmin = useIsTenantAdmin();
  const visible = visibleSettingsSections(isAdmin);

  // The route decides the category — that is the whole point of the move, and it
  // is what makes a category linkable and reload-proof.
  //
  // ★ Two fallbacks, both deliberate and both unchanged from fix-319. A path that
  // is not a section (bare /settings, which redirects) falls back to the first
  // VISIBLE one; and an admin-only section resolved for a non-admin does too.
  // AdminRoute already redirects that case at the router, so this is defence in
  // depth — but it is the same refusal the modal made, and a role that changes
  // mid-session is exactly when a gate that exists in only one place fails.
  const routed = sectionForPath(pathname);
  const permitted = routed && (isAdmin || !routed.adminOnly) ? routed : null;
  const active = permitted ?? visible[0] ?? SETTINGS_SECTIONS[0]!;

  // ── §C: one block open at a time, and the open one is in the URL ──
  //
  // ★★★ THE HASH IS THE STATE, not a mirror of it. `/settings/lists#jurisdictions`
  //     has to survive a reload, a shared link and the Back button, and the only
  //     way all three work is if the URL is where the answer lives. A `useState`
  //     synced to the hash gets this wrong on Back every time (fix-403 and
  //     fix-408 both landed on this).
  const openId = hash.startsWith('#') ? hash.slice(1) : null;

  const toggle = useCallback(
    (id: string) => {
      // ★ `replace`, so opening three blocks in a row does not put three entries
      //   in the history. Back should leave Settings, not step through what you
      //   expanded on the way.
      navigate(`${pathname}${openId === id ? '' : `#${id}`}`, { replace: true });
    },
    [navigate, pathname, openId],
  );

  // ── §D: search ──
  const [query, setQuery] = useState('');
  const index = useSettingsSearchIndex();
  const searchable = useMemo(
    // ★ Only what this viewer may see. A non-admin searching "Kirkland" must not
    //   be told there is a Jurisdictions block they cannot open — that is the rail
    //   filter's rule, applied to the second way into a block.
    () =>
      SETTINGS_BLOCKS.filter((b) => {
        const section = SETTINGS_SECTIONS.find((s) => s.id === b.category);
        return isAdmin || !section?.adminOnly;
      }),
    [isAdmin],
  );
  const hits = useMemo(
    () => searchSettings(query, searchable, index),
    [query, searchable, index],
  );
  const searching = query.trim().length >= SETTINGS_SEARCH_MIN;

  // ★ Clearing the box returns to the category, which it does by simply not
  //   rendering results any more — the category was never unmounted, so every
  //   draft in it survives the detour. (The same reason SettingsBlock hides
  //   rather than unmounts.)

  // ★★★ THE ID IS LIFTED OUT BEFORE THE MEMO, and that is not style. The React
  //     Compiler refuses to preserve a `useMemo` whose dependency is a PROPERTY
  //     ACCESS — `[active.id]` — because `active` may be mutated later, and it
  //     reports that refusal as a lint ERROR in this repo rather than silently
  //     deoptimising. Only lint catches it; tsc and vitest are both happy.
  //     Depending on the plain value is the fix. (fix-403, fix-408 and fix-426
  //     each hit a different face of the same rule.)
  // ★★★ NO useMemo HERE, DELIBERATELY — and this took two attempts to get right.
  //     The React Compiler refuses to preserve a manual `useMemo` whose deps it
  //     cannot prove stable (`active` is derived from a fresh `.filter()` array
  //     each render), and in this repo that refusal is a lint ERROR, not a
  //     silent deopt: *"Compilation Skipped: Existing memoization could not be
  //     preserved"*. Lifting `active.id` into a local did not satisfy it either.
  //
  // ★★ The answer is to stop hand-memoising: the compiler memoises this object
  //    for us, and fighting it is what turned the optimisation off for the whole
  //    component. Only LINT catches this — tsc and vitest are both happy either
  //    way (fix-403, fix-408 and fix-426 each hit a different face of this rule).
  const blockCtx = { category: active.id, openId, toggle };

  return (
    <div
      className="h-full flex flex-col"
      style={{ overflow: 'hidden' }}
      data-testid="settings-page"
    >
      <div className="flex items-baseline gap-3 flex-none mb-3">
        <h1 className="text-[15px] font-extrabold text-text">System Settings</h1>
        {/* ★★★ fix-587 §1b — THE BUILD, WHERE A PERSON CAN READ IT OUT.
            P-287 took a day because nobody could answer "which version are you
            on?". Brittani was three weeks stale and the only evidence was three
            missing toolbar buttons in a screenshot. One line, in the place
            somebody already opens when something looks wrong. */}
        <span
          className="text-[10px] text-dim font-mono ml-auto select-all"
          title={`Build ${buildStamp()} — quote this if a screen looks wrong`}
          data-testid="settings-build-stamp"
        >
          Build {buildStamp()}
        </span>
      </div>

      <div className="flex flex-1 min-h-0 border border-border rounded-md overflow-hidden bg-surface">
        {/* ── the category rail, with the search box at its top ── */}
        <nav
          className="flex-shrink-0 border-r border-border overflow-y-auto py-2.5 bg-s2"
          style={{ width: SETTINGS_RAIL_WIDTH }}
          data-testid="settings-nav"
          aria-label="Settings categories"
        >
          <div className="px-3 pb-2.5 mb-1 border-b border-border">
            <label className="flex items-center gap-1.5 rounded border border-border bg-bg px-2 py-1">
              <span className="text-dim text-[11px]" aria-hidden="true">
                ⌕
              </span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search settings…"
                aria-label="Search settings"
                className="w-full bg-transparent text-[11px] text-text outline-none placeholder:text-dim"
                data-testid="settings-search"
              />
              {query !== '' && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="text-dim hover:text-text text-[11px] leading-none"
                  title="Clear search"
                  data-testid="settings-search-clear"
                >
                  ×
                </button>
              )}
            </label>
            <div className="text-[9px] text-dim mt-1 leading-snug">
              Finds a setting by its name or anything in it
            </div>
          </div>

          {visible.map((s) => (
            <NavLink
              key={s.id}
              to={s.path}
              onClick={() => setQuery('')}
              data-testid={`settings-nav-${s.id}`}
              data-active={s.id === active.id && !searching ? 'true' : 'false'}
              className={`flex items-center gap-2.5 px-4 py-2.5 no-underline transition ${
                s.id === active.id && !searching
                  ? 'bg-surface'
                  : 'bg-transparent hover:bg-s3'
              }`}
              style={{
                borderRight:
                  s.id === active.id && !searching
                    ? '2px solid var(--color-de, #2563eb)'
                    : '2px solid transparent',
              }}
            >
              <span className="text-base">{s.icon}</span>
              <span
                className={`text-xs ${
                  s.id === active.id && !searching
                    ? 'font-bold text-de'
                    : 'font-medium text-text'
                }`}
              >
                {s.label}
              </span>
            </NavLink>
          ))}
        </nav>

        {/* ── ★ the only scroll container on this page (fix-319's test) ── */}
        <div
          className="flex-1 min-w-0 min-h-0 overflow-auto px-6 py-[22px]"
          data-testid="settings-content"
        >
          {searching ? (
            <SearchResults
              query={query}
              hits={hits}
              onPick={(block) => {
                setQuery('');
                navigate(
                  `${
                    SETTINGS_SECTIONS.find((s) => s.id === block.category)?.path ??
                    pathname
                  }#${block.id}`,
                );
              }}
            />
          ) : (
            <>
              <div className="mb-4">
                <div className="text-base font-display font-extrabold text-text mb-0.5">
                  {active.icon} {active.label}
                </div>
                <div className="text-xs text-dim">{active.desc}</div>
              </div>
              <SettingsBlockContext.Provider value={blockCtx}>
                <div className="space-y-2">
                  <CategoryBody id={active.id} />
                </div>
              </SettingsBlockContext.Provider>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The tabs that can contribute a block to this category, mounted.
 *
 * ★ `SettingsBlock` filters by registry category, so a tab listed here renders
 *   only its blocks that belong on this page. A tab not listed is not mounted,
 *   so its queries do not run.
 */
function CategoryBody({ id }: { id: SettingsSectionId }) {
  const tabs = TABS_BY_CATEGORY[id];
  return (
    <>
      {tabs.includes('account') && <AdminAccountTab />}
      {tabs.includes('team') && <AdminTeamTab />}
      {tabs.includes('projects') && <AdminProjectsTab />}
      {tabs.includes('permits') && <AdminPermitsTab />}
      {tabs.includes('schedule') && <AdminScheduleTab />}
    </>
  );
}

/** §D: results replace the content pane — one row per matching block. */
function SearchResults({
  query,
  hits,
  onPick,
}: {
  query: string;
  hits: ReturnType<typeof searchSettings>;
  onPick: (block: SettingsBlockMeta) => void;
}) {
  return (
    <div data-testid="settings-search-results">
      <div className="mb-3">
        <div className="text-base font-display font-extrabold text-text mb-0.5">
          ⌕ {hits.length} {hits.length === 1 ? 'setting' : 'settings'} match “
          {query}”
        </div>
        <div className="text-xs text-dim">
          Click one to open it where it lives.
        </div>
      </div>
      {hits.length === 0 && (
        <div
          className="text-xs text-dim italic py-6 text-center"
          data-testid="settings-search-empty"
        >
          Nothing matches “{query}”. Try a city, a person, a permit type or a
          value from one of the lists.
        </div>
      )}
      <div className="space-y-1.5">
        {hits.map((hit) => {
          const section = SETTINGS_SECTIONS.find(
            (s) => s.id === hit.block.category,
          );
          // ★ The line under the title is WHERE THE MATCH LANDED, not a fixed
          //   summary: for a value hit it is the value, which is the thing the
          //   person typed and the reason this row is here at all.
          const detail = hit.value ?? hit.block.summary;
          const parts = highlightParts(detail, query);
          return (
            <button
              key={hit.block.id}
              type="button"
              onClick={() => onPick(hit.block)}
              className="w-full text-left bg-surface border border-border rounded-lg px-3.5 py-2.5 hover:bg-s3 transition"
              data-testid={`settings-search-hit-${hit.block.id}`}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-[9px] uppercase tracking-wide text-dim font-bold">
                  {section?.label ?? hit.block.category}
                </span>
                <span className="text-dim text-[9px]">›</span>
                <span className="text-[13px] font-display font-bold text-text">
                  {hit.block.title}
                </span>
                {hit.via === 'value' && (
                  <span className="ml-auto text-[9px] uppercase tracking-wide text-dim font-bold">
                    in this list
                  </span>
                )}
              </div>
              <div className="text-[11px] text-muted mt-0.5 truncate">
                {parts.match === '' ? (
                  detail
                ) : (
                  <>
                    {parts.before}
                    <mark
                      className="bg-transparent text-de font-bold"
                      data-testid={`settings-search-mark-${hit.block.id}`}
                    >
                      {parts.match}
                    </mark>
                    {parts.after}
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
