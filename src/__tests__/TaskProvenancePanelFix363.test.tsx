import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { TaskProvenanceRow } from '../lib/taskProvenance';
import detailEditorSrc from '../components/TaskDetailEditor.tsx?raw';
import permitDetailSrc from '../components/ProjectDetail/PermitDetailV2.tsx?raw';
import notificationsSrc from '../pages/Notifications.tsx?raw';

// ===========================================================================
// fix-363 §2 + §3 on screen — ONE component, THREE surfaces, THREE states
// ===========================================================================
//
// ★★ Bobby named all three surfaces: the notification, My Tasks, and the
// permit. "The same four facts told three ways will drift, and this is a
// codebase that has paid for that twice" — so the last describe below asserts
// ONE IMPORT from each surface rather than three implementations.
//
// ★★★ And the three STATES must differ structurally, not merely in their words.
// A reader has to be able to tell "Cam did this" from "a trigger did this" from
// "nobody wrote it down" at a glance, and a test has to be able to hold that
// apart from the sentence.

const state = vi.hoisted(() => ({
  rows: [] as TaskProvenanceRow[],
  loading: false,
  error: null as unknown,
  calls: [] as (string | null | undefined)[],
  enabled: [] as boolean[],
}));

vi.mock('../hooks/useTaskProvenance', () => ({
  useTaskProvenance: (taskId: string | null | undefined, enabled = true) => {
    state.calls.push(taskId);
    state.enabled.push(enabled);
    return {
      data: enabled ? state.rows : undefined,
      isLoading: enabled ? state.loading : false,
      error: enabled ? state.error : null,
    };
  },
  useTaskAssigners: () => ({ data: [], isLoading: false, error: null }),
}));

import TaskProvenance from '../components/TaskProvenance';

function row(over: Partial<TaskProvenanceRow>): TaskProvenanceRow {
  return {
    kind: 'created',
    at: '2026-08-12T09:00:00Z',
    actor_uid: null,
    actor_name: null,
    detail: null,
    auto_mark: null,
    ...over,
  };
}

function renderPanel(open = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const view = render(<TaskProvenance taskId="task-1" />, { wrapper });
  if (open) fireEvent.click(screen.getByTestId('task-provenance-button'));
  return view;
}

beforeEach(() => {
  state.rows = [];
  state.loading = false;
  state.error = null;
  state.calls = [];
  state.enabled = [];
});

// ---------------------------------------------------------------------------
// §3 — three states, three renderings
// ---------------------------------------------------------------------------

