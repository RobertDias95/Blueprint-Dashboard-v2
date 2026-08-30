import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAuthStore } from '../stores/authStore';
import type { User } from '@supabase/supabase-js';
import type { TeamRole } from '../lib/database.types';
import dashboardSrc from '../pages/Dashboard.tsx?raw';
import projectListSrc from '../pages/ProjectList.tsx?raw';
import myTasksSrc from '../pages/MyTasks.tsx?raw';
import chromeSrc from '../components/Chrome.tsx?raw';
import selfScopeHookSrc from '../hooks/useSelfScope.ts?raw';
import { saveScopeMode, widenScopeWhenUnassigned } from '../lib/selfScope';

// ===========================================================================
// fix-428 — a way out of a filter, and a first screen that isn't blank
// ===========================================================================
//
// Both halves came from Bobby in one message on 2026-08-28, about the same
// filter row.
//
// ★ HALF ONE: *"whenever we have searches that can be adjusted to have multiple
//   selections, like pipeline, or my tasks, or project view etc, having that
//   clear button next to it is nice so that you can reset the search queue. for
//   instance, pipeline i dont think has it."* He was right — Pipeline was the
//   only one of the three with no way out.
//
// ★★★ HALF TWO: *"for people like dave, gena, darin, eric, lucas… who are not
//   assigned any permits/projects, their default view should be everyone."*
//   HE GUESSED FIVE NAMES. Measured on prod the same day it is SIXTEEN of
//   twenty-nine logins — every account with a roster row and zero project
//   leads, zero permit assignments and (bar one) zero tasks:
//
//     Ana · Darin · Dave · Dom · EJ · Eric · Gena · Greg · Jake · Jason ·
//     Jessie · Keelie · Keenan · Lucas · Scott · Taylor
//
//   More than half the company opened a blank Pipeline, a blank Project View
//   and a blank My Tasks. It already showed: Gena had not signed in since
//   2026-07-08, Lucas since 2026-07-07, Greg/EJ/Taylor since late July.
//
// ---------------------------------------------------------------------------
// ★★★ THE DEFECT WAS ONE QUESTION ASKED TOO NARROWLY
// ---------------------------------------------------------------------------
//
// `initialScopeMode` ALREADY returned 'all' for an identity scoped 'all'. The
// bug was upstream: `deriveSelfScope` decides the tier from PROJECTS ONLY, so a
// roster name leading no project is filed 'permit' — "you have permit-level
// work" — without anyone ever checking whether they are on a permit. All
// sixteen landed there, 'permit' defaults to 'mine', and 'mine' was empty.

/** Source with both comment forms removed. Every absence assertion runs through
 *  here — these files explain their own history, and prose that quotes a rule
 *  is not the rule. (Seventh sighting of that trap in this repo.) */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
/** JSX comments too — `{/* … *\/}` survives the block strip above only in the
 *  sense that its braces remain, but the text inside does not. */
function jsx(src: string): string {
  return code(src).replace(/\{\s*\}/g, '');
}

// ---------------------------------------------------------------------------
// §A · widenScopeWhenUnassigned — the pure rule
// ---------------------------------------------------------------------------

const PERMIT_FOR_CAM = [
  { ent_lead: null, dm: null, da: 'Cam', dual_da: null },
];
const PERMIT_FOR_NOBODY_WE_KNOW = [
  { ent_lead: 'Miles', dm: 'Brittani', da: 'Trevor', dual_da: null },
];

