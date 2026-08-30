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
// ★★★ fix-448 (P-098 / P-082) — THE BUILDER REGISTRY AND THE PICK-ONLY CELL
// ===========================================================================

const upsertMutate = vi.hoisted(() => vi.fn());
const deactivateMutate = vi.hoisted(() => vi.fn());
const mergeMutate = vi.hoisted(() => vi.fn());
const rows = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock('../hooks/useBuilderRegistry', async (imp) => {
  const actual = await imp<typeof import('../hooks/useBuilderRegistry')>();
  return {
    ...actual, // keep the real groupByPerson
    useBuilderRegistry: () => ({ data: rows.current, isLoading: false }),
    useUpsertBuilderRow: () => ({ mutate: upsertMutate, isPending: false }),
    useDeactivateBuilder: () => ({ mutate: deactivateMutate, isPending: false }),
    useMergeBuilders: () => ({ mutate: mergeMutate, isPending: false }),
  };
});

import BuildersRegistryPanel from '../components/Settings/BuildersRegistryPanel';

function row(over: Partial<BuilderRegistryRow>): BuilderRegistryRow {
  return {
    id: 'b1',
    name: 'Ted Chesledon',
    company: 'Cooper Thomas Homes, LLC',
    email: null,
    phone: null,
    address: null,
    notes: null,
    active: true,
    updated_at: '2026-08-29T00:00:00Z',
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
  rows.current = [];
});

// ---------------------------------------------------------------------------
// §1 · GROUP BY PERSON — ruling 3
// ---------------------------------------------------------------------------
describe('fix-448 §1: one person, several LLCs', () => {
  it('★★★ rows sharing a name become ONE group', () => {
    // ★ Prod's own shape: Ghennadi Ialanji holds 3 rows, Ted Chesledon 2. No
    //   schema change was needed to make ruling 3 true.
    const gs = groupByPerson([
      row({ id: 'a', name: 'Ted Chesledon', company: 'Cooper Thomas Homes, LLC', projectCount: 5 }),
      row({ id: 'b', name: 'Ted Chesledon', company: 'Cooper Thomas Homes', projectCount: 0 }),
      row({ id: 'c', name: 'Allan Cushing', company: 'Cushing Building Group, Inc.', projectCount: 5 }),
    ]);
    expect(gs.map((g) => g.name)).toEqual(['Allan Cushing', 'Ted Chesledon']);
    expect(gs[1]!.rows).toHaveLength(2);
    // ★★ The person's count is the sum across their LLCs.
    expect(gs[1]!.projectCount).toBe(5);
  });

  it('★★ grouping is case-insensitive but the DISPLAYED name is not rewritten', () => {
    const gs = groupByPerson([
      row({ id: 'a', name: 'Ted Chesledon', company: 'A' }),
      row({ id: 'b', name: 'ted chesledon', company: 'B' }),
    ]);
    expect(gs).toHaveLength(1);
    // ★ Filing them together is ours to decide; "correcting" somebody's name
    //   is not.
    expect(gs[0]!.name).toBe('Ted Chesledon');
  });

  it('★ a person with no company sorts FIRST among their LLCs', () => {
    // 4 of the 61 prod rows carry no company: an owner not trading through an
    // LLC is the base case, not an afterthought.
    const gs = groupByPerson([
      row({ id: 'a', name: 'G', company: 'Zeta LLC' }),
      row({ id: 'b', name: 'G', company: null }),
    ]);
    expect(gs[0]!.rows.map((r) => r.company)).toEqual([null, 'Zeta LLC']);
  });
});

