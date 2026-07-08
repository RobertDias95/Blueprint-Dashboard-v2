import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

// Q7.3.b: smoke tests for AdminTeamTab + the 4 PillListEditors + the
// Former DA section + TeamStructureEditor. Hooks are mocked so the
// component renders synchronously; mutate fns captured via vi.hoisted
// handles for assertion.

const T = 'test-tenant-uuid';
const NOW = '2026-05-11T12:00:00Z';

const mocks = vi.hoisted(() => ({
  upsertMember: vi.fn(),
  deleteMember: vi.fn(),
  renameDA: vi.fn(),
  renameDM: vi.fn(),
  upsertGroup: vi.fn(),
  deleteGroup: vi.fn(),
}));

const fixtures = vi.hoisted(() => {
  const NOW = '2026-05-11T12:00:00Z';
  return {
    members: [
      // Active DAs
      { id: 'da-1', name: 'Trevor', role: 'da', active: true, former: false, email: null, notes: null, updated_at: NOW },
      { id: 'da-2', name: 'Marc', role: 'da', active: true, former: false, email: null, notes: null, updated_at: NOW },
      // Former DA
      { id: 'da-3', name: 'OldGrad', role: 'da', active: false, former: true, email: null, notes: null, updated_at: NOW },
      // DMs
      { id: 'dm-1', name: 'Lindsay', role: 'dm', active: true, former: false, email: null, notes: null, updated_at: NOW },
      { id: 'dm-2', name: 'Derry', role: 'dm', active: true, former: false, email: null, notes: null, updated_at: NOW },
      // ENT
      { id: 'ent-1', name: 'Bobby', role: 'ent', active: true, former: false, email: null, notes: null, updated_at: NOW },
      // ACQ
      { id: 'acq-1', name: 'Caleb', role: 'acq', active: true, former: false, email: null, notes: null, updated_at: NOW },
    ],
    groups: [
      { id: 'g-1', dm_name: 'Lindsay', da_name: 'Trevor', dm_order: 1, da_order: 3, updated_at: NOW },
      // Marc is unassigned → should appear in unassigned warning
    ],
  };
});

vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: fixtures.members,
    activeDas: fixtures.members.filter((m) => m.role === 'da' && !m.former),
    formerDas: fixtures.members.filter((m) => m.role === 'da' && m.former),
    dms: fixtures.members.filter((m) => m.role === 'dm'),
    ents: fixtures.members.filter((m) => m.role === 'ent'),
    acqs: fixtures.members.filter((m) => m.role === 'acq'),
    schematics: fixtures.members.filter((m) => m.role === 'schematic'),
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useDmDaGroups', () => ({
  useDmDaGroups: () => ({
    rows: fixtures.groups,
    groups: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useUpsertTeamMember', () => ({
  useUpsertTeamMember: () => ({ mutate: mocks.upsertMember }),
}));
vi.mock('../hooks/useDeleteTeamMember', () => ({
  useDeleteTeamMember: () => ({ mutate: mocks.deleteMember }),
}));
vi.mock('../hooks/useRenameDA', () => ({
  useRenameDA: () => ({ mutate: mocks.renameDA }),
}));
vi.mock('../hooks/useRenameDM', () => ({
  useRenameDM: () => ({ mutate: mocks.renameDM }),
}));
vi.mock('../hooks/useUpsertDmDaGroup', () => ({
  useUpsertDmDaGroup: () => ({ mutate: mocks.upsertGroup }),
}));
vi.mock('../hooks/useDeleteDmDaGroup', () => ({
  useDeleteDmDaGroup: () => ({ mutate: mocks.deleteGroup }),
}));
// QuarterLayoutEditor (fix-182b) has its own test; stub it here so this tab
// test stays focused on the roster + structure editors.
vi.mock('../components/Settings/QuarterLayoutEditor', () => ({
  default: () => null,
}));

