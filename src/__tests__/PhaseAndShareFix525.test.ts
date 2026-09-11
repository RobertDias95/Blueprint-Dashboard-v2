import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { deriveBlockStatus, deriveLaneStatus } from '../lib/drawScheduleStatus';
import { classifyDeBucket } from '../lib/permitStage';
import { RETIRED_VISIBILITY, retiredHiddenFrom } from '../lib/retiredState';
import type { Permit, PermitCycle } from '../lib/database.types';

// ===========================================================================
// fix-525 — the phase and the share icon tell the truth (P-241 · P-242 · P-179)
// ===========================================================================
//
// ★ Source assertions strip comments first. Every "must not appear" grep in
//   this repo has at some point matched its own gravestone. Eighth recording.

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}
const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), 'utf8');

// ---------------------------------------------------------------------------
// §C — the phase
// ---------------------------------------------------------------------------

const TODAY = new Date('2026-09-11T12:00:00Z');

/** ★★★ `8236 120th Ave NE`, EXACTLY AS PROD HOLDS IT — the project Bobby
 *  circled. Three permits, all `Pre-Submittal — GO`, no submitted cycle, DD
 *  window 2026-08-24 → 2026-10-02, so today is **18 days into DD**. The stored
 *  `draw_schedule.status` says `Schematic`. */
function permit(over: Partial<Permit> = {}): Permit {
  return {
    id: 1,
    project_id: 'p-8236',
    type: 'Building Permit',
    status: 'Pre-Submittal — GO',
    dd_start: '2026-08-24',
    dd_end: '2026-10-02',
    actual_issue: null,
    approval_date: null,
    ...over,
  } as unknown as Permit;
}

const NO_CYCLES = new Map<number, PermitCycle[]>();

describe('fix-525 §C (P-242) — a block does not stay in the phase it was born in', () => {
  it('★★★ 8236 120th Ave NE reads DD, not Schematic', () => {
    // ★★★ THE WHOLE COMPLAINT, fixtured on the real row. 18 days into a DD
    //     window that runs to 2026-10-02, and the Pipeline had it under
    //     *Scheduled & Schematic*.
    const out = deriveBlockStatus({
      permits: [permit(), permit({ id: 2 }), permit({ id: 3 })],
      cyclesByPermit: NO_CYCLES,
      currentStatus: 'Schematic',
      manualStatus: false,
      today: TODAY,
    });
    expect(out.status).toBe('DD / Permit Set');
    expect(out.isAuto).toBe(true);
  });

  it('★★★ and it lands in the LATE D&E bucket, which is what Bobby sees', () => {
    // ★ `Schematic` is in `DE_EARLY_STATUSES`, so the stored value put this
    //   project in *Scheduled & Schematic*. The derived value puts it where the
    //   work actually is.
    expect(classifyDeBucket(permit(), 'Schematic')).toBe('early');
    expect(classifyDeBucket(permit(), 'DD / Permit Set')).toBe('late');
  });

  it('★★ the derivation has ALWAYS read the DD window — hypothesis 2 is false', () => {
    // ★★★ REPORTED BEFORE BUILDING, as §C requires. Two hypotheses were
    //     offered: (1) the phase is stored at creation and never recomputed, or
    //     (2) the derivation runs but never looks at DD. **(1) is true and (2)
    //     is false** — `deriveBlockStatus` branch 4 has keyed off `dd_end` and
    //     `dd_start` since Q9.5.g, and the Draw Schedule board has called it on
    //     every render since fix-150. The Pipeline read the stored column.
    const base = { cyclesByPermit: NO_CYCLES, currentStatus: null, manualStatus: false, today: TODAY };
    // before the window opens, but inside the 28-day schematic lead
    expect(
      deriveBlockStatus({ ...base, permits: [permit({ dd_start: '2026-09-20', dd_end: '2026-10-30' })] }).status,
    ).toBe('Schematic');
    // inside the window
    expect(deriveBlockStatus({ ...base, permits: [permit()] }).status).toBe('DD / Permit Set');
    // after it closes
    expect(
      deriveBlockStatus({ ...base, permits: [permit({ dd_start: '2026-06-01', dd_end: '2026-07-01' })] }).status,
    ).toBe('Pending Consultants');
    // ★ and far enough ahead that even Schematic has not started
    expect(
      deriveBlockStatus({ ...base, permits: [permit({ dd_start: '2026-12-01', dd_end: '2027-01-15' })] }).status,
    ).toBe('Scheduled');
  });

  it('★★ a hand-set status is still respected — the 9 rows with manual_status', () => {
    // ★ Only the three permit-data branches override a manual choice, and that
    //   is unchanged: this ticket adds a READER, it does not re-rule anything.
    expect(
      deriveBlockStatus({
        permits: [permit()],
        cyclesByPermit: NO_CYCLES,
        currentStatus: 'Schematic',
        manualStatus: true,
        today: TODAY,
      }),
    ).toEqual({ status: 'Schematic', isAuto: false });
  });

  it('★★★ the Pipeline and the Draw Schedule read the SAME function', () => {
    // ★★★ §C: *"One derivation, one place, every reader calls it."* And the
    //     matching prohibition — *"Do NOT fix this by having the Pipeline derive
    //     its own phase"* — which would have made a fourteenth writer's worth of
    //     disagreement without writing anything.
    const dash = code(read('src/pages/Dashboard.tsx'));
    const grid = code(read('src/components/DrawScheduleGrid.tsx'));
    expect(dash).toContain("import { deriveLaneStatus } from '../lib/drawScheduleStatus'");
    expect(dash).toContain('deriveLaneStatus({');
    expect(grid).toContain('deriveLaneStatus');
    // ★★ AND NOTHING NEW WRITES THE COLUMN. Thirteen functions already do; a
    //    fourteenth is what §C forbids.
    expect(dash).not.toContain('draw_schedule');
    expect(dash).not.toContain('.update(');
    expect(dash).not.toContain('bp_upsert_draw_schedule_row');
  });

  it('★★★ the Pipeline derives off UNFILTERED permits', () => {
    // ★ A permit hidden by the search box or the "mine" scope still decides its
    //   project's lane. Deriving off the visible set would make the phase depend
    //   on what you had typed — a phase that changes as you search is worse than
    //   one that is stale.
    const dash = code(read('src/pages/Dashboard.tsx'));
    expect(dash).toContain('const cyclesAll = new Map<number, PermitCycle[]>()');
    expect(dash).toContain('bucketPermits(visible, derivedDrawByProjectId)');
    const block = dash.slice(dash.indexOf('const permitsOnly'), dash.indexOf('bucketPermits(visible'));
    expect(block).not.toContain('for (const b of visible)');
  });

  it('★★ a reuse-redesign still chases its parent — 12 of our 17 need it', () => {
    // ★ fix-150's one-hop chase, which is why the Pipeline calls
    //   `deriveLaneStatus` and not `deriveBlockStatus`.
    const permitsByProjectId = new Map<string, Permit[]>([
      ['parent', [permit({ project_id: 'parent' })]],
      ['child', []],
    ]);
    expect(
      deriveLaneStatus({
        project: {
          id: 'child',
          redesign_of_project_id: 'parent',
          redesign_reuses_original_permit: true,
        },
        permitsByProjectId,
        cyclesByPermit: NO_CYCLES,
        currentStatus: 'Schematic',
        manualStatus: false,
        today: TODAY,
      }).status,
    ).toBe('DD / Permit Set');
  });
});