// ---------------------------------------------------------------------------
// §2 · THE EDITOR
// ---------------------------------------------------------------------------
describe('fix-448 §2: the registry editor', () => {
  it('★★★ renders one block per person with a line per LLC, and the project count', () => {
    rows.current = [
      row({ id: 'a', name: 'Ted Chesledon', company: 'Cooper Thomas Homes, LLC', projectCount: 5 }),
      row({ id: 'b', name: 'Ted Chesledon', company: 'Cooper Thomas Homes', projectCount: 0 }),
    ];
    renderPanel();
    expect(screen.getByTestId('builders-person-Ted Chesledon')).toBeInTheDocument();
    expect(screen.getByTestId('builders-row-a')).toBeInTheDocument();
    expect(screen.getByTestId('builders-row-b')).toBeInTheDocument();
    // ★★ The column that makes deactivating and merging safe to do.
    expect(screen.getByTestId('builders-a-projects').textContent).toBe('5 projects');
    expect(screen.getByTestId('builders-b-projects').textContent).toBe('0 projects');
  });

  it('★★★ an inline edit commits ONCE, on blur, carrying the OCC token', () => {
    rows.current = [row({ id: 'a', email: null })];
    renderPanel();
    const cell = screen.getByTestId('builders-a-email');
    fireEvent.change(cell, { target: { value: 'ted@cooper.test' } });
    // ★ Not on every keystroke — the BufferedDateInput rule.
    expect(upsertMutate).not.toHaveBeenCalled();
    fireEvent.blur(cell);
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      id: 'a',
      email: 'ted@cooper.test',
      expectedUpdatedAt: '2026-08-29T00:00:00Z',
    });
  });

  it('★★ deactivate never deletes, and the row stays visible and greyed', () => {
    rows.current = [row({ id: 'a', active: false, projectCount: 3 })];
    renderPanel();
    fireEvent.click(screen.getByTestId('builders-show-inactive'));
    const line = screen.getByTestId('builders-row-a');
    expect(line.getAttribute('data-active')).toBe('false');
    // ★ 56 of 61 rows are referenced by a project; a delete would orphan the
    //   record of who built it.
    expect(screen.getByTestId('builders-a-projects').textContent).toBe('3 projects');
    // …and it can be brought back.
    fireEvent.click(screen.getByTestId('builders-a-active'));
    expect(deactivateMutate).toHaveBeenCalledWith({ id: 'a', active: true });
  });

  it('★★ adding a person calls the upsert with no id', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('builders-add-person'));
    fireEvent.change(screen.getByTestId('builders-add-name'), {
      target: { value: 'New Owner' },
    });
    fireEvent.change(screen.getByTestId('builders-add-company'), {
      target: { value: 'New Owner LLC' },
    });
    fireEvent.click(screen.getByTestId('builders-add-save'));
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    const arg = upsertMutate.mock.calls[0][0];
    expect(arg.id).toBeUndefined();
    expect(arg.name).toBe('New Owner');
    expect(arg.company).toBe('New Owner LLC');
  });

  it('★★★ adding an LLC under a person does not ask for the name again', () => {
    rows.current = [row({ id: 'a', name: 'Ghennadi Ialanji', company: 'Green Way Homes, LLC' })];
    renderPanel();
    fireEvent.click(screen.getByTestId('builders-add-llc-Ghennadi Ialanji'));
    // ★ Ruling 3: the person is decided, only the LLC is asked for.
    expect(screen.queryByTestId('builders-add-name')).toBeNull();
    fireEvent.change(screen.getByTestId('builders-add-company'), {
      target: { value: 'Second LLC' },
    });
    fireEvent.click(screen.getByTestId('builders-add-save'));
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      name: 'Ghennadi Ialanji',
      company: 'Second LLC',
    });
  });
});

// ---------------------------------------------------------------------------
// §3 · MERGE
// ---------------------------------------------------------------------------
describe('fix-448 §3: merging duplicates', () => {
  it('★★★ picking two rows shows the project count and merges loser → winner', () => {
    rows.current = [
      row({ id: 'loser', name: 'Ted Chesledon', company: 'Cooper Thomas Homes', projectCount: 0 }),
      row({ id: 'winner', name: 'Ted Chesledon', company: 'Cooper Thomas Homes, LLC', projectCount: 5 }),
    ];
    renderPanel();
    expect(screen.queryByTestId('builders-merge-bar')).toBeNull();
    fireEvent.click(screen.getByTestId('builders-loser-merge-pick'));
    fireEvent.click(screen.getByTestId('builders-winner-merge-pick'));
    const bar = screen.getByTestId('builders-merge-bar');
    // ★★ Both sides named in full, with the counts — this is somebody else's
    //    data being repointed.
    expect(bar.textContent).toContain('Cooper Thomas Homes');
    expect(bar.textContent).toContain('Cooper Thomas Homes, LLC');
    fireEvent.click(screen.getByTestId('builders-merge-confirm'));
    expect(mergeMutate).toHaveBeenCalledWith({
      loserId: 'loser',
      winnerId: 'winner',
    });
  });

  it('★★★ two rows of DIFFERENT people can be merged — the JMS case', () => {
    // ★★★ THE BRIEF SAID "two rows of the same person", and its own named
    //     example breaks that rule: measured on prod, "JMS Homes, Inc" appears
    //     under BILL Richmond (1 project) and WILL Richmond (2) — one human,
    //     two spellings of a first name. A same-person-only merge could not
    //     clean the very duplicate it was written for.
    rows.current = [
      row({ id: 'bill', name: 'Bill Richmond', company: 'JMS Homes, Inc', projectCount: 1 }),
      row({ id: 'will', name: 'Will Richmond', company: 'JMS Homes, Inc', projectCount: 2 }),
    ];
    renderPanel();
    fireEvent.click(screen.getByTestId('builders-bill-merge-pick'));
    fireEvent.click(screen.getByTestId('builders-will-merge-pick'));
    const bar = screen.getByTestId('builders-merge-bar');
    // ★ Both NAMES are shown, so a cross-person merge is a visible act.
    expect(bar.textContent).toContain('Bill Richmond');
    expect(bar.textContent).toContain('Will Richmond');
    fireEvent.click(screen.getByTestId('builders-merge-confirm'));
    expect(mergeMutate).toHaveBeenCalledWith({ loserId: 'bill', winnerId: 'will' });
  });

  it('★ only two at a time — a third pick replaces the first', () => {
    rows.current = [
      row({ id: 'a', name: 'P', company: 'A' }),
      row({ id: 'b', name: 'P', company: 'B' }),
      row({ id: 'c', name: 'P', company: 'C' }),
    ];
    renderPanel();
    fireEvent.click(screen.getByTestId('builders-a-merge-pick'));
    fireEvent.click(screen.getByTestId('builders-b-merge-pick'));
    fireEvent.click(screen.getByTestId('builders-c-merge-pick'));
    fireEvent.click(screen.getByTestId('builders-merge-confirm'));
    // A three-way merge is two decisions wearing one confirm dialog.
    expect(mergeMutate).toHaveBeenCalledWith({ loserId: 'b', winnerId: 'c' });
  });
});