import AdminTeamTab from '../components/Settings/AdminTeamTab';

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminTeamTab />
    </QueryClientProvider>,
  );
}

describe('<AdminTeamTab /> Q7.3.b', () => {
  it('renders 4 role-pill sections + structure editor + former-DAs section', () => {
    renderIt();
    expect(screen.getByTestId('admin-team-tab')).toBeInTheDocument();
    expect(screen.getByTestId('team-da-pill-Trevor')).toBeInTheDocument();
    expect(screen.getByTestId('team-da-pill-Marc')).toBeInTheDocument();
    expect(screen.getByTestId('team-dm-pill-Lindsay')).toBeInTheDocument();
    expect(screen.getByTestId('team-dm-pill-Derry')).toBeInTheDocument();
    expect(screen.getByTestId('team-ent-pill-Bobby')).toBeInTheDocument();
    expect(screen.getByTestId('team-acq-pill-Caleb')).toBeInTheDocument();
    expect(screen.getByTestId('team-structure-editor')).toBeInTheDocument();
    expect(screen.getByTestId('team-former-pill-OldGrad')).toBeInTheDocument();
  });

  it('Former DA does NOT appear in the active DA list', () => {
    renderIt();
    expect(screen.queryByTestId('team-da-pill-OldGrad')).not.toBeInTheDocument();
  });

  it('Adding a DA calls useUpsertTeamMember with insert + role=da', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('team-da-add'), {
      target: { value: 'NewDA' },
    });
    fireEvent.click(screen.getByTestId('team-da-add-btn'));
    expect(mocks.upsertMember).toHaveBeenCalledWith({
      op: 'insert',
      patch: { name: 'NewDA', role: 'da' },
    });
  });

  it('× on DA pill soft-deletes (former=true) — does NOT hard-delete', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('team-da-remove-Trevor'));
    expect(mocks.upsertMember).toHaveBeenCalledWith({
      op: 'update',
      member: expect.objectContaining({ name: 'Trevor', role: 'da' }),
      patch: { former: true },
    });
    expect(mocks.deleteMember).not.toHaveBeenCalled();
  });

  it('× on DM pill hard-deletes via useDeleteTeamMember', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('team-dm-remove-Derry'));
    expect(mocks.deleteMember).toHaveBeenCalledWith({
      id: 'dm-2',
      updated_at: NOW,
    });
  });

  it('× on ENT pill hard-deletes', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('team-ent-remove-Bobby'));
    expect(mocks.deleteMember).toHaveBeenCalledWith({
      id: 'ent-1',
      updated_at: NOW,
    });
  });

  it('Renaming a DA fires useRenameDA cascade RPC', () => {
    renderIt();
    // Click the label to enter rename mode
    const pill = screen.getByTestId('team-da-pill-Trevor');
    fireEvent.click(pill.querySelector('span')!);
    const input = screen.getByTestId('team-da-rename-Trevor') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Trevor-New' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.renameDA).toHaveBeenCalledWith({
      oldName: 'Trevor',
      newName: 'Trevor-New',
    });
  });

  it('Renaming a DM fires useRenameDM cascade RPC', () => {
    renderIt();
    const pill = screen.getByTestId('team-dm-pill-Lindsay');
    fireEvent.click(pill.querySelector('span')!);
    const input = screen.getByTestId('team-dm-rename-Lindsay') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Lindsay-2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.renameDM).toHaveBeenCalledWith({
      oldName: 'Lindsay',
      newName: 'Lindsay-2',
    });
  });

  it('Renaming an ENT does NOT cascade — uses simple upsert (v1 parity)', () => {
    renderIt();
    const pill = screen.getByTestId('team-ent-pill-Bobby');
    fireEvent.click(pill.querySelector('span')!);
    const input = screen.getByTestId('team-ent-rename-Bobby') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Bobby-2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.renameDA).not.toHaveBeenCalled();
    expect(mocks.renameDM).not.toHaveBeenCalled();
    expect(mocks.upsertMember).toHaveBeenCalledWith({
      op: 'update',
      member: expect.objectContaining({ name: 'Bobby', role: 'ent' }),
      patch: { name: 'Bobby-2' },
    });
  });

  it('Rename Escape cancels without firing', () => {
    renderIt();
    fireEvent.click(
      screen.getByTestId('team-da-pill-Trevor').querySelector('span')!,
    );
    const input = screen.getByTestId('team-da-rename-Trevor') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'WontStick' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(mocks.renameDA).not.toHaveBeenCalled();
  });

  it('Rename to same name no-ops (does NOT fire mutation)', () => {
    renderIt();
    fireEvent.click(
      screen.getByTestId('team-da-pill-Trevor').querySelector('span')!,
    );
    const input = screen.getByTestId('team-da-rename-Trevor') as HTMLInputElement;
    // Default value is the current label; commit without changing.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.renameDA).not.toHaveBeenCalled();
  });

  it('Restore on Former DA flips former=false', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('team-former-restore-OldGrad'));
    expect(mocks.upsertMember).toHaveBeenCalledWith({
      op: 'update',
      member: expect.objectContaining({ name: 'OldGrad', former: true }),
      patch: { former: false },
    });
  });

  it('× on Former DA hard-deletes (permanent removal)', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('team-former-remove-OldGrad'));
    expect(mocks.deleteMember).toHaveBeenCalledWith({
      id: 'da-3',
      updated_at: NOW,
    });
  });

  it('TeamStructureEditor surfaces Marc as unassigned (Lindsay only has Trevor)', () => {
    renderIt();
    const warning = screen.getByTestId('team-unassigned-warning');
    expect(warning.textContent).toMatch(/Marc/);
    expect(warning.textContent).not.toMatch(/Trevor/);
  });

  it('Adding a DA to a DM card calls useUpsertDmDaGroup with insert', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('team-add-da-select-Lindsay'), {
      target: { value: 'Marc' },
    });
    expect(mocks.upsertGroup).toHaveBeenCalledWith({
      op: 'insert',
      dm_name: 'Lindsay',
      da_name: 'Marc',
    });
  });

  it('Moving a DA via the move-to dropdown calls useUpsertDmDaGroup with update + new dm_name', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('team-da-move-Trevor'), {
      target: { value: 'Derry' },
    });
    expect(mocks.upsertGroup).toHaveBeenCalledWith({
      op: 'update',
      row: expect.objectContaining({ id: 'g-1', da_name: 'Trevor' }),
      patch: { dm_name: 'Derry' },
    });
  });

  it('× on a DA chip inside the structure editor removes the (DM, DA) pairing only', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('team-chip-remove-Trevor'));
    expect(mocks.deleteGroup).toHaveBeenCalledWith({
      id: 'g-1',
      updated_at: NOW,
    });
    // Distinct from soft-deleting the DA: useUpsertTeamMember should NOT
    // have been called.
    expect(mocks.upsertMember).not.toHaveBeenCalled();
  });

  it('Non-admin role hides add inputs + × buttons + rename inputs (read-only)', () => {
    useAuthStore.setState({
      activeTenantId: T,
      memberships: [{ tenant_id: T, role: 'editor' }],
    });
    renderIt();
    expect(screen.getByText(/Read-only/i)).toBeInTheDocument();
    expect(screen.queryByTestId('team-da-add')).not.toBeInTheDocument();
    expect(screen.queryByTestId('team-da-remove-Trevor')).not.toBeInTheDocument();
    // Clicking the label in read-only mode should NOT open rename input.
    fireEvent.click(
      screen.getByTestId('team-da-pill-Trevor').querySelector('span')!,
    );
    expect(
      screen.queryByTestId('team-da-rename-Trevor'),
    ).not.toBeInTheDocument();
  });
});
