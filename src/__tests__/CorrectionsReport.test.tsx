import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { CorrectionItem } from '../lib/database.types';

// fix-277: the Corrections report page, driven through the real hooks (with the
// Supabase builder mocked) and the real report logic.
//
// The pagination test is the one that matters most: correction_items holds 2,194
// rows and PostgREST silently truncates an un-ranged select at 1,000. A report
// that quietly analysed the first 1,000 would be wrong everywhere with nothing
// on screen to say so.

const T = 'test-tenant-uuid';

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  error: null as { message: string } | null,
  rangeCalls: [] as Array<[number, number]>,
  select: '',
}));

vi.mock('../lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  chain.select = (cols: string) => {
    state.select = cols;
    return chain;
  };
  chain.order = () => chain;
  chain.range = (from: number, to: number) => {
    state.rangeCalls.push([from, to]);
    if (state.error) return Promise.resolve({ data: null, error: state.error });
    return Promise.resolve({
      data: state.rows.slice(from, to + 1),
      error: null,
    });
  };
  return { supabase: { from: () => chain } };
});

const PROJECTS = [
  { id: 'p1', address: '10044 37th Ave SW', juris: 'Seattle' },
  { id: 'p2', address: '10431 SE 19th St', juris: 'Bellevue' },
];

const PERMITS = [
  { id: 1, project_id: 'p1', architect: 'Fisk' },
  { id: 2, project_id: 'p2', architect: null },
];

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: PROJECTS, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: PERMITS, isLoading: false, error: null, refetch: vi.fn() }),
}));

import CorrectionsReport from '../pages/CorrectionsReport';

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<CorrectionsReport />, { wrapper });
}

let seq = 0;
function item(over: Partial<CorrectionItem> = {}): CorrectionItem {
  seq += 1;
  return {
    id: `ci-${seq}`,
    project_id: 'p1',
    permit_id: null,
    building: null,
    discipline: 'Zoning',
    cycle: 1,
    letter_date: '2025-08-01',
    reviewer: 'A. Reviewer',
    item_no: seq,
    subject: `Subject ${seq}`,
    body: `Body ${seq}`,
    codes: null,
    category: 'Setbacks & yards',
    theme: 'Site geometry',
    source_file: 'letter.pdf',
    ...over,
  };
}

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
  state.rows = [];
  state.error = null;
  state.rangeCalls = [];
  state.select = '';
});

// ------------------------------------------------------------------ paging ---