describe('fix-428 §A: nothing assigned to you widens to Everyone', () => {
  it('★★★ permit-scope with NO matching permit becomes "all"', () => {
    // The sixteen. This is the whole ticket in one assertion.
    expect(widenScopeWhenUnassigned('permit', 'Gena', PERMIT_FOR_NOBODY_WE_KNOW))
      .toBe('all');
    expect(widenScopeWhenUnassigned('permit', 'Gena', [])).toBe('all');
  });

  it('★★★ permit-scope WITH a matching permit stays "permit"', () => {
    // fix-179's motivating case, untouched: someone who leads no project but
    // works permits still opens on My Work, because My Work has something in it.
    expect(widenScopeWhenUnassigned('permit', 'Cam', PERMIT_FOR_CAM)).toBe('permit');
  });

  it('★★ it matches on all four permit roles, via permitMatchesSelf', () => {
    // ★ NOT a second predicate. Two matchers that agree today are two matchers
    //   that disagree after the next role is added.
    for (const role of ['ent_lead', 'dm', 'da', 'dual_da'] as const) {
      const permit = { ent_lead: null, dm: null, da: null, dual_da: null, [role]: 'Gena' };
      expect(widenScopeWhenUnassigned('permit', 'Gena', [permit]), role).toBe('permit');
    }
  });

  it('★★ project-scope and all-scope pass straight through', () => {
    // A project lead has work by definition; an unmapped name is already
    // Everyone. Only 'permit' — the tier reached by ELIMINATION — is re-asked.
    expect(widenScopeWhenUnassigned('project', 'Miles', [])).toBe('project');
    expect(widenScopeWhenUnassigned('all', null, PERMIT_FOR_CAM)).toBe('all');
    expect(widenScopeWhenUnassigned('all', 'Anyone', [])).toBe('all');
  });

  it('★ a null name is "all", never a match', () => {
    expect(widenScopeWhenUnassigned('permit', null, PERMIT_FOR_CAM)).toBe('all');
    expect(widenScopeWhenUnassigned('permit', '   ', PERMIT_FOR_CAM)).toBe('all');
  });

  it('★ case and padding do not decide it', () => {
    expect(widenScopeWhenUnassigned('permit', '  cam ', PERMIT_FOR_CAM)).toBe('permit');
  });
});

// ---------------------------------------------------------------------------
// §B · useScopeMode — the default, the stored choice, and the flash
// ---------------------------------------------------------------------------

const teamState = vi.hoisted(() => ({
  all: [] as { name: string; role: TeamRole; email: string | null }[],
  isLoading: false,
}));
const projectsState = vi.hoisted(() => ({
  data: [] as { entitlement_lead: string | null; design_manager: string | null }[],
  isLoading: false,
}));
const permitsState = vi.hoisted(() => ({
  data: [] as {
    ent_lead: string | null;
    dm: string | null;
    da: string | null;
    dual_da: string | null;
  }[],
  isLoading: false,
}));

vi.mock('../hooks/useTeamMembers', () => ({ useTeamMembers: () => teamState }));
vi.mock('../hooks/useProjects', () => ({ useProjects: () => projectsState }));
vi.mock('../hooks/usePermits', () => ({ usePermits: () => permitsState }));

import { useScopeMode } from '../hooks/useSelfScope';

const ROSTER = [
  // Leads a project → project scope, untouched by fix-428.
  { name: 'Miles', role: 'ent_lead' as TeamRole, email: 'miles@blueprintcap.com' },
  // Leads no project but works a permit → permit scope, stays 'mine'.
  { name: 'Cam', role: 'da' as TeamRole, email: 'cameron@blueprintcap.com' },
  // ★ One of the sixteen: on the roster, on nothing else.
  { name: 'Gena', role: 'acq' as TeamRole, email: 'gena@blueprintcap.com' },
];

function loginAs(id: string, email: string | null) {
  useAuthStore.setState({ user: { id, email } as unknown as User });
}

beforeEach(() => {
  window.localStorage.clear();
  teamState.all = ROSTER;
  teamState.isLoading = false;
  projectsState.data = [{ entitlement_lead: 'Miles', design_manager: null }];
  projectsState.isLoading = false;
  permitsState.data = PERMIT_FOR_CAM;
  permitsState.isLoading = false;
  useAuthStore.setState({ user: null });
});

