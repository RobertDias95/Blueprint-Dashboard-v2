import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
// ★★ fix-606: this editor now reads `app_config.waitingOnOptions` (its discipline
//    vocabulary is the admin's Settings list, not a code constant), so it needs a
//    QueryClientProvider. `renderEditor` supplies one; with no tenant in the
//    store the config query stays disabled and `firmDisciplineOptions` falls back
//    to the built-in list — which is exactly what prod shows today, so every
//    expectation below is unchanged.
function renderEditor(readOnly = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ExternalTeamDirectoryEditor readOnly={readOnly} />
    </QueryClientProvider>,
  );
}


// ★ fix-666: every firm carries its stale-edit token, and every UPDATE below
//   asserts the editor sends it back.
const TOKEN = '2026-10-13T20:00:00+00:00';
function firm(discipline: string, name: string, active = true) {
  return {
    id: `${discipline}-${name}`,
    discipline,
    name,
    active,
    created_at: '2026-01-01',
    updated_at: TOKEN,
  };
}

beforeEach(() => {
  upsertSpy.mockReset();
  DIR_REF.rows = [];
});

describe('ExternalTeamDirectoryEditor (fix-227)', () => {
  it('always shows the common-four discipline groups; hides empty non-common', () => {
    renderEditor(false);
    for (const d of ['Civil', 'Surveyor', 'Structural', 'Arborist']) {
      expect(screen.getByTestId(`etd-group-${d}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('etd-group-Geotech')).toBeNull();
  });

  it('renders a non-common discipline group once it has a firm', () => {
    DIR_REF.rows = [firm('Geotech', 'GeoCo')];
    renderEditor(false);
    expect(screen.getByTestId('etd-group-Geotech')).toBeInTheDocument();
    expect(screen.getByTestId('etd-firm-name-Geotech-GeoCo')).toHaveTextContent('GeoCo');
  });

  it('adding a firm calls upsert with the discipline + name (insert)', () => {
    renderEditor(false);
    fireEvent.change(screen.getByTestId('etd-add-Civil'), { target: { value: 'Prism' } });
    fireEvent.click(screen.getByTestId('etd-add-btn-Civil'));
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy.mock.calls[0][0]).toEqual({ discipline: 'Civil', name: 'Prism' });
  });

  it('renaming a firm calls upsert with the id + new name (update)', () => {
    DIR_REF.rows = [firm('Civil', 'Facet')];
    renderEditor(false);
    fireEvent.click(screen.getByTestId('etd-firm-name-Civil-Facet'));
    const input = screen.getByTestId('etd-firm-rename-Civil-Facet');
    fireEvent.change(input, { target: { value: 'Facet Land' } });
    fireEvent.blur(input);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy.mock.calls[0][0]).toEqual({
      id: 'Civil-Facet',
      discipline: 'Civil',
      name: 'Facet Land',
      expectedUpdatedAt: TOKEN,
    });
  });

  it('deactivating a firm flips active to false via upsert', () => {
    DIR_REF.rows = [firm('Civil', 'Facet', true)];
    renderEditor(false);
    fireEvent.click(screen.getByTestId('etd-toggle-Civil-Facet'));
    expect(upsertSpy.mock.calls[0][0]).toEqual({
      id: 'Civil-Facet',
      discipline: 'Civil',
      name: 'Facet',
      active: false,
      expectedUpdatedAt: TOKEN,
    });
  });

  it('an inactive firm shows the inactive badge + Reactivate flips active to true', () => {
    DIR_REF.rows = [firm('Civil', 'Facet', false)];
    renderEditor(false);
    const row = screen.getByTestId('etd-firm-Civil-Facet');
    expect(row).toHaveAttribute('data-active', 'false');
    expect(row).toHaveTextContent('inactive');
    fireEvent.click(screen.getByTestId('etd-toggle-Civil-Facet'));
    expect(upsertSpy.mock.calls[0][0]).toEqual({
      id: 'Civil-Facet',
      discipline: 'Civil',
      name: 'Facet',
      active: true,
      expectedUpdatedAt: TOKEN,
    });
  });

  it('+ Add discipline surfaces a hidden discipline group', () => {
    renderEditor(false);
    expect(screen.queryByTestId('etd-group-Energy')).toBeNull();
    fireEvent.change(screen.getByTestId('etd-add-discipline'), { target: { value: 'Energy' } });
    expect(screen.getByTestId('etd-group-Energy')).toBeInTheDocument();
  });

  it('read-only (non-admin): no add inputs, no toggles, names are not click-to-rename', () => {
    DIR_REF.rows = [firm('Civil', 'Facet')];
    renderEditor(true);
    expect(screen.queryByTestId('etd-add-Civil')).toBeNull();
    expect(screen.queryByTestId('etd-add-discipline')).toBeNull();
    expect(screen.queryByTestId('etd-toggle-Civil-Facet')).toBeNull();
    // Clicking the name does NOT open a rename input.
    fireEvent.click(screen.getByTestId('etd-firm-name-Civil-Facet'));
    expect(screen.queryByTestId('etd-firm-rename-Civil-Facet')).toBeNull();
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});

// ★ fix-652 (census 11): a stored discipline that is NOT on the list. On the
//   built-in list (no tenant → config disabled) `Acoustics` is off-list. fix-606
//   already keeps its group on screen; these pin that it stays, marked, AND that
//   a save from inside it keeps the discipline instead of dropping it.
describe('fix-652 — an off-list discipline survives render + save', () => {
  it('★★ renders its group, marked as not a current option', () => {
    DIR_REF.rows = [firm('Acoustics', 'SoundCo')];
    renderEditor(false);
    const group = screen.getByTestId('etd-group-Acoustics');
    expect(group).toHaveTextContent('Acoustics (not a current option)');
    expect(screen.getByTestId('etd-firm-name-Acoustics-SoundCo')).toHaveTextContent('SoundCo');
  });

  it('★★★ renaming or adding a firm under it saves the SAME discipline', () => {
    DIR_REF.rows = [firm('Acoustics', 'SoundCo')];
    renderEditor(false);
    fireEvent.click(screen.getByTestId('etd-firm-name-Acoustics-SoundCo'));
    const input = screen.getByTestId('etd-firm-rename-Acoustics-SoundCo');
    fireEvent.change(input, { target: { value: 'SoundCo LLC' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(upsertSpy.mock.calls[0][0]).toEqual({
      id: 'Acoustics-SoundCo',
      discipline: 'Acoustics',
      name: 'SoundCo LLC',
      expectedUpdatedAt: TOKEN,
    });
    fireEvent.change(screen.getByTestId('etd-add-Acoustics'), { target: { value: 'EchoCo' } });
    fireEvent.click(screen.getByTestId('etd-add-btn-Acoustics'));
    expect(upsertSpy.mock.calls[1][0]).toEqual({ discipline: 'Acoustics', name: 'EchoCo' });
  });
});
