import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  isUnclaimedTask,
  canSeeUnclaimedQueue,
  buildMissingLeadRows,
} from '../lib/unclaimedWork';
import { resolvePrimaryAssignee, defaultPrimaryTeamKey } from '../lib/taskTeam';
import type { PrimaryResolutionContext } from '../lib/taskTeam';

// ===========================================================================
// ★★★ fix-458 (P-106) — WORK THAT REACHES NOBODY
// ===========================================================================
//
// MEASURED ON PROD 2026-08-30 with the app's own resolution:
//   323 open tasks · 147 with no assignee and no co-assignee · 130 of those
//   still reach a person via fix-230's fallback · **17 reach nobody**.
//
// ★★★ SEVENTEEN, NOT FOURTEEN. Fourteen are `discipline='ent'` on a permit with
// no entitlement lead — the population the brief describes and Bobby is fixing.
// THREE MORE are `discipline='arch'` on permits with an ent_lead (Miles) and NO
// DA: 8236 120th Ave NE, human-created, open since 2026-08-07. So this is not an
// "ent_lead is missing" problem, it is a "resolved primary is null" problem, and
// a predicate written against `ent_lead` would have caught 14 of 17 and looked
// right. That is the case the first two tests below pin.

const ctx = (over: Partial<PrimaryResolutionContext>): PrimaryResolutionContext => ({
  da: null,
  dm: null,
  entLead: null,
  schematicDesigners: [],
  ...over,
});

describe('fix-458 — the unclaimed predicate', () => {
  it('★★★ ent task + blank ent_lead reaches nobody; the SAME task with a lead does not', () => {
    const task = { assigned_to: null, co_assignees: [], discipline: 'ent' };
    // The 14: an entitlement task on a permit with no lead.
    expect(isUnclaimedTask(task, ctx({ da: 'Fisk' }))).toBe(true);
    // …and the moment a lead exists it is claimed. Nothing about the TASK moved.
    expect(isUnclaimedTask(task, ctx({ da: 'Fisk', entLead: 'Miles' }))).toBe(false);
  });

  it('★★★ THE 130: an arch task with a DA is NOT unclaimed', () => {
    // The test that stops this surface swallowing the 130 that still reach
    // somebody. fix-230's fallback sends non-'ent' work to the DA.
    const task = { assigned_to: null, co_assignees: [], discipline: 'arch' };
    expect(isUnclaimedTask(task, ctx({ da: 'Cam' }))).toBe(false);
    // ★ …but the same task on a permit with NO DA is one of the 3 the brief
    //   did not measure. An ent_lead does NOT rescue it — the fallback for a
    //   non-'ent' discipline never looks at the lead.
    expect(isUnclaimedTask(task, ctx({ entLead: 'Miles' }))).toBe(true);
  });

  it('★★★ a co-assignee IS ownership (fix-308b) — not unclaimed', () => {
    expect(
      isUnclaimedTask(
        { assigned_to: null, co_assignees: ['Brittani'], discipline: 'ent' },
        ctx({}),
      ),
    ).toBe(false);
    // ★ …and a blank string in the array is not a co-assignee.
    expect(
      isUnclaimedTask(
        { assigned_to: null, co_assignees: ['  '], discipline: 'ent' },
        ctx({}),
      ),
    ).toBe(true);
  });

  it('★ anything actually assigned is claimed, whitespace aside', () => {
    expect(isUnclaimedTask({ assigned_to: 'Miles', discipline: 'ent' }, ctx({}))).toBe(false);
    expect(isUnclaimedTask({ assigned_to: '   ', discipline: 'ent' }, ctx({}))).toBe(true);
  });

  it('★★★ a BLANK ent_lead is nobody, not somebody', () => {
    // ★ resolvePrimaryTeamPerson returns `ctx.entLead ?? null`, and `??` only
    //   catches null/undefined — so `''` resolves to `''`, and a strict
    //   `=== null` check would have reported this task as claimed by an empty
    //   string. Caught by this case, not in review.
    expect(
      isUnclaimedTask(
        { assigned_to: null, co_assignees: [], discipline: 'ent' },
        ctx({ entLead: '' }),
      ),
    ).toBe(true);
    expect(
      isUnclaimedTask(
        { assigned_to: null, co_assignees: [], discipline: 'arch' },
        ctx({ da: '   ' }),
      ),
    ).toBe(true);
    // ★ Prod holds true NULLs today (measured 2026-08-30: 15 null, 0 empty),
    //   so this changes no count — it stops one appearing later.
  });

  it('★★ the rules it must not change still say what they said', () => {
    // MUST NOT CHANGE: resolvePrimaryAssignee / defaultPrimaryTeamKey. Pinned
    // here because this ticket is built ON them — if they move, the predicate
    // silently means something else.
    expect(defaultPrimaryTeamKey('ent')).toBe('Entitlements');
    expect(defaultPrimaryTeamKey('arch')).toBe('Design Associate');
    expect(defaultPrimaryTeamKey(null)).toBe('Design Associate');
    expect(resolvePrimaryAssignee('', ctx({ entLead: 'Miles' }), 'ent')).toBe('Miles');
    expect(resolvePrimaryAssignee('', ctx({ da: 'Cam' }), 'arch')).toBe('Cam');
    expect(resolvePrimaryAssignee('', ctx({}), 'ent')).toBeNull();
  });
});

