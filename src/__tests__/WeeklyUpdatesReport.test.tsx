import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { Note } from '../lib/database.types';

// fix-notes-3: Weekly Updates report — grouped, editable notes with write-back
// through the fix-notes-1 hooks (single source public.notes).

const T = 'test-tenant-uuid';

const fixtures = vi.hoisted(() => ({
  projects: [
    { id: 'p1', address: '100 Apple Way', juris: 'Seattle', archived: false, permit_order: [20, 10] },
    { id: 'p2', address: '200 Birch Rd', juris: 'Bellevue', archived: false, permit_order: null },
    { id: 'p3', address: '300 Cedar Ct', juris: 'Seattle', archived: true, permit_order: null }, // archived → excluded
  ],
  permits: [
    { id: 10, project_id: 'p1', type: 'Demolition', num: 'DEM-10', nickname: null, struct_address: null },
    { id: 20, project_id: 'p1', type: 'Building Permit', num: 'BP-20', nickname: 'Bldg A', struct_address: null },
    { id: 30, project_id: 'p2', type: 'Building Permit', num: null, nickname: null, struct_address: null },
  ],
  // bp_list_all_notes returns newest-first (created_at DESC).
  notes: [
    note({ id: 'n-p1-h2', project_id: 'p1', permit_id: null, body: 'Holistic newer', created_at: '2026-07-16T10:00:00Z' }),
    note({ id: 'n-p1-h1', project_id: 'p1', permit_id: null, body: 'Holistic older', created_at: '2026-07-10T10:00:00Z' }),
    note({ id: 'n-p1-20', project_id: 'p1', permit_id: 20, body: 'BP permit note', created_at: '2026-07-15T10:00:00Z' }),
    note({ id: 'n-p1-10done', project_id: 'p1', permit_id: 10, body: 'Demo done note', completed: true, completed_at: '2026-07-14T10:00:00Z', created_at: '2026-07-12T10:00:00Z' }),
    // p2 has no notes → only surfaces when "only with notes" is OFF
  ],
}));

function note(over: Partial<Note>): Note {
  return {
    id: 'n',
    project_id: 'p1',
    permit_id: null,
    body: 'body',
    completed: false,
    completed_at: null,
    created_by: 'u1',
    author_name: 'Bobby',
    created_at: '2026-07-15T10:00:00Z',
    updated_at: '2026-07-15T10:00:00Z',
    ...over,
  };
}

const mocks = vi.hoisted(() => {
  const insertFn = vi.fn();
  const updateFn = vi.fn();
  const eqFn = vi.fn();
  let allNotes: unknown[] = [];
  const builder = {
    rpc: (name: string) => {
      if (name === 'bp_list_all_notes') return Promise.resolve({ data: allNotes, error: null });
      return Promise.resolve({ data: [], error: null });
    },
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        insertFn(row);
        return {
          select: () => ({
            single: () =>
              Promise.resolve({ data: { id: 'created-note-id' }, error: null }),
          }),
        };
      },
      update: (patch: Record<string, unknown>) => ({
        eq: (col: string, val: string) => {
          updateFn(patch);
          eqFn(col, val);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };
  return { builder, insertFn, updateFn, eqFn, setAllNotes: (n: unknown[]) => { allNotes = n; } };
});

vi.mock('../lib/supabase', () => ({ supabase: mocks.builder }));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: fixtures.projects, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: fixtures.permits, isLoading: false, error: null, refetch: vi.fn() }),
}));

import WeeklyUpdatesReport from '../pages/WeeklyUpdatesReport';

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<WeeklyUpdatesReport />, { wrapper });
}

beforeEach(() => {
  mocks.insertFn.mockClear();
  mocks.updateFn.mockClear();
  mocks.eqFn.mockClear();
  mocks.setAllNotes(fixtures.notes);
  useAuthStore.setState({ activeTenantId: T, memberships: [{ tenant_id: T, role: 'admin' }] });
});

