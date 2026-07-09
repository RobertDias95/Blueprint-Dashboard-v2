import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TeamMember, ProjectDaHandoff } from '../lib/database.types';

// fix-225: the admin-only Reassign DA modal (ownership handoff).

const reassignMutate = vi.hoisted(() => vi.fn());
const undoMutate = vi.hoisted(() => vi.fn());
const historyRef = vi.hoisted(() => ({ current: [] as ProjectDaHandoff[] }));

function member(name: string): TeamMember {
  return {
    id: `m-${name}`,
    name,
    role: 'da',
    active: true,
    former: false,
    email: null,
    notes: null,
    updated_at: '',
    active_start_quarter: null,
    active_end_quarter: null,
  };
}

vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    activeDas: [member('Trevor'), member('Nicky'), member('Marc')],
  }),
}));
vi.mock('../hooks/useProjectDaHandoffs', () => ({
  useProjectDaHandoffs: () => ({ data: historyRef.current }),
  useReassignProjectDa: () => ({ mutate: reassignMutate, isPending: false }),
  useUndoProjectDaReassign: () => ({ mutate: undoMutate, isPending: false }),
}));

import ReassignDaModal from '../components/ProjectDetail/ReassignDaModal';

function renderModal(over: Partial<React.ComponentProps<typeof ReassignDaModal>> = {}) {
  return render(
    <ReassignDaModal
      projectId="p1"
      projectAddress="500 Pike St"
      currentDa="Trevor"
      onClose={vi.fn()}
      onUseRedesign={vi.fn()}
      {...over}
    />,
  );
}

beforeEach(() => {
  reassignMutate.mockClear();
  undoMutate.mockClear();
  historyRef.current = [];
});

describe('ReassignDaModal (fix-225)', () => {
  it('offers active DAs excluding the current owner, and states board stays put', () => {
    renderModal();
    const options = Array.from(
      (screen.getByTestId('reassign-da-select') as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(options).toContain('Nicky');
    expect(options).toContain('Marc');
    expect(options).not.toContain('Trevor'); // current owner excluded
    expect(screen.getByTestId('reassign-da-explainer').textContent).toMatch(
      /board block stays put/i,
    );
  });

  it('confirming fires the reassign RPC with the picked DA + note', () => {
    renderModal();
    fireEvent.change(screen.getByTestId('reassign-da-select'), {
      target: { value: 'Nicky' },
    });
    fireEvent.change(screen.getByTestId('reassign-da-note'), {
      target: { value: 'Trevor left' },
    });
    fireEvent.click(screen.getByTestId('reassign-da-confirm'));
    expect(reassignMutate).toHaveBeenCalledTimes(1);
    expect(reassignMutate.mock.calls[0][0]).toMatchObject({
      projectId: 'p1',
      toDa: 'Nicky',
      note: 'Trevor left',
    });
  });

  it('the "Use Redesign" link routes to the redesign flow (new-block case)', () => {
    const onUseRedesign = vi.fn();
    renderModal({ onUseRedesign });
    fireEvent.click(screen.getByTestId('reassign-da-use-redesign'));
    expect(onUseRedesign).toHaveBeenCalledTimes(1);
  });

  it('shows handoff history with an undo affordance', () => {
    historyRef.current = [
      {
        id: 'h1',
        project_id: 'p1',
        from_da: 'Trevor',
        to_da: 'Nicky',
        effective_date: '2026-07-06',
        note: null,
        created_at: '2026-07-06T00:00:00Z',
      },
    ];
    renderModal();
    expect(screen.getByTestId('reassign-da-history-h1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('reassign-da-undo-h1'));
    expect(undoMutate).toHaveBeenCalledWith({ handoffId: 'h1' });
  });
});
