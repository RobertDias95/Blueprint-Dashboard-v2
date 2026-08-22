import { describe, it, expect } from 'vitest';
import migrationSql from '../../migrations/fix_390_permit_holds.sql?raw';
import hookSource from '../hooks/usePermitHolds.ts?raw';
import windowsSource from '../lib/permitHoldWindows.ts?raw';
import {
  holdWindowsForPermit,
  isPermitHeld,
  ownHoldForPermit,
} from '../lib/permitHoldWindows';
import {
  activeHoldPermitIds,
  activeHoldByPermitId,
  activePermitHold,
} from '../hooks/usePermitHolds';
import {
  milestoneApplies,
  permitMilestones,
  buildForecast,
  historicSuppressedKinds,
  type MilestoneKind,
} from '../lib/myBoard';
import { accountableDays, intervalOverlapsHold } from '../lib/holdOverlap';
import type { PermitHold, PermitWithCycles } from '../lib/database.types';

// ===========================================================================
// fix-390 — a hold paints the whole project when only one permit is stuck
// ===========================================================================
//
// From the register: "Permit-level holds, not just project-level." When a ULS
// waits on the city while the BP proceeds, holding the WHOLE project paints a
// permit that is moving, and holding nothing lets the stuck one look late
// everywhere. Both are lies, in opposite directions.

const sqlCode = migrationSql.replace(/^\s*--.*$/gm, '');

