import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { WAITING_ON_OPTIONS } from '../lib/database.types';

const T = 'test-tenant-uuid';
const PROJ = 'proj-1';

// fix-195: Project Settings → External Team panel now reads/writes the
// projects.external_team BLOB (the single source My Tasks + the Overview editor
// use) — NOT the retired normalized project_external_teams / consultant_firms
// tables. Firms are free text backed by a <datalist> of the distinct firm names
// across all projects' blobs. We mock useProjects (the blob source) +
// useUpdateProject (the write path) and assert the blob read/write + fix-193
// show-rules.

const updateSpy = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const PROJECTS_REF = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

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

function renderPanel() {
  const wrapper = ({ children }: { children: ReactNode }) => <>{children}</>;
  return render(<ProjectExternalTeamPanel projectId={PROJ} />, { wrapper });
}

beforeEach(() => {
  updateSpy.mockClear();
  PROJECTS_REF.rows = [project({ external_team: { Civil: 'Prism' } })];
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('Project Settings → External Team (fix-195 blob)', () => {
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

  // fix-195: the panel reads the REAL blob assignment into the right slot.
  it('shows the blob assignment in its discipline slot (Civil → Prism)', () => {
    renderPanel();
    const civil = screen.getByTestId('project-external-team-firm-input-Civil') as HTMLInputElement;
    expect(civil.value).toBe('Prism');
  });

  // fix-195: real prod case — 8816 38th Ave SW: Surveyor=Emerald + Structural=SSS.
  it('shows two assigned disciplines from a multi-key blob', () => {
    PROJECTS_REF.rows = [project({ external_team: { Surveyor: 'Emerald', Structural: 'SSS' } })];
    renderPanel();
    expect((screen.getByTestId('project-external-team-firm-input-Surveyor') as HTMLInputElement).value).toBe('Emerald');
    expect((screen.getByTestId('project-external-team-firm-input-Structural') as HTMLInputElement).value).toBe('SSS');
  });

  // fix-193: a non-common discipline renders once it has a blob assignment.
  it('renders a non-common discipline when the blob assigns it', () => {
    PROJECTS_REF.rows = [project({ external_team: { Geotech: 'GeoCo' } })];
    renderPanel();
    expect(screen.getByTestId('project-external-team-row-Geotech')).toBeInTheDocument();
    expect((screen.getByTestId('project-external-team-firm-input-Geotech') as HTMLInputElement).value).toBe('GeoCo');
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

  // fix-195: writing a firm patches the blob key via useUpdateProject (merge,
  // not clobber — the existing Civil key survives).
  it('typing a firm + blur patches the blob key (Surveyor=Emerald, Civil kept)', async () => {
    renderPanel();
    const surveyor = screen.getByTestId('project-external-team-firm-input-Surveyor');
    fireEvent.change(surveyor, { target: { value: 'Emerald' } });
    fireEvent.blur(surveyor);
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    const call = updateSpy.mock.calls[0][0];
    expect(call.projectId).toBe(PROJ);
    expect(call.expectedUpdatedAt).toBe('2026-06-23T00:00:00Z');
    expect(call.patch).toEqual({ external_team: { Civil: 'Prism', Surveyor: 'Emerald' } });
  });

  // fix-195: clearing removes the discipline's key from the blob.
  it('Clear removes the discipline key from the blob', async () => {
    renderPanel();
    const clearBtn = screen.getByTestId('project-external-team-clear-Civil');
    fireEvent.click(clearBtn);
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy.mock.calls[0][0].patch).toEqual({ external_team: {} });
  });

  // No write when the value is unchanged (blur with no edit is a no-op).
  it('blur with no change does not write', async () => {
    renderPanel();
    const civil = screen.getByTestId('project-external-team-firm-input-Civil');
    fireEvent.blur(civil);
    await new Promise((r) => setTimeout(r, 0));
    expect(updateSpy).not.toHaveBeenCalled();
  });

  // fix-195: the firm datalist offers the distinct firm names across ALL blobs.
  it('the firm datalist lists the distinct firms used across all projects', () => {
    PROJECTS_REF.rows = [
      project({ id: PROJ, external_team: { Civil: 'Facet' } }),
      project({ id: 'p2', external_team: { Surveyor: 'Emerald' } }),
      project({ id: 'p3', external_team: { Structural: 'SSS', Surveyor: 'Emerald' } }),
    ];
    renderPanel();
    const datalist = screen.getByTestId('project-external-team-firm-datalist');
    const values = within(datalist)
      .queryAllByRole('option', { hidden: true })
      .map((o) => (o as HTMLOptionElement).value);
    // Deduped (Emerald once) + sorted.
    expect(values).toEqual(['Emerald', 'Facet', 'SSS']);
  });
});
