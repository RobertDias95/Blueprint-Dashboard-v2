import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// fix-264: the ONE cancelled rule, and the surfaces that route through it.
//
// fix-262 put "a cancelled project is not active" inside projectIsActive — a
// ProjectRow predicate only the Project List could reach. Every other live-work
// surface holds raw projects / permits / task rows, so the rule was lifted into
// isCancelledProject + excludeCancelled and projectIsActive now delegates. These
// pin that there is exactly one definition, and that holds never enter it.

import {
  isCancelledProject,
  excludeCancelled,
  projectIsActive,
} from '../lib/projectViewHelpers';
import { buildApprovedAwaitingRows } from '../lib/approvedAwaitingIssuance';
import type { Permit, Project } from '../lib/database.types';

describe('fix-264 isCancelledProject — the single rule', () => {
  it('is true only for an id in the set', () => {
    const set = new Set(['c1']);
    expect(isCancelledProject('c1', set)).toBe(true);
    expect(isCancelledProject('other', set)).toBe(false);
  });

  it('an omitted set hides nothing — a surface whose holds have not loaded yet renders pre-fix-264', () => {
    expect(isCancelledProject('c1')).toBe(false);
    expect(isCancelledProject('c1', undefined)).toBe(false);
    expect(isCancelledProject('c1', new Set())).toBe(false);
  });
});

describe('fix-264 excludeCancelled — both project-keyed shapes', () => {
  const cancelled = new Set(['c1']);

  it('keys `Project`-shaped rows by id', () => {
    const rows = [{ id: 'c1' }, { id: 'p2' }];
    expect(excludeCancelled(rows, cancelled)).toEqual([{ id: 'p2' }]);
  });

  it('keys permit / task / report rows by project_id, and prefers it over id', () => {
    // A task row carries BOTH: its own id and its project's. The project is what
    // decides — keying on `id` here would leak the cancelled project's tasks.
    const rows = [
      { id: 't1', project_id: 'c1' },
      { id: 't2', project_id: 'p2' },
    ];
    expect(excludeCancelled(rows, cancelled).map((r) => r.id)).toEqual(['t2']);
  });

  it('returns the SAME array reference when nothing is cancelled (no re-render churn)', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    expect(excludeCancelled(rows, new Set())).toBe(rows);
    expect(excludeCancelled(rows, undefined)).toBe(rows);
  });

  it('drops every row of a cancelled project, not just the first', () => {
    const rows = [
      { project_id: 'c1' },
      { project_id: 'c1' },
      { project_id: 'p2' },
    ];
    expect(excludeCancelled(rows, cancelled)).toHaveLength(1);
  });
});

describe('fix-264 projectIsActive still delegates (fix-262 behaviour preserved)', () => {
  function row(id: string, hasAnyPermit: boolean) {
    return {
      project: { id, address: 'x' },
      permits: hasAnyPermit
        ? [{ permit: { status: 'Reviews In Process', actual_issue: null } }]
        : [],
      hasAnyPermit,
    } as never;
  }

  it('cancelled short-circuits even a permit-less shell (which is otherwise active)', () => {
    expect(projectIsActive(row('c1', false))).toBe(true);
    expect(projectIsActive(row('c1', false), new Set(['c1']))).toBe(false);
  });

  it('cancelled short-circuits an all-open project', () => {
    expect(projectIsActive(row('c1', true), new Set(['c1']))).toBe(false);
  });

  it('a project NOT in the set is unaffected — holds never reach this argument', () => {
    expect(projectIsActive(row('held', true), new Set(['c1']))).toBe(true);
  });
});

describe('fix-264 buildApprovedAwaitingRows — the chase-list drops cancelled', () => {
  function permit(over: Partial<Permit>): Permit {
    return {
      id: 1,
      project_id: 'p1',
      type: 'Building Permit',
      num: null,
      da: null,
      status: 'Ready for Issuance',
      approval_date: '2026-06-01',
      actual_issue: null,
      parent_permit_id: null,
      ...over,
    } as unknown as Permit;
  }
  const projects = new Map<string, Project>([
    ['p1', { id: 'p1', address: '1 A St', juris: 'Seattle' } as Project],
    ['p2', { id: 'p2', address: '2 B St', juris: 'Seattle' } as Project],
  ]);
  const permits = [
    permit({ id: 1, project_id: 'p1' }),
    permit({ id: 2, project_id: 'p2' }),
  ];

  it('omitting the set is byte-identical to pre-fix-264', () => {
    const before = buildApprovedAwaitingRows(permits, projects, '2026-07-07');
    const after = buildApprovedAwaitingRows(permits, projects, '2026-07-07', new Set());
    expect(after).toEqual(before);
    expect(before.map((r) => r.permitId)).toEqual([1, 2]);
  });

  it('a cancelled project loses its row', () => {
    const rows = buildApprovedAwaitingRows(
      permits,
      projects,
      '2026-07-07',
      new Set(['p1']),
    );
    expect(rows.map((r) => r.permitId)).toEqual([2]);
  });
});

// ── Waiting On: the same rule, applied in the hook that feeds the view ───────

const rpcMock = vi.hoisted(() => vi.fn());
const holdsRef = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock('../lib/supabase', () => ({ supabase: { rpc: rpcMock } }));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: [
      { id: 'c1', external_team: null },
      { id: 'p2', external_team: null },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useProjectHolds', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useProjectHolds')>();
  return {
    ...actual,
    useAllProjectHolds: () => ({
      data: holdsRef.current,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});

import { useWaitingOnTasks } from '../hooks/useWaitingOnTasks';
import { useAuthStore } from '../stores/authStore';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function openHold(projectId: string, kind: 'hold' | 'cancelled') {
  return {
    id: `h-${projectId}`,
    project_id: projectId,
    kind,
    reason: 'because',
    note: null,
    hold_start: '2026-06-01',
    hold_end: null,
  };
}

describe('fix-264 useWaitingOnTasks — cancelled projects are not waiting on anybody', () => {
  const ROWS = [
    { task_id: 't1', project_id: 'c1', waiting_on: 'structural', firm_id: null, firm_name: null, firm_active: true },
    { task_id: 't2', project_id: 'p2', waiting_on: 'structural', firm_id: null, firm_name: null, firm_active: true },
  ];

  async function run() {
    useAuthStore.setState({ activeTenantId: 'test-tenant' });
    rpcMock.mockResolvedValue({ data: ROWS, error: null });
    const { result } = renderHook(
      () => useWaitingOnTasks({ includeCompleted: false }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    return result;
  }

  it('drops the cancelled project’s rows', async () => {
    holdsRef.current = [openHold('c1', 'cancelled')];
    const result = await run();
    await waitFor(() =>
      expect(result.current.data.map((r) => r.task_id)).toEqual(['t2']),
    );
  });

  it('keeps a HELD project — you are still chasing that consultant', async () => {
    holdsRef.current = [openHold('c1', 'hold'), openHold('p2', 'hold')];
    const result = await run();
    await waitFor(() =>
      expect(result.current.data.map((r) => r.task_id)).toEqual(['t1', 't2']),
    );
  });
});
