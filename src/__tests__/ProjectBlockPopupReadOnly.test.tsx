import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import ProjectBlockPopup from '../components/DrawSchedule/ProjectBlockPopup';
import type { DrawScheduleRow } from '../lib/database.types';

// fix-220: the Draw Schedule block popup is the click surface for status /
// duration / resync — all draw_schedule writes. Non-admins get a read-only
// popup: those controls are hidden, only the status readout + "Open Project"
// link remain. This locks in that split (the server RLS + RPC guards are the
// real enforcement; this keeps the UI from firing a doomed write).

vi.mock('../hooks/useUpdateDsRow', () => ({
  useUpdateDsRow: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const ROW: DrawScheduleRow = {
  project_id: 'p1',
  da_assigned: 'Trevor',
  start_week: '2026-05-04',
  end_week: '2026-05-18',
  status: 'Under Review',
  manual_status: null,
  manually_placed: true,
  dd_start: '2026-05-04',
  dd_end: '2026-05-22',
  notes: null,
  color_override: null,
  status_override: null,
  updated_at: '2026-05-09T12:00:00Z',
} as DrawScheduleRow;

function renderPopup(readOnly: boolean) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>{children}</MemoryRouter>
  );
  return render(
    <ProjectBlockPopup
      row={ROW}
      address="500 Pike St, Seattle"
      permits={[]}
      displayedStatus="Under Review"
      isAutoDerived
      readOnly={readOnly}
      onClose={() => {}}
    />,
    { wrapper },
  );
}

describe('ProjectBlockPopup — fix-220 read-only mode', () => {
  it('admin (readOnly=false): status pills, duration and resync are all present', () => {
    renderPopup(false);
    expect(screen.getByTestId('ds-popup-status-under-review')).toBeInTheDocument();
    expect(screen.getByTestId('ds-popup-duration-set')).toBeInTheDocument();
    expect(screen.getByTestId('ds-popup-resync')).toBeInTheDocument();
    expect(screen.queryByTestId('ds-popup-view-only')).toBeNull();
  });

  it('non-admin (readOnly=true): write controls hidden, status readout + open-project remain', () => {
    renderPopup(true);
    // Every write affordance is gone.
    expect(screen.queryByTestId('ds-popup-status-under-review')).toBeNull();
    expect(screen.queryByTestId('ds-popup-duration-set')).toBeNull();
    expect(screen.queryByTestId('ds-popup-duration-input')).toBeNull();
    expect(screen.queryByTestId('ds-popup-resync')).toBeNull();
    // Read-only readout + navigation stay.
    expect(screen.getByTestId('ds-popup-view-only')).toBeInTheDocument();
    expect(screen.getByTestId('ds-popup-open-project')).toBeInTheDocument();
  });
});
