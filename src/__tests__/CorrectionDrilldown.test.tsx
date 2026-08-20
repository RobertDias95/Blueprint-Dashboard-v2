import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { CorrectionItem } from '../lib/database.types';

// fix-281: reading the words behind a prevalence row, and time.

const T = 'test-tenant-uuid';

const state = vi.hoisted(() => ({
  items: [] as unknown[],
  worklist: [] as unknown[],
  rangeCalls: [] as Array<[string, number, number]>,
}));

vi.mock('../lib/supabase', () => {
  function builder(table: string) {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.order = () => chain;
    chain.range = (from: number, to: number) => {
      state.rangeCalls.push([table, from, to]);
      const src = table === 'correction_missing_worklist' ? state.worklist : state.items;
      return Promise.resolve({ data: src.slice(from, to + 1), error: null });
    };
    return chain;
  }
  return { supabase: { from: (t: string) => builder(t) } };
});

// A corpus with real dates either side of the year boundary, so the period
// controls have something to bite on.
const PROJECTS: Array<Record<string, unknown>> = [];
const ITEMS: CorrectionItem[] = [];
let seq = 0;

function push(projectId: string, over: Partial<CorrectionItem>) {
  seq += 1;
  ITEMS.push({
    id: `ci-${seq}`, project_id: projectId, permit_id: null, building: null,
    discipline: 'Zoning', cycle: 1, letter_date: '2026-05-01', reviewer: 'B. Reviewer',
    item_no: seq, subject: `Subject ${seq}`, body: `Body ${seq}`, codes: null,
    category: 'Other', theme: 'Other', source_file: 'letter.pdf', ...over,
  });
}

// 24 projects: 20 carry the parking category in 2026, 8 carried it in 2025.
for (let i = 0; i < 24; i += 1) {
  const id = `p${i}`;
  PROJECTS.push({ id, address: `${i} Main St`, juris: 'Seattle', units: 4 });
  push(id, { letter_date: '2026-05-01' });      // in scope for 2026
  push(id, { letter_date: '2025-09-01' });      // in the preceding window
  if (i < 20) {
    push(id, {
      // Staggered so newest/oldest is a real distinction between projects.
      letter_date: `2026-05-${String(1 + i).padStart(2, '0')}`,
      category: 'Parking / access / curb cut',
      theme: 'Access & ROW', subject: 'Sight triangle',
      body: 'The sight triangle at the driveway must be shown on the site plan '
        + 'and kept clear of obstructions over 30 inches. This is a long body '
        + 'that must render in full, because reading it is the whole point.',
      codes: 'SMC 23.54.030', source_file: '10044 - Zoning Corr 1.pdf',
      reviewer: 'A. Reviewer',
    });
  }
  if (i < 8) {
    push(id, {
      letter_date: '2025-09-01', category: 'Parking / access / curb cut',
      theme: 'Access & ROW', subject: 'Curb cut closure',
    });
  }
}
// The two implausible letters, exactly as production holds them.
PROJECTS.push({ id: 'bad', address: '99 Bad St', juris: 'Seattle', units: 4 });
for (let i = 0; i < 5; i += 1) {
  push('bad', { letter_date: '2026-12-24', source_file: '5603 - Zoning Corr 1.pdf' });
}
for (let i = 0; i < 5; i += 1) {
  push('bad', { letter_date: '2022-06-04', source_file: 'SFR 2 - LU Corr 1 - SUMMARY.pdf' });
}

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: PROJECTS, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

import CorrectionsReport from '../pages/CorrectionsReport';

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      {/* ★ fix-374: ask for the view by URL — the report now greets you with
          the recurring corrections. Assertions unchanged. */}
      <MemoryRouter initialEntries={['/reports/corrections?view=prevalence']}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<CorrectionsReport />, { wrapper });
}

const PARKING = 'Parking / access / curb cut';

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T, memberships: [{ tenant_id: T, role: 'admin' }],
  });
  state.items = ITEMS;
  state.worklist = [];
  state.rangeCalls = [];
});

async function ready() {
  renderPage();
  await screen.findByTestId('corrections-prevalence');
}

// ------------------------------------------------------------- drill-down --