describe('WeeklyUpdatesReport grouping', () => {
  it('groups by project, excludes archived, and shows holistic + permit scopes', async () => {
    renderIt();
    await screen.findByTestId('weekly-updates-project-p1');
    expect(screen.getByTestId('weekly-updates-project-p2')).toBeTruthy();
    // archived project excluded
    expect(screen.queryByTestId('weekly-updates-project-p3')).toBeNull();
    // holistic scope + each permit scope present on p1
    expect(screen.getByTestId('wu-scope-project-p1')).toBeTruthy();
    expect(screen.getByTestId('wu-scope-permit-20')).toBeTruthy();
    expect(screen.getByTestId('wu-scope-permit-10')).toBeTruthy();
  });

  it('orders permits by permit_order (20 before 10)', async () => {
    renderIt();
    await screen.findByTestId('weekly-updates-project-p1');
    const html = document.body.innerHTML;
    expect(html.indexOf('wu-scope-permit-20')).toBeLessThan(
      html.indexOf('wu-scope-permit-10'),
    );
  });

  it('holistic active notes are newest-first', async () => {
    renderIt();
    const scope = await screen.findByTestId('wu-scope-project-p1-active');
    const bodies = within(scope).getAllByTestId(/^note-body-/).map((el) => el.textContent);
    expect(bodies).toEqual(['Holistic newer', 'Holistic older']);
  });

  it('completed notes stay out of the active list, behind the history toggle', async () => {
    renderIt();
    await screen.findByTestId('wu-scope-permit-10');
    // the demo permit note is completed → not in active
    expect(screen.queryByTestId('note-body-n-p1-10done')).toBeNull();
    const toggle = screen.getByTestId('wu-scope-permit-10-history-toggle');
    expect(toggle.textContent).toContain('(1)');
    fireEvent.click(toggle);
    expect(screen.getByTestId('note-body-n-p1-10done')).toBeTruthy();
  });

  it('"only projects with active notes" hides note-less projects', async () => {
    renderIt();
    await screen.findByTestId('weekly-updates-project-p2');
    fireEvent.click(screen.getByTestId('weekly-updates-only-with-notes'));
    expect(screen.getByTestId('weekly-updates-project-p1')).toBeTruthy();
    // p2 has no notes → hidden
    expect(screen.queryByTestId('weekly-updates-project-p2')).toBeNull();
  });
});

describe('WeeklyUpdatesReport write-back (single source)', () => {
  it('adds a holistic note with permit_id null on the right project', async () => {
    renderIt();
    const scope = await screen.findByTestId('wu-scope-project-p1');
    fireEvent.change(within(scope).getByTestId('wu-scope-project-p1-add'), {
      target: { value: 'New holistic note' },
    });
    fireEvent.click(within(scope).getByTestId('wu-scope-project-p1-add-btn'));
    await waitFor(() =>
      expect(mocks.insertFn).toHaveBeenCalledWith({
        project_id: 'p1',
        permit_id: null,
        body: 'New holistic note',
      }),
    );
  });

  it('adds a permit note carrying its permit_id', async () => {
    renderIt();
    const scope = await screen.findByTestId('wu-scope-permit-20');
    fireEvent.change(within(scope).getByTestId('wu-scope-permit-20-add'), {
      target: { value: 'New permit note' },
    });
    fireEvent.click(within(scope).getByTestId('wu-scope-permit-20-add-btn'));
    await waitFor(() =>
      expect(mocks.insertFn).toHaveBeenCalledWith({
        project_id: 'p1',
        permit_id: 20,
        body: 'New permit note',
      }),
    );
  });

  it('editing a note writes an update to public.notes (same row id)', async () => {
    renderIt();
    fireEvent.click(await screen.findByTestId('note-body-n-p1-20'));
    const editor = screen.getByTestId('note-edit-n-p1-20');
    fireEvent.change(editor, { target: { value: 'Edited body' } });
    fireEvent.blur(editor);
    await waitFor(() =>
      expect(mocks.updateFn).toHaveBeenCalledWith({ body: 'Edited body' }),
    );
    expect(mocks.eqFn).toHaveBeenCalledWith('id', 'n-p1-20');
  });

  it('marking a note complete writes completed=true', async () => {
    renderIt();
    await screen.findByTestId('note-row-n-p1-20');
    fireEvent.click(screen.getByTestId('note-complete-n-p1-20'));
    await waitFor(() =>
      expect(mocks.updateFn).toHaveBeenCalledWith({ completed: true }),
    );
    expect(mocks.eqFn).toHaveBeenCalledWith('id', 'n-p1-20');
  });
});
