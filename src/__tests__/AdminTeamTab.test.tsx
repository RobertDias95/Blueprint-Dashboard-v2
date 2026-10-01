import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

// Q7.3.b: smoke tests for AdminTeamTab + the 4 PillListEditors + the
// Former DA section + TeamStructureEditor. Hooks are mocked so the
// component renders synchronously; mutate fns captured via vi.hoisted
// handles for assertion.

const T = 'test-tenant-uuid';

const mocks = vi.hoisted(() => ({
  upsertMember: vi.fn(),
  deleteMember: vi.fn(),
  renameDA: vi.fn(),
  renameDM: vi.fn(),
  upsertGroup: vi.fn(),
  deleteGroup: vi.fn(),
}));

const fixtures = vi.hoisted(() => {
  return {
    members: [
      // Active DAs
      { id: 'da-1', name: 'Trevor', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '2026-05-11T12:00:00Z' },
      { id: 'da-2', name: 'Marc', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '2026-05-11T12:00:00Z' },
      // Former DA
      { id: 'da-3', name: 'OldGrad', role: 'da', active: false, former: true, email: null, notes: null, updated_at: '2026-05-11T12:00:00Z' },
      // DMs
      { id: 'dm-1', name: 'Lindsay', role: 'dm', active: true, former: false, email: null, notes: null, updated_at: '2026-05-11T12:00:00Z' },
      { id: 'dm-2', name: 'Derry', role: 'dm', active: true, former: false, email: null, notes: null, updated_at: '2026-05-11T12:00:00Z' },
      // ENT
      { id: 'ent-1', name: 'Bobby', role: 'ent', active: true, former: false, email: null, notes: null, updated_at: '2026-05-11T12:00:00Z' },
      // ACQ
      { id: 'acq-1', name: 'Caleb', role: 'acq', active: true, former: false, email: null, notes: null, updated_at: '2026-05-11T12:00:00Z' },
    ],
    groups: [
      { id: 'g-1', dm_name: 'Lindsay', da_name: 'Trevor', dm_order: 1, da_order: 3, updated_at: '2026-05-11T12:00:00Z' },
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
// fix-346: TeamStructureEditor now also asks how many OPEN tasks each unmapped
// DA holds (the co-assign gap line). Stubbed so this tab test stays hermetic —
// the counts themselves are asserted in TeamStructureUnmappedFix346.test.tsx.
vi.mock('../hooks/useOpenTaskCounts', () => ({
  useOpenTaskCounts: () => ({ data: undefined, isLoading: false, error: null }),
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

// ===========================================================================
// ⚠️⚠️ Q7.3.b's DESCRIBE IS REPLACED — fix-613 §A, AND IT WAS RIGHT THROUGHOUT
// ===========================================================================
//
// Fourteen tests stood here and every one of them passed: four role-pill
// sections rendered, adding a DA inserted, × on a DA soft-deleted while × on a
// DM hard-deleted, renaming a DA fired the cascade RPC and renaming an ENT did
// not, Escape cancelled, a same-name rename no-opped, Restore flipped
// `former`, and a non-admin saw none of the controls.
//
// ★★★ THEY DESCRIBED THE SURFACE EXACTLY, WHICH IS WHY READING THEM TOGETHER
//     IS THE ARGUMENT FOR REPLACING IT. Three removal behaviours (soft-delete,
//     hard-delete, hard-delete-again) and three rename behaviours (cascade,
//     cascade, no-cascade) for ONE action on ONE kind of thing — a person.
//     ⚖️ Bobby, 2026-09-30: **People = one table.**
//
// ★★ WHAT THE REPLACEMENT ASSERTS is what those fourteen were protecting,
//    stated once: the roster is reachable, nothing deletes a row, and the
//    non-roster blocks this tab still owns are untouched. The table's own
//    behaviour — one row per person, retire, restore, roles — is covered in
//    PeopleAsOneTableFix613.
describe('<AdminTeamTab /> after fix-613 §A', () => {
  it('★★★ the nine roster pill lists are gone', () => {
    renderIt();
    expect(screen.getByTestId('admin-team-tab')).toBeInTheDocument();
    for (const prefix of [
      'team-da',
      'team-dm',
      'team-ent',
      'team-acq',
      'team-schematic',
      'team-ca',
    ]) {
      expect(
        screen.queryByTestId(`${prefix}-add`),
        `${prefix} add box should be gone`,
      ).toBeNull();
    }
    // ★ and no pill, for anybody
    expect(screen.queryByTestId('team-da-pill-Trevor')).toBeNull();
    expect(screen.queryByTestId('team-dm-pill-Lindsay')).toBeNull();
    expect(screen.queryByTestId('team-former-pill-OldGrad')).toBeNull();
  });

  it('★★ the Everyone table is what holds the roster now', () => {
    renderIt();
    expect(screen.getByTestId('people-table')).toBeInTheDocument();
    expect(screen.getByTestId('people-table-grid')).toBeInTheDocument();
  });

  it('★★★ no hard delete is reachable from this tab — census gap 37', () => {
    // Two of the three old removal behaviours DESTROYED a roster row while
    // ~2,209 assignments across 11 columns still pointed at the name. There is
    // one verb now, Retire, and it deletes nothing.
    renderIt();
    expect(screen.queryByTestId('team-dm-remove-Derry')).toBeNull();
    expect(screen.queryByTestId('team-ent-remove-Bobby')).toBeNull();
    expect(mocks.deleteMember).not.toHaveBeenCalled();
  });

  it('★★ the blocks this tab still owns are untouched', () => {
    // Team Structure, DA Routing, the draw-schedule layout, Active Quarters,
    // Chat Tags and three read-outs were never about the roster.
    renderIt();
    expect(screen.getByTestId('team-structure-editor')).toBeInTheDocument();
  });
});
