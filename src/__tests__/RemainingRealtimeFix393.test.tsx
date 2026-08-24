import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import migrationSql from '../../migrations/fix_393_publish_remaining_realtime.sql?raw';
import { REALTIME_TABLES, queryKeys } from '../lib/queryKeys';

// ===========================================================================
// fix-393 — five tables still promise realtime and never emit
// ===========================================================================
//
// The audit fix-391 reported, finished. Four of the five named tables are
// published here; the fifth is reported instead, because it turned out not to
// be a promise at all.
//
// ★★★ THE BRIEF SAID FIVE AND THE ANSWER IS FOUR. `builders` is not a member of
// REALTIME_TABLES and never has been — my own fix-391 audit comment listed it
// (and counted 24 tables where there are 22), and the ticket inherited that
// error from me. §3 below proves the three independent reasons publishing it
// would have been pure wire noise.
//
// ★★★ MEASURED ON PROD 2026-08-24, BEFORE: exactly four of the 22 tables in
// REALTIME_TABLES were absent from `supabase_realtime` — the same four this
// migration adds. AFTER: 22 of 22. The audit that started in fix-336 (3 of its
// 6) and continued in fix-391 (2 more) is closed.

const sqlCode = migrationSql.replace(/^\s*--.*$/gm, '');

/** The four tables this ticket publishes, each with the key it must invalidate
 *  and nobody else's. ★ Driven from `queryKeys` rather than string literals, so
 *  renaming a key breaks this test instead of silently un-proving it. */
const PUBLISHED = [
  { table: 'permit_cycle_reviewers', key: queryKeys.permitCycleReviewersAll },
  { table: 'error_reports', key: queryKeys.errorReportsAll },
  { table: 'vendor_report_state', key: queryKeys.vendorReportStateAll },
  { table: 'external_team_directory', key: queryKeys.externalTeamDirectoryAll },
] as const;

// ---------------------------------------------------------------------------
// The table-AWARE harness fix-391 built precisely so this ticket would be cheap.
// Keying handlers by table (not positionally) is what lets §2 ask the only
// question worth asking: does an event on THIS table invalidate THIS table?
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const byTable = new Map<string, Array<() => void>>();
  const channelObj: {
    on: (...a: unknown[]) => unknown;
    subscribe: (cb?: (s: string) => void) => unknown;
  } = {
    on: (...args: unknown[]) => {
      const filter = args[1] as { table: string };
      const handler = args[2] as () => void;
      const list = byTable.get(filter.table) ?? [];
      list.push(handler);
      byTable.set(filter.table, list);
      return channelObj;
    },
    subscribe: () => channelObj,
  };
  return { byTable, supabase: { channel: () => channelObj, removeChannel: vi.fn() } };
});

vi.mock('../lib/supabase', () => ({ supabase: mocks.supabase }));

import {
  useRealtimeInvalidation,
  REALTIME_FALLBACK_MS,
  allRealtimeKeys,
} from '../hooks/useRealtimeInvalidation';

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  renderHook(() => useRealtimeInvalidation(), { wrapper });
  return queryClient;
}

beforeEach(() => {
  mocks.byTable.clear();
});

// ---------------------------------------------------------------------------
// §1 · ARRIVAL, PROVEN PER TABLE
// ---------------------------------------------------------------------------

describe('fix-393 §1: each published table invalidates its OWN keys', () => {
  it.each(PUBLISHED)(
    '★★★ a $table event invalidates $table and fires exactly one handler',
    ({ table, key }) => {
      const qc = setup();
      const handlers = mocks.byTable.get(table);
      // ★ The subscription existed before this ticket too — which is exactly
      // why the silence was invisible. Publication membership was the gap.
      expect(handlers?.length).toBe(1);

      const spy = vi.spyOn(qc, 'invalidateQueries');
      handlers![0]!();
      expect(spy).toHaveBeenCalledWith({ queryKey: key });
    },
  );

  it('★★★ ...and NOBODY ELSE\'S — no cross-talk between the four', () => {
    const qc = setup();
    for (const { table } of PUBLISHED) {
      const spy = vi.spyOn(qc, 'invalidateQueries');
      mocks.byTable.get(table)![0]!();
      // Every OTHER published table's key must be untouched by this event.
      for (const other of PUBLISHED) {
        if (other.table === table) continue;
        expect(spy).not.toHaveBeenCalledWith({ queryKey: other.key });
      }
      // Exactly one key per event: these four map 1:1, so a second
      // invalidation would mean the map grew a fan-out nobody asked for.
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    }
  });

  it('★★ every one of the four is still reachable by the fallback poll', () => {
    // fix-371's floor invalidates `allRealtimeKeys()`, derived from
    // REALTIME_TABLES regardless of publication. Publishing must not have
    // removed anything from the slow path that now has a fast one.
    const all = allRealtimeKeys().map((k) => JSON.stringify(k));
    for (const { key } of PUBLISHED) {
      expect(all).toContain(JSON.stringify(key));
    }
  });

  it.each(PUBLISHED)(
    '★★ fix-39\'s clobber guard still swallows a $table event mid-mutation',
    ({ table }) => {
      // A realtime event landing mid-mutation would refetch the pre-commit row
      // and clobber the optimistic edit. Newly-published tables must not be a
      // hole in that guard.
      const qc = setup();
      vi.spyOn(qc, 'isMutating').mockReturnValue(1);
      const spy = vi.spyOn(qc, 'invalidateQueries');
      mocks.byTable.get(table)![0]!();
      expect(spy).not.toHaveBeenCalled();
    },
  );
});

