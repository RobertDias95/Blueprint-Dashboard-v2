import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { WAITING_ON_OPTIONS } from '../lib/database.types';

const T = 'test-tenant-uuid';
const PROJ = 'proj-1';

// fix-195 / fix-227: Project Settings → External Team panel reads/writes the
// projects.external_team BLOB (the single source My Tasks + the Overview editor
// use). fix-227: the firm field is now a DROPDOWN sourced from the central
// External Team directory (external_team_directory) for the discipline; picking
// still writes the blob, "+ Add new firm…" also inserts into the directory, and
// an existing free-text blob firm not in the directory still renders. We mock
// useProjects (blob source), useUpdateProject (blob write), and
// useExternalTeamDirectory / useUpsertDirectoryFirm (the directory).

const updateSpy = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const PROJECTS_REF = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
const DIR_REF = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
const upsertDirSpy = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: PROJECTS_REF.rows,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: updateSpy, isPending: false }),
}));
vi.mock('../hooks/useExternalTeamDirectory', () => ({
  useExternalTeamDirectory: () => ({
    data: DIR_REF.rows,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpsertDirectoryFirm: () => ({
    mutate: upsertDirSpy,
    mutateAsync: upsertDirSpy,
    isPending: false,
  }),
}));

import ProjectExternalTeamPanel from '../components/ProjectDetail/ProjectExternalTeamPanel';

function project(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PROJ,
    address: '224 2nd Ave N',
    juris: 'Seattle',
    external_team: {},
    updated_at: '2026-06-23T00:00:00Z',
    ...over,
  };
}

function firm(discipline: string, name: string, active = true) {
  return { id: `${discipline}-${name}`, discipline, name, active, created_at: '2026-01-01' };
}

function renderPanel() {
  const wrapper = ({ children }: { children: ReactNode }) => <>{children}</>;
  return render(<ProjectExternalTeamPanel projectId={PROJ} />, { wrapper });
}

const sel = (d: string) =>
  screen.getByTestId(`project-external-team-firm-${d}`) as HTMLSelectElement;

beforeEach(() => {
  updateSpy.mockClear();
  upsertDirSpy.mockClear();
  PROJECTS_REF.rows = [project({ external_team: { Civil: 'Prism' } })];
  DIR_REF.rows = [];
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('Project Settings → External Team (fix-195 blob / fix-227 directory)', () => {
  // fix-193: always show the common four as slots; hide unassigned others.
  it('always renders the common four as slots and hides unassigned others', () => {
    renderPanel();
    expect(screen.getByTestId('project-external-team-section')).toBeInTheDocument();
    for (const d of ['Civil', 'Surveyor', 'Structural', 'Arborist']) {
      expect(screen.getByTestId(`project-external-team-row-${d}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('project-external-team-row-Energy')).toBeNull();
    expect(screen.queryByTestId('project-external-team-row-Geotech')).toBeNull();
    expect(WAITING_ON_OPTIONS.length).toBe(13);
  });

  // fix-195/227: the panel reads the REAL blob assignment into the right slot,
  // showing it even when the firm isn't in the directory (free-text fallback).
  it('shows the blob assignment in its discipline slot (Civil → Prism, not in directory)', () => {
    renderPanel();
    expect(sel('Civil').value).toBe('Prism');
    // The saved custom firm is present as an option.
    expect(
      within(sel('Civil'))
        .getAllByRole('option')
        .some((o) => (o as HTMLOptionElement).value === 'Prism'),
    ).toBe(true);
  });

  it('shows two assigned disciplines from a multi-key blob', () => {
    PROJECTS_REF.rows = [project({ external_team: { Surveyor: 'Emerald', Structural: 'SSS' } })];
    renderPanel();
    expect(sel('Surveyor').value).toBe('Emerald');
    expect(sel('Structural').value).toBe('SSS');
  });

  // fix-193: a non-common discipline renders once it has a blob assignment.
  it('renders a non-common discipline when the blob assigns it', () => {
    PROJECTS_REF.rows = [project({ external_team: { Geotech: 'GeoCo' } })];
    renderPanel();
    expect(screen.getByTestId('project-external-team-row-Geotech')).toBeInTheDocument();
    expect(sel('Geotech').value).toBe('GeoCo');
  });

  // fix-193: the "+ Add discipline" control surfaces a hidden discipline.
  it('+ Add discipline surfaces a hidden discipline as a slot', async () => {
    renderPanel();
    expect(screen.queryByTestId('project-external-team-row-Energy')).toBeNull();
    fireEvent.change(screen.getByTestId('project-external-team-add-discipline'), {
      target: { value: 'Energy' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('project-external-team-row-Energy')).toBeInTheDocument(),
    );
  });

  // fix-193: empty-state CTA only when nothing is assigned.
  it('shows the empty-state CTA only when the blob is empty', () => {
    PROJECTS_REF.rows = [project({ external_team: {} })];
    renderPanel();
    expect(screen.getByTestId('project-external-team-empty-cta')).toBeInTheDocument();
  });

  it('hides the empty-state CTA once the blob has an assignment', () => {
    renderPanel(); // default has Civil → Prism
    expect(screen.queryByTestId('project-external-team-empty-cta')).toBeNull();
  });

  // fix-227: the firm dropdown lists the directory's ACTIVE firms for the
  // discipline (inactive dropped).
  it('the firm dropdown lists the directory firms for that discipline', () => {
    DIR_REF.rows = [
      firm('Surveyor', 'Emerald'),
      firm('Surveyor', 'Bush'),
      firm('Surveyor', 'OldCo', false), // inactive → excluded
      firm('Civil', 'Facet'), // other discipline → excluded
    ];
    renderPanel();
    const values = within(sel('Surveyor'))
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value);
    expect(values).toContain('Emerald');
    expect(values).toContain('Bush');
    expect(values).not.toContain('OldCo');
    expect(values).not.toContain('Facet');
  });

  // fix-227: picking a directory firm patches the blob key (merge, not clobber).
  it('selecting a directory firm patches the blob key (Surveyor=Emerald, Civil kept)', async () => {
    DIR_REF.rows = [firm('Surveyor', 'Emerald')];
    renderPanel();
    fireEvent.change(sel('Surveyor'), { target: { value: 'Emerald' } });
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    const call = updateSpy.mock.calls[0][0];
    expect(call.projectId).toBe(PROJ);
    expect(call.expectedUpdatedAt).toBe('2026-06-23T00:00:00Z');
    expect(call.patch).toEqual({ external_team: { Civil: 'Prism', Surveyor: 'Emerald' } });
  });

  // fix-227: "+ Add new firm…" inserts into the directory AND writes the blob.
  it('+ Add new firm inserts into the directory and writes the blob', async () => {
    renderPanel();
    // Choose the add sentinel → an inline input appears.
    fireEvent.change(sel('Surveyor'), { target: { value: '__add_new_firm__' } });
    const input = screen.getByTestId('project-external-team-firm-Surveyor-add-input');
    fireEvent.change(input, { target: { value: 'NewCo' } });
    fireEvent.blur(input);
    await waitFor(() => expect(upsertDirSpy).toHaveBeenCalledTimes(1));
    expect(upsertDirSpy.mock.calls[0][0]).toEqual({ discipline: 'Surveyor', name: 'NewCo' });
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy.mock.calls[0][0].patch).toEqual({
      external_team: { Civil: 'Prism', Surveyor: 'NewCo' },
    });
  });

  // fix-195: clearing removes the discipline's key from the blob.
  it('Clear removes the discipline key from the blob', async () => {
    renderPanel();
    const clearBtn = screen.getByTestId('project-external-team-clear-Civil');
    fireEvent.click(clearBtn);
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy.mock.calls[0][0].patch).toEqual({ external_team: {} });
  });

  // fix-227: selecting "— Unassigned —" also clears the discipline.
  it('selecting Unassigned removes the discipline key from the blob', async () => {
    renderPanel();
    fireEvent.change(sel('Civil'), { target: { value: '' } });
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy.mock.calls[0][0].patch).toEqual({ external_team: {} });
  });
});
