import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { CorrectionItem } from '../lib/database.types';

// fix-276: the Corrections panel, driven through the REAL hook + REAL grouping
// helpers with only the Supabase builder mocked. The two acceptance shapes are
// production data:
//
//   10044 37th Ave SW — 20 items; cycle 1 = Energy 5, OS 5, Tree 3, Zoning 3,
//     SCL 2, Addressing 1; cycle 2 = Addressing 1; 1 repeat topic; no building.
//   10431 SE 19th St — SFR 1..4, 12 items each, all cycle 1, no discipline.

const T = 'test-tenant-uuid';
const PROJECT_ID = 'p-corrections';

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  error: null as { message: string } | null,
  /** what the hook asked the server for — asserted so the read stays narrow */
  select: '',
  eq: null as [string, unknown] | null,
  orders: [] as Array<[string, unknown]>,
  calls: 0,
}));

vi.mock('../lib/supabase', () => {
  // Chainable, thenable builder — mirrors the PostgrestFilterBuilder surface
  // this hook touches: .select().eq().order().order().order() then awaited.
  const chain: Record<string, unknown> = {};
  chain.select = (cols: string) => {
    state.select = cols;
    return chain;
  };
  chain.eq = (col: string, val: unknown) => {
    state.eq = [col, val];
    return chain;
  };
  chain.order = (col: string, opts: unknown) => {
    state.orders.push([col, opts]);
    return chain;
  };
  chain.then = (resolve: (r: unknown) => unknown) => {
    state.calls += 1;
    return Promise.resolve(
      resolve(
        state.error
          ? { data: null, error: state.error }
          : { data: state.rows, error: null },
      ),
    );
  };
  return { supabase: { from: () => chain } };
});

import CorrectionsPanel from '../components/ProjectDetail/CorrectionsPanel';

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function renderPanel() {
  const Wrapper = wrapper();
  return render(
    <Wrapper>
      <CorrectionsPanel projectId={PROJECT_ID} />
    </Wrapper>,
  );
}

let seq = 0;
function row(over: Partial<CorrectionItem>): CorrectionItem {
  seq += 1;
  return {
    id: `ci-${seq}`,
    project_id: PROJECT_ID,
    permit_id: null,
    building: null,
    discipline: null,
    cycle: 1,
    letter_date: '2025-08-29',
    reviewer: null,
    item_no: 1,
    subject: `Subject ${seq}`,
    body: `Body ${seq}`,
    codes: null,
    category: null,
    theme: null,
    source_file: 'letter.pdf',
    ...over,
  };
}

function letter(opts: {
  discipline: string | null;
  cycle: number;
  n: number;
  source_file: string;
  category: string;
  building?: string | null;
}): CorrectionItem[] {
  return Array.from({ length: opts.n }, (_, i) =>
    row({
      discipline: opts.discipline,
      cycle: opts.cycle,
      source_file: opts.source_file,
      item_no: i + 1,
      category: opts.category,
      building: opts.building ?? null,
      reviewer: 'Jose Franco',
    }),
  );
}

const SEATTLE: CorrectionItem[] = [
  ...letter({ discipline: 'Addressing', cycle: 1, n: 1, source_file: '10044 - Addressing Corr 1.pdf', category: 'Address assignment / display' }),
  ...letter({ discipline: 'Energy', cycle: 1, n: 5, source_file: '10044 - Energy Corr 1.pdf', category: 'Lighting efficacy' }),
  ...letter({ discipline: 'OS', cycle: 1, n: 5, source_file: '10044 - OS Corr 1.pdf', category: 'Egress / stairs / guards' }),
  ...letter({ discipline: 'SCL', cycle: 1, n: 2, source_file: '10044 - SCL Corr 1.pdf', category: 'Unclassified' }),
  ...letter({ discipline: 'Tree', cycle: 1, n: 3, source_file: '10044 - Tree Corr 1.pdf', category: 'Tree inventory / survey' }),
  ...letter({ discipline: 'Zoning', cycle: 1, n: 3, source_file: '10044 - Zoning Corr 1.pdf', category: 'Height & grade calc' }),
  ...letter({ discipline: 'Addressing', cycle: 2, n: 1, source_file: '10044 - Addressing Corr 2.pdf', category: 'Address assignment / display' }),
];