describe('fix-428 §B: the default a person actually lands on', () => {
  it('★★★ a roster name with no project and no permit lands on EVERYONE', () => {
    loginAs('u-gena', 'gena@blueprintcap.com');
    for (const view of ['dashboard', 'projects', 'mytasks'] as const) {
      const { result } = renderHook(() => useScopeMode(view));
      expect(result.current.mode, view).toBe('all');
      // ★ And the toggle is still there — the point is not to take the choice
      //   away, it is to stop the first screen being blank.
      expect(result.current.ready).toBe(true);
    }
  });

  it('★★★ the same person WITH one permit lands on MY WORK', () => {
    // ★★ DERIVED LIVE, NEVER STAMPED. This is the same login and the same
    //    storage — only the assignments changed. The day Gena is given her
    //    first permit her default becomes My Work by itself, with nobody
    //    editing a row. A version that stamped the answer at account creation
    //    would be wrong within a week, and silently.
    permitsState.data = [{ ent_lead: null, dm: null, da: 'Gena', dual_da: null }];
    loginAs('u-gena', 'gena@blueprintcap.com');
    const { result } = renderHook(() => useScopeMode('dashboard'));
    expect(result.current.mode).toBe('mine');
  });

  it('★★★ A STORED CHOICE STILL WINS — this is a default, not a floor', () => {
    // ★ The regression that would quietly override a deliberate choice.
    //   Somebody with zero assignments who explicitly picked "My work" keeps it.
    // ★ Written through the REAL writer, so this cannot drift from the key
    //   format the reader uses.
    saveScopeMode('u-gena', 'dashboard', 'mine');
    loginAs('u-gena', 'gena@blueprintcap.com');
    const { result } = renderHook(() => useScopeMode('dashboard'));
    expect(result.current.mode).toBe('mine');
  });

  it('★★ fix-179 is untouched: a permit-worker still defaults to My Work', () => {
    loginAs('u-cam', 'cameron@blueprintcap.com');
    const { result } = renderHook(() => useScopeMode('dashboard'));
    expect(result.current.mode).toBe('mine');
    // ★ RosterIdentity.scope keeps fix-179's meaning for every other reader.
    expect(result.current.identity.scope).toBe('permit');
  });

  it('★★ a project lead is untouched', () => {
    loginAs('u-miles', 'miles@blueprintcap.com');
    const { result } = renderHook(() => useScopeMode('projects'));
    expect(result.current.mode).toBe('mine');
    expect(result.current.identity.scope).toBe('project');
  });

  it('★★ NO FLASH: while permits are loading nothing resolves', () => {
    // ★★★ A permit-scoped person shown Everyone for one frame and then snapped
    //     to My Work is the flinch fix-324 / fix-403's lazy-initialiser
    //     discipline exists to prevent — and it would be a NEW flinch, on the
    //     people this ticket is not even about. The permits query is folded
    //     into the SAME guard, not checked after it.
    permitsState.isLoading = true;
    loginAs('u-cam', 'cameron@blueprintcap.com');
    const { result } = renderHook(() => useScopeMode('dashboard'));
    expect(result.current.ready).toBe(false);
    expect(result.current.mode).toBe('all');
  });

  it('★ identity.scope is NOT widened — only the toggle default is', () => {
    // The name plate (fix-343), the board lens and PersonalBoard all read
    // RosterIdentity.scope and must keep reading exactly what they read today.
    loginAs('u-gena', 'gena@blueprintcap.com');
    const { result } = renderHook(() => useScopeMode('dashboard'));
    expect(result.current.identity.scope).toBe('permit'); // fix-179's answer
    expect(result.current.mode).toBe('all'); // fix-428's answer
  });
});

// ---------------------------------------------------------------------------
// §C · where the permits query lives — the one way §2 can go wrong invisibly
// ---------------------------------------------------------------------------