describe('fix-525 §C — status_override', () => {
  it('★★★ NOTHING reads it, so there is nothing to treat as absent', () => {
    // ★★★ MEASURED ON PROD 2026-09-11: **206 null · 14 empty string · ZERO real
    //     values.** The same 14 rows fix-521 found holding `color_override = ''`
    //     — an artefact nobody ever set, in a second column.
    //
    // ★★★ SO THE BRIEF'S CAUTION — *"whatever reads the override must treat ''
    //     as absent"* — has no subject. `status_override` appears in exactly two
    //     places in `src/`: the hand-written row type, and the allow-list of
    //     keys `useUpdateDsRow` may write. **No code path reads its value.** The
    //     phase comes from `deriveLaneStatus` and the hand-set escape hatch is
    //     `manual_status` (9 rows), which is a boolean and cannot be `''`.
    //
    // ★ Pinned as an absence so a reader is not added later without the
    //   empty-string rule coming with it.
    const files = [
      'src/pages/Dashboard.tsx',
      'src/components/DrawScheduleGrid.tsx',
      'src/lib/drawScheduleStatus.ts',
      'src/lib/permitStage.ts',
    ];
    for (const f of files) {
      expect(code(read(f))).not.toContain('status_override');
    }
    // ★ It is still WRITEABLE — fix-521 reported it rather than dropping it,
    //   and dropping a column is a migration this ticket does not want.
    expect(code(read('src/hooks/useUpdateDsRow.ts'))).toContain('status_override');
  });

  it('★★ an empty string is not a DsStatus, so it could never win a branch', () => {
    // ★ The one place a stored status is trusted is the manual branch, and it
    //   is guarded by `isStatus()` — `''` fails it. That guard is what makes the
    //   14 empty-string rows harmless today, so it is asserted rather than
    //   assumed.
    expect(
      deriveBlockStatus({
        permits: [permit()],
        cyclesByPermit: NO_CYCLES,
        currentStatus: '',
        manualStatus: true,
        today: TODAY,
      }).status,
    ).toBe('DD / Permit Set');
  });
});

// ---------------------------------------------------------------------------
// §B — the Library keeps the redesigned original
// ---------------------------------------------------------------------------

