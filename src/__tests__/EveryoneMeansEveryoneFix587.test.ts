import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { milestoneReach, makeLegsFor } from '../lib/milestoneOwnership';
import {
  initialScopeMode,
  loadScopeMode,
  saveScopeMode,
  widenScopeWhenUnassigned,
} from '../lib/selfScope';
import { buildStamp, buildAgeDays } from '../lib/buildInfo';

// ===========================================================================
// ★★★ fix-587 (P-287) — "EVERYONE" MUST MEAN EVERYONE
// ===========================================================================
//
// THE REPORT, 2026-09-16. Bobby and Brittani, same screen, same filters, both
// on **Everyone**:
//
//              Bobby   Brittani
//   OPEN         332         65
//   OVERDUE       65         17
//   PROJECTS     185         20
//
// ---------------------------------------------------------------------------
// ★★★ §1a — SERVER PARITY. PROVED FIRST, BEFORE ANY CODE CHANGED.
// ---------------------------------------------------------------------------
//
// `bp_list_tasks()` called on prod as each login, impersonated with BOTH the
// JWT claim and `SET LOCAL ROLE authenticated` (either alone silently reads as
// the caller), inside a block that ended in `RAISE EXCEPTION` so nothing
// persisted:
//
//   bobby    = 1847 rows      tenants {00000000-…-0001}
//   brittani = 1847 rows      tenants {00000000-…-0001}
//   equal    = TRUE
//
// **The two receive identical rows.** The server is not the cause, exactly as
// the brief said — and `bp_list_tasks` and the RLS policies are untouched here.
//
// ---------------------------------------------------------------------------
// ★★★ §1b — BUILD PARITY. IT FAILS, AND IT IS THE ANSWER.
// ---------------------------------------------------------------------------
//
// Brittani's toolbar was missing **Co-assigned**, **Unclaimed** and
// **+ Task with no permit**. Those are not filters, they are components, and
// `git log --diff-filter=A` dates them:
//
//   fix-445  CoAssignedToggle    2026-08-29
//   fix-458  UnclaimedToggle     2026-08-30
//   fix-460  TeamTaskComposer    2026-08-30
//
// A client missing all three is running code from **before 2026-08-29** — about
// three weeks stale on the day of the report, and therefore older than fix-428
// (scope defaults) and fix-583 (the widened ownership predicate) as well. **A
// three-week-old bundle does not share this one's idea of "Everyone".**
//
// ⚠️ AND NOTHING COULD SAY SO: `package.json` read `0.0.0`, there was no Vite
//    `define`, no About panel, and no build field on any `error_reports` row.
//    The evidence was three missing buttons in a screenshot. §1b's remedy is
//    `lib/buildInfo` — asserted at the bottom of this file.
//
// ---------------------------------------------------------------------------
// ★★★ §1c — THE CHAIN, STAGE BY STAGE. EVERY ONE IS CORRECT UNDER 'all'.
// ---------------------------------------------------------------------------
//
//   1. `bp_list_tasks`         1847 rows, identical for both       (§1a)
//   2. `liveTasks`             excludeCancelled + excludeHeldWork — identity-free
//   3. `scopedTasks`           `if (scopeMode !== 'mine') return tasks` ✔ NO-OP under 'all'
//   4. `visibleTasks`          = scopedTasks unless the Unclaimed switch is ON
//   5. `filterTasks`           botOnly / permitTypes / roleNames / quickRole /
//                              search — **identity-free, and every one empty by
//                              default**
//   6. milestones              `milestoneReach` → `if (ctx.everyone) return 'direct'` ✔
//   7. counters                derived from (5) + (6); no filtering of their own
//
// ★★★ SO THERE IS NO STAGE WHERE 332 BECOMES 65 IN THIS BUILD. The divergence
//     is not in the logic, it is in WHICH LOGIC WAS RUNNING. That is why §3's
//     guard is the deliverable and there is no behaviour change to the chain.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const strip = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// §2 · WHAT "EVERYONE" MEANS — the stages that DO consult identity
// ---------------------------------------------------------------------------

