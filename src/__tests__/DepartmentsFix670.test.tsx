// ===========================================================================
// fix-670 §A + §B (P-351) — departments you can add, and a Department picker
// on Add Person
// ===========================================================================
//
// Bobby: *"other departments need access to this to view our work… so i need
// to be able to add their departments, so their labels are accurate to their
// roles in the company."*
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import migrationSql from '../../migrations/fix_670_departments_table.sql?raw';
import type { TeamMember } from '../lib/database.types';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  rows: [] as Array<{ key: string; label: string; sort_order: number }>,
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
    functions: { invoke: mocks.invoke },
    from: () => ({
      select: () => ({
        order: async () => ({ data: mocks.rows, error: null }),
      }),
    }),
  },
}));

import { useAuthStore } from '../stores/authStore';
import {
  FALLBACK_DEPARTMENTS,
  sortDepartments,
} from '../hooks/useDepartments';
import { DEPARTMENTS, DEPARTMENT_LABEL, departmentLabel, rosterRoleTitle } from '../lib/roleLabels';
import DepartmentListEditor from '../components/Settings/DepartmentListEditor';
import { moveKey, peopleByDepartment } from '../lib/departmentList';
import AddPersonSection from '../components/Settings/AddPersonSection';
import { DEFAULT_DEPARTMENT_FOR_ROLE, welcomePlate } from '../lib/addPerson';
import { parseDepartments } from '../lib/departmentFilter';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function member(name: string, department: string | null, role = 'da'): TeamMember {
  return { id: `${name}-${role}`, name, role, department, active: true } as unknown as TeamMember;
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.invoke.mockReset();
  mocks.rows = [];
  useAuthStore.setState({
    user: { id: 'u-bobby', email: 'robertd@blueprintcap.com' } as never,
    activeTenantId: 'tenant-1',
    memberships: [{ tenant_id: 'tenant-1', role: 'admin' }],
  });
});

// ---------------------------------------------------------------------------
describe('fix-670 §A — the list is a table; the built-in seven are the fallback', () => {
  it('★★ the fallback is the seeded seven, in DEPARTMENTS order', () => {
    expect(FALLBACK_DEPARTMENTS.map((d) => d.key)).toEqual([...DEPARTMENTS]);
    expect(FALLBACK_DEPARTMENTS.map((d) => d.label)).toEqual(
      DEPARTMENTS.map((d) => DEPARTMENT_LABEL[d]),
    );
  });

  it('★ the list sorts as the table does', () => {
    expect(
      sortDepartments([
        { key: 'b', label: 'B', sort_order: 20 },
        { key: 'a', label: 'A', sort_order: 10 },
        { key: 'c', label: 'C', sort_order: 10 },
      ]).map((d) => d.key),
    ).toEqual(['a', 'c', 'b']);
  });

  it('★★★ a department the code has never heard of still has words', () => {
    const live = new Map([['accounting', 'Accounting']]);
    expect(departmentLabel('accounting', live)).toBe('Accounting');
    // the built-in seven still resolve without the live list
    expect(departmentLabel('underwriting')).toBe('Underwriting');
    // an unknown key prints as itself, never blank
    expect(departmentLabel('retired_thing')).toBe('retired_thing');
    // ★ and a viewer's name plate follows the live label (fix-652's rule)
    expect(rosterRoleTitle(['viewer'], 'CFO', 'accounting', live)).toBe('Accounting');
  });

  it('★ a saved filter keeps a new department key (pages pass any-key)', () => {
    expect(parseDepartments(['accounting', 'Bad Key!', 'policy'], 'any-key')).toEqual([
      'accounting',
      'policy',
    ]);
  });
});