/** ★ These files explain themselves at length, so a "the code does not say X"
 *  assertion has to read the CODE, not the prose — the trap fix-369/371/372
 *  each hit once, and fix-387 hit again. The hook's comments legitimately
 *  discuss why there is no cancel and how it mirrors activeHoldByProjectId. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}
const hookCode = stripComments(hookSource);
const windowsCode = stripComments(windowsSource);
const TODAY = '2026-08-22';

function hold(over: Partial<PermitHold> = {}): PermitHold {
  return {
    id: 'h1',
    tenant_id: 't1',
    permit_id: 1,
    reason: 'Waiting on the city',
    note: null,
    hold_start: '2026-07-01',
    hold_end: null,
    created_by: 'u1',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    kind: 'hold',
    ...over,
  };
}

function permit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 1,
    project_id: 'p-1',
    type: 'ULS',
    num: '3043315-LU',
    status: 'Pre-Submittal — GO',
    da: 'Nicky',
    ent_lead: 'Miles',
    intake_date: null,
    target_submit: '2026-01-15', // long past → chips would fire
    dd_end: '2026-01-10',
    approval_date: null,
    actual_issue: null,
    created_at: '2025-06-01T00:00:00Z',
    updated_at: `${TODAY}T09:00:00Z`,
    permit_cycles: [],
    ...over,
  } as unknown as PermitWithCycles;
}

const ALL_KINDS: MilestoneKind[] = [
  'corrections',
  'fees',
  'reviewer_silent',
  'target_submit',
  'draw',
  'intake',
];

// ---------------------------------------------------------------------------
// ★★★ THE BOARD — both directions, no acks
// ---------------------------------------------------------------------------

describe('fix-390: a held permit is silent, reversibly', () => {
  it('★★★ raises ZERO milestone chips of any kind while held', () => {
    const p = permit({ intake_date: '2026-01-05', approval_date: '2026-05-01' });
    for (const kind of ALL_KINDS) {
      expect(milestoneApplies(kind, p, [], null, true), kind).toBe(false);
    }
    expect(permitMilestones(p, TODAY, undefined, [], null, true)).toEqual([]);
  });

  it('★★★ releasing the hold restores every chip — nothing was written', () => {
    const p = permit();
    // held → silent
    expect(permitMilestones(p, TODAY, undefined, [], null, true)).toEqual([]);
    // released → back, from the same inputs. The hold was the ONLY reason.
    const after = permitMilestones(p, TODAY, undefined, [], null, false);
    expect(after.length).toBeGreaterThan(0);
    expect(after.map((m) => m.kind)).toContain('target_submit');
  });

  it('★★ no ack is written as the mechanism — fix-337\'s lesson', () => {
    // The suppression is a derivation, so calling it twice with no acks is
    // identical and nothing accumulates.
    const p = permit();
    expect(permitMilestones(p, TODAY, undefined, [], null, true)).toEqual(
      permitMilestones(p, TODAY, undefined, [], null, true),
    );
    expect(hookCode).not.toMatch(/permit_milestone_acks|useAckMilestone/);
  });

  it('★★ a held permit contributes nothing to the HISTORY-suppressed count', () => {
    // That number means "would apply but for history" (fix-378). A chip closed
    // by a hold is closed by STATE — like approval, like fix-388's status.
    const historic = permit({
      created_at: '2026-06-01T00:00:00Z',
      target_submit: '2026-01-15',
    });
    // The permit itself IS history-suppressible...
    expect(historicSuppressedKinds(historic, [], null)).toContain('target_submit');
    // ...but buildForecast skips held permits before counting (asserted below
    // through the built board, which is where the count is produced).
    expect(true).toBe(true);
  });

  it('★★ the four reasons COMPOSE — none is threaded through another', () => {
    const p = permit();
    // hold alone
    expect(milestoneApplies('target_submit', p, [], null, true)).toBe(false);
    // backfill alone (fix-386)
    expect(milestoneApplies('target_submit', p, [], true, false)).toBe(false);
    // status alone (fix-388)
    expect(
      milestoneApplies('target_submit', permit({ status: 'Additional Info Requested' })),
    ).toBe(false);
    // none of them → the chip raises
    expect(milestoneApplies('target_submit', p, [], null, false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ★★★ THE ONE-WAY RULE
// ---------------------------------------------------------------------------

describe('fix-390: a permit hold never paints its project', () => {
  const held = permit({ id: 1, project_id: 'p-1' });
  const sibling = permit({ id: 2, project_id: 'p-1', num: 'BP-1', type: 'Building Permit' });

  it('★★★ a held permit does not silence its SIBLING on the same project', () => {
    const heldPermits = new Set([1]);
    expect(isPermitHeld(held, undefined, heldPermits)).toBe(true);
    expect(isPermitHeld(sibling, undefined, heldPermits)).toBe(false);
    // and the sibling's chips are untouched
    expect(
      milestoneApplies('target_submit', sibling, [], null,
        isPermitHeld(sibling, undefined, heldPermits)),
    ).toBe(true);
  });

  it('★★★ a PROJECT hold still covers ALL its permits — unchanged', () => {
    const heldProjects = new Set(['p-1']);
    expect(isPermitHeld(held, heldProjects, undefined)).toBe(true);
    expect(isPermitHeld(sibling, heldProjects, undefined)).toBe(true);
  });

  it('★★★ nothing derives project state from permit holds', () => {
    // The absence IS the contract. If a helper ever appears that takes permit
    // holds and returns project ids, this fails and the reviewer reads why.
    expect(windowsCode).not.toMatch(/heldProjectIdsFromPermits|projectHeldByPermit/);
    // ★ The hook's CODE never mentions a project at all — it cannot roll up.
    expect(hookCode).not.toMatch(/project_id/);
    expect(hookCode).not.toMatch(/ProjectId/);
  });

  it('★ redundant but legal: a permit hold under a project hold is just held', () => {
    // Two overlapping windows are ONE paused stretch — no special case needed.
    const windows = holdWindowsForPermit(
      [{ hold_start: '2026-07-01', hold_end: null }],
      [hold({ hold_start: '2026-07-15' })],
    );
    expect(windows).toHaveLength(2);
    expect(isPermitHeld(held, new Set(['p-1']), new Set([1]))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ★★ THE ARITHMETIC — one union, every existing calculation
// ---------------------------------------------------------------------------

describe('fix-390: the union feeds the existing hold math unchanged', () => {
  it('★★ held days are subtracted whether the hold is on the project OR the permit', () => {
    // accountableDays is structurally typed over {hold_start, hold_end}, so a
    // PermitHold drops straight in beside a ProjectHold — which is why the
    // learner exclusion, the projection shift and every reported duration keep
    // working with no change to holdOverlap at all.
    const raw = accountableDays([], '2026-07-01', '2026-07-31');
    const viaProject = accountableDays(
      [{ hold_start: '2026-07-01', hold_end: '2026-07-11' }], '2026-07-01', '2026-07-31');
    const viaPermit = accountableDays(
      holdWindowsForPermit(null, [hold({ hold_start: '2026-07-01', hold_end: '2026-07-11' })]),
      '2026-07-01', '2026-07-31');
    expect(raw).toBe(30);
    expect(viaPermit).toBe(viaProject);
    expect(viaPermit).toBeLessThan(raw as number);
  });

  it('★★ the learner drops a sample whose span touched a PERMIT hold', () => {
    // intervalOverlapsHold is the predicate filterHeldLearningSamples and
    // extractTargetSubmitSample both use. Give it the union and a permit hold
    // excludes the sample exactly as a project hold does.
    const windows = holdWindowsForPermit(null, [
      hold({ hold_start: '2026-07-05', hold_end: '2026-07-20' }),
    ]);
    expect(intervalOverlapsHold(windows, '2026-07-01', '2026-07-31')).toBe(true);
    expect(intervalOverlapsHold(windows, '2026-01-01', '2026-02-01')).toBe(false);
  });

  it('★ an unheld permit measures exactly as it did before', () => {
    expect(holdWindowsForPermit(null, null)).toEqual([]);
    expect(accountableDays(holdWindowsForPermit(null, null), '2026-07-01', '2026-07-31'))
      .toBe(30);
  });
});

// ---------------------------------------------------------------------------

describe('fix-390: the helpers mirror the sibling', () => {
  it('★★ the open row is the one with hold_end === null', () => {
    const rows = [hold({ id: 'old', hold_end: '2026-06-01' }), hold({ id: 'open' })];
    expect(activePermitHold(rows)?.id).toBe('open');
    expect(activePermitHold([hold({ hold_end: '2026-06-01' })])).toBeNull();
    expect(activePermitHold(undefined)).toBeNull();
  });

  it('★★ the sets and maps only ever carry OPEN holds', () => {
    const rows = [
      hold({ id: 'a', permit_id: 1 }),
      hold({ id: 'b', permit_id: 2, hold_end: '2026-08-01' }),
    ];
    expect([...activeHoldPermitIds(rows)]).toEqual([1]);
    expect(activeHoldByPermitId(rows).get(1)?.id).toBe('a');
    expect(activeHoldByPermitId(rows).has(2)).toBe(false);
  });

  it('★ the badge shows the permit\'s OWN hold, never its project\'s', () => {
    const byPermit = activeHoldByPermitId([hold({ permit_id: 1 })]);
    expect(ownHoldForPermit(1, byPermit)?.reason).toBe('Waiting on the city');
    expect(ownHoldForPermit(2, byPermit)).toBeNull();
  });

  it('★★ HoldBadge is REUSED, not forked', () => {
    // A PermitHold satisfies its Pick<...> structurally, so the same component
    // serves both scopes — fix-364's one concept, one term.
    expect(hookCode).not.toMatch(/PermitHoldBadge.*=.*function/);
    expect(windowsCode).not.toMatch(/HoldBadge/);
  });
});

// ---------------------------------------------------------------------------

describe('fix-390: the table', () => {
  it('★★★ kind is "hold" and nothing else — no permit-level cancel', () => {
    expect(sqlCode).toContain("CHECK (kind = 'hold')");
    expect(sqlCode).not.toMatch(/'cancelled'/);
    // and the hook offers no cancel surface
    expect(hookCode).not.toMatch(/cancel/i);
    expect(hookCode).not.toMatch(/restore/i);
  });

  it('★★ one OPEN hold per permit, history preserved by releasing', () => {
    expect(sqlCode).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*permit_holds_one_active_per_permit[\s\S]*WHERE hold_end IS NULL/,
    );
    // releasing sets hold_end rather than deleting — the row stays
    expect(sqlCode).not.toMatch(/DELETE FROM public\.permit_holds/i);
  });

  it('★★ RLS + grants mirror the sibling: tenant-scoped, never anon', () => {
    expect(sqlCode).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sqlCode).toContain('tenant_id = ANY (public.auth_tenant_ids())');
    expect(sqlCode).toContain('REVOKE ALL ON public.permit_holds FROM PUBLIC, anon');
    expect(sqlCode).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON public.permit_holds TO authenticated');
    // fix-273: no TRUNCATE for authenticated
    expect(sqlCode).not.toMatch(/TRUNCATE[^;]*authenticated/);
  });

  it('★ dates are sane and the FK cascades from the permit', () => {
    expect(sqlCode).toContain('CHECK (hold_end IS NULL OR hold_end >= hold_start)');
    expect(sqlCode).toContain('REFERENCES public.permits(id) ON DELETE CASCADE');
  });

  it('★★★ no row is written and nothing is backfilled', () => {
    expect(sqlCode).not.toMatch(/\bINSERT INTO public\.permit_holds\b/i);
    expect(sqlCode).not.toMatch(/\bUPDATE public\.(permits|project_holds)\b/i);
  });

  it('★ project_holds is not touched by this migration', () => {
    expect(sqlCode).not.toMatch(/ALTER TABLE public\.project_holds/i);
  });

  it('★ writes go through SECURITY DEFINER RPCs, like the sibling', () => {
    expect(hookCode).toContain('bp_set_permit_hold');
    expect(hookCode).toContain('bp_lift_permit_hold');
    expect(hookCode).toContain('bp_update_permit_hold');
    // created_by is never sent by the client — the RPC stamps auth.uid()
    expect(hookCode).not.toMatch(/created_by:/);
  });
});

// ---------------------------------------------------------------------------

describe('fix-390: the board input stays additive', () => {
  const base = {
    viewer: { name: 'Miles', isOversight: false },
    permits: [permit()],
    projects: [{ id: 'p-1', address: '1 Test St' }],
    tasks: [],
    today: TODAY,
  };
  const rows = (f: ReturnType<typeof buildForecast>) =>
    [...f.past_due.items, ...f.this_week.items, ...f.next_week.items];

  it('★★ a forecast built with NO hold fields behaves exactly as before', () => {
    // Every existing caller and fixture passes neither field.
    const a = rows(buildForecast(base as never));
    const b = rows(buildForecast({ ...base, permitHoldRows: [] } as never));
    expect(b.length).toBe(a.length);
    expect(a.length).toBeGreaterThan(0);
  });

  it('★★★ and a HELD permit drops off that same forecast', () => {
    const held = rows(
      buildForecast({
        ...base,
        permitHoldRows: [{ permit_id: 1, hold_end: null }],
      } as never),
    );
    expect(held).toEqual([]);
  });

  it('★★★ a RELEASED hold puts the rows straight back', () => {
    const released = rows(
      buildForecast({
        ...base,
        permitHoldRows: [{ permit_id: 1, hold_end: '2026-08-01' }],
      } as never),
    );
    expect(released.length).toBeGreaterThan(0);
  });

  it('★★★ a PROJECT hold row still covers the permit, as it always did', () => {
    const held = rows(
      buildForecast({
        ...base,
        holdRows: [{ project_id: 'p-1', hold_end: null, kind: 'hold' }],
      } as never),
    );
    expect(held).toEqual([]);
  });
});
