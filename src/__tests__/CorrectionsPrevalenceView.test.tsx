import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { CorrectionItem } from '../lib/database.types';

// fix-279: the Corrections report's prevalence view, its segment filters, its
// permit-coverage disclosure and the no-letter-found worklist — driven through
// the real page with only the Supabase builder mocked.

const T = 'test-tenant-uuid';

const state = vi.hoisted(() => ({
  items: [] as unknown[],
  worklist: [] as unknown[],
  error: null as { message: string } | null,
  rangeCalls: [] as Array<[string, number, number]>,
  table: '',
}));

vi.mock('../lib/supabase', () => {
  function builder(table: string) {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.order = () => chain;
    chain.range = (from: number, to: number) => {
      state.rangeCalls.push([table, from, to]);
      if (state.error) return Promise.resolve({ data: null, error: state.error });
      const src = table === 'correction_missing_worklist' ? state.worklist : state.items;
      return Promise.resolve({ data: src.slice(from, to + 1), error: null });
    };
    return chain;
  }
  return { supabase: { from: (table: string) => builder(table) } };
});

// 93 projects: 78 with 'Missing / incorrect plan info' (the production 84%),
// and unit bands matching the worked example.
const UNITS_FOR: Record<string, number> = { '1': 1, '2–3': 2, '4–5': 4, '6+': 6 };
const BANDS: Array<[string, number, number]> = [
  ['1', 4, 1], ['2–3', 27, 15], ['4–5', 54, 37], ['6+', 7, 5],
];

const PROJECTS: Array<Record<string, unknown>> = [];
const ITEMS: CorrectionItem[] = [];
let seq = 0;
function push(projectId: string, category: string, theme: string, permitId: number | null) {
  seq += 1;
  ITEMS.push({
    id: `ci-${seq}`, project_id: projectId, permit_id: permitId, building: null,
    discipline: 'Drainage', cycle: 1, letter_date: '2025-08-01', reviewer: null,
    item_no: seq, subject: `s${seq}`, body: null, codes: null,
    category, theme, source_file: 'f.pdf',
  });
}
let idx = 0;
for (const [band, n, hit] of BANDS) {
  for (let i = 0; i < n; i += 1) {
    const id = `${band}-${i}`;
    PROJECTS.push({
      id, address: `${idx} Main St`, juris: idx % 2 ? 'Seattle' : 'Bellevue',
      units: UNITS_FOR[band], zone: 'NR3', is_corner_lot: i % 2 === 0,
      product_types: ['Townhome'], builder_company: 'Boyd',
    });
    idx += 1;
    // Everything is in the denominator.
    push(id, 'Something else', 'Other', null);
    if (i < hit) push(id, 'Flow control / detention', 'Stormwater', i % 2 ? 1 : null);
  }
}
// Production's 93rd project has no units recorded — the "Not recorded" band.
// Including it keeps the denominator at 93 and exercises that bucket.
PROJECTS.push({
  id: 'no-units', address: '99 Main St', juris: 'Seattle', units: null,
  zone: 'NR3', is_corner_lot: null, product_types: ['Townhome'],
  builder_company: null,
});
push('no-units', 'Something else', 'Other', null);

// 78 of the 93 get the headline category.
PROJECTS.slice(0, 78).forEach((p) => push(p.id as string, 'Missing / incorrect plan info', 'Plan info', null));

const PERMITS = [
  { id: 1, project_id: PROJECTS[0].id, type: 'Building Permit', da: 'Ana', architect: null,
    permit_cycles: [] },
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
      {/* ★ fix-374: the report GREETS you with the recurring corrections now
          (Bobby: "seems complicated to find"), so these fix-279 tests ask for
          the prevalence view by URL. Every assertion below is untouched; only
          the way of getting there is new. The landing view has its own suite. */}
      <MemoryRouter initialEntries={['/reports/corrections?view=prevalence']}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<CorrectionsReport />, { wrapper });
}

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T, memberships: [{ tenant_id: T, role: 'admin' }],
  });
  state.items = ITEMS;
  state.worklist = [];
  state.error = null;
  state.rangeCalls = [];
});

// -------------------------------------------------------------- prevalence --