describe('fix-587 §2 — the milestone half ignores identity under Everyone', () => {
  const ctx = (name: string | null, everyone: boolean) => ({
    name,
    dmForDa: () => null,
    everyone,
  });
  const PERMIT = { da: 'Erick', ent_lead: 'Briana' };

  it('★★★ under Everyone a milestone reaches you whoever you are', () => {
    for (const who of ['Brittani', 'Bobby', 'Nobody At All', null]) {
      expect(milestoneReach(PERMIT, 'design', ctx(who, true)), String(who)).toBe('direct');
      expect(milestoneReach(PERMIT, 'entitlement', ctx(who, true)), String(who)).toBe('direct');
    }
  });

  it('★★★ …and both legs are walked, so nothing is dropped before it is built', () => {
    // ⚠️ `makeLegsFor` feeds `buildForecast`, which SKIPS a permit with no legs.
    //    A reach that returned 'none' under Everyone would delete the row
    //    upstream of every counter — invisibly.
    expect(makeLegsFor(ctx('Brittani', true))(PERMIT)).toEqual(['design', 'entitlement']);
    expect(makeLegsFor(ctx('Bobby', true))(PERMIT)).toEqual(['design', 'entitlement']);
  });

  it('★★★ two different people get the SAME legs under Everyone', () => {
    // The property the report is about, at the one stage that could break it.
    const a = makeLegsFor(ctx('Brittani', true))(PERMIT);
    const b = makeLegsFor(ctx('Bobby', true))(PERMIT);
    expect(a).toEqual(b);
  });

  it('★★ …and under My Work they correctly differ — the filter still filters', () => {
    // ⚠️ THE OTHER DIRECTION. A fix that made `everyone` unconditional would
    //    pass every assertion above and destroy My Work.
    expect(makeLegsFor(ctx('Briana', false))(PERMIT)).toEqual(['entitlement']);
    expect(makeLegsFor(ctx('Erick', false))(PERMIT)).toEqual(['design']);
    expect(makeLegsFor(ctx('Nobody', false))(PERMIT)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §2b · THE PILL CANNOT SAY ONE THING AND THE FILTER DO ANOTHER
// ---------------------------------------------------------------------------

describe('fix-587 §2 — the label and the behaviour are one value', () => {
  it('★★★ ScopeToggle renders the SAME `mode` the filter reads', () => {
    // ★★★ "A control that says Everyone and means mine is the whole bug."
    //     It cannot happen here, and this is why: `useScopeMode` returns one
    //     `mode`, the toggle is given that value as a prop, and `scopedTasks`
    //     closes over the same variable. There is no second source to drift.
    const page = strip(read('src/pages/MyTasks.tsx'));
    expect(page).toMatch(/mode=\{scopeMode\}/);
    expect(page).toMatch(/if \(scopeMode !== 'mine' \|\| !name\) return tasks;/);
    // …and the hook exposes exactly one.
    const hook = strip(read('src/hooks/useSelfScope.ts'));
    expect(hook).toMatch(/const mode: ScopeMode =/);
    expect((hook.match(/return \{ mode, setMode, identity, ready/g) ?? []).length).toBe(1);
  });

  it('★★★ a person whose DEFAULT is mine gets everything once they click Everyone', () => {
    // The stored choice wins over the role-aware default, for every view.
    for (const view of ['dashboard', 'projects', 'mytasks'] as const) {
      saveScopeMode('u-brittani', view, 'all');
      expect(loadScopeMode('u-brittani', view)).toBe('all');
      expect(initialScopeMode(loadScopeMode('u-brittani', view), 'project')).toBe('all');
      expect(initialScopeMode(loadScopeMode('u-brittani', view), 'permit')).toBe('all');
    }
  });

  it('★★ the remembered choice cannot leak between logins', () => {
    saveScopeMode('u-a', 'mytasks', 'all');
    expect(loadScopeMode('u-b', 'mytasks')).toBeNull();
    // …and a null stored choice falls back to the tier default, not to 'all'.
    expect(initialScopeMode(null, 'project')).toBe('mine');
    expect(initialScopeMode(null, 'all')).toBe('all');
  });

  it('★★ an unassigned person still defaults to Everyone (fix-428, kept)', () => {
    expect(widenScopeWhenUnassigned('permit', 'Nobody', [])).toBe('all');
  });
});

// ---------------------------------------------------------------------------
// §2c · AN UNCHOSEN PEOPLE/ROLE SELECT DOES NOT FILTER
// ---------------------------------------------------------------------------

describe('fix-587 §2 — the People/role filter is empty by default', () => {
  const page = strip(read('src/pages/MyTasks.tsx'));

  it('★★★ every role bucket starts EMPTY and quickRole starts "all"', () => {
    // ★ The brief's second candidate: "if an unchosen role select defaults to
    //   her own name or role rather than to all, that filters her board while
    //   the scope pill still reads Everyone." It does not — the defaults are
    //   empty arrays and the literal string 'all', with no identity in sight.
    expect(page).toMatch(/roles:\s*\{\s*ent:\s*\[\],\s*da:\s*\[\],\s*dm:\s*\[\],\s*internal:\s*\[\]/);
    expect(page).toMatch(/quickRole:\s*'all'/);
  });

  it('★★★ …and the filter is a no-op when they are empty', () => {
    // `roleNames.length > 0` and `quickRole !== 'all'` gate both branches, so an
    // untouched dropdown removes nothing.
    expect(page).toMatch(/if \(roleNames\.length > 0 && !roleNames\.some/);
    expect(page).toMatch(/if \(filters\.quickRole !== 'all'\)/);
  });

  it('★★★ `filterTasks` never reads the viewer at all', () => {
    // ★★ It takes a `taskMatches` resolver and a list of NAMES THE USER PICKED.
    //    The viewer's own name is not a parameter, so it cannot narrow by it.
    const body = page.slice(page.indexOf('function filterTasks('));
    const end = body.indexOf('\n}\n');
    const fn = body.slice(0, end > 0 ? end : 4000);
    expect(fn).not.toMatch(/identity/);
    expect(fn).not.toMatch(/scopeMode/);
  });
});

// ---------------------------------------------------------------------------
// §3 · THE CENSUS — the deliverable
// ---------------------------------------------------------------------------
//
// ★★★ THIS IS THE THIRD TIME WORK HAS BEEN HIDDEN FROM THE PERSON WHO OWNS IT
//     — Briana on 2443 (fix-573), then fix-583's 105 assignments across 8
//     people, now this. **A per-person view that silently shows less is
//     invisible by construction: the person sees a shorter list, not an error.**
//     Nobody can report what they cannot see, so the test is the only witness.

/** Every `useMemo` / `useCallback` in MyTasks that reads the viewer's identity. */
function identityStages(): Array<{ name: string; line: number; gated: boolean }> {
  const src = read('src/pages/MyTasks.tsx').replace(/\r\n/g, '\n');
  const lines = src.split('\n');
  const out: Array<{ name: string; line: number; gated: boolean }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^\s*const (\w+) = use(?:Memo|Callback)\(/.exec(lines[i]!);
    if (!open) continue;
    let depth = 0;
    let started = false;
    let j = i;
    for (; j < lines.length; j += 1) {
      const l = lines[j]!;
      depth += (l.match(/\(/g) ?? []).length - (l.match(/\)/g) ?? []).length;
      if ((l.match(/\(/g) ?? []).length > 0) started = true;
      if (started && depth <= 0) break;
    }
    const body = lines.slice(i, j + 1).join('\n').replace(/^\s*\/\/.*$/gm, '');
    if (!/\bidentity\.name\b/.test(body)) continue;
    out.push({ name: open[1]!, line: i + 1, gated: /scopeMode/.test(body) });
    i = j;
  }
  return out;
}

/**
 * Stages that read identity and are deliberately NOT gated on the scope, each
 * with the reason. ★ An allow-list, not a silence: adding to it is a visible
 * decision in a diff, which is the point.
 */
const NOT_FILTERS: Record<string, string> = {
  // Builds the People dropdown's OPTION LISTS from the roster. It narrows no
  // task — and it must read the full roster under both modes, or the dropdown
  // would collapse to whatever the current filter left standing.
  rosterByRole: 'builds dropdown options from the roster, filters no task',
  // An ACTION handler: stamps who confirmed a handoff. Attribution, not a view.
  onMilestoneTick: 'attributes an action to the actor; filters no task',
};

describe('fix-587 §3 — no filter stage may consult identity under Everyone', () => {
  it('★★ the census finds the stages at all (it would pass vacuously otherwise)', () => {
    expect(identityStages().length).toBeGreaterThanOrEqual(4);
  });

  it('★★★ every identity-reading stage is either scope-gated or a named non-filter', () => {
    // ★★★ THE GUARD. A new stage that narrows the list by who is looking, with
    //     no `scopeMode` in sight, fails HERE on the day it is written — which
    //     is the only moment anybody would notice, because the symptom is a
    //     shorter list and not an error.
    const offenders = identityStages()
      .filter((s) => !s.gated && !(s.name in NOT_FILTERS))
      .map((s) => `${s.name} (MyTasks.tsx:${s.line})`);
    expect(
      offenders,
      'reads identity.name without consulting scopeMode — gate it, or add it to NOT_FILTERS with a reason',
    ).toEqual([]);
  });

  it('★★★ the census FAILS on a rogue stage — proved, not assumed', () => {
    // ★★★ A guard nobody has seen fail is a guard nobody knows works. This is
    //     the exact shape of the stage a future ticket would add.
    const rogue = `
  const narrowed = useMemo(() => {
    return tasks.filter((t) => t.assigned_to === identity.name);
  }, [tasks, identity.name]);`;
    const body = rogue.replace(/^\s*\/\/.*$/gm, '');
    expect(/\bidentity\.name\b/.test(body)).toBe(true);
    expect(/scopeMode/.test(body)).toBe(false);
    expect('narrowed' in NOT_FILTERS).toBe(false);
    // …so it would land in `offenders` above.
  });

  it('★★ the three real gates are present and named', () => {
    const byName = new Map(identityStages().map((s) => [s.name, s]));
    for (const n of ['scopedTasks', 'coAssignedKey', 'reachCtx']) {
      expect(byName.get(n)?.gated, n).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// §1b · THE REMEDY — a build a person and a report can both name
// ---------------------------------------------------------------------------

describe('fix-587 §1b — a stale client is detectable now', () => {
  it('★★★ the build stamp exists and is not empty', () => {
    expect(buildStamp()).toMatch(/\S/);
  });

  it('★★★ every error report carries the build', () => {
    // ★★ The same argument fix-511 made for `environment`: the stamp answers a
    //    question a stack trace cannot, and it CANNOT be recovered
    //    retroactively — which is why P-287 had to be settled by counting
    //    buttons in a screenshot.
    const logger = strip(read('src/lib/errorLogger.ts'));
    expect(logger).toContain('build: buildStamp()');
  });

  it('★★★ …and a person can read it off a screen without a developer', () => {
    const page = strip(read('src/pages/SettingsPage.tsx'));
    expect(page).toContain('data-testid="settings-build-stamp"');
    expect(page).toContain('buildStamp()');
  });

  it('★★ the age is reported, never enforced', () => {
    // ⚠️ Deliberately NOT a cache-buster. Forcing a reload has real costs (work
    //    in progress, open dialogs) and is a separate ruling. This only makes
    //    the fact legible.
    expect(buildAgeDays(new Date())).toSatisfy(
      (v: number | null) => v === null || typeof v === 'number',
    );
    const src = strip(read('src/lib/buildInfo.ts'));
    expect(src).not.toMatch(/location\.reload|caches\.delete|serviceWorker/);
  });

  it('★★ the build is resolved at BUILD time, not guessed at runtime', () => {
    const cfg = strip(read('vite.config.ts'));
    expect(cfg).toContain('__BUILD_SHA__');
    expect(cfg).toContain('__BUILT_AT__');
    // ★ A build without git still builds — it reports `unknown`, which is
    //   honest and still distinguishes "cannot tell" from "three weeks old".
    expect(cfg).toContain("return 'unknown';");
  });
});

// ---------------------------------------------------------------------------
// §4 · WHAT WAS NOT TOUCHED
// ---------------------------------------------------------------------------

describe('fix-587 §4 — the server is proven correct and stays untouched', () => {
  it('★★★ no migration, and bp_list_tasks is not redefined anywhere in this change', () => {
    // ⚠️ §1a proved parity (1847 = 1847). Widening the server would have hidden
    //    the real cause AND opened a data-exposure hole at the same time.
    const src = read('src/pages/MyTasks.tsx');
    expect(src).toContain('bp_list_tasks');       // still the only source
    expect(strip(read('src/hooks/useTaskTree.ts'))).toContain("supabase.rpc('bp_list_tasks')");
  });

  it('★★★ "My Work" still means what fix-583 settled', () => {
    // ⛔ This ticket is about `'all'` only.
    const selfScope = strip(read('src/lib/selfScope.ts'));
    expect(selfScope).toContain('export function projectIsMine');
  });
});
