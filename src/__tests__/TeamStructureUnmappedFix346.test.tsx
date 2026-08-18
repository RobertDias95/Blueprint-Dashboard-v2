import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import type { TeamMember } from '../lib/database.types';

// ===========================================================================
// fix-346 §2 — the unmapped-DA gap, surfaced where somebody will act on it
// ===========================================================================
//
// ★★★ Bobby decided that a DA with no manager in `dm_da_groups` gets NO
// co-assignee — "skip them" — ON ONE CONDITION: "★★★ BUT IT MUST NOT BE
// SILENT." Cam has the largest task load on the team; a feature that quietly
// does nothing for him looks like a feature that does not work.
//
// ★ THE HOME IS THE SURFACE THAT OWNS THE TABLE: Settings → Team → Team
// Structure, the editor where a mapping is added. Naming the gap next to the
// control that closes it is the difference between a warning and a complaint.
//
// ★ AND IT CARRIES THE NUMBER. "Cam is unassigned" and "Cam is unassigned and
// holds 17 open tasks no manager is seeing" are different sentences, and only
// the second one gets acted on.

const T = 'test-tenant-uuid';
const NOW = '2026-08-18T00:00:00Z';

const mocks = vi.hoisted(() => ({
  counts: { Cam: 17, Shire: 8, George: 0 } as Record<string, number> | undefined,
  askedFor: [] as string[][],
}));

vi.mock('../hooks/useUpsertDmDaGroup', () => ({
  useUpsertDmDaGroup: () => ({ mutate: vi.fn() }),
}));
vi.mock('../hooks/useDeleteDmDaGroup', () => ({
  useDeleteDmDaGroup: () => ({ mutate: vi.fn() }),
}));
vi.mock('../hooks/useOpenTaskCounts', () => ({
  useOpenTaskCounts: (names: string[]) => {
    mocks.askedFor.push(names);
    return { data: mocks.counts, isLoading: false, error: null };
  },
}));

// The prod mapping as it stands after §3 — Alex, Chad and Nidhi removed.
const GROUPS = [
  ['Lindsay', 'Francesca', 1, 1],
  ['Lindsay', 'Ainsley', 1, 2],
  ['Lindsay', 'Trevor', 1, 3],
  ['Derry', 'Nicky', 2, 1],
  ['Derry', 'Qisheng', 2, 3],
  ['Brittani', 'Marc', 3, 1],
  ['Brittani', 'Ahmadi', 3, 2],
  ['Brittani', 'Fisk', 3, 3],
  ['Jade', 'Erick', 4, 2],
].map(([dm, da, dmo, dao], i) => ({
  id: `g-${i}`,
  dm_name: dm as string,
  da_name: da as string,
  dm_order: dmo as number,
  da_order: dao as number,
  updated_at: NOW,
}));

const groupsRef = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock('../hooks/useDmDaGroups', () => ({
  useDmDaGroups: () => ({
    rows: groupsRef.rows,
    groups: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import TeamStructureEditor from '../components/Settings/TeamStructureEditor';

function member(name: string, role = 'da'): TeamMember {
  return {
    id: `m-${name}`,
    name,
    role,
    active: true,
    former: false,
    email: null,
    notes: null,
    updated_at: NOW,
  } as unknown as TeamMember;
}

const ACTIVE_DAS = [
  'Ahmadi', 'Ainsley', 'Cam', 'Erick', 'Fisk', 'Francesca',
  'George', 'Marc', 'Nicky', 'Qisheng', 'Shire', 'Trevor',
].map((n) => member(n));
const DMS = ['Lindsay', 'Derry', 'Brittani', 'Jade'].map((n) => member(n, 'dm'));

function renderIt(activeDas = ACTIVE_DAS) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <TeamStructureEditor dms={DMS} activeDas={activeDas} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  groupsRef.rows = GROUPS;
  mocks.counts = { Cam: 17, Shire: 8, George: 0 };
  mocks.askedFor = [];
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
});

describe('fix-346 §2: the unmapped DAs are named, with what the gap costs', () => {
  it('★★★ names exactly the three active DAs with no design manager', () => {
    renderIt();
    const gap = screen.getByTestId('team-unmapped-coassign-warning');
    expect(within(gap).getByTestId('team-unmapped-da-Cam')).toBeInTheDocument();
    expect(within(gap).getByTestId('team-unmapped-da-Shire')).toBeInTheDocument();
    expect(within(gap).getByTestId('team-unmapped-da-George')).toBeInTheDocument();
    // A mapped DA is not a gap.
    expect(within(gap).queryByTestId('team-unmapped-da-Nicky')).toBeNull();
    expect(within(gap).queryByTestId('team-unmapped-da-Marc')).toBeNull();
  });

  it('★★ says what it costs — no DM co-assignee — not just that they are unassigned', () => {
    renderIt();
    const gap = screen.getByTestId('team-unmapped-coassign-warning');
    expect(gap.textContent).toMatch(/no Design Manager co-assignee/i);
    // ★ And it says what to do about it, next to the control that does it.
    expect(gap.textContent).toMatch(/Assign each to a DM above/i);
  });

  // ★★ NO BACKFILL, said on the screen as well as in the migration: turning the
  // mapping on does not reach back into work that already exists.
  it('★★ it promises nothing about existing tasks', () => {
    renderIt();
    expect(
      screen.getByTestId('team-unmapped-coassign-warning').textContent,
    ).toMatch(/existing tasks are not changed/i);
  });

  it('★ carries each person\'s open task count', () => {
    renderIt();
    expect(screen.getByTestId('team-unmapped-da-Cam').textContent).toContain('17 open tasks');
    expect(screen.getByTestId('team-unmapped-da-Shire').textContent).toContain('8 open tasks');
    // ★ Singular/plural, and a zero is still printed — "0 open tasks" is a fact
    // worth having when deciding which gap to close first.
    expect(screen.getByTestId('team-unmapped-da-George').textContent).toContain('0 open tasks');
  });

  it('★ asks for the counts of exactly the unmapped DAs, nobody else', () => {
    renderIt();
    expect(mocks.askedFor[0]).toEqual(['Cam', 'George', 'Shire']);
  });

  it('★ a missing count degrades to the name alone, never to a wrong number', () => {
    mocks.counts = undefined;
    renderIt();
    const row = screen.getByTestId('team-unmapped-da-Cam');
    expect(row.textContent).toBe('Cam');
    expect(row.textContent).not.toMatch(/open task/);
  });

  it('★★ and it disappears entirely once everyone is mapped', () => {
    renderIt(ACTIVE_DAS.filter((d) => !['Cam', 'Shire', 'George'].includes(d.name)));
    expect(screen.queryByTestId('team-unmapped-coassign-warning')).toBeNull();
    expect(screen.queryByTestId('team-unassigned-warning')).toBeNull();
  });

  // ★ The editor and the trigger must agree about who is a gap: both match
  // trimmed + case-folded, so a roster name that differs only in spacing is
  // routed by the rule and must not be reported here.
  it('★ a name differing only in case is not reported as a gap', () => {
    renderIt([member('nicky '), member('Cam')]);
    expect(screen.queryByTestId('team-unmapped-da-nicky ')).toBeNull();
    expect(screen.getByTestId('team-unmapped-da-Cam')).toBeInTheDocument();
  });
});