describe('fix-279 the prevalence view', () => {
  it('opens on prevalence — the question the business asked', async () => {
    // ★★ fix-374 supersedes the "opens on" half of this fix-279 contract, and
    // deliberately: Bobby could not find the drill-down and it is the reason
    // fix-372 exists. Prevalence is still the question the business asked and
    // is now one click (or one `?view=`) away; what changed is which question
    // greets you. `RecurringCorrections.test.tsx` owns the new default.
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    expect(screen.getByTestId('corrections-view-prevalence'))
      .toHaveAttribute('data-active', 'true');
  });

  it('states its denominator in words, on screen', async () => {
    renderPage();
    const note = await screen.findByTestId('prevalence-denominator');
    expect(note).toHaveTextContent('of the 93 projects in this filter that have any correction on file');
    expect(note).toHaveTextContent('not of all projects, and not of letters');
  });

  it('reproduces the production headline: 84% on 78 of 93', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    const row = screen.getByTestId('prevalence-row-Missing / incorrect plan info');
    expect(row).toHaveTextContent('83.9%');
    expect(row).toHaveTextContent('78 of 93');
  });

  it('shows every percentage with its n', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    // Flow control: 58 of 93 in this fixture (1+15+37+5).
    const row = screen.getByTestId('prevalence-row-Flow control / detention');
    expect(row).toHaveTextContent('58 of 93');
  });

  it('bands the rows, and 50% lands in the top band', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    const high = screen.getByTestId('prevalence-band-high');
    expect(within(high).getByTestId('prevalence-row-Missing / incorrect plan info'))
      .toBeInTheDocument();
  });

  it('banding can be turned off', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    fireEvent.click(screen.getByTestId('prevalence-banded'));
    expect(screen.queryByTestId('prevalence-band-high')).toBeNull();
    expect(screen.getByTestId('prevalence-row-Missing / incorrect plan info'))
      .toBeInTheDocument();
  });

  it('rolls up to theme level', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    fireEvent.change(screen.getByTestId('prevalence-level'), { target: { value: 'theme' } });
    expect(screen.getByTestId('prevalence-row-Stormwater')).toBeInTheDocument();
    expect(screen.queryByTestId('prevalence-row-Flow control / detention')).toBeNull();
  });
});

// ------------------------------------------------------ the worked example --

describe('fix-279 prevalence by unit band', () => {
  it('reproduces 25% / 56% / 69% / 71% with each n shown', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    fireEvent.change(screen.getByTestId('prevalence-breakdown'), {
      target: { value: 'units' },
    });
    fireEvent.click(screen.getByTestId('prevalence-row-Flow control / detention'));

    const expected: Array<[string, string, string]> = [
      ['1', '25%', '1 of 4'],
      ['2–3', '55.6%', '15 of 27'],
      ['4–5', '68.5%', '37 of 54'],
      ['6+', '71.4%', '5 of 7'],
    ];
    for (const [band, pct, n] of expected) {
      const row = screen.getByTestId(
        `prevalence-segment-Flow control / detention-${band}`,
      );
      expect(row, band).toHaveTextContent(pct);
      expect(row, band).toHaveTextContent(n);
    }
  });

  it('de-emphasises the bands under n=10 and leaves the rest alone', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    fireEvent.change(screen.getByTestId('prevalence-breakdown'), {
      target: { value: 'units' },
    });
    fireEvent.click(screen.getByTestId('prevalence-row-Flow control / detention'));
    const low = (band: string) =>
      screen
        .getByTestId(`prevalence-segment-Flow control / detention-${band}`)
        .getAttribute('data-low-confidence');
    expect(low('1')).toBe('true');       // n=4
    expect(low('6+')).toBe('true');      // n=7
    expect(low('2–3')).toBe('false');    // n=27
    expect(low('4–5')).toBe('false');    // n=54
  });
});

// ------------------------------------- prevalence and repeat rate stay apart --

describe('fix-279 prevalence and repeat rate are never one column', () => {
  it('the prevalence table shows no repeat figure at all', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    const table = screen.getByTestId('corrections-prevalence');
    expect(table).not.toHaveTextContent(/repeat/i);
  });

  it('the repeat view shows no prevalence figure', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    fireEvent.click(screen.getByTestId('corrections-view-repeats'));
    expect(screen.queryByTestId('corrections-prevalence')).toBeNull();
    expect(screen.queryByTestId('prevalence-denominator')).toBeNull();
    // Single-cycle fixture, so the repeat view renders its "nothing could
    // repeat" notice rather than a table — either way, no prevalence figure.
    expect(screen.getByTestId('corrections-repeats-none-eligible')).toBeInTheDocument();
  });

  it('each view names what it measures, below the tabs and not only on hover', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    expect(screen.getByTestId('corrections-view-hint'))
      .toHaveTextContent('what to fix in the template');
    fireEvent.click(screen.getByTestId('corrections-view-repeats'));
    expect(screen.getByTestId('corrections-view-hint'))
      .toHaveTextContent('where the response breaks');
  });
});

// --------------------------------------------------------- segment filters --

describe('fix-279 segment filters drive every figure', () => {
  it('a unit-band filter moves the prevalence denominator', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    fireEvent.change(screen.getByTestId('corrections-segment-units'), {
      target: { value: '1' },
    });
    expect(screen.getByTestId('prevalence-denominator'))
      .toHaveTextContent('of the 4 projects');
  });

  it('warns when the whole slice is under n=10', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    fireEvent.change(screen.getByTestId('corrections-segment-units'), {
      target: { value: '1' },
    });
    expect(screen.getByTestId('prevalence-scope-low')).toHaveTextContent(
      'Fewer than 10 projects in scope',
    );
  });

  it('the active filter set is restated on screen', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    fireEvent.change(screen.getByTestId('corrections-segment-zone'), {
      target: { value: 'NR3' },
    });
    expect(screen.getByTestId('corrections-active-filters'))
      .toHaveTextContent('Zone: NR3');
  });

  it('a theme filter narrows the rows but NOT the denominator', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    fireEvent.change(screen.getByTestId('corrections-filter-theme'), {
      target: { value: 'Stormwater' },
    });
    // Still all 93 — otherwise every Stormwater category would read near 100%.
    expect(screen.getByTestId('prevalence-denominator')).toHaveTextContent('of the 93 projects');
    expect(screen.getByTestId('prevalence-scope-note'))
      .toHaveTextContent('the denominator stays the whole filtered slice');
    expect(screen.getByTestId('prevalence-row-Flow control / detention'))
      .toHaveTextContent('58 of 93');
  });
});