describe('fix-363 §3: the three states are structurally distinct', () => {
  it('★★★ each line carries its own state in the DOM, not just its wording', () => {
    state.rows = [
      row({ kind: 'created', actor_uid: 'u1', actor_name: 'Briana' }),
      row({ kind: 'coassigned', detail: 'Miles', auto_mark: 'dm_of_da' }),
      row({ kind: 'completed', at: '2026-08-19T09:00:00Z' }),
    ];
    renderPanel();

    const created = screen.getByTestId('task-provenance-created');
    const coassigned = screen.getByTestId('task-provenance-coassigned');
    const completed = screen.getByTestId('task-provenance-completed');

    // ★ Three different `data-state` values — asserted on the attribute rather
    // than on a colour, so the claim survives a repaint.
    expect(created.dataset.state).toBe('person');
    expect(coassigned.dataset.state).toBe('machine');
    expect(completed.dataset.state).toBe('unrecorded');
    expect(
      new Set([created.dataset.state, coassigned.dataset.state, completed.dataset.state])
        .size,
    ).toBe(3);

    // ★ …and three different treatments, so they do not look alike either.
    const colours = [created, coassigned, completed].map((el) => el.style.color);
    expect(new Set(colours).size).toBe(3);
  });

  it('★★★ "not recorded" never renders as a blank or as a name', () => {
    state.rows = [
      row({ kind: 'created', at: '2026-06-01T12:00:00Z' }),
      row({ kind: 'completed', at: '2026-07-04T12:00:00Z' }),
    ];
    renderPanel();
    for (const kind of ['created', 'completed']) {
      const el = screen.getByTestId(`task-provenance-${kind}`);
      expect(el.textContent?.trim()).not.toBe('');
      expect(el.textContent).toMatch(/who is not recorded/);
      expect(el.textContent).not.toMatch(/unknown/i);
    }
  });

  it('★★ a pre-audit task still shows WHEN — the gap is only the WHO', () => {
    // The real shape of 636 tasks: created before capture began on 2026-08-04.
    state.rows = [row({ kind: 'created', at: '2026-06-01T12:00:00Z' })];
    renderPanel();
    expect(screen.getByTestId('task-provenance-created').textContent).toBe(
      'Created Jun 01, 2026 · who is not recorded',
    );
  });

  it('★★ a FAILED READ is not a gap in the record, and does not say it is', () => {
    // "Not recorded" is a claim about history; this is a claim about the
    // network. Rendering the second as the first would be the tool lying about
    // what it knows.
    state.error = new Error('offline');
    renderPanel();
    expect(screen.getByTestId('task-provenance-error').textContent).toContain(
      'could not be loaded',
    );
    expect(screen.queryByTestId('task-provenance-lines')).toBeNull();
    expect(screen.queryByText(/who is not recorded/)).toBeNull();
  });

  it('★ a task with no history at all says so, rather than rendering nothing', () => {
    state.rows = [];
    renderPanel();
    expect(screen.getByTestId('task-provenance-empty')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// §4 — where the panel lives
// ---------------------------------------------------------------------------

describe('fix-363 §4: a popover, and it costs nothing until it is opened', () => {
  it('★★ the query does not run until somebody asks', () => {
    // "Not always-on — this is reference information someone wants
    // occasionally." Four more lines on every task row would bury the work
    // itself, and 1,361 queries to render a board would be worse still.
    renderPanel(false);
    expect(state.enabled.every((e) => e === false)).toBe(true);
    expect(screen.queryByTestId('task-provenance-panel')).toBeNull();

    fireEvent.click(screen.getByTestId('task-provenance-button'));
    expect(state.enabled.some((e) => e === true)).toBe(true);
    expect(screen.getByTestId('task-provenance-panel')).toBeInTheDocument();
  });

  it('★ it closes again, and asks for the task it was given', () => {
    renderPanel();
    expect(state.calls.every((c) => c === 'task-1')).toBe(true);
    fireEvent.click(screen.getByTestId('task-provenance-button'));
    expect(screen.queryByTestId('task-provenance-panel')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §2 — one component, three surfaces
// ---------------------------------------------------------------------------

describe('fix-363 §2: ONE component, rendered in three places', () => {
  it('★★★ all three surfaces IMPORT it — none of them reimplements it', () => {
    // The requirement, asserted the only way that means anything: three imports
    // of one module, not three displays of four facts.
    const surfaces: [string, string][] = [
      ['My Tasks / My Board detail pane', detailEditorSrc],
      ['the permit task bar', permitDetailSrc],
      ['the notification centre', notificationsSrc],
    ];
    for (const [, src] of surfaces) {
      expect(src).toMatch(/import TaskProvenance from '[^']*TaskProvenance'/);
      expect(src).toMatch(/<TaskProvenance\s/);
    }
  });

  it('★★★ …and none of them builds a provenance sentence of its own', () => {
    // If a surface ever composes these words itself, the three tellings drift —
    // which is the failure fix-298 Phase 2 spent a ticket collapsing.
    for (const src of [detailEditorSrc, permitDetailSrc, notificationsSrc]) {
      const code = src
        .split(String.fromCharCode(10))
        .map((l) => (l.includes('//') ? l.slice(0, l.indexOf('//')) : l))
        .join(String.fromCharCode(10))
        .replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code).not.toMatch(/who is not recorded/);
      expect(code).not.toMatch(/Closed automatically/);
      expect(code).not.toMatch(/provenanceLine|buildProvenance/);
    }
  });

  it('★ the notification offers it only where there IS a task to ask about', () => {
    // A status flip has no assignee and no creator to go and talk to.
    expect(notificationsSrc).toMatch(/i\.source === 'task' \|\| i\.source === 'auto_closed'/);
    expect(notificationsSrc).toMatch(/i\.target\?\.kind === 'task'/);
  });
});
