import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { rosterRoleTitle, ROLE_TITLE, viewerPlate } from '../lib/roleLabels';
import { welcomePlate } from '../lib/addPerson';
import { validateAddPerson } from '../../supabase/functions/admin-create-user/handler';
import type { TeamRole } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-674 (P-354) — a viewer's Title, then their department
// ===========================================================================
//
// Bobby, 2026-10-14: when a Title is typed, show the Title, then the
// department. The table is the prod roster as measured that day (read-only),
// with the live department labels — "Loans" is not one of the built-in seven,
// which is why the labels map is passed exactly as Chrome passes it.

const LABELS = new Map([
  ['executive', 'Executive'],
  ['underwriting', 'Underwriting'],
  ['it_investor_relations', 'IT & Investor Relations'],
  ['loans', 'Loans'],
  ['policy', 'Policy'],
]);

const ROSTER: ReadonlyArray<{
  name: string;
  roles: TeamRole[];
  notes: string | null;
  dept: string | null;
  plate: string | null;
}> = [
  { name: 'Darin', roles: ['viewer'], notes: 'CEO', dept: 'executive', plate: 'CEO · Executive' },
  { name: 'Eric', roles: ['viewer'], notes: 'President', dept: 'executive', plate: 'President · Executive' },
  { name: 'Karl', roles: ['viewer'], notes: 'CFO', dept: 'executive', plate: 'CFO · Executive' },
  { name: 'EJ', roles: ['viewer'], notes: 'Underwriting', dept: 'underwriting', plate: 'Underwriting' },
  { name: 'Greg', roles: ['viewer'], notes: 'Underwriting', dept: 'underwriting', plate: 'Underwriting' },
  { name: 'Taylor', roles: ['viewer'], notes: 'Underwriting', dept: 'underwriting', plate: 'Underwriting' },
  {
    name: 'Jeanne',
    roles: ['viewer'],
    notes: 'Vice President, Loan Operations',
    dept: 'loans',
    plate: 'Vice President, Loan Operations · Loans',
  },
  {
    name: 'Kerry',
    roles: ['viewer'],
    notes: 'Loan Operations Manager',
    dept: 'loans',
    plate: 'Loan Operations Manager · Loans',
  },
  {
    name: 'Keenan',
    roles: ['viewer'],
    notes: 'IT',
    dept: 'it_investor_relations',
    plate: 'IT · IT & Investor Relations',
  },
  // ★ Holds `ent` too, so the role title wins and the Title is not printed.
  { name: 'Lucas', roles: ['ent', 'viewer'], notes: 'Policy', dept: 'policy', plate: ROLE_TITLE.ent },
  // ★ Nothing recorded → null, and Chrome prints "Blueprint Services".
  { name: 'Blake', roles: ['viewer'], notes: null, dept: null, plate: null },
];

describe('fix-674 · the measured roster reads as Bobby ruled', () => {
  it.each(ROSTER)('$name → $plate', ({ roles, notes, dept, plate }) => {
    expect(rosterRoleTitle(roles, notes, dept, LABELS)).toBe(plate);
  });
});

describe('fix-674 · the rule', () => {
  it('★★ a Title equal to the department is printed once, ignoring case and spaces', () => {
    expect(viewerPlate('underwriting ', 'Underwriting')).toBe('Underwriting');
    expect(viewerPlate('IT  &  Investor relations', 'IT & Investor Relations')).toBe(
      'IT & Investor Relations',
    );
  });

  it('★ Title only → the Title; department only → the department; neither → null', () => {
    expect(rosterRoleTitle(['viewer'], 'CEO', null, LABELS)).toBe('CEO');
    expect(rosterRoleTitle(['viewer'], '   ', 'loans', LABELS)).toBe('Loans');
    expect(rosterRoleTitle(['viewer'], '', null, LABELS)).toBeNull();
  });

  it('★★ a non-viewer role never prints its Title', () => {
    for (const role of ['da', 'dm', 'ent_lead', 'acq', 'ca', 'director'] as const) {
      expect(rosterRoleTitle([role], 'Vice President', 'loans', LABELS)).toBe(ROLE_TITLE[role]);
    }
  });

  it('★★ the Add Person preview (and the welcome email) say the same thing', () => {
    expect(
      welcomePlate('Jeanne', 'viewer', 'Vice President, Loan Operations', 'Loans').line,
    ).toBe('Jeanne · Vice President, Loan Operations · Loans');
    expect(welcomePlate('Greg', 'viewer', 'Underwriting', 'Underwriting').line).toBe(
      'Greg · Underwriting',
    );
    expect(welcomePlate('Pat', 'viewer', null, null).title).toBe('Blueprint Services');
    expect(welcomePlate('Sam', 'da', 'Ignored', 'Design & Permitting').title).toBe(
      'Design Associate · Design & Permitting',
    );
  });
});

// ---------------------------------------------------------------------------
// Emails saved lowercase
// ---------------------------------------------------------------------------

describe('fix-674 · Add Person stores the email lowercase', () => {
  it('★★ the value the function creates the login and roster row with', () => {
    const r = validateAddPerson({
      email: '  Jeanne.Smith@BlueprintCap.com ',
      first_name: 'Jeanne',
      last_name: 'Smith',
      role: 'viewer',
      department: 'loans',
      bridge_role: 'editor',
      send_welcome: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.email).toBe('jeanne.smith@blueprintcap.com');
  });
});

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { rpc: rpcMock } }));
vi.mock('../stores/toastStore', () => ({ pushToast: vi.fn() }));

import { useSetPersonDetails } from '../hooks/useSetPersonDetails';

describe('fix-674 · the roster editor stores the email lowercase', () => {
  beforeEach(() => rpcMock.mockReset().mockResolvedValue({ data: 1, error: null }));

  it('★★ what is typed is trimmed and lowercased before it is saved', async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSetPersonDetails(), { wrapper });
    act(() => {
      result.current.mutate({
        name: 'Kerry',
        first_name: 'Kerry',
        last_name: 'Lee',
        email: ' Kerry.Lee@BlueprintCap.com',
      });
    });
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_email: 'kerry.lee@blueprintcap.com' });
  });
});