describe('fix-428 §C: Chrome did not gain a permits fetch', () => {
  it('★★★ Chrome imports neither usePermits nor anything that loads permits', () => {
    // ★★★ THIS IS THE ENGINEERING DECISION OF THE TICKET. `useSelfScope` is
    //     called by Chrome.tsx — which renders on EVERY screen — and by
    //     useBoardLens, useBoardNotifications, MyBoard and PersonalBoard. Five
    //     callers, none of which load permits. Putting `usePermits()` there
    //     would make every page in the app fetch every permit with its nested
    //     cycles to decide a toggle those pages do not have.
    //     `useShowHeldWork.ts` already carries a comment warning about exactly
    //     this trap.
    expect(code(chromeSrc)).not.toMatch(/usePermits/);
    // ★ And Chrome still uses useSelfScope — i.e. the assertion above is not
    //   passing because the call went away.
    expect(code(chromeSrc)).toMatch(/useSelfScope/);
  });

  it('★★★ useSelfScope itself does NOT reach for permits; useScopeMode does', () => {
    const src = code(selfScopeHookSrc);
    // The import exists once, at the top…
    expect(src).toMatch(/import \{ usePermits \} from '\.\/usePermits'/);
    // …and the ONLY call site is inside useScopeMode, after its opening line.
    const scopeModeStart = src.indexOf('export function useScopeMode');
    const selfScopeStart = src.indexOf('export function useSelfScope');
    expect(scopeModeStart).toBeGreaterThan(-1);
    expect(selfScopeStart).toBeGreaterThan(-1);
    const selfScopeBody = src.slice(selfScopeStart, scopeModeStart);
    expect(selfScopeBody).not.toMatch(/usePermits\(\)/);
    expect(src.slice(scopeModeStart)).toMatch(/usePermits\(\)/);
    // Exactly one call, so a second cannot drift in.
    expect((src.match(/usePermits\(\)/g) ?? []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §D · the Clear controls
// ---------------------------------------------------------------------------

describe('fix-428 §D: Pipeline gets the button it never had', () => {
  it('★★★ ONE persistFilters call carrying all three keys', () => {
    // ★★★ NOT THREE SEQUENTIAL CALLS. `persistFilters` fills anything omitted
    //     from the CURRENT closure values, so three calls in one handler would
    //     each re-persist two stale pieces and the store would end up holding a
    //     mixture of cleared and uncleared state. That is what the "One writer
    //     for all three pieces, so they cannot be stored out of step" note is
    //     protecting — and the failure a test asserting only the rendered state
    //     would not see, because it surfaces on the NEXT navigation when
    //     fix-403's memory reads the store back.
    const src = code(dashboardSrc);
    const handler = src.slice(
      src.indexOf('const clearFilters'),
      src.indexOf('const clearFilters') + 500,
    );
    expect(handler).toMatch(/setSearch\(''\)/);
    expect(handler).toMatch(/setFilters\(EMPTY_DASH_FILTERS\)/);
    expect(handler).toMatch(/setHoldMode\(HOLD_FILTER_DEFAULT\)/);
    // All three keys in ONE call.
    expect(handler).toMatch(/persistFilters\(\{[\s\S]*?search: ''[\s\S]*?\}\)/);
    expect(handler).toMatch(/filters: EMPTY_DASH_FILTERS/);
    expect(handler).toMatch(/holdMode: HOLD_FILTER_DEFAULT/);
    expect((handler.match(/persistFilters\(/g) ?? []).length).toBe(1);
  });

  it('★★ it clears through the existing writer, not around it', () => {
    // fix-403's session filter memory: Clear must not bypass persistFilters and
    // must not touch the storage shape or key.
    const src = code(dashboardSrc);
    expect(src).not.toMatch(/savePipelineFilters\(/g.source && /clearFilters[\s\S]{0,400}savePipelineFilters/);
    expect(src).toMatch(/data-testid="pipeline-filter-clear"/);
  });

  it('★★★ Clear does NOT touch the My Work / Everyone toggle, on any screen', () => {
    // ★★★ fix-409's reasoning, and it is the same case: the other controls are
    //     THIS screen's filters, while ScopeToggle is a preference persisted
    //     per user per view that OTHER screens read. Clearing a filter row must
    //     not silently change what a different screen shows you.
    const dash = code(dashboardSrc);
    const handler = dash.slice(
      dash.indexOf('const clearFilters'),
      dash.indexOf('const clearFilters') + 500,
    );
    expect(handler).not.toMatch(/setScopeMode|setMode/);

    const pl = code(projectListSrc);
    const reset = pl.slice(
      pl.indexOf('function resetFilters'),
      pl.indexOf('function resetFilters') + 320,
    );
    expect(reset).not.toMatch(/setScopeMode|setMode/);

    const mt = code(myTasksSrc);
    // ★ And ShowHeldWorkToggle (fix-409) stays outside every Clear, for the
    //   identical reason it is outside today.
    expect(reset).not.toMatch(/ShowHeldWork|setShowHeld/);
    expect(handler).not.toMatch(/ShowHeldWork|setShowHeld/);
    expect(mt).toMatch(/mytasks-filter-reset/);
  });

  it('★ Project View\'s Clear now resets its hold filter too', () => {
    // Otherwise Pipeline's Clear and Project View's Clear would do visibly
    // different things under the same word — worse than the inconsistency we
    // started with.
    const pl = code(projectListSrc);
    const reset = pl.slice(
      pl.indexOf('function resetFilters'),
      pl.indexOf('function resetFilters') + 320,
    );
    expect(reset).toMatch(/setFilters\(DEFAULT_FILTERS\)/);
    expect(reset).toMatch(/setHoldMode\(HOLD_FILTER_DEFAULT\)/);
  });

  it('★ the convention is written down where it is first obeyed', () => {
    // Bobby raised it as a general rule, not one screen: a filter row with more
    // than one control owes a Clear at its end.
    expect(dashboardSrc).toMatch(/owes a Clear at\s*\n?\s*(\/\/)?\s*its end/i);
  });
});

describe('fix-428 §D: one word, and the ids do not move', () => {
  it('★★★ all four buttons say "Clear" and keep their existing test ids', () => {
    // ★★ LABELS ONLY. Bobby chose "Clear" over the recommended "Reset"; the app
    //    follows the person. Renaming an id for a word change breaks every test
    //    that references it and buys nothing, so `*-reset` ids stay.
    for (const [src, id] of [
      [projectListSrc, 'project-view-filter-reset'],
      [projectListSrc, 'project-view-empty-reset'],
      [myTasksSrc, 'mytasks-filter-reset'],
      // ★★ fix-451 §D5: the row that read `mytasks-filter-clear` pointed at
      //    components/MyTasks/FilterBar.tsx — a file NO live path rendered,
      //    imported only by this test. It is deleted, and nothing is lost
      //    here: the LIVE My Tasks Clear is the line above, and it was always
      //    the one that mattered. Four live surfaces, four assertions.
      [dashboardSrc, 'pipeline-filter-clear'],
    ] as const) {
      const at = src.indexOf(`data-testid="${id}"`);
      expect(at, id).toBeGreaterThan(-1);
      // The label sits within the button that carries the id.
      expect(src.slice(at, at + 260), id).toMatch(/>\s*(\{[^}]*\}\s*)?Clear\s*</);
    }
  });

  it('★★ no button anywhere still says "Reset"', () => {
    for (const src of [projectListSrc, myTasksSrc, dashboardSrc]) {
      // ★ On the STRIPPED source: these files explain the relabel in prose, and
      //   a comment quoting the old word is not the old word.
      expect(jsx(src)).not.toMatch(/>\s*Reset\s*</);
    }
  });

  it('★ the props and functions kept their names too', () => {
    expect(code(projectListSrc)).toMatch(/function resetFilters/);
    expect(code(myTasksSrc)).toMatch(/onReset/);
  });
});
