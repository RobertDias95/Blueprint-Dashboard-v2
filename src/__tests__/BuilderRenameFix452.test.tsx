import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  groupByPerson,
  type BuilderRegistryRow,
} from '../hooks/useBuilderRegistry';

// ===========================================================================
// ★★★ fix-452 (P-102 / P-103) — RENAME A PERSON, AND REACH THE MERGE
// ===========================================================================

const upsertMutate = vi.hoisted(() => vi.fn());
const deactivateMutate = vi.hoisted(() => vi.fn());
const mergeMutate = vi.hoisted(() => vi.fn());
const renameMutate = vi.hoisted(() => vi.fn());
const rows = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock('../hooks/useBuilderRegistry', async (imp) => {
  const actual = await imp<typeof import('../hooks/useBuilderRegistry')>();
  return {
    ...actual, // keep the real groupByPerson
    useBuilderRegistry: () => ({ data: rows.current, isLoading: false }),
    useUpsertBuilderRow: () => ({ mutate: upsertMutate, isPending: false }),
    useDeactivateBuilder: () => ({ mutate: deactivateMutate, isPending: false }),
    useMergeBuilders: () => ({ mutate: mergeMutate, isPending: false }),
    useRenameBuilderPerson: () => ({ mutate: renameMutate, isPending: false }),
  };
});

import BuildersRegistryPanel from '../components/Settings/BuildersRegistryPanel';

function row(over: Partial<BuilderRegistryRow>): BuilderRegistryRow {
  return {
    id: 'b1',
    name: 'Ghennadi Ialanji',
    company: null,
    email: null,
    phone: null,
    address: null,
    notes: null,
    active: true,
    updated_at: '2026-08-30T00:00:00Z',
    projectCount: 0,
    ...over,
  } as BuilderRegistryRow;
}

function renderPanel(readOnly = false) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<BuildersRegistryPanel readOnly={readOnly} />, { wrapper });
}

beforeEach(() => {
  upsertMutate.mockReset();
  deactivateMutate.mockReset();
  mergeMutate.mockReset();
  renameMutate.mockReset();
  rows.current = [];
});