const EASTSIDE: CorrectionItem[] = ['SFR 1', 'SFR 2', 'SFR 3', 'SFR 4'].flatMap(
  (building) =>
    letter({
      discipline: null, cycle: 1, n: 12, building,
      source_file: `10431 - ${building} - Correction Letter 1.pdf`,
      category: 'Missing / incorrect plan info',
    }),
);

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
  state.rows = [];
  state.error = null;
  state.select = '';
  state.eq = null;
  state.orders = [];
  state.calls = 0;
});

// --------------------------------------------------------------- the query --

describe('fix-276 the corrections read is narrow and project-scoped', () => {
  it('filters on project_id and selects only the displayed columns', async () => {
    state.rows = SEATTLE;
    renderPanel();
    await screen.findByTestId('corrections-summary');

    expect(state.eq).toEqual(['project_id', PROJECT_ID]);
    expect(state.select).not.toContain('*');
    for (const col of [
      'building', 'discipline', 'cycle', 'letter_date', 'reviewer',
      'item_no', 'subject', 'body', 'codes', 'category', 'theme', 'source_file',
    ]) {
      expect(state.select).toContain(col);
    }
  });

  it('orders totally so a refetch cannot reshuffle equal rows', async () => {
    state.rows = SEATTLE;
    renderPanel();
    await screen.findByTestId('corrections-summary');
    expect(state.orders.map(([col]) => col)).toEqual([
      'cycle', 'source_file', 'item_no',
    ]);
  });

  it('does not fire until the active tenant is known', async () => {
    useAuthStore.setState({ activeTenantId: null, memberships: [] });
    state.rows = SEATTLE;
    renderPanel();
    await new Promise((r) => setTimeout(r, 30));
    expect(state.calls).toBe(0);
  });
});

// ----------------------------------------------------- 10044 37th Ave SW ----

describe('fix-276 Corrections panel — 10044 37th Ave SW (Seattle)', () => {
  beforeEach(() => {
    state.rows = SEATTLE;
  });

  it('header reports 20 items, 2 cycles and 1 repeat topic', async () => {
    renderPanel();
    const summary = await screen.findByTestId('corrections-summary');
    expect(within(summary).getByTestId('corrections-summary-total')).toHaveTextContent('20 items');
    expect(within(summary).getByTestId('corrections-summary-cycles')).toHaveTextContent('2 cycles');
    expect(within(summary).getByTestId('corrections-summary-cycles')).toHaveTextContent('1, 2');
    expect(within(summary).getByTestId('corrections-summary-repeats')).toHaveTextContent('1 repeat topic');
  });

  it('renders NO building level — every row has building NULL', async () => {
    renderPanel();
    await screen.findByTestId('corrections-summary');
    expect(screen.queryByTestId('corrections-building-label-none')).toBeNull();
    expect(screen.queryByText('Whole project')).toBeNull();
  });

  it('groups into Cycle 1 (19 items) and Cycle 2 (1 item)', async () => {
    renderPanel();
    await screen.findByTestId('corrections-summary');
    const c1 = screen.getByTestId('corrections-cycle-none-1');
    const c2 = screen.getByTestId('corrections-cycle-none-2');
    expect(within(c1).getByText('Cycle 1')).toBeInTheDocument();
    expect(within(c1).getByText('19 items')).toBeInTheDocument();
    expect(within(c2).getByText('Cycle 2')).toBeInTheDocument();
    expect(within(c2).getByText('1 item')).toBeInTheDocument();
  });

  it('cycle 1 shows the six disciplines with their item counts', async () => {
    renderPanel();
    await screen.findByTestId('corrections-summary');
    const c1 = screen.getByTestId('corrections-cycle-none-1');
    for (const [discipline, n] of [
      ['Energy', 5], ['OS', 5], ['Tree', 3], ['Zoning', 3],
      ['SCL', 2], ['Addressing', 1],
    ] as const) {
      const heading = within(c1)
        .getAllByText(discipline, { exact: false })
        .find((el) => el.textContent?.includes(`(${n})`));
      expect(heading, `${discipline} heading with (${n})`).toBeTruthy();
    }
  });

  it('renders one row per item — 20 in total', async () => {
    renderPanel();
    await screen.findByTestId('corrections-summary');
    const rows = screen
      .getAllByTestId(/^corrections-item-ci-/)
      .filter((el) => el.dataset.testid?.startsWith('corrections-item-ci-'));
    expect(rows).toHaveLength(20);
  });

  it('a row carries its category chip and reviewer + date', async () => {
    renderPanel();
    await screen.findByTestId('corrections-summary');
    const first = SEATTLE[0];
    const rowEl = screen.getByTestId(`corrections-item-${first.id}`);
    expect(within(rowEl).getByTestId(`corrections-item-category-${first.id}`))
      .toHaveTextContent('Address assignment / display');
    expect(within(rowEl).getByTestId(`corrections-item-meta-${first.id}`))
      .toHaveTextContent('Jose Franco · 2025-08-29');
  });
});

