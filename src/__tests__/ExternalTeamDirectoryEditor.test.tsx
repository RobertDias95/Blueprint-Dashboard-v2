import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// fix-227: Settings → Projects → External Team Directory. Admin-editable master
// firm list by discipline that feeds the per-project picker. We mock the
// directory hooks and assert CRUD (add / rename / deactivate) + the admin gate.

const DIR_REF = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
const upsertSpy = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useExternalTeamDirectory', () => ({
  useExternalTeamDirectory: () => ({
    data: DIR_REF.rows,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpsertDirectoryFirm: () => ({
    mutate: upsertSpy,
    mutateAsync: upsertSpy,
    isPending: false,
  }),
}));

import ExternalTeamDirectoryEditor from '../components/Settings/ExternalTeamDirectoryEditor';

function firm(discipline: string, name: string, active = true) {
  return { id: `${discipline}-${name}`, discipline, name, active, created_at: '2026-01-01' };
}

beforeEach(() => {
  upsertSpy.mockReset();
  DIR_REF.rows = [];
});

describe('ExternalTeamDirectoryEditor (fix-227)', () => {
  it('always shows the common-four discipline groups; hides empty non-common', () => {
    render(<ExternalTeamDirectoryEditor readOnly={false} />);
    for (const d of ['Civil', 'Surveyor', 'Structural', 'Arborist']) {
      expect(screen.getByTestId(`etd-group-${d}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('etd-group-Geotech')).toBeNull();
  });

  it('renders a non-common discipline group once it has a firm', () => {
    DIR_REF.rows = [firm('Geotech', 'GeoCo')];
    render(<ExternalTeamDirectoryEditor readOnly={false} />);
    expect(screen.getByTestId('etd-group-Geotech')).toBeInTheDocument();
    expect(screen.getByTestId('etd-firm-name-Geotech-GeoCo')).toHaveTextContent('GeoCo');
  });

  it('adding a firm calls upsert with the discipline + name (insert)', () => {
    render(<ExternalTeamDirectoryEditor readOnly={false} />);
    fireEvent.change(screen.getByTestId('etd-add-Civil'), { target: { value: 'Prism' } });
    fireEvent.click(screen.getByTestId('etd-add-btn-Civil'));
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy.mock.calls[0][0]).toEqual({ discipline: 'Civil', name: 'Prism' });
  });

  it('renaming a firm calls upsert with the id + new name (update)', () => {
    DIR_REF.rows = [firm('Civil', 'Facet')];
    render(<ExternalTeamDirectoryEditor readOnly={false} />);
    fireEvent.click(screen.getByTestId('etd-firm-name-Civil-Facet'));
    const input = screen.getByTestId('etd-firm-rename-Civil-Facet');
    fireEvent.change(input, { target: { value: 'Facet Land' } });
    fireEvent.blur(input);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy.mock.calls[0][0]).toEqual({
      id: 'Civil-Facet',
      discipline: 'Civil',
      name: 'Facet Land',
    });
  });

  it('deactivating a firm flips active to false via upsert', () => {
    DIR_REF.rows = [firm('Civil', 'Facet', true)];
    render(<ExternalTeamDirectoryEditor readOnly={false} />);
    fireEvent.click(screen.getByTestId('etd-toggle-Civil-Facet'));
    expect(upsertSpy.mock.calls[0][0]).toEqual({
      id: 'Civil-Facet',
      discipline: 'Civil',
      name: 'Facet',
      active: false,
    });
  });

  it('an inactive firm shows the inactive badge + Reactivate flips active to true', () => {
    DIR_REF.rows = [firm('Civil', 'Facet', false)];
    render(<ExternalTeamDirectoryEditor readOnly={false} />);
    const row = screen.getByTestId('etd-firm-Civil-Facet');
    expect(row).toHaveAttribute('data-active', 'false');
    expect(row).toHaveTextContent('inactive');
    fireEvent.click(screen.getByTestId('etd-toggle-Civil-Facet'));
    expect(upsertSpy.mock.calls[0][0]).toEqual({
      id: 'Civil-Facet',
      discipline: 'Civil',
      name: 'Facet',
      active: true,
    });
  });

  it('+ Add discipline surfaces a hidden discipline group', () => {
    render(<ExternalTeamDirectoryEditor readOnly={false} />);
    expect(screen.queryByTestId('etd-group-Energy')).toBeNull();
    fireEvent.change(screen.getByTestId('etd-add-discipline'), { target: { value: 'Energy' } });
    expect(screen.getByTestId('etd-group-Energy')).toBeInTheDocument();
  });

  it('read-only (non-admin): no add inputs, no toggles, names are not click-to-rename', () => {
    DIR_REF.rows = [firm('Civil', 'Facet')];
    render(<ExternalTeamDirectoryEditor readOnly={true} />);
    expect(screen.queryByTestId('etd-add-Civil')).toBeNull();
    expect(screen.queryByTestId('etd-add-discipline')).toBeNull();
    expect(screen.queryByTestId('etd-toggle-Civil-Facet')).toBeNull();
    // Clicking the name does NOT open a rename input.
    fireEvent.click(screen.getByTestId('etd-firm-name-Civil-Facet'));
    expect(screen.queryByTestId('etd-firm-rename-Civil-Facet')).toBeNull();
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});
