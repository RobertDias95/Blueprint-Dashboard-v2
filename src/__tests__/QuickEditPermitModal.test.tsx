import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PermitWithCycles } from '../lib/database.types';

// Q9.5.f-fix-19: smoke tests for the Quick Edit Permit popup. The modal
// composes three hooks (useUpdatePermit, usePermitTypes, useTeamMembers).
// We mock the hooks rather than the supabase layer so the assertions stay
// readable — the hooks themselves are covered by their own wire-shape tests.

const mutateAsync = vi.fn();
const useUpdatePermitMock = vi.fn();
const usePermitTypesMock = vi.fn();
const useTeamMembersMock = vi.fn();
const pushToastMock = vi.fn();

vi.mock('../hooks/useUpdatePermit', () => ({
  useUpdatePermit: () => useUpdatePermitMock(),
}));
vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => usePermitTypesMock(),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => useTeamMembersMock(),
}));
vi.mock('../stores/toastStore', () => ({
  pushToast: (...args: unknown[]) => pushToastMock(...args),
}));

import QuickEditPermitModal from '../components/ProjectDetail/QuickEditPermitModal';

function permit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 7,
    project_id: 'proj-1',
    type: 'Building Permit',
    stage: 'pm',
    stage_override: null,
    status: null,
    num: 'BP-2026-0001',
    da: 'Ainsley',
    dm: null,
    ent_lead: 'Bobby',
    dual_da: null,
    target_submit: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
    notes: null,
    cycle_model: null,
    view_cycle: null,
    kickoff_date: null,
    corr_rounds: null,
    permit_owner: null,
    architect: null,
    nickname: null,
    struct_address: '4717-A Fremont Ave N',
    portal_url: 'https://example.com/permit/7',
    updated_at: '2026-04-01T00:00:00Z',
    permit_cycles: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mutateAsync.mockReset();
  useUpdatePermitMock.mockReturnValue({
    mutateAsync,
    isPending: false,
  });
  usePermitTypesMock.mockReturnValue({
    data: [
      { name: 'Building Permit', is_builtin: true, notes: null },
      { name: 'ULS', is_builtin: true, notes: null },
      { name: 'Demolition', is_builtin: true, notes: null },
    ],
  });
  useTeamMembersMock.mockReturnValue({
    data: [
      { id: 'm1', name: 'Bobby', role: 'ent', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: 'm2', name: 'Miles', role: 'ent', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: 'm3', name: 'Ainsley', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: 'm4', name: 'Trevor', role: 'da', active: false, former: true, email: null, notes: null, updated_at: '' },
    ],
  });
});

