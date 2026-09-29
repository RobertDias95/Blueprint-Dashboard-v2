// ===========================================================================
// ★★★ fix-590 §2 — RESTORE, NOT JUST RECORD. THE DELIVERABLE.
// ===========================================================================
//
// §2: *"A history nobody can act on is a longer version of the problem. Bobby's
// ask was **a way to quickly restore**, not a way to find out. If this ticket
// ships only a trigger, it has not shipped the ask."*
//
// So this file drives the two screens rather than the SQL:
//   1. the shared history panel — see the past of one row, put a version back
//   2. `QuarterLayoutRestore` — the ORIGIN case, a whole quarter in one action
//
// ★★★ AND IT DRIVES THEM WITH THE MIGRATION UNAPPLIED TOO, because it is staged
//     and Bobby applies it. A column that does not exist comes back from
//     PostgREST as 42703 and the panel must read as "nothing recorded yet", not
//     as a broken screen. **That is the state prod is in the day this merges.**

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

const T = 'test-tenant-uuid';

/** What the fake `audit_log` holds. */
let auditRows: Record<string, unknown>[] = [];
/** Set to a PostgREST error to simulate the migration being unapplied. */
let selectError: { code?: string; message: string } | null = null;
/** Every RPC the screen called. */
let rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
let rpcError: { code?: string; message: string } | null = null;
let rpcResult: unknown = null;

const fromMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (t: string) => fromMock(t),
    rpc: (n: string, a: Record<string, unknown>) => rpcMock(n, a),
  },
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    data: [{ name: 'Cam', role: 'da', active: true, user_id: 'u-cam' }],
    isLoading: false,
  }),
}));
vi.mock('../stores/toastStore', () => ({
  pushToast: vi.fn(),
  pushRecoveredToast: vi.fn(),
  useToastStore: () => ({ toasts: [], push: vi.fn(), dismiss: vi.fn() }),
}));

import RowHistoryPanel from '../components/shared/RowHistoryPanel';
import QuarterLayoutRestore from '../components/Settings/QuarterLayoutRestore';
import { pushToast } from '../stores/toastStore';

/** A postgrest-js-shaped builder that resolves when awaited. */
function builder() {
  const self: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'contains', 'is', 'in']) {
    self[m] = () => self;
  }
  (self as { then: unknown }).then = (res: (v: unknown) => unknown) =>
    Promise.resolve(
      selectError ? { data: null, error: selectError } : { data: auditRows, error: null },
    ).then(res);
  return self;
}

function mount(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const entry = (over: Record<string, unknown> = {}) => ({
  id: 101,
  created_at: '2026-09-28T10:00:00Z',
  user_id: 'u-cam',
  action: 'app_config_updated',
  table_name: 'app_config',
  row_id: 'projectTagOptions',
  row_key: { key: 'projectTagOptions' },
  changes: { value: { before: ['ECA'], after: ['ECA', 'HVL'] } },
  ...over,
});

beforeEach(() => {
  cleanup();
  auditRows = [];
  selectError = null;
  rpcCalls = [];
  rpcError = null;
  rpcResult = null;
  fromMock.mockReset();
  fromMock.mockImplementation(() => builder());
  rpcMock.mockReset();
  rpcMock.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    if (rpcError) return { data: null, error: rpcError };
    return { data: rpcResult ?? [{ out_table: 'app_config', out_row_id: 'x', out_columns: ['value'], out_created: false }], error: null };
  });
  (pushToast as unknown as { mockClear: () => void }).mockClear();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
});

