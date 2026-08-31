import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SNAPSHOT_COLUMNS,
  SNAPSHOT_MIN_WIDTH_PX,
  SNAPSHOT_SECTIONS,
  TINT_HOT_DAYS,
  TINT_WARN_DAYS,
  ageTone,
  backlogBreakdown,
  type SnapshotRow,
} from '../lib/weeklySnapshot';

// ===========================================================================
// ★★★ fix-465 (P-114 + P-115) — THE AGENDA BECOMES READABLE, AND PRESENT
// ===========================================================================
//
// Two complaints, one screen:
//
//   P-114  the five snapshot tables do not line up with each other, and the
//          data in them is too faint to read.
//   P-115  the Weekly Update modal — the screen the whole meeting is looking
//          at on a Wednesday morning — does not contain the agenda.
//
// ★★★ THE MOCK WINS ON APPEARANCE, THE BRIEF WINS ON MECHANISM, and this file
// records the three places where that mattered:
//   · the mock's own tab ink measures 4.24:1 (§B4 below)
//   · the mock's own age column truncates its own header (§A3 below)
//   · the mock's per-row urgency tones are not a function (§B3 below)
// In each case the shape is the mock's and the numbers are measured.

// ---------------------------------------------------------------------------
// ★★★ §A — ONE GRID ACROSS FIVE SECTIONS
// ---------------------------------------------------------------------------
describe('fix-465 §A — the five sections share one set of column boundaries', () => {
  it('★★★ the widths are stated ONCE and total exactly 100%', () => {
    // ★ 0d: `SnapshotSection` was already the only component rendering all
    //   five, so this is not de-duplication — it is the widths EXISTING at
    //   all. Before this ticket the table had no `table-layout` and no
    //   `<col>`, so each section auto-sized to its own three rows.
    const total = SNAPSHOT_COLUMNS.reduce((n, c) => n + c.width, 0);
    expect(total).toBe(100);
    expect(SNAPSHOT_COLUMNS).toHaveLength(8);
  });

  it('★★★ the eight columns are the eight SORT KEYS — neither list can grow alone', () => {
    // The point of putting the widths beside the sort keys: adding a column
    // to one and not the other now fails here rather than rendering a table
    // with seven headers over eight cells.
    expect(SNAPSHOT_COLUMNS.map((c) => c.key)).toEqual([
      'address',
      'num',
      'type',
      'ent_lead',
      'da',
      'on_date',
      'age_days',
      'status',
    ]);
  });

  it('★★ exactly TWO columns are named by the section, not by the column', () => {
    // `on_date` and `age_days` take their label from the SectionSpec — that
    // is the only per-section variation §A permits, and it is why those two
    // headers are the ones that must never truncate.
    const unlabelled = SNAPSHOT_COLUMNS.filter((c) => c.label === undefined);
    expect(unlabelled.map((c) => c.key)).toEqual(['on_date', 'age_days']);
    for (const s of SNAPSHOT_SECTIONS) {
      expect(s.dateLabel.length).toBeGreaterThan(0);
      expect(s.ageLabel.length).toBeGreaterThan(0);
    }
  });

  it('★★★ §A3 — THE MEASUREMENT IS COMMITTED, and it disagrees with the brief', () => {
    // The gauntlet: "if you build a harness to measure anything, COMMIT IT."
    // This asserts the harness exists, that it measures the real worst case
    // taken from prod, and — the part that matters — that the numbers this
    // file pins are the ones the harness was last run with. A harness whose
    // candidate list has drifted from the shipped list measures nothing.
    const harness = readFileSync(
      resolve(process.cwd(), 'harness/snapshot-widths.html'),
      'utf8',
    );
    const m = harness.match(/const CANDIDATE = \[([^\]]+)\]/);
    expect(m, 'harness has no CANDIDATE list').toBeTruthy();
    const measured = m![1]!.split(',').map((n) => Number(n.trim()));
    expect(measured).toEqual(SNAPSHOT_COLUMNS.map((c) => c.width));

    // ★ The worst-case strings are the ones measured on prod 2026-08-31, not
    //   the mock's samples. If somebody softens these the measurement stops
    //   being about the data this report actually shows.
    expect(harness).toContain('1515 Martin Luther King Jr Way'); // 30 chars
    expect(harness).toContain('SPUE-IPR-26-00004'); // 17 — the brief predicted this shape
    expect(harness).toContain('Approved - Additional Information'); // 33
    expect(harness).toContain('Corrections issued'); // the longest HEADER

    // ★★★ AND THE BRIEF'S PROPOSAL IS RECORDED AS SUPERSEDED, NOT DELETED.
    //     19/15/11/9/9/12/8/17 truncated four columns at the modal's 1076px.
    expect(harness).toContain('[19, 15, 11, 9, 9, 12, 8, 17]');
    expect(SNAPSHOT_COLUMNS.map((c) => c.width)).not.toEqual([
      19, 15, 11, 9, 9, 12, 8, 17,
    ]);
  });

  it('★★★ §A3 RULE 1 — the section-named columns are the WIDER of the two changes', () => {
    // The rule that drove the redistribution: no header ever truncates. The
    // two headers that were short are the two the section names, and both
    // grew. Stated as a property rather than as four literals, so it survives
    // a re-measure that moves the numbers but keeps the rule.
    const w = (k: string) => SNAPSHOT_COLUMNS.find((c) => c.key === k)!.width;
    expect(w('on_date')).toBeGreaterThan(12); // brief said 12, header needed more
    expect(w('age_days')).toBeGreaterThan(8); // brief said 8; short at 1204 too
    // …paid for by the three that measured spare.
    expect(w('num')).toBeLessThan(15);
    expect(w('ent_lead')).toBeLessThan(9);
    expect(w('da')).toBeLessThan(9);
  });

  it('★★ the min width is DERIVED from the binding header, not picked', () => {
    // "Corrections issued" needs 135px inside a 13% column → 135 / 0.13.
    const dateCol = SNAPSHOT_COLUMNS.find((c) => c.key === 'on_date')!;
    const implied = Math.round(135 / (dateCol.width / 100));
    expect(SNAPSHOT_MIN_WIDTH_PX).toBeGreaterThanOrEqual(implied - 10);
    expect(SNAPSHOT_MIN_WIDTH_PX).toBeLessThanOrEqual(implied + 20);
  });
});