describe('<QuickEditPermitModal />', () => {
  it('populates fields from the permit prop', () => {
    render(<QuickEditPermitModal permit={permit()} onClose={vi.fn()} />);
    expect((screen.getByTestId('qe-type') as HTMLSelectElement).value).toBe('Building Permit');
    expect((screen.getByTestId('qe-ent') as HTMLInputElement).value).toBe('Bobby');
    expect((screen.getByTestId('qe-da') as HTMLInputElement).value).toBe('Ainsley');
    expect((screen.getByTestId('qe-num') as HTMLInputElement).value).toBe('BP-2026-0001');
    expect((screen.getByTestId('qe-struct') as HTMLInputElement).value).toBe('4717-A Fremont Ave N');
    expect((screen.getByTestId('qe-url') as HTMLInputElement).value).toBe('https://example.com/permit/7');
  });

  it('Save dispatches the mutation with only changed fields', async () => {
    mutateAsync.mockResolvedValue({});
    const onClose = vi.fn();
    render(<QuickEditPermitModal permit={permit()} onClose={onClose} />);
    fireEvent.change(screen.getByTestId('qe-num'), { target: { value: 'BP-2026-0042' } });
    fireEvent.click(screen.getByTestId('qe-save'));
    await screen.findByTestId('quick-edit-permit-modal'); // flush microtasks
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    const call = mutateAsync.mock.calls[0][0];
    expect(call.permitId).toBe(7);
    expect(call.projectId).toBe('proj-1');
    expect(call.expectedUpdatedAt).toBe('2026-04-01T00:00:00Z');
    expect(call.patch).toEqual({ num: 'BP-2026-0042' });
  });

  it('Save with no changes closes the modal without calling mutate', () => {
    const onClose = vi.fn();
    render(<QuickEditPermitModal permit={permit()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('qe-save'));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Cancel closes without saving', () => {
    const onClose = vi.fn();
    render(<QuickEditPermitModal permit={permit()} onClose={onClose} />);
    fireEvent.change(screen.getByTestId('qe-num'), { target: { value: 'unsaved' } });
    fireEvent.click(screen.getByTestId('qe-cancel'));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ESC key closes the modal', () => {
    const onClose = vi.fn();
    render(<QuickEditPermitModal permit={permit()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // fix-194: "Sub-permit of…" marker.
  const sibling = (id: number, num: string): PermitWithCycles =>
    permit({ id, num, parent_permit_id: null });

  it('hides the Sub-permit selector when the project has no eligible parent', () => {
    render(<QuickEditPermitModal permit={permit()} siblings={[permit()]} onClose={vi.fn()} />);
    // only self in siblings → no parent options
    expect(screen.queryByTestId('qe-parent-permit')).toBeNull();
  });

  it('lists same-project siblings (excluding self + other sub-permits) as parents', () => {
    const self = permit({ id: 204, num: 'BLD2026-0320' });
    const sibs = [
      self,
      sibling(202, 'BLD2026-0319'),
      permit({ id: 206, num: 'BLD2026-0399', parent_permit_id: 202 }), // already a child — excluded
    ];
    render(<QuickEditPermitModal permit={self} siblings={sibs} onClose={vi.fn()} />);
    const sel = screen.getByTestId('qe-parent-permit') as HTMLSelectElement;
    const optionValues = Array.from(sel.options).map((o) => o.value);
    expect(optionValues).toEqual(['', '202']); // standalone + the one eligible parent
  });

  it('setting a parent marks the permit a sub-permit (patch carries parent_permit_id)', async () => {
    mutateAsync.mockResolvedValue({});
    const self = permit({ id: 204, num: 'BLD2026-0320' });
    render(
      <QuickEditPermitModal
        permit={self}
        siblings={[self, sibling(202, 'BLD2026-0319')]}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId('qe-parent-permit'), { target: { value: '202' } });
    fireEvent.click(screen.getByTestId('qe-save'));
    await screen.findByTestId('quick-edit-permit-modal');
    expect(mutateAsync.mock.calls[0][0].patch).toEqual({ parent_permit_id: 202 });
  });

  it('clearing the parent restores standalone (patch sets parent_permit_id null)', async () => {
    mutateAsync.mockResolvedValue({});
    const self = permit({ id: 204, num: 'BLD2026-0320', parent_permit_id: 202 });
    render(
      <QuickEditPermitModal
        permit={self}
        siblings={[self, sibling(202, 'BLD2026-0319')]}
        onClose={vi.fn()}
      />,
    );
    // Pre-filled to the current parent.
    expect((screen.getByTestId('qe-parent-permit') as HTMLSelectElement).value).toBe('202');
    fireEvent.change(screen.getByTestId('qe-parent-permit'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('qe-save'));
    await screen.findByTestId('quick-edit-permit-modal');
    expect(mutateAsync.mock.calls[0][0].patch).toEqual({ parent_permit_id: null });
  });

  it('OCC conflict (mutateAsync rejects) keeps the modal open', async () => {
    mutateAsync.mockRejectedValue(new Error('OCC conflict'));
    const onClose = vi.fn();
    render(<QuickEditPermitModal permit={permit()} onClose={onClose} />);
    fireEvent.change(screen.getByTestId('qe-num'), { target: { value: 'changed' } });
    fireEvent.click(screen.getByTestId('qe-save'));
    // Wait a tick for the rejected promise to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