// ---------------------------------------------------------------------------
describe('fix-670 §A — Settings → Teams → Department list', () => {
  const depts = [
    { key: 'policy', label: 'Policy', sort_order: 10 },
    { key: 'underwriting', label: 'Underwriting', sort_order: 20 },
    { key: 'accounting', label: 'Accounting', sort_order: 30 },
  ];
  const members = [
    member('EJ', 'underwriting', 'viewer'),
    member('Greg', 'underwriting', 'viewer'),
    // ★ one PERSON with two rows counts once
    member('Lucas', 'policy', 'director'),
    member('Lucas', 'policy', 'viewer'),
  ];

  it('★ counts by person, not by row', () => {
    expect(peopleByDepartment(members)).toEqual(
      new Map([
        ['underwriting', 2],
        ['policy', 1],
      ]),
    );
  });

  it('★ moveKey swaps neighbours and refuses the ends', () => {
    expect(moveKey(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveKey(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
  });

  it('★★★ add sends only the label — the server makes the key', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ key: 'investor_relations', label: 'Investor Relations', sort_order: 40 }], error: null });
    wrap(<DepartmentListEditor departments={depts} members={members} readOnly={false} />);
    fireEvent.change(screen.getByTestId('department-list-add'), {
      target: { value: 'Investor Relations' },
    });
    fireEvent.click(screen.getByTestId('department-list-add-btn'));
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('bp_upsert_department', {
        p_key: null,
        p_label: 'Investor Relations',
      }),
    );
  });

  it('★★★ rename keeps the key — team_members.department joins on it', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ key: 'policy', label: 'Public Policy', sort_order: 10 }], error: null });
    wrap(<DepartmentListEditor departments={depts} members={members} readOnly={false} />);
    fireEvent.click(screen.getByTestId('department-list-rename-policy'));
    const input = screen.getByTestId('department-list-rename-input-policy');
    fireEvent.change(input, { target: { value: 'Public Policy' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('bp_upsert_department', {
        p_key: 'policy',
        p_label: 'Public Policy',
      }),
    );
  });

  it('★★ reorder sends the whole new order', async () => {
    mocks.rpc.mockResolvedValue({ data: 2, error: null });
    wrap(<DepartmentListEditor departments={depts} members={members} readOnly={false} />);
    expect(screen.getByTestId('department-list-up-policy')).toBeDisabled();
    fireEvent.click(screen.getByTestId('department-list-up-accounting'));
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('bp_reorder_departments', {
        p_keys: ['policy', 'accounting', 'underwriting'],
      }),
    );
  });

  it('★★★ delete is refused while anybody is in it — and the button says why', () => {
    wrap(<DepartmentListEditor departments={depts} members={members} readOnly={false} />);
    const del = screen.getByTestId('department-list-delete-underwriting');
    expect(del).toBeDisabled();
    expect(del.getAttribute('title')).toBe(
      '2 people are in Underwriting. Move them to another department first.',
    );
    expect(screen.getByTestId('department-list-count-underwriting').textContent).toBe('2 people');
    fireEvent.click(del);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('★★ an empty department can be deleted', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    wrap(<DepartmentListEditor departments={depts} members={members} readOnly={false} />);
    const del = screen.getByTestId('department-list-delete-accounting');
    expect(del).not.toBeDisabled();
    fireEvent.click(del);
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('bp_delete_department', { p_key: 'accounting' }),
    );
  });

  it('★ a non-admin sees the list and no controls', () => {
    wrap(<DepartmentListEditor departments={depts} members={members} readOnly />);
    expect(screen.getByTestId('department-list-row-policy')).toBeInTheDocument();
    expect(screen.queryByTestId('department-list-add')).toBeNull();
    expect(screen.queryByTestId('department-list-delete-accounting')).toBeNull();
    expect(screen.queryByTestId('department-list-rename-policy')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('fix-670 §A — the migration (proved on prod in BEGIN…ROLLBACK first)', () => {
  const sql = migrationSql.replace(/\r\n/g, '\n');

  it('★★★ seeds exactly the seven, with today’s labels, in DEPARTMENTS order', () => {
    const seeded = [...sql.matchAll(/\('([a-z_]+)',\s+'([^']+)',\s+(\d+)\)/g)].map((m) => [
      m[1],
      m[2],
      Number(m[3]),
    ]);
    expect(seeded.map(([k]) => k)).toEqual([...DEPARTMENTS]);
    expect(seeded.map(([, l]) => l)).toEqual(DEPARTMENTS.map((d) => DEPARTMENT_LABEL[d]));
    expect(seeded.map(([, , o]) => o)).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });

  it('★★★ the CHECK becomes a composite FK, so a typo still cannot be stored', () => {
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS team_members_department_check/);
    expect(sql).toMatch(
      /FOREIGN KEY \(tenant_id, department\)\s+REFERENCES public\.departments \(tenant_id, key\)/,
    );
  });

  it('★★ bp_set_team_department no longer carries its own list (the fifth place)', () => {
    const fn = sql.slice(sql.indexOf('FUNCTION public.bp_set_team_department'));
    const body = fn.slice(0, fn.indexOf('$function$;'));
    expect(body).toContain('from public.departments d');
    expect(body).not.toContain("'underwriting'");
  });

  it('★★ it writes no team_members value', () => {
    expect(sql).not.toMatch(/UPDATE\s+public\.team_members\s+SET\s+department/i);
    expect(sql).not.toMatch(/INSERT INTO public\.team_members/i);
  });
});

// ---------------------------------------------------------------------------
describe('fix-670 §B — Add Person gets a Department picker', () => {
  function open() {
    wrap(<AddPersonSection readOnly={false} />);
    fireEvent.click(screen.getByTestId('add-person-open'));
  }
  const dept = () => screen.getByTestId('add-person-department') as HTMLSelectElement;
  const role = (v: string) =>
    fireEvent.change(screen.getByTestId('add-person-role'), { target: { value: v } });

  it('★★★ defaults from the role', () => {
    expect(DEFAULT_DEPARTMENT_FOR_ROLE).toEqual({
      da: 'design_entitlements',
      dm: 'design_entitlements',
      ent: 'design_entitlements',
      ent_lead: 'design_entitlements',
      schematic: 'design_entitlements',
      director: 'design_entitlements',
      acq: 'acquisitions',
      acq_lead: 'acquisitions',
      ca: 'construction_admin',
      viewer: null,
    });
    open();
    expect(dept().value).toBe('design_entitlements');
    role('acq_lead');
    expect(dept().value).toBe('acquisitions');
    role('ca');
    expect(dept().value).toBe('construction_admin');
  });

  it('★★★ a viewer has no default and must pick — that is their label', () => {
    open();
    role('viewer');
    expect(dept().value).toBe('');
    expect(dept().required).toBe(true);
    expect(within(dept()).getAllByRole('option')[0]!.textContent).toBe('Pick a department…');
  });

  it('★★ a picked department survives a role change', () => {
    open();
    fireEvent.change(dept(), { target: { value: 'policy' } });
    role('acq');
    expect(dept().value).toBe('policy');
  });

  it('★★★ the name plate preview shows the department', () => {
    open();
    fireEvent.change(screen.getByTestId('add-person-first'), { target: { value: 'Greg' } });
    role('viewer');
    fireEvent.change(dept(), { target: { value: 'underwriting' } });
    expect(screen.getByTestId('add-person-plate-name').textContent).toBe('Greg');
    expect(screen.getByTestId('add-person-plate-title').textContent).toBe('Underwriting');
    expect(welcomePlate('Greg', 'viewer', null, 'Underwriting').line).toBe('Greg · Underwriting');
    expect(welcomePlate('Sam', 'da', null, 'Design & Permitting').line).toBe(
      'Sam · Design Associate · Design & Permitting',
    );
    // ★ a viewer with no department falls back to the Title (fix-652's order)
    expect(welcomePlate('Darin', 'viewer', 'CEO', null).line).toBe('Darin · CEO');
  });

  it('★★★ the value reaches admin-create-user', async () => {
    mocks.invoke.mockResolvedValue({
      data: { ok: false, code: 'invalid', message: 'stop here' },
      error: null,
    });
    open();
    fireEvent.change(screen.getByTestId('add-person-email'), {
      target: { value: 'greg@blueprintcap.com' },
    });
    fireEvent.change(screen.getByTestId('add-person-first'), { target: { value: 'Greg' } });
    fireEvent.change(screen.getByTestId('add-person-last'), { target: { value: 'Smith' } });
    role('viewer');
    fireEvent.change(dept(), { target: { value: 'underwriting' } });
    fireEvent.click(screen.getByTestId('add-person-submit'));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalled());
    const [, opts] = mocks.invoke.mock.calls[0]!;
    expect(opts.body).toMatchObject({ role: 'viewer', department: 'underwriting' });
  });
});