describe('fix-277 the report reads the WHOLE corpus', () => {
  it('pages past the 1000-row cap instead of silently analysing the first page', async () => {
    // 2,194 is production's row count — the exact size that makes this bite.
    state.rows = Array.from({ length: 2194 }, () => item());
    renderPage();
    expect(await screen.findByTestId('corrections-summary')).toHaveTextContent(
      '2194 comments',
    );
    expect(state.rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('asks only for the columns it renders', async () => {
    state.rows = [item()];
    renderPage();
    await screen.findByTestId('corrections-summary');
    expect(state.select).not.toContain('*');
    for (const col of ['building', 'discipline', 'cycle', 'theme', 'category', 'source_file']) {
      expect(state.select).toContain(col);
    }
  });
});

// ----------------------------------------------------------------- summary ---

describe('fix-277 summary strip', () => {
  beforeEach(() => {
    state.rows = [
      item({ project_id: 'p1', cycle: 1, discipline: 'Zoning', category: 'Setbacks' }),
      item({ project_id: 'p1', cycle: 2, discipline: 'Zoning', category: 'Setbacks' }),
      item({ project_id: 'p2', cycle: 1, discipline: 'Planning', category: 'Trees' }),
    ];
  });

  it('counts comments, projects and jurisdictions', async () => {
    renderPage();
    const s = await screen.findByTestId('corrections-summary');
    expect(within(s).getByTestId('corrections-stat-items')).toHaveTextContent('3 comments');
    expect(within(s).getByTestId('corrections-stat-projects')).toHaveTextContent('2 projects');
    expect(within(s).getByTestId('corrections-stat-juris')).toHaveTextContent('2 jurisdictions');
  });

  it('states the repeat rate with its denominator spelled out', async () => {
    renderPage();
    const rate = await screen.findByTestId('corrections-stat-repeat-rate');
    // p1's Zoning/Setbacks is eligible (p1 has a cycle 2) and repeats. p2 has
    // only one cycle, so nothing there is eligible.
    expect(rate).toHaveTextContent('100%');
    expect(rate).toHaveTextContent('1 of 1 topics came back the next cycle');
  });
});

// ------------------------------------------------------------------- views ---

describe('fix-277 the three views', () => {
  beforeEach(() => {
    state.rows = [
      item({ project_id: 'p1', cycle: 1, discipline: 'Zoning', category: 'Setbacks', theme: 'Site geometry' }),
      item({ project_id: 'p1', cycle: 2, discipline: 'Zoning', category: 'Setbacks', theme: 'Site geometry' }),
      item({ project_id: 'p2', cycle: 1, discipline: 'Planning', category: 'Trees', theme: 'Trees' }),
    ];
  });

  it('lists the repeating topic on the repeat view', async () => {
    renderPage();
    await screen.findByTestId('corrections-summary');
    // fix-279 moved the default to Prevalence — the question the business
    // actually asked. Repeat rate is one click away and unchanged.
    expect(screen.getByTestId('corrections-view-prevalence'))
      .toHaveAttribute('data-active', 'true');
    fireEvent.click(screen.getByTestId('corrections-view-repeats'));
    expect(screen.getByTestId('corrections-view-repeats')).toHaveAttribute('data-active', 'true');
    const repeats = screen.getByTestId('corrections-repeats');
    expect(within(repeats).getByTestId('corrections-repeat-row-p1')).toHaveTextContent('10044 37th Ave SW');
    expect(within(repeats).getByTestId('corrections-repeat-row-p1')).toHaveTextContent('1→2');
    // p2 never had a second cycle, so it is not listed.
    expect(within(repeats).queryByTestId('corrections-repeat-row-p2')).toBeNull();
  });

  it('the counts view breaks down by theme AND discipline', async () => {
    renderPage();
    await screen.findByTestId('corrections-summary');
    fireEvent.click(screen.getByTestId('corrections-view-counts'));
    const themes = screen.getByTestId('corrections-theme-table');
    const disciplines = screen.getByTestId('corrections-discipline-table');
    expect(within(themes).getByTestId('corrections-theme-table-row-Site geometry')).toHaveTextContent('2');
    expect(within(themes).getByTestId('corrections-theme-table-row-Trees')).toHaveTextContent('1');
    expect(within(disciplines).getByTestId('corrections-discipline-table-row-Zoning')).toHaveTextContent('2');
    expect(within(disciplines).getByTestId('corrections-discipline-table-row-Planning')).toHaveTextContent('1');
  });

  it('the items view drills down to the individual comments', async () => {
    renderPage();
    await screen.findByTestId('corrections-summary');
    fireEvent.click(screen.getByTestId('corrections-view-items'));
    const items = screen.getByTestId('corrections-items');
    expect(within(items).getAllByTestId(/^corrections-item-row-/)).toHaveLength(3);
  });

  it('an item expands to its body, theme and source letter', async () => {
    renderPage();
    await screen.findByTestId('corrections-summary');
    fireEvent.click(screen.getByTestId('corrections-view-items'));
    const first = (state.rows[0] as CorrectionItem).id;
    expect(screen.queryByTestId(`corrections-item-body-${first}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`corrections-item-row-${first}`));
    const body = screen.getByTestId(`corrections-item-body-${first}`);
    expect(body).toHaveTextContent('Site geometry');
    expect(body).toHaveTextContent('letter.pdf');
    expect(body).toHaveTextContent('Fisk');
  });

  it('clicking a repeat topic drills into its items', async () => {
    renderPage();
    await screen.findByTestId('corrections-summary');
    // fix-279: reach the repeat view first — Prevalence is the landing view now.
    fireEvent.click(screen.getByTestId('corrections-view-repeats'));
    fireEvent.click(screen.getByTestId('corrections-repeat-row-p1'));
    expect(screen.getByTestId('corrections-view-items')).toHaveAttribute('data-active', 'true');
    // Filtered to that topic's discipline.
    expect(screen.getByTestId('corrections-filter-discipline')).toHaveValue('Zoning');
    expect(screen.getAllByTestId(/^corrections-item-row-/)).toHaveLength(2);
  });
});

// ----------------------------------------------------------------- filters ---

describe('fix-277 filters', () => {
  beforeEach(() => {
    state.rows = [
      item({ project_id: 'p1', cycle: 1, discipline: 'Zoning', theme: 'Site geometry', letter_date: '2025-08-01' }),
      item({ project_id: 'p2', cycle: 2, discipline: 'Planning', theme: 'Trees', letter_date: '2025-11-01' }),
    ];
  });

  async function ready() {
    renderPage();
    await screen.findByTestId('corrections-summary');
  }

  it('jurisdiction narrows every view at once', async () => {
    await ready();
    fireEvent.change(screen.getByTestId('corrections-filter-juris'), {
      target: { value: 'Bellevue' },
    });
    expect(screen.getByTestId('corrections-stat-items')).toHaveTextContent('1 comment');
    fireEvent.click(screen.getByTestId('corrections-view-counts'));
    expect(screen.getByTestId('corrections-theme-table')).toHaveTextContent('Trees');
    expect(screen.getByTestId('corrections-theme-table')).not.toHaveTextContent('Site geometry');
  });

  it('discipline, theme and cycle each narrow the set', async () => {
    await ready();
    for (const [testid, value] of [
      ['corrections-filter-discipline', 'Zoning'],
      ['corrections-filter-theme', 'Site geometry'],
      ['corrections-filter-cycle', '1'],
    ] as const) {
      fireEvent.change(screen.getByTestId(testid), { target: { value } });
      expect(screen.getByTestId('corrections-stat-items')).toHaveTextContent('1 comment');
      fireEvent.click(screen.getByTestId('corrections-filter-reset'));
      expect(screen.getByTestId('corrections-stat-items')).toHaveTextContent('2 comments');
    }
  });

  it('a date range narrows to the letters inside it', async () => {
    await ready();
    fireEvent.change(screen.getByTestId('corrections-filter-from'), {
      target: { value: '2025-10-01' },
    });
    expect(screen.getByTestId('corrections-stat-items')).toHaveTextContent('1 comment');
    fireEvent.change(screen.getByTestId('corrections-filter-to'), {
      target: { value: '2025-10-15' },
    });
    expect(screen.getByTestId('corrections-report-no-match')).toBeInTheDocument();
  });

  it('the architect filter exists and its thin coverage is stated on the page', async () => {
    await ready();
    const select = screen.getByTestId('corrections-filter-architect');
    expect(within(select).getByRole('option', { name: 'Fisk' })).toBeInTheDocument();
    // 1 of 2 rows has an architect → 50%. The banner shows below 50%… so at
    // exactly 50 it does not; assert the option list instead, and the banner
    // separately below.
    fireEvent.change(select, { target: { value: 'Fisk' } });
    expect(screen.getByTestId('corrections-stat-items')).toHaveTextContent('1 comment');
  });

  it('warns when architect is recorded on almost nothing', async () => {
    state.rows = [
      item({ project_id: 'p2' }),
      item({ project_id: 'p2' }),
      item({ project_id: 'p2' }),
    ];
    await ready();
    expect(screen.getByTestId('corrections-architect-coverage')).toHaveTextContent(
      'Architect is recorded on 0 of 3 indexed comments (0%)',
    );
  });

  it('the dropdowns keep their options as you narrow', async () => {
    await ready();
    fireEvent.change(screen.getByTestId('corrections-filter-juris'), {
      target: { value: 'Bellevue' },
    });
    // Zoning belongs only to the Seattle row, but must remain selectable —
    // otherwise the filter bar traps you in whatever you picked first.
    const disc = screen.getByTestId('corrections-filter-discipline');
    expect(within(disc).getByRole('option', { name: 'Zoning' })).toBeInTheDocument();
  });

  it('reset only appears once something is filtered', async () => {
    await ready();
    expect(screen.queryByTestId('corrections-filter-reset')).toBeNull();
    fireEvent.change(screen.getByTestId('corrections-filter-cycle'), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByTestId('corrections-filter-reset'));
    expect(screen.queryByTestId('corrections-filter-reset')).toBeNull();
  });
});

// ------------------------------------------------------------ empty / error --

describe('fix-277 empty and failure states', () => {
  it('says nothing is indexed when the table is empty', async () => {
    state.rows = [];
    renderPage();
    expect(await screen.findByTestId('corrections-report-empty')).toHaveTextContent(
      'Nothing indexed yet',
    );
  });

  it('distinguishes "no data at all" from "no match for these filters"', async () => {
    state.rows = [item({ project_id: 'p1', letter_date: '2025-08-01' })];
    renderPage();
    await screen.findByTestId('corrections-summary');
    // The dropdowns only ever offer values that exist, so the only way to
    // filter down to nothing is a date window — which is exactly the case a
    // user hits ("show me Q4" on a project that finished in Q3").
    fireEvent.change(screen.getByTestId('corrections-filter-from'), {
      target: { value: '2026-01-01' },
    });
    expect(screen.getByTestId('corrections-report-no-match')).toBeInTheDocument();
    expect(screen.queryByTestId('corrections-report-empty')).toBeNull();
  });

  it('a load failure surfaces rather than rendering an empty report', async () => {
    state.error = { message: 'permission denied for table correction_items' };
    renderPage();
    expect(await screen.findByText(/Corrections failed to load/i)).toBeInTheDocument();
  });

  it('a cycle 9 filter offers no option that cannot match', async () => {
    state.rows = [item({ cycle: 1 }), item({ cycle: 2 })];
    renderPage();
    await screen.findByTestId('corrections-summary');
    const cycles = within(screen.getByTestId('corrections-filter-cycle'))
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value);
    expect(cycles).toEqual(['', '1', '2']);
  });
});

// --------------------------------------------------------------------- CSV ---

describe('fix-277 CSV export', () => {
  it('is disabled with nothing to export and enabled once there is', async () => {
    state.rows = [];
    const { unmount } = renderPage();
    await screen.findByTestId('corrections-report-empty');
    expect(screen.getByTestId('corrections-export-csv')).toHaveAttribute('data-disabled', 'true');
    unmount();

    state.rows = [item()];
    renderPage();
    await screen.findByTestId('corrections-summary');
    expect(screen.getByTestId('corrections-export-csv')).toHaveAttribute('data-disabled', 'false');
  });
});

// ------------------------------------------------------ fix-283a: excluded ---

// Roughly a quarter of correction_items was suspected of not being corrections
// at all — Seattle's two-column letters put drawing text through the extractor
// alongside the reviewer's comments. The indexer now flags those rows; this
// report must stop counting them, WITHOUT hiding that it did.

describe('fix-283a the report excludes rows the indexer flagged', () => {
  it('asks the database for the flag', async () => {
    state.rows = [item()];
    renderPage();
    await screen.findByTestId('corrections-summary');
    expect(state.select).toContain('is_correction');
    expect(state.select).toContain('exclusion_reason');
  });

  it('leaves flagged rows out of every headline count', async () => {
    state.rows = [
      item({ project_id: 'p1' }),
      item({ project_id: 'p1' }),
      item({ project_id: 'p2', is_correction: false, exclusion_reason: 'drawing_text' }),
      item({ project_id: 'p2', is_correction: false, exclusion_reason: 'explicit' }),
    ];
    renderPage();
    const summary = await screen.findByTestId('corrections-summary');
    // Two real comments, and — the point of the ticket — ONE project, not two.
    expect(within(summary).getByTestId('corrections-stat-items')).toHaveTextContent('2');
    expect(within(summary).getByTestId('corrections-stat-projects')).toHaveTextContent('1');
  });

  // ★ The brief's specific requirement: the denominator becomes "projects with
  // at least one CORRECTION", recomputed rather than carried over. p2's only
  // rows are excluded, so it must leave the denominator entirely.
  it('recomputes the prevalence denominator, not just the numerators', async () => {
    state.rows = [
      item({ project_id: 'p1' }),
      item({ project_id: 'p2', is_correction: false, exclusion_reason: 'boilerplate' }),
    ];
    renderPage();
    const denom = await screen.findByTestId('prevalence-denominator');
    expect(denom).toHaveTextContent('1');
    expect(denom).not.toHaveTextContent('2');
  });

  it('says how many rows it dropped, on every view and without being asked', async () => {
    state.rows = [
      item(),
      item({ is_correction: false, exclusion_reason: 'drawing_text' }),
      item({ is_correction: false, exclusion_reason: 'drawing_text' }),
      item({ is_correction: false, exclusion_reason: 'explicit' }),
    ];
    renderPage();
    const note = await screen.findByTestId('corrections-exclusion-note');
    expect(within(note).getByTestId('corrections-excluded-count')).toHaveTextContent('3');
    expect(note).toHaveTextContent(/2 drawing text/i);
    expect(note).toHaveTextContent(/1 marked not a correction/i);
  });

  it('shows nothing at all when nothing was excluded', async () => {
    state.rows = [item(), item()];
    renderPage();
    await screen.findByTestId('corrections-summary');
    expect(screen.queryByTestId('corrections-exclusion-note')).toBeNull();
  });

  it('lists the excluded rows, with their text, grouped by reason', async () => {
    state.rows = [
      item(),
      item({
        subject: 'ALL VERTICAL FENESTRATION U-VALUE TO BE 0.28',
        body: '',
        is_correction: false,
        exclusion_reason: 'drawing_text',
      }),
    ];
    renderPage();
    fireEvent.click(await screen.findByTestId('corrections-exclusion-show'));
    const group = await screen.findByTestId('corrections-excluded-drawing_text');
    expect(group).toHaveTextContent('Drawing text');
    // The TEXT is the evidence — a label and a count alone would let a wrong
    // rule hide behind a plausible name.
    expect(group).toHaveTextContent(/ALL VERTICAL FENESTRATION/);
  });

  // A row whose flag was never selected, or which predates the migration, is a
  // correction. Nothing about this filter may be able to shrink a count by
  // accident — under-counting is the failure it exists to fix.
  it('counts a row with no flag at all', async () => {
    const noFlag = item();
    delete (noFlag as Partial<CorrectionItem>).is_correction;
    state.rows = [noFlag];
    renderPage();
    const summary = await screen.findByTestId('corrections-summary');
    expect(within(summary).getByTestId('corrections-stat-items')).toHaveTextContent('1');
    expect(screen.queryByTestId('corrections-exclusion-note')).toBeNull();
  });

  it('keeps the excluded rows out of the item drill-down', async () => {
    state.rows = [
      item({ subject: 'A real correction' }),
      item({
        subject: 'CAPTURED DRAWING TEXT',
        is_correction: false,
        exclusion_reason: 'drawing_text',
      }),
    ];
    renderPage();
    await screen.findByTestId('corrections-summary');
    const tabs = screen.getByTestId('corrections-view-tabs');
    fireEvent.click(within(tabs).getByText('Items'));
    const items = await screen.findByTestId('corrections-items');
    expect(items).toHaveTextContent('A real correction');
    expect(items).not.toHaveTextContent('CAPTURED DRAWING TEXT');
  });
});