describe('fix-458 §B4 — who sees the queue', () => {
  it('★★ admins and entitlement leads, nobody else', () => {
    expect(canSeeUnclaimedQueue(true, [])).toBe(true);
    expect(canSeeUnclaimedQueue(false, ['ent'])).toBe(true);
    // ★ both ent rows count — Bobby/Briana/Miles hold `ent` AND `ent_lead`, and
    //   gating on one would hide the queue depending on which surfaced first.
    expect(canSeeUnclaimedQueue(false, ['ent_lead'])).toBe(true);
    expect(canSeeUnclaimedQueue(false, ['da'])).toBe(false);
    expect(canSeeUnclaimedQueue(false, ['dm', 'viewer'])).toBe(false);
    expect(canSeeUnclaimedQueue(false, null)).toBe(false);
  });
});

describe('fix-458 §A — the Settings rows', () => {
  const permits = [
    { id: 1, project_id: 'pA', num: '7097616-CN-005', type: 'PPR', status: 'Issued', da: 'Fisk', ent_lead: null, updated_at: 'u1' },
    { id: 2, project_id: 'pB', num: null, type: 'Building Permit', status: 'Pre-Submittal — GO', da: null, ent_lead: '', updated_at: 'u2' },
    { id: 3, project_id: 'pC', num: '7065752-CN', type: 'Building Permit', status: 'Issued', da: 'George', ent_lead: 'Miles', updated_at: 'u3' },
  ];
  const addressOf = (id: string) =>
    ({ pA: '123 N 48th St', pB: '215 31st Ave', pC: '2610 NW 62nd St' })[id] ?? '?';
  const tasks = [
    // permit 1 swallows two, the older from June
    { permit_id: 1, assigned_to: null, co_assignees: [], discipline: 'ent', created_at: '2026-06-25', completion_status: 'Open' },
    { permit_id: 1, assigned_to: null, co_assignees: [], discipline: 'ent', created_at: '2026-08-01', completion_status: 'Open' },
    // …a resolved one does not count
    { permit_id: 1, assigned_to: null, co_assignees: [], discipline: 'ent', created_at: '2026-05-01', completion_status: 'Resolved' },
    // …nor does one that reaches the DA
    { permit_id: 1, assigned_to: null, co_assignees: [], discipline: 'arch', created_at: '2026-05-02', completion_status: 'Open' },
    // permit 2 swallows one
    { permit_id: 2, assigned_to: null, co_assignees: [], discipline: 'ent', created_at: '2026-07-01', completion_status: 'Open' },
    // permit 3 has a lead — not on the panel at all
    { permit_id: 3, assigned_to: null, co_assignees: [], discipline: 'ent', created_at: '2026-01-01', completion_status: 'Open' },
  ];
  const isLive = (s: string | null | undefined) => (s ?? 'Open') !== 'Resolved';

  it('★★★ lists only lead-less permits, and counts what each swallows', () => {
    const rows = buildMissingLeadRows(permits, addressOf, tasks, isLive);
    expect(rows.map((r) => r.permitId)).toEqual([1, 2]); // 3 has a lead
    expect(rows[0]!.unclaimedCount).toBe(2); // resolved + arch excluded
    expect(rows[1]!.unclaimedCount).toBe(1);
  });

  it('★★ sorted by count desc, then oldest task first (§A3)', () => {
    const rows = buildMissingLeadRows(permits, addressOf, tasks, isLive);
    expect(rows[0]!.permitId).toBe(1);
    expect(rows[0]!.oldestTaskAt).toBe('2026-06-25');
  });

  it('★ "no number yet" is a real state, not a blank', () => {
    const rows = buildMissingLeadRows(permits, addressOf, tasks, isLive);
    expect(rows.find((r) => r.permitId === 2)!.num).toBeNull();
    expect(rows.find((r) => r.permitId === 1)!.num).toBe('7097616-CN-005');
  });

  it('★★★ a permit drops off the list the moment a lead is set', () => {
    const withLead = permits.map((p) =>
      p.id === 1 ? { ...p, ent_lead: 'Briana' } : p,
    );
    const rows = buildMissingLeadRows(withLead, addressOf, tasks, isLive);
    expect(rows.map((r) => r.permitId)).toEqual([2]);
  });

  it('★ a lead-less permit with NO stuck work still lists, at zero', () => {
    const rows = buildMissingLeadRows(permits, addressOf, [], isLive);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.unclaimedCount === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The Settings panel
// ---------------------------------------------------------------------------
const state = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: [
      { id: 1, project_id: 'pA', num: '7097616-CN-005', type: 'PPR', status: 'Issued', da: 'Fisk', ent_lead: null, updated_at: 'u1' },
      { id: 3, project_id: 'pC', num: 'x', type: 'BP', status: 'Issued', da: null, ent_lead: 'Miles', updated_at: 'u3' },
    ],
    isLoading: false,
  }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: [{ id: 'pA', address: '123 N 48th St' }, { id: 'pC', address: 'other' }],
    isLoading: false,
  }),
}));
vi.mock('../hooks/useAllPermitTasks', () => ({
  useAllPermitTasks: () => ({
    data: [
      { id: 't1', permit_id: 1, assigned_to: null, co_assignees: [], discipline: 'ent', created_at: '2026-06-25', completion_status: 'Open' },
    ],
    isLoading: false,
  }),
}));
vi.mock('../hooks/useUpdatePermit', () => ({
  useUpdatePermit: () => ({ mutate: state.update, isPending: false }),
}));

