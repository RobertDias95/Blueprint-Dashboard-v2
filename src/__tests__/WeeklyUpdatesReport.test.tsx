import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { Note } from '../lib/database.types';

// fix-notes-3: Weekly Updates report — grouped, editable notes with write-back
// through the fix-notes-1 hooks (single source public.notes).

const T = 'test-tenant-uuid';

const fixtures = vi.hoisted(() => ({
  projects: [
    { id: 'p1', address: '100 Apple Way', juris: 'Seattle', archived: false, permit_order: [20, 10] },
    { id: 'p2', address: '200 Birch Rd', juris: 'Bellevue', archived: false, permit_order: null },
    { id: 'p3', address: '300 Cedar Ct', juris: 'Seattle', archived: true, permit_order: null }, // archived → excluded
  ],
  permits: [
    { id: 10, project_id: 'p1', type: 'Demolition', num: 'DEM-10', nickname: null, struct_address: null },
    { id: 20, project_id: 'p1', type: 'Building Permit', num: 'BP-20', nickname: 'Bldg A', struct_address: null },
    { id: 30, project_id: 'p2', type: 'Building Permit', num: null, nickname: null, struct_address: null },
  ],
  // bp_list_all_notes returns newest-first (created_at DESC).
  notes: [
    note({ id: 'n-p1-h2', project_id: 'p1', permit_id: null, body: 'Holistic newer', created_at: '2026-07-16T10:00:00Z' }),
    note({ id: 'n-p1-h1', project_id: 'p1', permit_id: null, body: 'Holistic older', created_at: '2026-07-10T10:00:00Z' }),
    note({ id: 'n-p1-20', project_id: 'p1', permit_id: 20, body: 'BP permit note', created_at: '2026-07-15T10:00:00Z' }),
    note({ id: 'n-p1-10done', project_id: 'p1', permit_id: 10, body: 'Demo done note', completed: true, completed_at: '2026-07-14T10:00:00Z', created_at: '2026-07-12T10:00:00Z' }),
    // p2 has no notes → only surfaces when "only with notes" is OFF
  ],
}));

function note(over: Partial<Note>): Note {
  return {
    id: 'n',
    project_id: 'p1',
    permit_id: null,
    body: 'body',
    completed: false,
    completed_at: null,
    created_by: 'u1',
    author_name: 'Bobby',
    created_at: '2026-07-15T10:00:00Z',
    updated_at: '2026-07-15T10:00:00Z',
    ...over,
  };
}

const mocks = vi.hoisted(() => {
  const insertFn = vi.fn();
  const updateFn = vi.fn();
  const eqFn = vi.fn();
  let allNotes: unknown[] = [];
  const builder = {
    rpc: (name: string) => {
      if (name === 'bp_list_all_notes') return Promise.resolve({ data: allNotes, error: null });
      return Promise.resolve({ data: [], error: null });
    },
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        insertFn(row);
        return {
          select: () => ({
            single: () =>
              Promise.resolve({ data: { id: 'created-note-id' }, error: null }),
          }),
        };
      },
      update: (patch: Record<string, unknown>) => ({
        eq: (col: string, val: string) => {
          updateFn(patch);
          eqFn(col, val);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };
  return { builder, insertFn, updateFn, eqFn, setAllNotes: (n: unknown[]) => { allNotes = n; } };
});

vi.mock('../lib/supabase', () => ({ supabase: mocks.builder }));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: fixtures.projects, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: fixtures.permits, isLoading: false, error: null, refetch: vi.fn() }),
}));

// fix-264: cancelled projects leave the Monday pass. Partial mock so the real
// cancelledProjectIds runs over a settable holds list.
const holdsData = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock('../hooks/useProjectHolds', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useProjectHolds')>();
  return {
    ...actual,
    useAllProjectHolds: () => ({
      data: holdsData.current,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});

import WeeklyUpdatesReport from '../pages/WeeklyUpdatesReport';

/** An OPEN project_holds row of either kind. */
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

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<WeeklyUpdatesReport />, { wrapper });
}