function toasts(): [string, string][] {
  return (pushToast as unknown as { mock: { calls: [string, string][] } }).mock.calls;
}

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-590 §2.1 — see the history of one row', () => {
  it('★★★ what changed, when, by whom, from what to what', async () => {
    auditRows = [entry()];
    mount(<RowHistoryPanel table="app_config" rowId="projectTagOptions" label="Project Tags" />);
    await screen.findByTestId('row-history-entry-101');
    const field = screen.getByTestId('row-history-field-101-value');
    // from what → to what
    expect(field.textContent).toContain('["ECA"]');
    expect(field.textContent).toContain('["ECA","HVL"]');
    // by whom — fix-330's rule: the name comes from `team_members`, never
    // `profiles.name`, which is NULL for all 29 prod logins.
    expect(screen.getByTestId('row-history-entry-101').textContent).toContain('Cam');
    // what happened
    expect(screen.getByTestId('row-history-entry-101').getAttribute('data-op')).toBe('updated');
  });

  it('★★★ a scraper write is shown and MARKED, never hidden', async () => {
    auditRows = [entry({ id: 102, user_id: null, action: 'permit_cycles_updated' })];
    mount(<RowHistoryPanel table="permit_cycles" rowId="55" label="Cycle 1" />);
    await screen.findByTestId('row-history-entry-102');
    expect(screen.getByTestId('row-history-machine-102').textContent).toMatch(/not a person/);
    expect(screen.getByTestId('row-history-entry-102').textContent).toMatch(/scrape|migration/i);
  });

  it('★★★ an empty history SAYS WHY it is empty — the other half of §0', async () => {
    auditRows = [];
    mount(<RowHistoryPanel table="app_config" rowId="projectTagOptions" label="Project Tags" />);
    // *"I could not tell him whether it had been deleted or never saved."*
    await screen.findByTestId('row-history-empty');
    expect(screen.getByTestId('row-history-empty').textContent).toMatch(/No changes recorded/i);
  });

  it('★★★ with the migration UNAPPLIED it reads as empty, not as broken', async () => {
    // The state prod is in the day this merges: no `row_key` column, so PostgREST
    // answers 42703. **CI is green with it unapplied and so is the screen.**
    selectError = { code: '42703', message: 'column audit_log.row_key does not exist' };
    mount(<RowHistoryPanel table="app_config" rowId="projectTagOptions" label="Project Tags" />);
    await screen.findByTestId('row-history-empty');
    expect(screen.queryByTestId('row-history-entry-101')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-590 §2.2 — put a prior version back, in one action', () => {
  it('★★★ Restore asks first, then calls the RPC with that entry', async () => {
    auditRows = [entry()];
    mount(<RowHistoryPanel table="app_config" rowId="projectTagOptions" label="Project Tags" />);
    await screen.findByTestId('row-history-restore-101');
    // ★★ ONE CONTROL IS NOT ONE CLICK (fix-440): a restore overwrites whatever is
    //    there now, so it confirms in place rather than firing on the first tap.
    await act(async () => {
      fireEvent.click(screen.getByTestId('row-history-restore-101'));
    });
    expect(rpcCalls).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByTestId('row-history-restore-confirm-101'));
    });
    await waitFor(() => expect(rpcCalls).toHaveLength(1));
    expect(rpcCalls[0]).toEqual({
      name: 'bp_restore_audited_row',
      args: { p_audit_id: 101 },
    });
  });

  it('★ and Cancel calls nothing', async () => {
    auditRows = [entry()];
    mount(<RowHistoryPanel table="app_config" rowId="projectTagOptions" label="Project Tags" />);
    await screen.findByTestId('row-history-restore-101');
    await act(async () => {
      fireEvent.click(screen.getByTestId('row-history-restore-101'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('row-history-restore-cancel-101'));
    });
    expect(rpcCalls).toEqual([]);
    expect(screen.getByTestId('row-history-restore-101')).toBeInTheDocument();
  });

  it('★★★ a restore the caller is not allowed is refused, IN WORDS', async () => {
    // The RPC is SECURITY INVOKER, so `is_tenant_admin` / `may_edit_draw_schedule`
    // refuse and it comes back as 42501. Nothing in the client re-derives those
    // rules; it shows what the server said.
    auditRows = [entry()];
    rpcError = { code: '42501', message: 'You do not have permission to change this record.' };
    mount(<RowHistoryPanel table="app_config" rowId="projectTagOptions" label="Project Tags" />);
    await screen.findByTestId('row-history-restore-101');
    await act(async () => {
      fireEvent.click(screen.getByTestId('row-history-restore-101'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('row-history-restore-confirm-101'));
    });
    await waitFor(() => expect(toasts().length).toBeGreaterThan(0));
    const [msg, kind] = toasts()[0];
    expect(msg).toBe('You do not have permission to change this record.');
    expect(kind).toBe('error');
  });

  it('★★ and if the migration is not applied, it says THAT rather than a stack trace', async () => {
    auditRows = [entry()];
    rpcError = { code: 'PGRST202', message: 'Could not find the function public.bp_restore_audited_row' };
    mount(<RowHistoryPanel table="app_config" rowId="projectTagOptions" label="Project Tags" />);
    await screen.findByTestId('row-history-restore-101');
    await act(async () => {
      fireEvent.click(screen.getByTestId('row-history-restore-101'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('row-history-restore-confirm-101'));
    });
    await waitFor(() => expect(toasts().length).toBeGreaterThan(0));
    expect(toasts()[0][0]).toMatch(/not switched on yet/i);
  });

  it('★★★ an entry that CANNOT be restored offers no button and says why', async () => {
    // Three refusals, mirroring the RPC's in the RPC's order. The person is told
    // before they click rather than after.
    auditRows = [
      entry({ id: 201, action: 'app_config_inserted' }),
      entry({ id: 202, row_key: null }),
      entry({ id: 203, table_name: 'permits', row_id: '5' }),
    ];
    mount(<RowHistoryPanel table="app_config" rowId="projectTagOptions" label="Project Tags" />);
    await screen.findByTestId('row-history-entry-201');
    for (const id of [201, 202, 203]) {
      expect(screen.queryByTestId(`row-history-restore-${id}`)).toBeNull();
      expect(screen.getByTestId(`row-history-blocked-${id}`).textContent).not.toBe('');
    }
    expect(screen.getByTestId('row-history-blocked-201').textContent).toMatch(/being created/i);
    expect(screen.getByTestId('row-history-blocked-202').textContent).toMatch(/predates/i);
    expect(screen.getByTestId('row-history-blocked-203').textContent).toMatch(/not restorable/i);
  });

  it('★★ a composite key is passed as an OBJECT, never a rebuilt string', async () => {
    auditRows = [entry({ id: 301, table_name: 'permit_type_defaults', row_id: 'ignored' })];
    mount(
      <RowHistoryPanel
        table="permit_type_defaults"
        rowKey={{ tenant_id: T, type: 'ULS' }}
        label="ULS"
      />,
    );
    await screen.findByTestId('row-history-entry-301');
    // ★★★ The panel's own testid is built from the SORTED key, so two mounts of
    //     one row cannot disagree — and nothing anywhere reproduces Postgres's
    //     jsonb key ordering.
    expect(
      screen.getByTestId(`row-history-permit_type_defaults-tenant_id=${T}&type=ULS`),
    ).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-590 §2 — the ORIGIN case: a whole quarter in one action', () => {
  const deletedRow = (id: number, da: string) => ({
    id,
    created_at: '2026-09-16T10:00:00Z',
    user_id: 'u-cam',
    action: 'draw_schedule_quarter_layout_deleted',
    table_name: 'draw_schedule_quarter_layout',
    row_id: String(id),
    row_key: { id },
    changes: {
      quarter: { before: '2025-Q4', after: null },
      da_name: { before: da, after: null },
      position: { before: id, after: null },
    },
  });

  it('★★★ names how many vanished, and who they were', async () => {
    auditRows = [deletedRow(1, 'Cam'), deletedRow(2, 'Marc')];
    mount(<QuarterLayoutRestore quarter="2025-Q4" />);
    const banner = await screen.findByTestId('ql-restore-banner');
    expect(banner.textContent).toContain('2 columns');
    // ★ Names them, because "12 columns" is a number and "Cam, Marc" is the thing
    //   he arranged — read off the deleted row's own `before`, the only place
    //   those names still exist.
    expect(banner.textContent).toContain('Cam');
    expect(banner.textContent).toContain('Marc');
  });

  it('★★★ one action puts the whole quarter back', async () => {
    auditRows = [deletedRow(1, 'Cam'), deletedRow(2, 'Marc')];
    rpcResult = [{ out_restored: 2, out_audit_ids: [1, 2] }];
    mount(<QuarterLayoutRestore quarter="2025-Q4" />);
    await screen.findByTestId('ql-restore-open');
    await act(async () => {
      fireEvent.click(screen.getByTestId('ql-restore-open'));
    });
    expect(rpcCalls).toEqual([]); // ★ asks first
    await act(async () => {
      fireEvent.click(screen.getByTestId('ql-restore-confirm'));
    });
    await waitFor(() => expect(rpcCalls).toHaveLength(1));
    expect(rpcCalls[0]).toEqual({
      name: 'bp_restore_deleted_quarter_layout',
      args: { p_quarter: '2025-Q4' },
    });
    await waitFor(() => expect(toasts().length).toBeGreaterThan(0));
    expect(toasts()[0][0]).toMatch(/Restored 2 columns to 2025-Q4/);
  });

  it('★★★ NOTHING is offered when nothing was deleted — "never saved" is the answer', async () => {
    // §0's other half. A quarter that was never arranged has nothing to put back,
    // and **a restore that invented a layout would be worse than the gap.**
    auditRows = [];
    mount(<QuarterLayoutRestore quarter="2026-Q1" />);
    await waitFor(() => expect(fromMock).toHaveBeenCalled());
    expect(screen.queryByTestId('ql-restore-banner')).toBeNull();
  });

  it('★★ a row deleted and then RE-CREATED is not missing', async () => {
    auditRows = [
      // newest first, as the query orders
      { ...deletedRow(1, 'Cam'), id: 9, action: 'draw_schedule_quarter_layout_inserted' },
      deletedRow(1, 'Cam'),
    ];
    mount(<QuarterLayoutRestore quarter="2025-Q4" />);
    await waitFor(() => expect(fromMock).toHaveBeenCalled());
    // The newest entry for that row_key is an insert, so it is present.
    expect(screen.queryByTestId('ql-restore-banner')).toBeNull();
  });

  it('★★★ a reader who cannot edit the schedule is told, not offered a dead button', async () => {
    auditRows = [deletedRow(1, 'Cam')];
    mount(<QuarterLayoutRestore quarter="2025-Q4" readOnly />);
    const banner = await screen.findByTestId('ql-restore-banner');
    expect(screen.queryByTestId('ql-restore-open')).toBeNull();
    expect(banner.textContent).toMatch(/need permission/i);
  });

  it('★★ and with the migration unapplied it renders nothing at all', async () => {
    selectError = { code: '42703', message: 'column audit_log.row_key does not exist' };
    mount(<QuarterLayoutRestore quarter="2025-Q4" />);
    await waitFor(() => expect(fromMock).toHaveBeenCalled());
    expect(screen.queryByTestId('ql-restore-banner')).toBeNull();
  });
});