// ---------------------------------------------------------------------------
// ★★★ §B4 — CONTRAST, COMPUTED FROM THE REAL TOKENS
// ---------------------------------------------------------------------------
// fix-406's method, and its exact functions: relative luminance and a WCAG
// ratio, both computed here from the hexes `src/index.css` actually declares.
// Asserting a hex would pin the wrong thing — the claim is not "the ink is
// #5a6a85", it is "whatever the ink is, it clears 4.5:1 on the surface it
// SITS ON". Those are different assertions and only the second is the ticket.

function tokens(): Record<string, string> {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
  const out: Record<string, string> = {};
  for (const [, name, hex] of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) {
    if (!(name in out)) out[name] = hex.toLowerCase(); // first wins = the :root light value
  }
  return out;
}

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

describe('fix-465 §B4 — every ink clears 4.5:1 on the surface it actually sits on', () => {
  const T = tokens();

  it('★ the parse found real tokens (fix-406: an empty read passes everything)', () => {
    // ★★★ THE TRAP fix-406 RECORDED: a `?raw` CSS import is EMPTY under
    //     vitest, and an empty stylesheet makes every contrast assertion below
    //     vacuously true. This reads from disk and proves the read worked.
    expect(Object.keys(T).length).toBeGreaterThan(20);
    for (const k of ['bg', 'surface', 's2', 's3', 'text', 'muted', 'dim', 'de', 'er', 'wa']) {
      expect(T[k], `token --color-${k} not found`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('★★★ THE DEFECT, AS A NUMBER: --color-dim fails on white, which is why it is gone', () => {
    // Every data cell in every one of the five tables was this colour.
    expect(contrast(T.dim!, T.surface!)).toBeLessThan(4.5); // 2.82:1
    // …and it is worse on the header bar, which is where the column headers
    // and the toggle button used to sit.
    expect(contrast(T.dim!, T.s3!)).toBeLessThan(3); // 2.18:1
  });

  it('★★★ the two data inks clear the floor on white', () => {
    expect(contrast(T.text!, T.surface!)).toBeGreaterThanOrEqual(4.5); // 15.19:1
    expect(contrast(T.muted!, T.surface!)).toBeGreaterThanOrEqual(4.5); // 5.48:1
  });

  it('★★★ the section title and the tabs clear it on the s3 BAR, not on white', () => {
    // The surface is the point. `--color-muted` passes on white and FAILS
    // here — 4.24:1 — which is exactly the mock's unselected tab and exactly
    // the ink the old toggle button used on this bar.
    expect(contrast(T.muted!, T.s3!)).toBeLessThan(4.5);
    // So both the title and the unselected tab use `--color-text` instead.
    expect(contrast(T.text!, T.s3!)).toBeGreaterThanOrEqual(4.5); // 11.75:1
    // …and the selected tab is the inversion, white on `--color-text`.
    expect(contrast(T.surface!, T.text!)).toBeGreaterThanOrEqual(4.5);
  });

  it('★★★ THE WARN INK IS NOT --color-co, AND THE MEASUREMENT IS WHY', () => {
    // ★★ The obvious choice for "warn" is the Corrections orange. It measures
    //    3.19:1 on white — it would have failed the very floor this ticket
    //    exists to raise. fix-406 hit this exact wall and pinned `--color-wa`
    //    to a darker amber; this reuses that ink rather than adding a second.
    expect(contrast(T.co!, T.surface!)).toBeLessThan(4.5);
    expect(contrast(T.wa!, T.surface!)).toBeGreaterThanOrEqual(4.5); // 5.56:1
    expect(contrast(T.er!, T.surface!)).toBeGreaterThanOrEqual(4.5); // 4.83:1
    // The address link, unchanged, on white.
    expect(contrast(T.de!, T.surface!)).toBeGreaterThanOrEqual(4.5); // 5.17:1
  });

  it('★★ the backlog note clears it on its own half-step surface', () => {
    // It sits on `--color-s2` so it reads as a note about the table rather
    // than a ninth row of it — which changes the surface, and so the check.
    expect(contrast(T.muted!, T.s2!)).toBeGreaterThanOrEqual(4.5); // 4.65:1
  });
});

// ---------------------------------------------------------------------------
// ★★★ §B3 — THE URGENCY TINT
// ---------------------------------------------------------------------------
describe('fix-465 §B3 — the tint is derived, and it reuses the thresholds already here', () => {
  it('★★★ 30 and 90 are the SAME numbers the backlog sentence states', () => {
    // Not new numbers. `backlogBreakdown` already tells the reader "over a
    // month … over three months" using exactly these, so the colour of a
    // figure and the sentence beneath it cannot disagree.
    expect(TINT_WARN_DAYS).toBe(30);
    expect(TINT_HOT_DAYS).toBe(90);

    const rows = [1, 31, 91, 400].map(
      (d) => ({ bucket: 'b', age_days: d }) as SnapshotRow,
    );
    const b = backlogBreakdown(rows);
    // The three rows the sentence counts as "over a month" are exactly the
    // three rows the tint colours.
    expect(b.overMonth).toBe(3);
    expect(rows.filter((r) => ageTone('b', r.age_days) !== null)).toHaveLength(3);
    expect(b.overQuarter).toBe(2);
    expect(rows.filter((r) => ageTone('b', r.age_days) === 'hot')).toHaveLength(2);
  });

  it('★★★ SECTION A IS NEVER TINTED — its number counts DOWN, it is not an overrun', () => {
    // "Due in 14" is not lateness. Painting a fortnight's notice the same red
    // as a permit 1,126 days past due teaches the reader to ignore the colour.
    expect(ageTone('a', 400)).toBeNull();
    expect(ageTone('a', 1)).toBeNull();
    // …while the same figure in any elapsed section is tinted.
    for (const k of ['b', 'c', 'd', 'e'] as const) {
      expect(ageTone(k, 400)).toBe('hot');
    }
  });

  it('★★ the boundaries are exclusive, matching backlogBreakdown exactly', () => {
    expect(ageTone('b', 30)).toBeNull();
    expect(ageTone('b', 31)).toBe('warn');
    expect(ageTone('b', 90)).toBe('warn');
    expect(ageTone('b', 91)).toBe('hot');
  });

  it('★ a missing age is not an urgent one', () => {
    expect(ageTone('b', null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The rendered section
// ---------------------------------------------------------------------------
function row(over: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    bucket: 'b',
    permit_id: 1,
    project_id: 'p-1',
    address: '1515 Martin Luther King Jr Way',
    num: 'SPUE-IPR-26-00004',
    type: 'Grading / Clearing',
    ent_lead: 'Miles',
    da: 'Francesca',
    status: 'Approved - Additional Information',
    on_date: '2026-02-18',
    age_days: 194,
    ...over,
  };
}

import SnapshotSection from '../components/WeeklyUpdate/SnapshotSection';

function renderSection(rows: SnapshotRow[], specKey: 'a' | 'b' = 'b') {
  const spec = SNAPSHOT_SECTIONS.find((s) => s.key === specKey)!;
  return render(
    <MemoryRouter>
      <SnapshotSection spec={spec} rows={rows} />
    </MemoryRouter>,
  );
}

describe('fix-465 §A/§B/§C — the rendered section', () => {
  it('★★★ §A1: the table is FIXED and carries one colgroup from the constant', () => {
    // This is the ticket. Without `table-fixed` the five sections each
    // auto-size to their own rows and no two line up.
    const { container } = renderSection([row()]);
    const table = screen.getByTestId('snapshot-b-table');
    expect(table.className).toContain('table-fixed');

    const cols = container.querySelectorAll('colgroup col');
    expect(cols).toHaveLength(8);
    cols.forEach((c, i) => {
      expect((c as HTMLElement).style.width).toBe(`${SNAPSHOT_COLUMNS[i]!.width}%`);
      expect(c.getAttribute('data-col')).toBe(SNAPSHOT_COLUMNS[i]!.key);
    });
  });

  it('★★★ EVERY section renders the SAME widths — the property being bought', () => {
    // Rendered per section rather than asserted once on the constant: the
    // failure this prevents is a section that overrides a width.
    const seen = new Set<string>();
    for (const spec of SNAPSHOT_SECTIONS) {
      const { container, unmount } = render(
        <MemoryRouter>
          <SnapshotSection spec={spec} rows={[row({ bucket: spec.key })]} />
        </MemoryRouter>,
      );
      seen.add(
        Array.from(container.querySelectorAll('colgroup col'))
          .map((c) => (c as HTMLElement).style.width)
          .join('|'),
      );
      unmount();
    }
    expect(seen.size).toBe(1);
  });

  it('★★★ §B2: NO cell anywhere renders in --color-dim', () => {
    // The complaint, as an assertion over the whole rendered section rather
    // than over a list of cells somebody has to remember to extend.
    const { container } = renderSection([row(), row({ permit_id: 2 })]);
    const html = container.innerHTML;
    expect(html).not.toContain('--color-dim');
    expect(html).not.toContain('text-dim');
  });

  it('★★ §B2: the identifying columns are full strength, the describing ones step back', () => {
    renderSection([row()]);
    const num = screen.getByTestId('snapshot-b-cell-1-num');
    const type = screen.getByTestId('snapshot-b-cell-1-type');
    // `num` is soft, `address` is a link in `--color-de`, and `type` is soft.
    expect(num.style.color).toBe('var(--color-muted)');
    expect(type.style.color).toBe('var(--color-muted)');
    const link = screen.getByTestId('snapshot-b-open-1');
    expect(link.style.color).toBe('var(--color-de)');
  });

  it('★★ §B4: a row with NO project id is not a fainter row — it is only not a link', () => {
    // It used to be `text-dim`, which said "ignore me" about a permit that
    // may be the most urgent in the section.
    renderSection([row({ project_id: null })]);
    expect(screen.queryByTestId('snapshot-b-open-1')).toBeNull();
    const cell = screen.getByTestId('snapshot-b-cell-1-address');
    expect(cell.textContent).toContain('1515 Martin Luther King Jr Way');
    expect(cell.innerHTML).not.toContain('--color-dim');
  });

  it('★★★ §B3 rendered: the age cell carries a tone, and section A carries none', () => {
    renderSection([row({ age_days: 194 })]);
    expect(screen.getByTestId('snapshot-b-cell-1-age_days').getAttribute('data-tone')).toBe(
      'hot',
    );

    const { unmount } = renderSection([row({ age_days: 40, permit_id: 2 })]);
    expect(screen.getByTestId('snapshot-b-cell-2-age_days').getAttribute('data-tone')).toBe(
      'warn',
    );
    unmount();

    // Section A: the same magnitude, no tint.
    renderSection([row({ bucket: 'a', permit_id: 3, age_days: 400 })], 'a');
    expect(screen.getByTestId('snapshot-a-cell-3-age_days').getAttribute('data-tone')).toBeNull();
  });

  it('★★ the age column is right-aligned with tabular figures, in every section', () => {
    // 9 must sit under the 3 of 103, or the column is decoration.
    renderSection([row()]);
    const cell = screen.getByTestId('snapshot-b-cell-1-age_days');
    expect(cell.className).toContain('text-right');
    expect(cell.className).toContain('tabular-nums');
    expect(screen.getByTestId('snapshot-b-th-age_days').className).toContain('text-right');
  });

  it('★★★ §C: the count chip is GONE and the total is still stated', () => {
    // Removing a number is only safe if the number survives. "Show all 3"
    // is the same figure, in the control that already had the job.
    renderSection([row(), row({ permit_id: 2 }), row({ permit_id: 3 })]);
    expect(screen.queryByTestId('snapshot-b-count')).toBeNull();
    expect(screen.getByTestId('snapshot-b-toggle').textContent).toBe('Show all 3');
    expect(screen.getByTestId('snapshot-b-title').textContent).toBe(
      'Intake past due, still not submitted',
    );
  });

  it('★ §A5 survives §C — searching still reports "n of N"', () => {
    // The chip's removal must not take the search counter with it: that one
    // says something the toggle does not.
    renderSection([row(), row({ permit_id: 2, address: '1 Elsewhere Ave' })]);
    fireEvent.change(screen.getByTestId('snapshot-b-search'), {
      target: { value: 'Elsewhere' },
    });
    expect(screen.getByTestId('snapshot-b-hits').textContent).toBe('1 of 2 shown');
  });
});

// ---------------------------------------------------------------------------
// ★★★ §D — THE AGENDA IS IN THE WEEKLY UPDATE
// ---------------------------------------------------------------------------
const agendaState = vi.hoisted(() => ({
  tasks: [] as unknown[],
  isMember: true,
  isAdmin: false,
}));

// ★★★ THE PARTIAL-MOCK TRAP, and it is worth naming again because this is the
// SEVENTH occurrence in this repo's history. Replacing `useTaskTree` wholesale
// removes `useUpsertTask` — which `TaskCard` reaches for through
// `useSetTaskStatus` — and the failure reads as "useUpsertTask is not a
// function" three files away from the mock that caused it. `importOriginal`
// keeps every other member and overrides exactly the one this suite steers.
vi.mock('../hooks/useTaskTree', async (imp) => {
  const actual = await imp<typeof import('../hooks/useTaskTree')>();
  return {
    ...actual,
    useAllTasks: () => ({ data: agendaState.tasks, isLoading: false }),
  };
});
// ★ No network: TaskCard's real write path is mounted (that is the point — it
//   is the SAME row My Tasks renders), it is simply never fired here.
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: [], error: null }),
    from: () => ({
      select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
    }),
  },
}));
vi.mock('../hooks/useAgendaMember', () => ({
  useIsAgendaMember: () => agendaState.isMember,
  useAgendaMemberNames: () => ['Bobby', 'Briana'],
  useSetAgendaMember: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useIsTenantAdmin', () => ({
  useIsTenantAdmin: () => agendaState.isAdmin,
}));
vi.mock('../hooks/useTeamMembers', async (imp) => {
  const actual = await imp<typeof import('../hooks/useTeamMembers')>();
  return {
    ...actual,
    useTeamMembers: () => ({
      all: ['Bobby', 'Briana'],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});
vi.mock('../hooks/useTeamTasks', async (imp) => {
  const actual = await imp<typeof import('../hooks/useTeamTasks')>();
  return {
    ...actual,
    useUpsertTeamTask: () => ({ mutate: vi.fn(), isPending: false }),
  };
});
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useWeeklySnapshot', () => ({
  useWeeklySnapshot: () => ({ data: { today: '2026-09-02', rows: [] }, isLoading: false }),
}));
vi.mock('../hooks/useVendorReportState', () => ({
  useVendorReportState: () => ({ data: [] }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: {} }),
  readAppConfigStringArray: () => [],
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import WeeklyUpdate from '../components/WeeklyUpdate/WeeklyUpdate';
import AgendaPage from '../pages/Agenda';

/** ★ TaskCard mounts the real optimistic-status stack (fix-434), so these
 *  renders need a query client. That is the assertion, not the scaffolding:
 *  the agenda row in the modal IS the My Tasks row, wiring included. */
function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

function task(over: Record<string, unknown> = {}) {
  return {
    id: 't-1',
    title: 'Talk about the Densmore fee',
    // ★ The flag is `agenda` and the split is the TASK STATUS (fix-462) —
    //   'Open' is live, 'Resolved' is not. No agenda status exists.
    status: 'Open',
    agenda: true,
    assigned_to: 'Bobby',
    discipline: 'ent',
    target_date: null,
    created_at: '2026-08-01T00:00:00Z',
    done_at: null,
    kind: 'team',
    priority: false,
    ...over,
  };
}

beforeEach(() => {
  agendaState.tasks = [];
  agendaState.isMember = true;
  agendaState.isAdmin = false;
});

describe('fix-465 §D — the Weekly Update contains the agenda', () => {
  it('★★★ THE DEFECT: the shared report renders the agenda block AT ALL', () => {
    // fix-463's own header comment said the agenda was "rendered by the
    // Agenda page around this". The modal renders this component and nothing
    // else, so the one screen the meeting looks at had no agenda on it.
    render(
      wrap(<WeeklyUpdate surface="modal" />),
    );
    expect(screen.getByTestId('agenda-block')).toBeTruthy();
    expect(screen.getByTestId('agenda-tabs')).toBeTruthy();
  });

  it('★★★ §D5: the order is AGENDA → SNAPSHOT → SSS, and it is the same order on both', () => {
    // The meeting opens with what people want to talk about; the numbers are
    // what they consult while talking about it.
    for (const surface of ['page', 'modal'] as const) {
      const { container, unmount } = render(
        wrap(<WeeklyUpdate surface={surface} />),
      );
      const html = container.innerHTML;
      const agenda = html.indexOf('agenda-block');
      const snapshot = html.indexOf('snapshot-a');
      const sss = html.indexOf("Consultant report");
      expect(agenda).toBeGreaterThan(-1);
      expect(agenda).toBeLessThan(snapshot);
      expect(snapshot).toBeLessThan(sss);
      unmount();
    }
  });

  it('★★★ §D2: THE AGENDA PAGE RENDERS EXACTLY ONE OF THEM', () => {
    // The failure this prevents is the obvious one: leave the page's own list
    // in place, and the screen grows a second list and a second
    // "+ Agenda item" button that write to the same rows.
    agendaState.tasks = [task()];
    const { container } = render(
      wrap(<AgendaPage />),
    );
    expect(container.querySelectorAll('[data-testid="agenda-block"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="agenda-tabs"]')).toHaveLength(1);
    expect(screen.getAllByText('+ Agenda item')).toHaveLength(1);
  });

  it('★★ ONE RUNNING LIST SHOWN AS TWO — the tabs carry their own counts', () => {
    agendaState.tasks = [
      task({ id: 't-1' }),
      task({ id: 't-2' }),
      task({ id: 't-3', status: 'Resolved' }),
    ];
    render(
      wrap(<WeeklyUpdate surface="page" />),
    );
    // The count is ON the tab, so the reader never switches to find out
    // whether the other list is worth switching to.
    expect(screen.getByTestId('agenda-tab-open-count').textContent).toBe('2');
    expect(screen.getByTestId('agenda-tab-closed-count').textContent).toBe('1');
    expect(screen.getByTestId('agenda-tab-open').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('agenda-tab-closed').getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByTestId('agenda-tab-closed'));
    expect(screen.getByTestId('agenda-tab-closed').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('agenda-closed')).toBeTruthy();
  });

  it('★★ the two surfaces differ by exactly ONE sentence', () => {
    const hint = (surface: 'page' | 'modal') => {
      const { unmount } = render(
        wrap(<WeeklyUpdate surface={surface} />),
      );
      const text = screen.getByTestId('agenda-empty-hint').textContent;
      unmount();
      return text;
    };
    const page = hint('page');
    const modal = hint('modal');
    expect(page).not.toBe(modal);
    // On the page the reader arrived on purpose and needs to know how an item
    // gets here; in the modal the meeting is starting now.
    expect(page).toContain('tick Agenda on any task');
    expect(modal).toContain('worth raising');
  });

  it('★★★ §D4: AN ADMIN WHO IS NOT A MEMBER MAY STILL ADD AN ITEM', () => {
    // They already SEE this — fix-462 put the ribbon entry in front of admins
    // deliberately. Read-but-not-write would be the worse half of both: they
    // are the person most likely to be told "raise this on Wednesday" and
    // least likely to be in the room. Nothing about an agenda item is
    // privileged; it is a team_tasks row whose RLS already decides the write.
    agendaState.isMember = false;
    agendaState.isAdmin = true;
    render(
      wrap(<WeeklyUpdate surface="page" />),
    );
    expect(screen.getByTestId('agenda-block')).toBeTruthy();
    expect(screen.getByText('+ Agenda item')).toBeTruthy();
  });

  it('★★ …and somebody who is neither gets the list without the create control', () => {
    // The /agenda route itself is ungated, so this is reachable by typing the
    // URL. They read the meeting's list; they do not get a control for a
    // meeting they are not in.
    agendaState.isMember = false;
    agendaState.isAdmin = false;
    agendaState.tasks = [task()];
    render(
      wrap(<WeeklyUpdate surface="page" />),
    );
    expect(screen.getByTestId('agenda-block')).toBeTruthy();
    expect(screen.queryByText('+ Agenda item')).toBeNull();
  });

  it('★★ ONE control: the composer is in the body when empty, in the bar when not', () => {
    // fix-440's rule. Not in both places — that would be two buttons doing
    // one job on a screen whose whole complaint is clutter.
    const { unmount } = render(
      wrap(<WeeklyUpdate surface="page" />),
    );
    expect(screen.getAllByText('+ Agenda item')).toHaveLength(1);
    expect(within(screen.getByTestId('agenda-open')).getByText('+ Agenda item')).toBeTruthy();
    unmount();

    agendaState.tasks = [task()];
    render(
      wrap(<WeeklyUpdate surface="page" />),
    );
    expect(screen.getAllByText('+ Agenda item')).toHaveLength(1);
    expect(within(screen.getByTestId('agenda-open')).queryByText('+ Agenda item')).toBeNull();
  });

  it('★★★ §B4: the CREATE CONTROL is legible — it is now the primary CTA', () => {
    // fix-460 drew this button in `text-dim` (2.82:1), which was tolerable as
    // a faint affordance at the end of a task list. fix-465 promotes it to the
    // first thing an empty agenda offers the meeting, and "add the first item"
    // cannot be the least legible thing on the screen.
    render(wrap(<WeeklyUpdate surface="modal" />));
    const add = screen.getByTestId('agenda-task-add');
    expect(add.className).not.toContain('text-dim');
    expect(add.style.color).toBe('var(--color-muted)');
    // The dashed border is what says "this creates something" — it is the
    // shape doing that job, not the ink, so it stays.
    expect(add.className).toContain('border-dashed');
  });

  it('★★★ the agenda renders even while the SNAPSHOT is still loading', () => {
    // The old component returned early on `isLoading` and rendered nothing
    // but "Loading…". With the agenda inside, that early return would have
    // held the agenda hostage to five server-side counts — on the one screen
    // that opens automatically on a Wednesday morning.
    vi.resetModules();
    expect(
      readFileSync(
        resolve(process.cwd(), 'src/components/WeeklyUpdate/WeeklyUpdate.tsx'),
        'utf8',
      ),
    ).not.toMatch(/if \(snapQ\.isLoading\) \{\s*return/);
  });
});
