import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import migrationSql from '../../migrations/fix_391_publish_holds_realtime.sql?raw';
import myBoardSource from '../lib/myBoard.ts?raw';
import { REALTIME_TABLES, queryKeys } from '../lib/queryKeys';

// ===========================================================================
// fix-391 — hold means quiet at BOTH scopes, and holds go live on the socket
// ===========================================================================
//
// Two follow-ups fix-390's report flagged. Bobby ruled YES to both (2026-08-23).
//
// ★★★ §1 WAS ALREADY TRUE ON MAIN, AND THAT IS THE INTERESTING PART. fix-390
// built `isPermitHeld` as a UNION over both scopes and wired `holdRows:
// holdsQ.data` into MyBoard and BoardBell — so a permit under an open project
// hold has been silent since b2588c9, while fix-390's own report said it had
// only added permit-scope silence. The behaviour was right and the description
// was wrong. This suite makes the ruling explicit and pins it, so nobody reads
// the project half as an accident and removes it.
//
// ★★ MEASURED ON PROD 2026-08-23/24: 2 open project holds ('MHA' on 6340 4th
// Ave NE and 6712 14th Ave NW) covering 4 unissued permits, which raise TWO
// chips between them today — `corrections` on 7102926-CN and `fees` on
// 7099413-CN (verified through fix-214's own SQL twin
// bp_permit_in_corrections, not a re-implementation). After this ruling: zero.

const sqlCode = migrationSql.replace(/^\s*--.*$/gm, '');

// ---------------------------------------------------------------------------
// §1 · BOTH SCOPES — through the real deriver
// ---------------------------------------------------------------------------

import { buildForecast } from '../lib/myBoard';
import type { PermitWithCycles } from '../lib/database.types';

const TODAY = '2026-08-24';

function permit(id: number, over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id,
    project_id: 'p-1',
    type: id === 1 ? 'ULS' : 'Building Permit',
    num: id === 1 ? '3043277-LU' : '7102926-CN',
    status: 'Pre-Submittal — GO',
    da: 'Nicky',
    ent_lead: 'Miles',
    intake_date: null,
    target_submit: '2026-01-15', // long past → a chip would fire
    dd_end: null,
    approval_date: null,
    actual_issue: null,
    created_at: '2025-06-01T00:00:00Z',
    updated_at: `${TODAY}T09:00:00Z`,
    permit_cycles: [],
    ...over,
  } as unknown as PermitWithCycles;
}

const BASE = {
  viewer: { name: 'Miles', isOversight: false },
  permits: [permit(1), permit(2)],
  projects: [{ id: 'p-1', address: '6340 4th Ave NE' }],
  tasks: [],
  today: TODAY,
};

const rows = (f: ReturnType<typeof buildForecast>) =>
  [...f.past_due.items, ...f.this_week.items, ...f.next_week.items];

const build = (over: Record<string, unknown> = {}) =>
  rows(buildForecast({ ...BASE, ...over } as never));

describe('fix-391 §1: a project hold silences its permits', () => {
  it('★★★ every permit under an open project hold raises ZERO chips', () => {
    expect(build().length).toBe(2); // both permits chip when nothing is held
    expect(
      build({ holdRows: [{ project_id: 'p-1', hold_end: null, kind: 'hold' }] }),
    ).toEqual([]);
  });

  it('★★★ releasing the project hold restores them — no acks written', () => {
    const released = build({
      holdRows: [{ project_id: 'p-1', hold_end: '2026-08-20', kind: 'hold' }],
    });
    expect(released.length).toBe(2);
    // Same inputs, same output: the hold was the only reason they were quiet.
    expect(released.map((r) => r.why)).toEqual(build().map((r) => r.why));
  });

  it('★★ CANCEL IS NOT HOLD — a cancelled project is fix-262\'s, untouched', () => {
    // The held-project set is filtered to kind === 'hold', so an open CANCEL
    // row never reaches the hold gate. (A cancelled project is dropped from the
    // board by isCancelledProject, a different mechanism, via cancelledIds.)
    const viaCancelKind = build({
      holdRows: [{ project_id: 'p-1', hold_end: null, kind: 'cancelled' }],
    });
    expect(viaCancelKind.length).toBe(2); // NOT silenced by the hold gate
    // ...and fix-262's own mechanism still drops it entirely.
    expect(build({ cancelledIds: new Set(['p-1']) })).toEqual([]);
  });

  it('★★ a permit held BOTH ways is silenced once, and needs BOTH lifted', () => {
    const both = {
      holdRows: [{ project_id: 'p-1', hold_end: null, kind: 'hold' }],
      permitHoldRows: [{ permit_id: 1, hold_end: null }],
    };
    expect(build(both)).toEqual([]);

    // Lift only the PROJECT hold → permit 1 stays quiet, permit 2 comes back.
    const projectLifted = build({
      holdRows: [{ project_id: 'p-1', hold_end: '2026-08-20', kind: 'hold' }],
      permitHoldRows: [{ permit_id: 1, hold_end: null }],
    });
    expect(projectLifted.map((r) => r.where)).toEqual([
      expect.stringContaining('Building Permit'),
    ]);

    // Lift only the PERMIT hold → still fully quiet, the project hold covers it.
    expect(
      build({
        holdRows: [{ project_id: 'p-1', hold_end: null, kind: 'hold' }],
        permitHoldRows: [{ permit_id: 1, hold_end: '2026-08-20' }],
      }),
    ).toEqual([]);

    // Both lifted → everything back.
    expect(
      build({
        holdRows: [{ project_id: 'p-1', hold_end: '2026-08-20', kind: 'hold' }],
        permitHoldRows: [{ permit_id: 1, hold_end: '2026-08-20' }],
      }).length,
    ).toBe(2);
  });

  it('★★ a permit hold still does NOT paint its project (fix-390, unbroken)', () => {
    const onePermitHeld = build({ permitHoldRows: [{ permit_id: 1, hold_end: null }] });
    // The sibling on the same project is untouched.
    expect(onePermitHeld.length).toBe(1);
    expect(onePermitHeld[0]!.where).toContain('Building Permit');
  });

  it('★ the code says the project half is RULED, not incidental', () => {
    // fix-390 shipped this by accident of its union and reported otherwise.
    // The comment is what stops the next reader removing it as a bug.
    expect(myBoardSource).toContain('DO NOT "FIX" THE PROJECT HALF AWAY');
    expect(myBoardSource).toContain('CANCEL IS NOT HOLD');
  });
});