beforeEach(() => {
  mocks.insertFn.mockClear();
  mocks.updateFn.mockClear();
  mocks.eqFn.mockClear();
  mocks.setAllNotes(fixtures.notes);
  holdsData.current = [];
  useAuthStore.setState({ activeTenantId: T, memberships: [{ tenant_id: T, role: 'admin' }] });
});

// fix-264: cancelled = nothing moving = off the Monday pass. Hold ≠ cancel.
describe('WeeklyUpdatesReport — cancelled projects (fix-264)', () => {
  it('hides a CANCELLED project and keeps a HELD one', async () => {
    holdsData.current = [openHold('p1', 'cancelled'), openHold('p2', 'hold')];
    renderIt();
    await screen.findByTestId('weekly-updates-project-p2');
    expect(screen.queryByTestId('weekly-updates-project-p1')).toBeNull();
  });

  it('brings the project back once the cancel is lifted', async () => {
    holdsData.current = [{ ...openHold('p1', 'cancelled'), hold_end: '2026-07-20' }];
    renderIt();
    await screen.findByTestId('weekly-updates-project-p1');
  });
});

describe('WeeklyUpdatesReport grouping', () => {
  it('groups by project, excludes archived, and shows holistic + permit scopes', async () => {
    renderIt();
    await screen.findByTestId('weekly-updates-project-p1');
    expect(screen.getByTestId('weekly-updates-project-p2')).toBeTruthy();
    // archived project excluded
    expect(screen.queryByTestId('weekly-updates-project-p3')).toBeNull();
    // holistic scope + each permit scope present on p1
    expect(screen.getByTestId('wu-scope-project-p1')).toBeTruthy();
    expect(screen.getByTestId('wu-scope-permit-20')).toBeTruthy();
    expect(screen.getByTestId('wu-scope-permit-10')).toBeTruthy();
  });

  it('orders permits by permit_order (20 before 10)', async () => {
    renderIt();
    await screen.findByTestId('weekly-updates-project-p1');
    const html = document.body.innerHTML;
    expect(html.indexOf('wu-scope-permit-20')).toBeLessThan(
      html.indexOf('wu-scope-permit-10'),
    );
  });

  it('holistic active notes are newest-first', async () => {
    renderIt();
    const scope = await screen.findByTestId('wu-scope-project-p1-active');
    const bodies = within(scope).getAllByTestId(/^note-body-/).map((el) => el.textContent);
    expect(bodies).toEqual(['Holistic newer', 'Holistic older']);
  });

  it('completed notes stay out of the active list, behind the history toggle', async () => {
    renderIt();
    await screen.findByTestId('wu-scope-permit-10');
    // the demo permit note is completed → not in active
    expect(screen.queryByTestId('note-body-n-p1-10done')).toBeNull();
    const toggle = screen.getByTestId('wu-scope-permit-10-history-toggle');
    expect(toggle.textContent).toContain('(1)');
    fireEvent.click(toggle);
    expect(screen.getByTestId('note-body-n-p1-10done')).toBeTruthy();
  });

  it('"only projects with active notes" hides note-less projects', async () => {
    renderIt();
    await screen.findByTestId('weekly-updates-project-p2');
    fireEvent.click(screen.getByTestId('weekly-updates-only-with-notes'));
    expect(screen.getByTestId('weekly-updates-project-p1')).toBeTruthy();
    // p2 has no notes → hidden
    expect(screen.queryByTestId('weekly-updates-project-p2')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ★★★ fix-570 (P-275) — THE WRITE-BACK BLOCK THAT USED TO LIVE HERE
// ═══════════════════════════════════════════════════════════════════════════
//
// Four tests stood here: adding a holistic note, adding a permit note,
// editing a body, and marking one complete. Every one of them exercised a
// control this ticket removed — Bobby's 2026-09-15 ruling, option 1:
// *"remove the permit level note, we only need a tasks level note."*
//
// ★★ THEY ARE DELETED, NOT SKIPPED. A skipped test for a control that cannot
//    come back is a reader's puzzle. What replaces them is the assertion the
//    ruling actually needs — that no such control renders — and it lives in
//    `ReportStopsWritingFix570` beside the rest of the census.

describe('WeeklyUpdatesReport — fix-570: it reads, it does not write', () => {
  it('★★★ NO add-note box renders in any scope', async () => {
    renderIt();
    await screen.findByTestId('wu-scope-project-p1');
    // ★ The add box carried `${testid}-add`. Asserted per scope rather than
    //   once, because there used to be one for the project and one per permit.
    expect(screen.queryByTestId('wu-scope-project-p1-add')).toBeNull();
    expect(screen.queryByTestId('wu-scope-permit-20-add')).toBeNull();
    expect(screen.queryByTestId('wu-scope-permit-10-add')).toBeNull();
  });

  it('★★★ a note body is NOT click-to-edit any more', async () => {
    renderIt();
    const body = await screen.findByTestId('note-body-n-p1-20');
    fireEvent.click(body);
    // ★★ The editor never appears, and — the load-bearing half — nothing is
    //    written. A click that silently did nothing but still called the
    //    mutation would pass a "no textarea" assertion on its own.
    expect(screen.queryByTestId('note-edit-n-p1-20')).toBeNull();
    expect(mocks.updateFn).not.toHaveBeenCalled();
  });

  it('★★★ the completion box is a MARKER, not a button', async () => {
    renderIt();
    await screen.findByTestId('note-row-n-p1-20');
    const marker = screen.getByTestId('note-complete-n-p1-20');
    // ★ It still SHOWS whether the note was done — that is information, and
    //   the read path keeps it. It just cannot be pressed.
    expect(marker.tagName).toBe('SPAN');
    fireEvent.click(marker);
    expect(mocks.updateFn).not.toHaveBeenCalled();
  });

  it('★★★ nothing in the report writes to `notes` at all', async () => {
    // ★★★ THE WHOLE-SURFACE ASSERTION. The three above name the controls that
    //     existed; this one catches a fourth nobody remembered, by watching the
    //     supabase client rather than the DOM.
    renderIt();
    await screen.findByTestId('wu-scope-project-p1');
    for (const el of document.querySelectorAll('button, [data-testid]')) {
      fireEvent.click(el);
    }
    expect(mocks.insertFn).not.toHaveBeenCalled();
    expect(mocks.updateFn).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ★★★ §C — THE EMPTIED REGION SAYS WHERE THE NOTES WENT
// ═══════════════════════════════════════════════════════════════════════════

describe('WeeklyUpdatesReport — fix-570 §C: the empty state', () => {
  it('★★★ a project with NO notes renders the sentence, not a blank panel', async () => {
    // p2 has no notes in the fixtures — which is what EVERY project looks like
    // on prod, where `public.notes` has held 0 rows since fix-559.
    renderIt();
    const moved = await screen.findByTestId('weekly-updates-moved-p2');
    expect(moved.textContent).toContain('General channel');
    expect(moved.textContent).toContain('lives on the task');
  });

  it('★★★ …and it does NOT link anywhere — §C forbids re-pointing', async () => {
    // ⚠️ §C: *"Do not re-point the reader at chat or at task notes. That is a
    //    product decision nobody has made."* It says where to look. It does not
    //    go and get them.
    renderIt();
    const moved = await screen.findByTestId('weekly-updates-moved-p2');
    expect(moved.querySelector('a')).toBeNull();
    expect(moved.querySelector('button')).toBeNull();
  });

  it('★★★ a project WITH notes still renders its scopes, unchanged', async () => {
    // ★★ The guard on the collapse. The empty state replaces the scopes only
    //    when the whole group is empty — the read path is otherwise untouched,
    //    which is what the ruling protects.
    renderIt();
    await screen.findByTestId('wu-scope-project-p1');
    expect(screen.getByTestId('wu-scope-permit-20')).toBeTruthy();
    expect(screen.queryByTestId('weekly-updates-moved-p1')).toBeNull();
  });
});