// ---------------------------------------------------------------------------
// §4 · THE MIGRATION TEXT
// ---------------------------------------------------------------------------
describe('fix-448 §4: migrations/fix_448_builder_registry.sql', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'migrations/fix_448_builder_registry.sql'),
    'utf8',
  );

  it('★★★ the three RPCs are present', () => {
    for (const fn of [
      'bp_upsert_builder',
      'bp_deactivate_builder',
      'bp_merge_builders',
    ]) {
      expect(sql, fn).toContain(`create or replace function public.${fn}(`);
    }
  });

  it('★★★ every one is TENANT-SCOPED through auth_tenant_ids()', () => {
    // A security-definer function without a tenant filter is a cross-tenant
    // read with extra steps.
    const bodies = sql.split('create or replace function').slice(1);
    expect(bodies).toHaveLength(3);
    for (const b of bodies) {
      expect(b).toContain('auth_tenant_ids()');
      expect(b).toContain("set search_path to 'public', 'pg_temp'");
    }
  });

  it('★★★ builders GAINS updated_at and the house trigger', () => {
    // ★ Confirmed on prod: the table had NO updated_at and no created_at, so
    //   the editor had no OCC token to check against.
    expect(sql).toContain('add column if not exists updated_at');
    expect(sql).toContain('execute function public.bp_set_updated_at()');
  });

  it('★★★ grants follow the house model — anon gets nothing', () => {
    expect(sql).toContain('revoke all on function public.bp_upsert_builder');
    expect(sql).toContain('from public, anon');
    expect(sql).toContain('to authenticated');
    // ★★ No new table and no view, so nothing for the truncate-grant rule to
    //    bite on — and nothing here hands out table privileges either.
    expect(sql).not.toMatch(/grant\s+(all|insert|update|delete|truncate)\s+on\s+table/i);
    expect(sql).not.toMatch(/create\s+(or replace\s+)?view/i);
  });

  it('★★★ the merge repoints the FK AND refreshes the five cache columns', () => {
    // Repointing without rewriting the cache leaves exactly the state P-082
    // exists to abolish: a link and a label that disagree.
    const merge = sql.slice(sql.indexOf('bp_merge_builders'));
    for (const col of [
      'builder_id      = p_winner_id',
      'builder_name    = v_winner.name',
      'builder_company = v_winner.company',
      'builder_email   = v_winner.email',
      'builder_phone   = v_winner.phone',
      'builder_address = v_winner.address',
    ]) {
      expect(merge, col).toContain(col);
    }
    // ★ And the loser is deactivated, never deleted.
    expect(merge).toContain('set active = false');
    expect(merge).not.toMatch(/delete\s+from\s+public\.builders/i);
  });

  it('★★★ APPLYING it writes no data — the DML lives inside function bodies', () => {
    // ★★★ The distinction the first version of this test missed: an `update
    //     public.projects` INSIDE bp_merge_builders is the feature, and it runs
    //     only when somebody calls it. What must not exist is DML at the top
    //     level, which would run the moment Claude applies this. So the
    //     function bodies are stripped before the check.
    const topLevel = sql.replace(/\$\$[\s\S]*?\$\$/g, '<<body>>');
    expect(topLevel).not.toMatch(/update\s+public\./i);
    expect(topLevel).not.toMatch(/insert\s+into\s+public\./i);
    expect(topLevel).not.toMatch(/delete\s+from\s+public\./i);
    // ★ The duplicates are cleaned by Bobby in the editor with the project
    //   count in front of him, not by a migration repointing FKs silently.
    //   The only DDL is the column, its trigger and an index.
    expect(topLevel).toContain('add column if not exists updated_at');
  });
});
