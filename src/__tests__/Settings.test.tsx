import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { ConsultantFirm } from '../lib/database.types';

const T = 'test-tenant-uuid';

// fix-139: Settings → Consultant Firms section. Drives the ConsultantFirmsEditor
// against a STATEFUL mocked supabase.rpc (an in-memory firms table) so the
// add / edit / archive / show-inactive flows exercise the real hook
// round-trips (mutation → invalidate → refetch → re-render).

const store = vi.hoisted(() => ({
  firms: [] as ConsultantFirm[],
  seq: 0,
}));

const builder = vi.hoisted(() => ({
  rpc: (name: string, args: Record<string, unknown>) => {
    if (name === 'bp_list_consultant_firms') {
      const inc = args.p_include_inactive === true;
      const rows = store.firms
        .filter((f) => inc || f.active)
        .sort(
          (a, b) =>
            a.discipline.localeCompare(b.discipline) ||
            a.name.localeCompare(b.name),
        );
      return Promise.resolve({ data: rows, error: null });
    }
    if (name === 'bp_upsert_consultant_firm') {
      const id = (args.p_id as string | null) ?? `firm-${++store.seq}`;
      const existing = store.firms.find((f) => f.id === id);
      const row: ConsultantFirm = {
        id,
        tenant_id: T,
        name: args.p_name as string,
        discipline: args.p_discipline as ConsultantFirm['discipline'],
        active: (args.p_active as boolean) ?? existing?.active ?? true,
        notes: (args.p_notes as string | null) ?? null,
        created_at: existing?.created_at ?? '2026-01-01T00:00:00Z',
        updated_at: new Date().toISOString(),
      };
      store.firms = existing
        ? store.firms.map((f) => (f.id === id ? row : f))
        : [...store.firms, row];
      return Promise.resolve({ data: [row], error: null });
    }
    if (name === 'bp_archive_consultant_firm') {
      const id = args.p_id as string;
      store.firms = store.firms.map((f) =>
        f.id === id ? { ...f, active: false } : f,
      );
      const row = store.firms.find((f) => f.id === id);
      return Promise.resolve({ data: row ? [row] : [], error: null });
    }
    return Promise.resolve({ data: [], error: null });
  },
}));

vi.mock('../lib/supabase', () => ({ supabase: builder }));

import ConsultantFirmsEditor from '../components/Settings/ConsultantFirmsEditor';

function renderEditor() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<ConsultantFirmsEditor />, { wrapper });
}

beforeEach(() => {
  store.firms = [];
  store.seq = 0;
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('Settings → Consultant Firms', () => {
  it('renders the empty state when no firms exist', async () => {
    renderEditor();
    expect(
      screen.getByTestId('settings-consultant-firms-section'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByTestId('settings-consultant-firms-empty'),
      ).toBeInTheDocument(),
    );
  });

  it('adds a firm: name + discipline → row appears in the table', async () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('settings-firm-add-button'));
    fireEvent.change(screen.getByTestId('settings-firm-form-name'), {
      target: { value: 'Prism' },
    });
    fireEvent.change(screen.getByTestId('settings-firm-form-discipline'), {
      target: { value: 'Civil' },
    });
    fireEvent.click(screen.getByTestId('settings-firm-form-save'));
    await waitFor(() => expect(screen.getByText('Prism')).toBeInTheDocument());
    // Discipline rendered alongside.
    expect(screen.getByText('Civil')).toBeInTheDocument();
  });

  it('add form requires name AND discipline (save disabled until both set)', async () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('settings-firm-add-button'));
    const save = screen.getByTestId('settings-firm-form-save');
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByTestId('settings-firm-form-name'), {
      target: { value: 'SSS' },
    });
    expect(save).toBeDisabled(); // discipline still empty
    fireEvent.change(screen.getByTestId('settings-firm-form-discipline'), {
      target: { value: 'Structural' },
    });
    expect(save).not.toBeDisabled();
  });

  it('edits a firm: form opens pre-populated, saves new name', async () => {
    store.firms = [
      {
        id: 'firm-1',
        tenant_id: T,
        name: 'Prism',
        discipline: 'Civil',
        active: true,
        notes: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-05-01T00:00:00Z',
      },
    ];
    renderEditor();
    await waitFor(() =>
      expect(screen.getByTestId('settings-firm-row-firm-1')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('settings-firm-edit-firm-1'));
    const nameInput = screen.getByTestId(
      'settings-firm-form-name',
    ) as HTMLInputElement;
    expect(nameInput.value).toBe('Prism');
    fireEvent.change(nameInput, { target: { value: 'Prism Engineering' } });
    fireEvent.click(screen.getByTestId('settings-firm-form-save'));
    await waitFor(() =>
      expect(screen.getByText('Prism Engineering')).toBeInTheDocument(),
    );
  });

  it('archives a firm with confirm → drops from default list, returns under Show inactive', async () => {
    store.firms = [
      {
        id: 'firm-1',
        tenant_id: T,
        name: 'Prism',
        discipline: 'Civil',
        active: true,
        notes: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-05-01T00:00:00Z',
      },
    ];
    renderEditor();
    await waitFor(() =>
      expect(screen.getByTestId('settings-firm-row-firm-1')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('settings-firm-archive-firm-1'));
    fireEvent.click(screen.getByTestId('settings-firm-archive-confirm-firm-1'));
    // Default list excludes inactive → row disappears.
    await waitFor(() =>
      expect(screen.queryByTestId('settings-firm-row-firm-1')).toBeNull(),
    );
    // Toggle Show inactive → reappears.
    fireEvent.click(screen.getByTestId('settings-firm-show-inactive'));
    await waitFor(() =>
      expect(screen.getByTestId('settings-firm-row-firm-1')).toBeInTheDocument(),
    );
  });
});
