import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ProjectHold } from '../lib/database.types';

// fix-167: project On-Hold Phase 1 — badge + control + history. The DB layer
// (RPC tenant gate, one-active-hold constraint) is verified by rolled-back prod
// probes; these tests cover the UI wiring: badge visibility, the set/lift/edit
// flows fire the right mutations, and history renders closed intervals.

const holdsState = vi.hoisted(() => ({ rows: [] as ProjectHold[] }));
const setMutate = vi.hoisted(() => vi.fn());
const liftMutate = vi.hoisted(() => vi.fn());
const updateMutate = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useProjectHolds', async (importActual) => {
  const actual =
    await importActual<typeof import('../hooks/useProjectHolds')>();
  return {
    ...actual, // keep the real activeHold() helper
    useProjectHolds: () => ({
      data: holdsState.rows,
      isLoading: false,
      error: null,
    }),
    useSetProjectHold: () => ({ mutate: setMutate, isPending: false }),
    useLiftProjectHold: () => ({ mutate: liftMutate, isPending: false }),
    useUpdateProjectHold: () => ({ mutate: updateMutate, isPending: false }),
  };
});

vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({
    map: new Map([
      ['holdReasonOptions', ['MHA', 'Financing / capital decision']],
    ]),
  }),
  readAppConfigStringArray: (map: Map<string, unknown>, key: string) =>
    (map.get(key) as string[]) ?? [],
}));

import { ProjectHoldBadge, ProjectHoldPanel } from '../components/ProjectDetail/ProjectHold';

function hold(over: Partial<ProjectHold>): ProjectHold {
  return {
    id: 'h1',
    tenant_id: 't1',
    project_id: 'p1',
    reason: 'MHA',
    note: null,
    hold_start: '2026-06-10',
    hold_end: null,
    created_by: null,
    created_at: '2026-06-10T00:00:00Z',
    updated_at: '2026-06-10T00:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  holdsState.rows = [];
  setMutate.mockReset();
  liftMutate.mockReset();
  updateMutate.mockReset();
});

describe('fix-167 ProjectHoldBadge', () => {
  it('renders nothing when there is no active hold', () => {
    holdsState.rows = [hold({ id: 'past', hold_end: '2026-06-05' })];
    render(<ProjectHoldBadge projectId="p1" />);
    expect(screen.queryByTestId('project-hold-badge')).not.toBeInTheDocument();
  });

  it('renders "On Hold — <reason>" when a hold is active', () => {
    holdsState.rows = [hold({ reason: 'Financing / capital decision' })];
    render(<ProjectHoldBadge projectId="p1" />);
    const badge = screen.getByTestId('project-hold-badge');
    expect(badge.textContent).toContain('On Hold');
    expect(badge.textContent).toContain('Financing / capital decision');
  });
});

describe('fix-167 ProjectHoldPanel — set / lift / edit', () => {
  it('putting on hold fires bp_set_project_hold with the chosen reason', () => {
    holdsState.rows = [];
    render(<ProjectHoldPanel projectId="p1" />);
    fireEvent.change(screen.getByTestId('hold-reason-select'), {
      target: { value: 'MHA' },
    });
    fireEvent.change(screen.getByTestId('hold-note-input'), {
      target: { value: 'waiting on closing' },
    });
    fireEvent.click(screen.getByTestId('hold-set-btn'));
    expect(setMutate).toHaveBeenCalledTimes(1);
    expect(setMutate.mock.calls[0][0]).toMatchObject({
      projectId: 'p1',
      reason: 'MHA',
      note: 'waiting on closing',
    });
  });

  it('does not fire when no reason is picked (button disabled)', () => {
    holdsState.rows = [];
    render(<ProjectHoldPanel projectId="p1" />);
    fireEvent.click(screen.getByTestId('hold-set-btn'));
    expect(setMutate).not.toHaveBeenCalled();
  });

  it('an active hold shows the lift control; clicking Lift fires bp_lift_project_hold', () => {
    holdsState.rows = [hold({})];
    render(<ProjectHoldPanel projectId="p1" />);
    fireEvent.click(screen.getByTestId('hold-lift-btn'));
    expect(liftMutate).toHaveBeenCalledTimes(1);
    expect(liftMutate.mock.calls[0][0]).toMatchObject({ projectId: 'p1' });
  });

  it('editing the reason + Save fires bp_update_project_hold with the patch', () => {
    holdsState.rows = [hold({ id: 'h-active' })];
    render(<ProjectHoldPanel projectId="p1" />);
    fireEvent.change(screen.getByTestId('hold-edit-reason-select'), {
      target: { value: 'Financing / capital decision' },
    });
    fireEvent.change(screen.getByTestId('hold-edit-start-input'), {
      target: { value: '2026-06-01' },
    });
    fireEvent.click(screen.getByTestId('hold-save-btn'));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0][0]).toMatchObject({
      holdId: 'h-active',
      reason: 'Financing / capital decision',
      holdStart: '2026-06-01',
    });
  });

  it('renders hold history with closed intervals', () => {
    holdsState.rows = [
      hold({ id: 'active' }),
      hold({
        id: 'closed',
        reason: 'MHA',
        hold_start: '2026-05-01',
        hold_end: '2026-05-20',
      }),
    ];
    render(<ProjectHoldPanel projectId="p1" />);
    const row = screen.getByTestId('hold-history-row-closed');
    expect(row.textContent).toContain('2026-05-01');
    expect(row.textContent).toContain('2026-05-20');
    // The active hold is NOT in history (it has no end date).
    expect(screen.queryByTestId('hold-history-row-active')).not.toBeInTheDocument();
  });
});