// ---------------------------------------------------------------------------
// §A — the rename
// ---------------------------------------------------------------------------
describe('fix-452 §A: renaming the person', () => {
  it('★★★ the rename goes through the PERSON rpc, not the per-row writer', () => {
    // ★★★ THE WHOLE POINT. `useUpsertBuilderRow` already updates `name` — for
    //     ONE row. Ghennadi holds three; correcting one of three splits him
    //     into two groups, because groupByPerson keys on the case-folded name.
    rows.current = [
      row({ id: 'a', name: 'GERRARD FLOYD', company: 'Floyd Homes', projectCount: 1 }),
    ];
    renderPanel();
    fireEvent.click(screen.getByTestId('builders-person-name-GERRARD FLOYD'));
    const input = screen.getByTestId(
      'builders-person-rename-GERRARD FLOYD',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Gerrard Floyd' } });
    fireEvent.blur(input);
    expect(renameMutate).toHaveBeenCalledTimes(1);
    expect(renameMutate.mock.calls[0][0]).toEqual({
      oldName: 'GERRARD FLOYD',
      newName: 'Gerrard Floyd',
    });
    // ★ …and NOT through the row writer, which would have split the person.
    expect(upsertMutate).not.toHaveBeenCalled();
  });

  it('★★★ a CASING-ONLY rename still fires — it is the headline case', () => {
    // `GERRARD FLOYD` → `Gerrard Floyd` is a no-op under a case-folded
    // comparison, so there is deliberately no "nothing changed" early return.
    rows.current = [row({ id: 'a', name: 'gerrard floyd' })];
    renderPanel();
    fireEvent.click(screen.getByTestId('builders-person-name-gerrard floyd'));
    const input = screen.getByTestId('builders-person-rename-gerrard floyd');
    fireEvent.change(input, { target: { value: 'Gerrard Floyd' } });
    fireEvent.blur(input);
    expect(renameMutate).toHaveBeenCalledWith({
      oldName: 'gerrard floyd',
      newName: 'Gerrard Floyd',
    });
  });

  it('★★★ a blank name is refused and NOTHING is written', () => {
    rows.current = [row({ id: 'a', name: 'Ted Chesledon' })];
    renderPanel();
    fireEvent.click(screen.getByTestId('builders-person-name-Ted Chesledon'));
    const input = screen.getByTestId('builders-person-rename-Ted Chesledon');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(renameMutate).not.toHaveBeenCalled();
  });

  it('★★ an unchanged name writes nothing either', () => {
    rows.current = [row({ id: 'a', name: 'Ted Chesledon' })];
    renderPanel();
    fireEvent.click(screen.getByTestId('builders-person-name-Ted Chesledon'));
    fireEvent.blur(screen.getByTestId('builders-person-rename-Ted Chesledon'));
    expect(renameMutate).not.toHaveBeenCalled();
  });

  it('★★ Escape cancels without writing', () => {
    rows.current = [row({ id: 'a', name: 'Ted Chesledon' })];
    renderPanel();
    fireEvent.click(screen.getByTestId('builders-person-name-Ted Chesledon'));
    const input = screen.getByTestId('builders-person-rename-Ted Chesledon');
    fireEvent.change(input, { target: { value: 'Something Else' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(renameMutate).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('builders-person-rename-Ted Chesledon'),
    ).toBeNull();
  });

  it('★★★ §A4: readOnly offers no rename affordance, and still shows the name', () => {
    rows.current = [row({ id: 'a', name: 'Ted Chesledon', email: 'ted@x.test' })];
    renderPanel(true);
    expect(
      screen.getByTestId('builders-person-name-Ted Chesledon').textContent,
    ).toBe('Ted Chesledon');
    fireEvent.click(screen.getByTestId('builders-person-name-Ted Chesledon'));
    expect(
      screen.queryByTestId('builders-person-rename-Ted Chesledon'),
    ).toBeNull();
    // ★ …and the contact fields are still readable.
    expect(screen.getByTestId('builders-a-email')).toBeInTheDocument();
  });

  it('★★★ the person does NOT split: one group at the new name, none at the old', () => {
    // What the RPC guarantees, asserted on the grouper that would have shown
    // the split. All three of Ghennadi's rows carry the new spelling.
    const after = groupByPerson([
      row({ id: 'a', name: 'Ghennadi Ialanji Jr', company: null }),
      row({ id: 'b', name: 'Ghennadi Ialanji Jr', company: 'Green Way Homes, LLC' }),
      row({ id: 'c', name: 'Ghennadi Ialanji Jr', company: 'Second LLC' }),
    ]);
    expect(after).toHaveLength(1);
    expect(after[0]!.name).toBe('Ghennadi Ialanji Jr');
    expect(after[0]!.rows).toHaveLength(3);

    // ★★ And the half-done state this exists to prevent — one row renamed —
    //    really would have produced two people.
    const halfDone = groupByPerson([
      row({ id: 'a', name: 'Ghennadi Ialanji Jr', company: null }),
      row({ id: 'b', name: 'Ghennadi Ialanji', company: 'Green Way Homes, LLC' }),
      row({ id: 'c', name: 'Ghennadi Ialanji', company: 'Second LLC' }),
    ]);
    expect(halfDone).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// §B — the confirm goes where the decision is
// ---------------------------------------------------------------------------
describe('fix-452 §B: reaching the merge', () => {
  const two = [
    row({ id: 'loser', name: 'Ted Chesledon', company: 'Cooper Thomas Homes', projectCount: 0 }),
    row({ id: 'winner', name: 'Ted Chesledon', company: 'Cooper Thomas Homes, LLC', projectCount: 5 }),
  ];

  it('★★★ §B3: ONE pick shows "pick one more to merge"', () => {
    rows.current = two;
    renderPanel();
    expect(screen.queryByTestId('builders-loser-merge-hint')).toBeNull();
    fireEvent.click(screen.getByTestId('builders-loser-merge-pick'));
    expect(screen.getByTestId('builders-loser-merge-hint')).toBeInTheDocument();
    // ★ …and it goes when the second pick lands.
    fireEvent.click(screen.getByTestId('builders-winner-merge-pick'));
    expect(screen.queryByTestId('builders-loser-merge-hint')).toBeNull();
  });

  it('★★★ §B2: the inline confirm appears under the SECOND pick', () => {
    rows.current = two;
    renderPanel();
    fireEvent.click(screen.getByTestId('builders-loser-merge-pick'));
    fireEvent.click(screen.getByTestId('builders-winner-merge-pick'));
    const inline = screen.getByTestId('builders-inline-merge-winner');
    // Both sides named, like the bar — the two duplicates this exists for are
    // not obvious from an id.
    expect(inline.textContent).toContain('Cooper Thomas Homes');
    expect(inline.textContent).toContain('Cooper Thomas Homes, LLC');
    // ★ And it is NOT under the first pick.
    expect(screen.queryByTestId('builders-inline-merge-loser')).toBeNull();
  });

  it('★★★ §B2: the inline confirm fires the SAME mutation as the sticky bar', () => {
    rows.current = two;
    renderPanel();
    fireEvent.click(screen.getByTestId('builders-loser-merge-pick'));
    fireEvent.click(screen.getByTestId('builders-winner-merge-pick'));
    fireEvent.click(screen.getByTestId('builders-inline-merge-confirm-winner'));
    expect(mergeMutate).toHaveBeenCalledWith({
      loserId: 'loser',
      winnerId: 'winner',
    });
  });

  it('★★ §B1: the sticky bar is still there, unchanged, and is sticky', () => {
    rows.current = two;
    renderPanel();
    fireEvent.click(screen.getByTestId('builders-loser-merge-pick'));
    fireEvent.click(screen.getByTestId('builders-winner-merge-pick'));
    const bar = screen.getByTestId('builders-merge-bar');
    expect(bar.className).toContain('sticky');
    // ★ Its copy, its ids and its counts are untouched — only placement moved.
    expect(bar.textContent).toContain('Cooper Thomas Homes, LLC');
    expect(screen.getByTestId('builders-merge-confirm')).toBeInTheDocument();
    expect(screen.getByTestId('builders-merge-cancel')).toBeInTheDocument();
  });

  it('★★ §B5: a third pick keeps the LAST TWO and moves the inline confirm', () => {
    rows.current = [
      ...two,
      row({ id: 'third', name: 'Ted Chesledon', company: 'Third LLC', projectCount: 2 }),
    ];
    renderPanel();
    fireEvent.click(screen.getByTestId('builders-loser-merge-pick'));
    fireEvent.click(screen.getByTestId('builders-winner-merge-pick'));
    expect(screen.getByTestId('builders-inline-merge-winner')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('builders-third-merge-pick'));
    // ★ The existing `.slice(-2)` keeps winner + third; the confirm follows.
    expect(screen.queryByTestId('builders-inline-merge-winner')).toBeNull();
    expect(screen.getByTestId('builders-inline-merge-third')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('builders-inline-merge-confirm-third'));
    expect(mergeMutate).toHaveBeenCalledWith({
      loserId: 'winner',
      winnerId: 'third',
    });
  });

  it('★★ §B5: Cancel clears BOTH affordances', () => {
    rows.current = two;
    renderPanel();
    fireEvent.click(screen.getByTestId('builders-loser-merge-pick'));
    fireEvent.click(screen.getByTestId('builders-winner-merge-pick'));
    fireEvent.click(screen.getByTestId('builders-inline-merge-cancel-winner'));
    expect(screen.queryByTestId('builders-inline-merge-winner')).toBeNull();
    expect(screen.queryByTestId('builders-merge-bar')).toBeNull();
  });

  it('★★ cross-person merge stays allowed (fix-448) — the JMS case', () => {
    rows.current = [
      row({ id: 'bill', name: 'Bill Richmond', company: 'JMS Homes, Inc', projectCount: 1 }),
      row({ id: 'will', name: 'Will Richmond', company: 'JMS Homes, Inc', projectCount: 2 }),
    ];
    renderPanel();
    fireEvent.click(screen.getByTestId('builders-bill-merge-pick'));
    fireEvent.click(screen.getByTestId('builders-will-merge-pick'));
    expect(screen.getByTestId('builders-inline-merge-will')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// §A — the migration text
// ---------------------------------------------------------------------------
describe('fix-452 §A: migrations/fix_452_rename_builder_person.sql', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'migrations/fix_452_rename_builder_person.sql'),
    'utf8',
  );

  it('★★★ ONE transaction moves the catalogue AND the denormalised copy', () => {
    // Renaming the catalogue alone would leave the Overview cell showing the
    // old spelling, and would split the builder in redesignAnalytics, which
    // groups on `(builder_name ?? '').trim()` WITHOUT case-folding.
    expect(sql).toContain('update public.builders');
    expect(sql).toContain('set builder_name = v_new');
    expect(sql).toContain('update public.projects');
  });

  it('★★★ it is tenant-scoped and refuses a blank name', () => {
    expect(sql).toContain('auth_tenant_ids()');
    expect(sql).toContain("set search_path to 'public', 'pg_temp'");
    expect(sql).toContain("raise exception 'builder name is required'");
  });

  it('★★★ grants follow bp_merge_builders exactly — anon gets nothing', () => {
    expect(sql).toContain(
      'revoke all on function public.bp_rename_builder_person(text, text) from public, anon',
    );
    expect(sql).toContain(
      'grant execute on function public.bp_rename_builder_person(text, text) to authenticated',
    );
  });

  it('★★★ it does not touch the three existing builder RPCs', () => {
    // A rename is a NEW function beside them, never an edit to any of them.
    for (const fn of [
      'bp_merge_builders',
      'bp_deactivate_builder',
      'bp_upsert_builder',
    ]) {
      expect(sql, fn).not.toContain(`create or replace function public.${fn}`);
    }
  });

  it('★★ NO auto-tidy anywhere — ruled out', () => {
    // initcap() is the exact function that would turn "SSS" into "Sss" and
    // "JMS Homes, Inc" into "Jms Homes, Inc".
    expect(sql.toLowerCase()).not.toContain('initcap');
  });
});