// ---------------------------------------------------------------------------
// §2 · THE SOCKET — arrival proven, not the publication listing
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // ★ Table-AWARE capture: the existing suite keys handlers positionally, which
  // cannot answer "does a project_holds event invalidate project_holds?".
  const byTable = new Map<string, Array<() => void>>();
  const channelObj: { on: (...a: unknown[]) => unknown; subscribe: (cb?: (s: string) => void) => unknown } = {
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
  return {
    byTable,
    supabase: { channel: () => channelObj, removeChannel: vi.fn() },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: mocks.supabase }));

import { useRealtimeInvalidation } from '../hooks/useRealtimeInvalidation';

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

describe('fix-391 §2: a hold event arrives and invalidates', () => {
  it('★★★ a project_holds event invalidates the project-hold queries', () => {
    const qc = setup();
    const handlers = mocks.byTable.get('project_holds');
    // The subscription exists for this table at all — which it did before, and
    // which is exactly why the silence was invisible.
    expect(handlers?.length).toBe(1);

    const spy = vi.spyOn(qc, 'invalidateQueries');
    handlers![0]!();
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.projectHoldsAll });
  });

  it('★★★ a permit_holds event invalidates the permit-hold queries', () => {
    const qc = setup();
    const handlers = mocks.byTable.get('permit_holds');
    expect(handlers?.length).toBe(1);

    const spy = vi.spyOn(qc, 'invalidateQueries');
    handlers![0]!();
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.permitHoldsAll });
  });

  it('★★ the two scopes stay separate — one does not invalidate the other', () => {
    const qc = setup();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    mocks.byTable.get('permit_holds')![0]!();
    expect(spy).not.toHaveBeenCalledWith({ queryKey: queryKeys.projectHoldsAll });
  });

  it('★★ REALTIME_TABLES was already sufficient client-side', () => {
    // The answer to "does fix-336's channel machinery need anything else?" —
    // no. The hook iterates REALTIME_TABLES and registers one handler per
    // table, so the ONLY thing missing was the publication membership.
    setup();
    expect(REALTIME_TABLES).toHaveProperty('project_holds');
    expect(REALTIME_TABLES).toHaveProperty('permit_holds');
    expect(mocks.byTable.size).toBe(Object.keys(REALTIME_TABLES).length);
  });

  it('★★ fix-39\'s clobber guard still swallows an event mid-mutation', () => {
    const qc = setup();
    vi.spyOn(qc, 'isMutating').mockReturnValue(1);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    mocks.byTable.get('project_holds')![0]!();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('fix-391 §2: the migration', () => {
  it('★★ publishes BOTH hold tables, not just the new one', () => {
    expect(sqlCode).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE public.project_holds');
    expect(sqlCode).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE public.permit_holds');
  });

  it('★★ it is idempotent and verifies rather than assuming', () => {
    // ADD TABLE errors on an existing member, so each is guarded; and the
    // migration raises if the table is still absent afterwards.
    expect(sqlCode).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_publication_tables/);
    expect(sqlCode).toContain('still missing from supabase_realtime');
  });

  it('★★★ no row is written, and the fallback poll is untouched', () => {
    expect(sqlCode).not.toMatch(/\bINSERT INTO\b|\bUPDATE public\.|\bDELETE FROM\b/i);
    // fix-371's floor: a backgrounded tab freezes timers AND drops sockets.
    expect(sqlCode).not.toMatch(/REALTIME_FALLBACK_MS/);
  });

  it('★ replica identity is deliberately left alone', () => {
    expect(sqlCode).not.toMatch(/REPLICA IDENTITY/i);
  });
});
