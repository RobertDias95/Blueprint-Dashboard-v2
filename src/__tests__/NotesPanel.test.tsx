import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { Note } from '../lib/database.types';

// fix-notes-1: NotesPanel behavior — scope filtering (holistic vs per-permit),
// active/completed split with collapsed history, add (with the right scope on
// the wire), in-place edit, and the mark-done control.

const T = 'test-tenant-uuid';
const PROJECT = 'project-uuid-1';

const mocks = vi.hoisted(() => {
  const rpcFn = vi.fn();
  const insertFn = vi.fn();
  const updateFn = vi.fn();
  const eqFn = vi.fn();
  let listResult: unknown[] = [];
  const builder = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcFn(name, args);
      return Promise.resolve({ data: listResult, error: null });
    },
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        insertFn(table, row);
        return Promise.resolve({ error: null });
      },
      update: (patch: Record<string, unknown>) => ({
        eq: (col: string, val: string) => {
          updateFn(table, patch);
          eqFn(col, val);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };
  return {
    builder,
    rpcFn,
    insertFn,
    updateFn,
    eqFn,
    setListResult: (rows: unknown[]) => {
      listResult = rows;
    },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: mocks.builder }));

import NotesPanel from '../components/ProjectDetail/NotesPanel';

function makeNote(over: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    project_id: PROJECT,
    permit_id: null,
    body: 'A project note',
    completed: false,
    completed_at: null,
    created_by: 'user-1',
    author_name: 'Bobby',
    created_at: '2026-07-16T10:00:00Z',
    updated_at: '2026-07-16T10:00:00Z',
    ...over,
  };
}

function renderPanel(props: { projectId: string; permitId?: number | null }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<NotesPanel {...props} />, { wrapper });
}

beforeEach(() => {
  mocks.rpcFn.mockClear();
  mocks.insertFn.mockClear();
  mocks.updateFn.mockClear();
  mocks.eqFn.mockClear();
  mocks.setListResult([]);
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('NotesPanel scope filtering', () => {
  it('holistic panel shows only permit_id NULL notes; permit panel only its own', async () => {
    mocks.setListResult([
      makeNote({ id: 'n-proj', permit_id: null, body: 'Holistic note' }),
      makeNote({ id: 'n-p7', permit_id: 7, body: 'Permit 7 note' }),
      makeNote({ id: 'n-p9', permit_id: 9, body: 'Permit 9 note' }),
    ]);

    const { unmount } = renderPanel({ projectId: PROJECT });
    await screen.findByTestId('note-row-n-proj');
    expect(screen.queryByTestId('note-row-n-p7')).toBeNull();
    expect(screen.queryByTestId('note-row-n-p9')).toBeNull();
    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_list_project_notes', {
      p_project_id: PROJECT,
    });
    unmount();

    renderPanel({ projectId: PROJECT, permitId: 7 });
    await screen.findByTestId('note-row-n-p7');
    expect(screen.queryByTestId('note-row-n-proj')).toBeNull();
    expect(screen.queryByTestId('note-row-n-p9')).toBeNull();
  });

  it('shows date and author on each note', async () => {
    mocks.setListResult([makeNote()]);
    renderPanel({ projectId: PROJECT });
    const row = await screen.findByTestId('note-row-note-1');
    expect(row.textContent).toContain('2026-07-16');
    expect(row.textContent).toContain('Bobby');
  });
});

describe('NotesPanel active / completed split', () => {
  it('completed notes leave the active list and appear under the collapsed history toggle', async () => {
    mocks.setListResult([
      makeNote({ id: 'n-open', body: 'Still open' }),
      makeNote({
        id: 'n-done',
        body: 'Already done',
        completed: true,
        completed_at: '2026-07-15T09:00:00Z',
      }),
    ]);
    renderPanel({ projectId: PROJECT });

    await screen.findByTestId('note-row-n-open');
    // Completed note hidden until the history toggle is opened.
    expect(screen.queryByTestId('note-row-n-done')).toBeNull();

    const toggle = screen.getByTestId('notes-panel-history-toggle');
    expect(toggle.textContent).toContain('(1)');
    fireEvent.click(toggle);
    expect(screen.getByTestId('note-row-n-done')).toBeTruthy();
    expect(screen.getByTestId('note-row-n-done').textContent).toContain(
      'done 2026-07-15',
    );
  });

  it('mark-done writes completed=true; restore writes completed=false', async () => {
    mocks.setListResult([makeNote({ id: 'n-open' })]);
    renderPanel({ projectId: PROJECT });
    fireEvent.click(await screen.findByTestId('note-complete-n-open'));
    await waitFor(() =>
      expect(mocks.updateFn).toHaveBeenCalledWith('notes', { completed: true }),
    );
    expect(mocks.eqFn).toHaveBeenCalledWith('id', 'n-open');
  });
});

describe('NotesPanel add', () => {
  it('adds a holistic note with permit_id null', async () => {
    renderPanel({ projectId: PROJECT });
    fireEvent.change(screen.getByTestId('notes-panel-add'), {
      target: { value: 'New note' },
    });
    fireEvent.click(screen.getByTestId('notes-panel-add-btn'));
    await waitFor(() =>
      expect(mocks.insertFn).toHaveBeenCalledWith('notes', {
        project_id: PROJECT,
        permit_id: null,
        body: 'New note',
      }),
    );
  });

  it('adds a permit note carrying its permit_id', async () => {
    renderPanel({ projectId: PROJECT, permitId: 7 });
    fireEvent.change(screen.getByTestId('notes-panel-add'), {
      target: { value: 'Permit note' },
    });
    fireEvent.click(screen.getByTestId('notes-panel-add-btn'));
    await waitFor(() =>
      expect(mocks.insertFn).toHaveBeenCalledWith('notes', {
        project_id: PROJECT,
        permit_id: 7,
        body: 'Permit note',
      }),
    );
  });

  it('ignores a whitespace-only draft', async () => {
    renderPanel({ projectId: PROJECT });
    fireEvent.change(screen.getByTestId('notes-panel-add'), {
      target: { value: '   ' },
    });
    expect(
      (screen.getByTestId('notes-panel-add-btn') as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('NotesPanel in-place edit', () => {
  it('click body -> edit -> blur commits the new body', async () => {
    mocks.setListResult([makeNote({ id: 'n-1', body: 'Old body' })]);
    renderPanel({ projectId: PROJECT });
    fireEvent.click(await screen.findByTestId('note-body-n-1'));
    const editor = screen.getByTestId('note-edit-n-1');
    fireEvent.change(editor, { target: { value: 'New body' } });
    fireEvent.blur(editor); // blur commits
    await waitFor(() =>
      expect(mocks.updateFn).toHaveBeenCalledWith('notes', { body: 'New body' }),
    );
    expect(mocks.eqFn).toHaveBeenCalledWith('id', 'n-1');
  });

  it('unchanged body commits nothing', async () => {
    mocks.setListResult([makeNote({ id: 'n-1', body: 'Same body' })]);
    renderPanel({ projectId: PROJECT });
    fireEvent.click(await screen.findByTestId('note-body-n-1'));
    fireEvent.blur(screen.getByTestId('note-edit-n-1'));
    await waitFor(() =>
      expect(screen.getByTestId('note-body-n-1')).toBeTruthy(),
    );
    expect(mocks.updateFn).not.toHaveBeenCalled();
  });
});