// ------------------------------------------------------ 10431 SE 19th St ----

describe('fix-276 Corrections panel — 10431 SE 19th St (east side)', () => {
  beforeEach(() => {
    state.rows = EASTSIDE;
  });

  it('renders SFR 1..4, 12 items each, in natural order', async () => {
    renderPanel();
    await screen.findByTestId('corrections-summary');
    for (const b of ['SFR 1', 'SFR 2', 'SFR 3', 'SFR 4']) {
      const label = screen.getByTestId(`corrections-building-label-${b}`);
      expect(label).toHaveTextContent(b);
      expect(label).toHaveTextContent('12 items');
    }
    const order = screen
      .getAllByTestId(/^corrections-building-label-/)
      .map((el) => el.textContent?.slice(0, 5));
    expect(order).toEqual(['SFR 1', 'SFR 2', 'SFR 3', 'SFR 4']);
  });

  it('header reports 48 items, 1 cycle, 0 repeat topics', async () => {
    renderPanel();
    const summary = await screen.findByTestId('corrections-summary');
    expect(within(summary).getByTestId('corrections-summary-total')).toHaveTextContent('48 items');
    expect(within(summary).getByTestId('corrections-summary-cycles')).toHaveTextContent('1 cycle');
    expect(within(summary).getByTestId('corrections-summary-repeats')).toHaveTextContent('0 repeat topics');
  });

  it('each building holds exactly one cycle', async () => {
    renderPanel();
    await screen.findByTestId('corrections-summary');
    for (const b of ['SFR 1', 'SFR 2', 'SFR 3', 'SFR 4']) {
      const cycle = screen.getByTestId(`corrections-cycle-${b}-1`);
      expect(within(cycle).getByText('Cycle 1')).toBeInTheDocument();
      expect(within(cycle).getByText('12 items')).toBeInTheDocument();
    }
  });

  it('a null discipline renders as Unspecified rather than swallowing the rows', async () => {
    renderPanel();
    await screen.findByTestId('corrections-summary');
    const cycle = screen.getByTestId('corrections-cycle-SFR 1-1');
    expect(
      within(cycle)
        .getAllByText('Unspecified', { exact: false })
        .some((el) => el.textContent?.includes('(12)')),
    ).toBe(true);
  });
});

// ------------------------------------------------------------ interaction ---