// ------------------------------------------------------- permit disclosure --

describe('fix-279 permit-linked slices disclose their coverage', () => {
  it('says nothing until a permit filter is set', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    expect(screen.queryByTestId('corrections-permit-coverage')).toBeNull();
  });

  it('states the fraction and that the rest are excluded', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    fireEvent.change(screen.getByTestId('corrections-filter-permit-type'), {
      target: { value: 'Building Permit' },
    });
    const banner = screen.getByTestId('corrections-permit-coverage');
    expect(banner).toHaveTextContent('Permit-level filter active');
    expect(banner).toHaveTextContent('carry a permit link');
    expect(banner).toHaveTextContent('excluded');
  });
});

// --------------------------------------------------- no letter found view ---

describe('fix-279 the no-letter-found worklist', () => {
  const WORKLIST = [
    {
      tenant_id: T, project_id: '4–5-0', permit_id: 10, permit_num: '7069001-CN',
      permit_type: 'Building Permit', address: '0 Main St', juris: 'Bellevue',
      cycle: 1, disciplines_expected: 'Drainage', corr_issued: '2025-05-15',
      days_since_corr_issued: 453, project_parked: false,
      status_note: 'no letter found — either never saved to the share, or saved under a name the parser does not recognise',
    },
    {
      tenant_id: T, project_id: '4–5-1', permit_id: 11, permit_num: '7088097-DM',
      permit_type: 'Demolition', address: '1 Main St', juris: 'Seattle',
      cycle: 2, disciplines_expected: null, corr_issued: '2025-08-22',
      days_since_corr_issued: 354, project_parked: true,
      status_note: 'no letter found — either never saved to the share, or saved under a name the parser does not recognise',
    },
  ];

  beforeEach(() => {
    state.worklist = WORKLIST;
  });

  it('says "no letter found" and never "not filed"', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    fireEvent.click(screen.getByTestId('corrections-view-missing'));
    const panel = await screen.findByTestId('corrections-missing-worklist');
    expect(panel).toHaveTextContent('No letter found');
    expect(panel).not.toHaveTextContent(/not filed/i);
    expect(screen.getByTestId('missing-worklist-note'))
      .toHaveTextContent('cannot tell which');
  });

  it('lists longest-outstanding first', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    fireEvent.click(screen.getByTestId('corrections-view-missing'));
    await screen.findByTestId('missing-worklist-summary');
    const rows = screen.getAllByTestId(/^missing-row-/);
    expect(rows[0]).toHaveTextContent('453d');
    expect(rows[1]).toHaveTextContent('354d');
  });

  it('marks a parked project rather than hiding it', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    fireEvent.click(screen.getByTestId('corrections-view-missing'));
    await screen.findByTestId('missing-worklist-summary');
    expect(screen.getByTestId('missing-parked-11-2')).toHaveTextContent('on hold');
    fireEvent.click(screen.getByTestId('missing-worklist-hide-parked'));
    expect(screen.queryByTestId('missing-row-11-2')).toBeNull();
  });

  it('says the correction filters do not apply to it', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    fireEvent.click(screen.getByTestId('corrections-view-missing'));
    expect(await screen.findByTestId('missing-worklist-note'))
      .toHaveTextContent('The filters above do not apply here');
  });

  it('is reachable even when no correction rows match the filters', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    fireEvent.change(screen.getByTestId('corrections-filter-from'), {
      target: { value: '2099-01-01' },
    });
    fireEvent.click(screen.getByTestId('corrections-no-match-to-missing'));
    expect(await screen.findByTestId('corrections-missing-worklist')).toBeInTheDocument();
  });

  it('pages its read like every other load-all hook', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    fireEvent.click(screen.getByTestId('corrections-view-missing'));
    await screen.findByTestId('missing-worklist-summary');
    expect(state.rangeCalls.some(([t]) => t === 'correction_missing_worklist')).toBe(true);
  });
});

// -------------------------------------------------------------- still pages --

describe('fix-279 useAllCorrectionItems still pages', () => {
  it('ranges over the corpus rather than taking PostgREST’s silent first page', async () => {
    renderPage();
    await screen.findByTestId('corrections-prevalence');
    const itemCalls = state.rangeCalls.filter(([t]) => t === 'correction_items');
    expect(itemCalls.length).toBeGreaterThan(0);
    expect(itemCalls[0].slice(1)).toEqual([0, 999]);
  });
});