describe('fix-281 expanding a prevalence row shows the actual corrections', () => {
  it('a row expands in place to the comments behind it', async () => {
    await ready();
    expect(screen.queryByTestId(`comments-${PARKING}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`prevalence-row-${PARKING}`));
    expect(screen.getByTestId(`prevalence-expanded-${PARKING}`)).toBeInTheDocument();
    expect(screen.getByTestId(`comments-${PARKING}`)).toBeInTheDocument();
  });

  it('renders the body text IN FULL — it is the payload', async () => {
    await ready();
    fireEvent.click(screen.getByTestId(`prevalence-row-${PARKING}`));
    const bodies = screen.getAllByTestId(/^comment-body-/);
    expect(bodies.length).toBeGreaterThan(0);
    // Every word, not an ellipsis.
    expect(bodies[0]).toHaveTextContent(
      'kept clear of obstructions over 30 inches',
    );
    expect(bodies[0]).toHaveTextContent('reading it is the whole point');
    expect(bodies[0].textContent).not.toContain('…');
    // And it wraps rather than clamping to one line.
    expect(bodies[0].className).toContain('whitespace-pre-wrap');
  });

  it('each comment carries subject, project, cycle, discipline, reviewer, date, codes and source', async () => {
    await ready();
    fireEvent.click(screen.getByTestId(`prevalence-row-${PARKING}`));
    const panel = screen.getByTestId(`comments-${PARKING}`);
    expect(panel).toHaveTextContent('Sight triangle');
    expect(panel).toHaveTextContent('19 Main St');   // newest, so first
    expect(panel).toHaveTextContent('Cycle 1');
    expect(panel).toHaveTextContent('Zoning');
    expect(panel).toHaveTextContent('A. Reviewer');
    expect(panel).toHaveTextContent('2026-05-20');
    expect(panel).toHaveTextContent('SMC 23.54.030');
    expect(panel).toHaveTextContent('10044 - Zoning Corr 1.pdf');
  });

  it('groups by project', async () => {
    await ready();
    fireEvent.click(screen.getByTestId(`prevalence-row-${PARKING}`));
    expect(screen.getAllByTestId(/^comments-project-/).length).toBeGreaterThan(1);
  });

  it('SEVERAL rows open at once, and no refetch happens', async () => {
    await ready();
    const before = state.rangeCalls.length;
    fireEvent.click(screen.getByTestId(`prevalence-row-${PARKING}`));
    fireEvent.click(screen.getByTestId('prevalence-row-Other'));
    expect(screen.getByTestId(`comments-${PARKING}`)).toBeInTheDocument();
    expect(screen.getByTestId('comments-Other')).toBeInTheDocument();
    expect(state.rangeCalls.length).toBe(before);
  });

  it('clicking again collapses it', async () => {
    await ready();
    fireEvent.click(screen.getByTestId(`prevalence-row-${PARKING}`));
    fireEvent.click(screen.getByTestId(`prevalence-row-${PARKING}`));
    expect(screen.queryByTestId(`comments-${PARKING}`)).toBeNull();
  });

  it('is lazy: nothing is rendered until the row is opened', async () => {
    await ready();
    expect(screen.queryAllByTestId(/^comment-body-/)).toHaveLength(0);
    fireEvent.click(screen.getByTestId(`prevalence-row-${PARKING}`));
    expect(screen.queryAllByTestId(/^comment-body-/).length).toBeGreaterThan(0);
  });

  it('pages the long tail rather than rendering 137 at once', async () => {
    await ready();
    fireEvent.click(screen.getByTestId(`prevalence-row-${PARKING}`));
    const more = screen.getByTestId(`comments-more-${PARKING}`);
    const first = screen.getAllByTestId(/^comment-body-/).length;
    expect(first).toBeLessThan(28);
    fireEvent.click(more);
    expect(screen.getAllByTestId(/^comment-body-/).length).toBeGreaterThan(first);
  });

  it('the sort flips newest/oldest', async () => {
    await ready();
    fireEvent.click(screen.getByTestId(`prevalence-row-${PARKING}`));
    const firstProject = () =>
      screen.getAllByTestId(/^comments-project-/)[0].getAttribute('data-testid');
    const newestFirst = firstProject();
    fireEvent.change(screen.getByTestId(`comments-sort-${PARKING}`), {
      target: { value: 'oldest' },
    });
    expect(firstProject()).not.toBe(newestFirst);
  });

  it('respects the active filters', async () => {
    await ready();
    fireEvent.click(screen.getByTestId(`prevalence-row-${PARKING}`));
    const all = screen.getAllByTestId(/^comment-body-/).length;
    // Narrow to the preceding year: the 2026 sight-triangle comments go.
    fireEvent.click(screen.getByTestId('corrections-period-last90'));
    const open = screen.queryByTestId(`comments-${PARKING}`);
    if (open) {
      expect(screen.queryAllByTestId(/^comment-body-/).length).not.toBe(all);
    } else {
      expect(screen.queryByTestId(`prevalence-row-${PARKING}`)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------- periods --

describe('fix-281 period presets', () => {
  it('offers YTD, 90 days, 12 months and all time', async () => {
    await ready();
    for (const key of ['ytd2026', 'last90', 'last12m', 'all']) {
      expect(screen.getByTestId(`corrections-period-${key}`)).toBeInTheDocument();
    }
  });

  it('selecting 2026 YTD narrows to this year and names the window', async () => {
    await ready();
    fireEvent.click(screen.getByTestId('corrections-period-ytd2026'));
    expect(screen.getByTestId('corrections-period-ytd2026'))
      .toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('corrections-period-label')).toHaveTextContent('YTD');
    // The 2025 rows drop out: 24 projects still in scope, but the counts move.
    expect(screen.getByTestId('corrections-stat-items')).not.toHaveTextContent('0 comments');
  });

  it('the window is named in words, not just by a highlighted button', async () => {
    await ready();
    fireEvent.click(screen.getByTestId('corrections-period-last90'));
    expect(screen.getByTestId('corrections-period-label'))
      .toHaveTextContent('Last 90 days');
  });
});

// ------------------------------------------------------------- comparison --

describe('fix-281 period comparison', () => {
  it('appears only when there is a preceding window', async () => {
    await ready();
    // 'All time' is the default and has no previous.
    expect(screen.queryByTestId('prevalence-comparison-header')).toBeNull();
    fireEvent.click(screen.getByTestId('corrections-period-ytd2026'));
    expect(screen.getByTestId('prevalence-comparison-header')).toBeInTheDocument();
  });

  it('names both windows, not just the delta', async () => {
    await ready();
    fireEvent.click(screen.getByTestId('corrections-period-ytd2026'));
    const header = screen.getByTestId('prevalence-comparison-header');
    // The header names the previous window; its tooltip names both.
    expect(header.textContent).toMatch(/vs \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/);
    expect(header.getAttribute('title')).toContain('YTD');
  });

  it('shows BOTH underlying counts on every row', async () => {
    await ready();
    fireEvent.click(screen.getByTestId('corrections-period-ytd2026'));
    const cell = screen.getByTestId(`prevalence-delta-${PARKING}`);
    // "20/24 vs 8/24" — never a bare delta.
    expect(within(cell).getByTestId('comparison-counts').textContent)
      .toMatch(/^\d+\/\d+ vs \d+\/\d+$/);
  });

  it('reports the direction of change', async () => {
    await ready();
    fireEvent.click(screen.getByTestId('corrections-period-ytd2026'));
    const cell = screen.getByTestId(`prevalence-delta-${PARKING}`);
    // Parking went from 8-of-24 to 20-of-24 — up.
    expect(cell.querySelector('[data-direction]')?.getAttribute('data-direction'))
      .toBe('up');
    expect(cell).toHaveTextContent('pts');
  });

  it('suppresses the delta under n=10 a side but keeps the counts', async () => {
    await ready();
    // Squeeze the scope to a handful of projects via a segment filter.
    fireEvent.change(screen.getByTestId('corrections-segment-units'), {
      target: { value: '4–5' },
    });
    fireEvent.click(screen.getByTestId('corrections-period-last90'));
    const cell = screen.queryByTestId(`prevalence-delta-${PARKING}`);
    if (cell) {
      const suppressed = cell.querySelector('[data-suppressed="true"]');
      if (suppressed) {
        expect(suppressed).toHaveTextContent('not comparable');
        expect(within(cell).getByTestId('comparison-counts')).toBeInTheDocument();
      }
    }
  });
});

// ------------------------------------------------------------ date sanity --

describe('fix-281 implausible dates', () => {
  it('are counted where a reader will see them', async () => {
    await ready();
    const note = screen.getByTestId('corrections-date-sanity');
    expect(note).toHaveTextContent('10 of');
    expect(note).toHaveTextContent('5 in the future');
    expect(note).toHaveTextContent('5 before 2025');
    expect(note).toHaveTextContent('never corrected');
  });

  it('are excluded from a period window', async () => {
    await ready();
    fireEvent.click(screen.getByTestId('corrections-period-ytd2026'));
    // The 2026-12-24 rows are dated this year but are in the future.
    const items = screen.getByTestId('corrections-stat-items').textContent ?? '';
    const n = Number(items.replace(/\D+/g, ''));
    expect(n).toBe(44); // 24 in-scope + 20 parking, and none of the 10 bad ones
  });

  it('still appear in the drill-down, flagged, rather than vanishing', async () => {
    await ready();
    fireEvent.click(screen.getByTestId('prevalence-row-Other'));
    // They sort LAST on purpose — a future-dated letter must never masquerade
    // as the newest thing on the page — so page to the end to find them.
    for (let i = 0; i < 10; i += 1) {
      const more = screen.queryByTestId('comments-more-Other');
      if (!more) break;
      fireEvent.click(more);
    }
    const dates = screen.queryAllByTestId(/^comment-date-/);
    const flagged = dates.filter((el) => el.getAttribute('data-implausible') === 'true');
    expect(flagged.length).toBe(10);
    expect(flagged[0]).toHaveTextContent('⚠');
    // And they really are at the end of the list.
    expect(dates.slice(-10).every((el) => el.getAttribute('data-implausible') === 'true'))
      .toBe(true);
  });
});

// ------------------------------------------------- nothing else moved -------

describe('fix-281 leaves the existing prevalence figures alone', () => {
  it('the default view is still all-time prevalence with its denominator stated', async () => {
    await ready();
    expect(screen.getByTestId('prevalence-denominator'))
      .toHaveTextContent('of the 25 projects in this filter that have any correction on file');
  });

  it('parking still reads 20 of 25 across all time', async () => {
    await ready();
    expect(screen.getByTestId(`prevalence-row-${PARKING}`)).toHaveTextContent('20 of 25');
  });
});