describe('fix-276 body expansion', () => {
  it('a body is hidden until the row is clicked, then shown', async () => {
    const only = row({
      discipline: 'Zoning', cycle: 1, category: 'Setbacks',
      subject: 'Rear yard', body: 'Dimension the rear yard on A1.0.',
      codes: 'SMC 23.44.014', source_file: 'z.pdf',
    });
    state.rows = [only];
    renderPanel();
    await screen.findByTestId('corrections-summary');

    expect(screen.queryByTestId(`corrections-item-body-${only.id}`)).toBeNull();
    const toggle = screen.getByTestId(`corrections-item-toggle-${only.id}`);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    const body = screen.getByTestId(`corrections-item-body-${only.id}`);
    expect(body).toHaveTextContent('Dimension the rear yard on A1.0.');
    // The code citations + the letter the comment came from ride along.
    expect(body).toHaveTextContent('SMC 23.44.014');
    expect(body).toHaveTextContent('z.pdf');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(toggle);
    expect(screen.queryByTestId(`corrections-item-body-${only.id}`)).toBeNull();
  });

  it('a row with no body offers no toggle to press', async () => {
    const only = row({ body: null, subject: 'No body here' });
    state.rows = [only];
    renderPanel();
    await screen.findByTestId('corrections-summary');
    expect(screen.getByTestId(`corrections-item-${only.id}`)).toHaveTextContent('No body here');
    expect(screen.queryByTestId(`corrections-item-toggle-${only.id}`)).toBeNull();
  });

  it('a missing subject still renders a row', async () => {
    const only = row({ subject: null });
    state.rows = [only];
    renderPanel();
    await screen.findByTestId('corrections-summary');
    expect(screen.getByTestId(`corrections-item-${only.id}`)).toHaveTextContent('(no subject)');
  });
});

// ------------------------------------------------------------ empty/error ---

describe('fix-276 empty and failure states', () => {
  it('a project with nothing indexed says so — the common case', async () => {
    state.rows = [];
    renderPanel();
    expect(await screen.findByTestId('corrections-panel-empty')).toHaveTextContent(
      'No indexed corrections for this project.',
    );
    expect(screen.queryByTestId('corrections-summary')).toBeNull();
  });

  it('the panel still renders its heading when empty', async () => {
    state.rows = [];
    renderPanel();
    await screen.findByTestId('corrections-panel-empty');
    expect(screen.getByTestId('corrections-panel')).toHaveTextContent('Corrections');
  });

  it('a failed load degrades to an inline notice, not a blank overview', async () => {
    state.error = { message: 'permission denied for table correction_items' };
    renderPanel();
    expect(
      await screen.findByTestId('corrections-panel-load-error'),
    ).toHaveTextContent('Corrections could not be loaded.');
    expect(screen.getByTestId('corrections-panel-retry')).toBeInTheDocument();
  });

  it('retry re-issues the query', async () => {
    state.error = { message: 'boom' };
    renderPanel();
    await screen.findByTestId('corrections-panel-retry');
    const before = state.calls;
    state.error = null;
    state.rows = SEATTLE;
    fireEvent.click(screen.getByTestId('corrections-panel-retry'));
    await waitFor(() => expect(state.calls).toBeGreaterThan(before));
    expect(await screen.findByTestId('corrections-summary')).toHaveTextContent('20 items');
  });

  it('a null cycle is surfaced rather than silently dropped', async () => {
    state.rows = [
      row({ cycle: 1, discipline: 'Zoning', category: 'Setbacks' }),
      row({ cycle: null, discipline: 'Zoning', category: 'Setbacks' }),
    ];
    renderPanel();
    const summary = await screen.findByTestId('corrections-summary');
    expect(within(summary).getByTestId('corrections-summary-total')).toHaveTextContent('2 items');
    expect(within(summary).getByTestId('corrections-summary-unknown-cycle')).toBeInTheDocument();
    expect(screen.getByTestId('corrections-cycle-none-unknown')).toHaveTextContent('Unknown cycle');
  });
});