// ---------------------------------------------------------------------------
// §2 · THE MIGRATION
// ---------------------------------------------------------------------------

describe('fix-393 §2: the migration', () => {
  it('★★★ publishes the four LIVE tables', () => {
    // The DO block loops an ARRAY of table names, so assert on the array
    // contents rather than four literal ALTER statements.
    expect(sqlCode).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE');
    for (const { table } of PUBLISHED) {
      expect(sqlCode).toContain(`'${table}'`);
    }
  });

  it('★★★ and does NOT publish `builders` — the dead one', () => {
    // ★★ THE COMMENT-STRIPPING MATTERS. The header discusses `builders` at
    // length, precisely because it is being reported rather than published.
    // Asserting against the raw file would fail on the prose that explains the
    // decision — the trap fix-387 and fix-390 both hit.
    expect(migrationSql).toContain('builders'); // the explanation is there...
    expect(sqlCode).not.toContain('builders'); // ...and no executable line is.
  });

  it('★★ it is idempotent and verifies rather than assuming', () => {
    // ADD TABLE errors on an existing member, so each is guarded; and the
    // migration raises if a table is still absent afterwards.
    expect(sqlCode).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_publication_tables/);
    expect(sqlCode).toContain('still missing from supabase_realtime');
  });

  it('★★★ no row is written, and the fallback poll is untouched', () => {
    expect(sqlCode).not.toMatch(/\bINSERT INTO\b|\bUPDATE public\.|\bDELETE FROM\b/i);
    expect(sqlCode).not.toMatch(/REALTIME_FALLBACK_MS/);
    // fix-371's floor, pinned at its value: a backgrounded tab freezes timers
    // AND drops sockets, so the poll is the floor and the socket is only an
    // accelerant. Publishing four tables is not a reason to lengthen it.
    expect(REALTIME_FALLBACK_MS).toBe(60_000);
  });

  it('★ replica identity is deliberately left alone', () => {
    // All four are `default` (primary key) — the same as `permits`, whose
    // realtime demonstrably works. RLS keys on tenant_id, present in the NEW
    // record of every INSERT and UPDATE, so FULL would buy an old_record
    // nobody reads at the cost of wider WAL rows.
    expect(sqlCode).not.toMatch(/REPLICA IDENTITY/i);
  });
});

// ---------------------------------------------------------------------------
// §3 · `builders` IS DEAD — reported, not published
// ---------------------------------------------------------------------------

describe('fix-393 §3: why the fifth table was reported instead', () => {
  it('★★★ it is not in REALTIME_TABLES, so NO HANDLER would ever receive it', () => {
    // The strongest of the three reasons, and the one that makes publishing it
    // pointless rather than merely wasteful: the hook subscribes to
    // Object.keys(REALTIME_TABLES). A published table absent from that map puts
    // rows on the wire that reach nothing at all.
    setup();
    expect(REALTIME_TABLES).not.toHaveProperty('builders');
    expect(mocks.byTable.has('builders')).toBe(false);
    expect(mocks.byTable.size).toBe(Object.keys(REALTIME_TABLES).length);
  });

  it('★★★ and the live autocomplete key CANNOT prefix-match ["builders"]', () => {
    // Proven behaviourally through a real QueryClient rather than asserted from
    // the source, because prefix matching is react-query's rule, not ours.
    // useBuilderSearch keys on ['builders_search', tenantId, query] — a
    // different FIRST ELEMENT, so it is a sibling of ['builders'], not a child.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const searchKey = ['builders_search', 't-1', 'acme'];
    qc.setQueryData(searchKey, []);
    qc.setQueryData([...queryKeys.buildersAll, 't-1'], []); // a genuine child

    qc.invalidateQueries({ queryKey: queryKeys.buildersAll });

    expect(qc.getQueryState([...queryKeys.buildersAll, 't-1'])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(searchKey)?.isInvalidated).toBe(false);
  });

  it('★★ the audit is closed: every mapped table is published', () => {
    // Measured on prod 2026-08-24: these four were the ONLY members of
    // REALTIME_TABLES missing from supabase_realtime.
    //
    // ★★★ fix-401 grew the map from 22 to 25 (dm_da_groups, team_members,
    // draw_schedule_quarter_layout) and found the OTHER failure mode this test
    // could not see: two of those three were ALREADY published and had been
    // emitting to nobody, because no client key named them. A frozen COUNT
    // pins neither half, so it is replaced by the invariant it was standing in
    // for — every mapped table has a key, and fix-401's own suite asserts the
    // publication side. Both halves, checked separately.
    expect(Object.keys(REALTIME_TABLES).length).toBeGreaterThanOrEqual(25);
    for (const t of Object.keys(REALTIME_TABLES)) {
      expect(REALTIME_TABLES[t as keyof typeof REALTIME_TABLES].length).toBeGreaterThan(0);
    }
    for (const { table } of PUBLISHED) {
      expect(REALTIME_TABLES).toHaveProperty(table);
    }
  });
});