import PermitsMissingLeadPanel from '../components/Settings/PermitsMissingLeadPanel';

const ENTS = [
  { id: 'e1', name: 'Miles' },
  { id: 'e2', name: 'Briana' },
] as unknown as Parameters<typeof PermitsMissingLeadPanel>[0]['ents'];

beforeEach(() => state.update.mockReset());

describe('fix-458 §A — the panel', () => {
  it('★★★ lists the lead-less permit with its swallowed-task count', () => {
    render(<PermitsMissingLeadPanel ents={ENTS} readOnly={false} />);
    expect(screen.getByTestId('missing-lead-row-1')).toBeTruthy();
    expect(screen.getByTestId('missing-lead-count-1').textContent).toBe('1');
    // The permit that HAS a lead is not on the panel.
    expect(screen.queryByTestId('missing-lead-row-3')).toBeNull();
  });

  it('★★★ setting a lead writes ent_lead with the OCC token', () => {
    render(<PermitsMissingLeadPanel ents={ENTS} readOnly={false} />);
    fireEvent.change(screen.getByTestId('missing-lead-set-1'), {
      target: { value: 'Briana' },
    });
    expect(state.update).toHaveBeenCalledTimes(1);
    expect(state.update.mock.calls[0]![0]).toMatchObject({
      permitId: 1,
      projectId: 'pA',
      expectedUpdatedAt: 'u1',
      patch: { ent_lead: 'Briana' },
    });
  });

  it('★★ readOnly: the gap is visible, the control is not', () => {
    render(<PermitsMissingLeadPanel ents={ENTS} readOnly={true} />);
    expect(screen.getByTestId('missing-lead-row-1')).toBeTruthy();
    expect(screen.getByTestId('missing-lead-count-1').textContent).toBe('1');
    expect(screen.queryByTestId('missing-lead-set-1')).toBeNull();
  });
});