describe('fix-525 §B — cancelled hidden, redesigned kept and hatched', () => {
  const sets = {
    cancelledIds: new Set(['cancelled-1']),
    redesignedIds: new Set(['original-1']),
  };

  it('★★★ the two causes diverge on exactly one surface, and it is declared', () => {
    expect(RETIRED_VISIBILITY.cancelled.library).toBe('hidden');
    expect(RETIRED_VISIBILITY.redesigned.library).toBe('hatched');
    // ★ Everywhere else they agree, which is what makes the Library the
    //   exception rather than the start of a pattern.
    expect(RETIRED_VISIBILITY.cancelled.pipeline).toBe(
      RETIRED_VISIBILITY.redesigned.pipeline,
    );
    expect(RETIRED_VISIBILITY.cancelled.drawSchedule).toBe(
      RETIRED_VISIBILITY.redesigned.drawSchedule,
    );
  });

  it('★★★ a cancelled project is hidden from the Library; a redesigned one is not', () => {
    expect(retiredHiddenFrom('library', 'cancelled-1', sets)).toBe(true);
    expect(retiredHiddenFrom('library', 'original-1', sets)).toBe(false);
    // ★ Both are still gone from the Pipeline.
    expect(retiredHiddenFrom('pipeline', 'cancelled-1', sets)).toBe(true);
    expect(retiredHiddenFrom('pipeline', 'original-1', sets)).toBe(true);
    // ★ Neither is ever hidden from the board — capacity is the point.
    expect(retiredHiddenFrom('drawSchedule', 'cancelled-1', sets)).toBe(false);
    expect(retiredHiddenFrom('drawSchedule', 'original-1', sets)).toBe(false);
  });

  it('★★★ the Library exposes NO edit control and NO write path', () => {
    // ⚠️⚠️ §B: *"A freeze with one unguarded entrance is not a freeze."* The
    //      brief expects this to need work, because fix-524's report said the
    //      Library's unit table is an editor.
    //
    // ★★★ IT IS NOT, AND fix-524's REPORT WAS WRONG. fix-506 §H removed the
    //     write path — *"this file makes ZERO calls to `useUpdateProject`"* —
    //     and fix-514 §H later removed even the link out to one. fix-524 read
    //     a comment that fix-506 §H had left stale in the same file rather than
    //     reading the code. **A comment is not evidence.** So the freeze does
    //     not leak; this is the assertion that keeps it that way.
    const lib = code(read('src/components/LibraryMatrix.tsx'));
    expect(lib).not.toContain('useUpdateProject');
    expect(lib).not.toContain('writeUnitTypes');
    expect(lib).not.toContain('.update(');
    expect(lib).not.toContain('.upsert(');
    expect(lib).not.toContain('supabase');
    // ★ The only `<input>`/`<select>` elements are the FILTER controls, which
    //   write to component state and never to a project.
    expect(lib).not.toContain('expectedUpdatedAt');
  });

  it('★★ the hatch is the one fix-524 built — not a second one', () => {
    // ⚠️ *"Do NOT rebuild the hatch, the retired predicate, or the
    //    plan-of-record card."*
    const lib = code(read('src/components/LibraryMatrix.tsx'));
    expect(lib).toContain('RetiredBadge');
    expect(lib).not.toContain('repeating-linear-gradient');
    expect(lib).not.toContain('--color-redesigned');
  });
});

// ---------------------------------------------------------------------------
// §A — the share icon
// ---------------------------------------------------------------------------

describe('fix-525 §A (P-241) — the card menu had no handler problem at all', () => {
  const card = code(read('src/components/ProjectDetail/PlanOfRecordCard.tsx'));

  it('★★★ the menu is portaled out of the two ancestors that clipped it', () => {
    // ★★★ IT WAS NEVER A HANDLER AND NEVER A REGRESSION. The menu rendered
    //     `absolute … top-full` inside `SetButton`'s frame — `overflow-hidden`
    //     since **fix-506**, which predates the menu — and inside
    //     `OverviewCard`'s root, `overflow-hidden` since fix-290. `top-full`
    //     puts it entirely below the frame's content box, so two separate
    //     ancestors clipped it to nothing. **The card's share menu has never
    //     opened in a browser**, which makes this a fix-522 defect rather than
    //     the fix-523 regression the brief expected.
    expect(card).toContain('createPortal(menu, document.body)');
    expect(card).toContain("position: 'fixed'");
    expect(card).not.toContain('absolute right-0 top-full');
  });

  it('★★★ the outside-click handler knows about the portal', () => {
    // ★★★ THE TRAP A PORTAL INTRODUCES. The menu is no longer inside
    //     `wrapRef`, so a mousedown on a menu ITEM counts as "outside" — it
    //     would close the menu and unmount the item before its `click` fired.
    //     The control would open, look correct, and do nothing when pressed:
    //     the same bug, one layer down.
    expect(card).toContain('menuRef.current?.contains(t)');
    expect(card).toContain('wrapRef.current?.contains(t)');
  });

  it('★★ a fixed menu closes on scroll rather than floating away', () => {
    expect(card).toContain("window.addEventListener('scroll', onScroll, true)");
    expect(card).toContain("window.addEventListener('resize', onScroll)");
  });

  it('★★ the position is measured on the CLICK, never during render', () => {
    // ★ Reading a ref during render is a React Compiler error and only LINT
    //   catches it — fix-426, and this is the fourth recording.
    expect(card).toContain('function toggle()');
    expect(card).toContain('btnRef.current?.getBoundingClientRect()');
    const renderBody = card.slice(card.indexOf('const menu = open ?'));
    expect(renderBody).not.toContain('getBoundingClientRect');
  });
});
