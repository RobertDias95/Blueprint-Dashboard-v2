import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// ===========================================================================
// fix-374 · §2 §3 §5 — what the corrections report greets you with
// ===========================================================================
//
// Bobby: *"can we make this drill down more relevant on the main screen? seems
// complicated to find… I have to go by theme/discipline to get the drill down
// option."* and *"idk what prevalance is."*
//
// Every fixture is a real value measured on prod 2026-08-20.

const T = 'test-tenant-uuid';

const state = vi.hoisted(() => ({
  ranking: [] as unknown[],
  disciplines: [] as unknown[],
  items: [] as unknown[],
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (name: string) => {
      if (name === 'bp_correction_cluster_ranking') {
        return Promise.resolve({ data: state.ranking, error: null });
      }
      if (name === 'bp_correction_cluster_discipline') {
        return Promise.resolve({ data: state.disciplines, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.order = () => chain;
      chain.range = () => Promise.resolve({ data: [], error: null });
      return chain;
    },
  },
}));

vi.mock('../hooks/useAllCorrectionItems', () => ({
  useAllCorrectionItems: () => ({
    data: state.items, isLoading: false, error: null, refetch: vi.fn(),
  }),
}));

import RecurringCorrections from '../components/Reports/RecurringCorrections';

function cluster(over: Record<string, unknown>) {
  return {
    cluster_key: 'k', tier: 'subject', subject: 's', label: 'l',
    display_name: null, item_count: 10, project_count: 10, reviewer_count: 3,
    distinct_bodies: 5, scope_projects: 100, project_share: 10,
    wording_variance: 0.5, is_verbatim: false, hidden: false,
    merged_into_key: null, fix_note: null, fix_note_by_name: null,
    fix_note_at: null, addressed_on: null, occurrences_after_addressed: 0,
    first_seen: null, last_seen: null, sheets: [], codes: [],
    ...over,
  };
}

function renderView() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<RecurringCorrections />, { wrapper });
}

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T, memberships: [{ tenant_id: T, role: 'admin' }],
  });
  state.ranking = [
    // The real `General` pile: 75 Seattle projects, and genuinely two
    // disciplines rather than one.
    cluster({ cluster_key: 'subject:general', label: 'General',
              subject: 'General', project_count: 75, project_share: 63.6,
              item_count: 476 }),
    // fix-372's worked example, a coded subject that IS the correction.
    cluster({ cluster_key: 'subject:302 fire separation',
              label: '302 Fire Separation', subject: '302 Fire Separation',
              project_count: 39, project_share: 33.1, item_count: 106 }),
  ];
  state.disciplines = [
    { cluster_key: 'subject:general', discipline: 'Drainage', items: 206 },
    { cluster_key: 'subject:general', discipline: 'Energy', items: 203 },
    { cluster_key: 'subject:general', discipline: 'Reveg', items: 7 },
    { cluster_key: 'subject:general', discipline: 'Compiled', items: 6 },
    { cluster_key: 'subject:302 fire separation', discipline: 'Building',
      items: 106 },
  ];
  state.items = [];
});

describe('fix-374 §2 the drill-down greets you', () => {
  it('★★★ the recurring corrections are on the landing view itself', async () => {
    renderView();
    await screen.findByTestId('recurring-list');
    // Bobby had to go to "By theme & discipline" to find this. He does not now.
    expect(screen.getByTestId('recurring-row-subject:general')).toBeTruthy();
  });

  it('★★★ ONE CLICK to a specific recurring correction', async () => {
    renderView();
    await screen.findByTestId('recurring-list');
    const row = screen.getByTestId('recurring-row-subject:302 fire separation');
    // The row opens THAT pattern, not the top of a list to search again.
    expect(row.getAttribute('href')).toBe(
      '/reports/corrections/patterns?open=subject%3A302%20fire%20separation');
  });

  it('★★★ ranks by project reach — the mixed pile is not buried', async () => {
    renderView();
    await screen.findByTestId('recurring-list');
    // `General` is 75 projects to 302 Fire Separation's 39, and it is also the
    // pile no single discipline owns. It stays FIRST; what changed is that it
    // now says what it is made of instead of pretending to be one thing.
    const rows = screen.getAllByTestId(/^recurring-row-/);
    expect(rows[0].getAttribute('data-testid')).toContain('subject:general');
  });
});

describe('fix-374 §1 the landing view is organised by discipline', () => {
  it('★★★ a coded subject sits under the discipline it is about', async () => {
    renderView();
    await screen.findByTestId('recurring-list');
    const building = screen.getByTestId('recurring-group-Building');
    expect(building).toHaveTextContent('Building');
    // ...and 302 Fire Separation is the row inside it.
    const list = building.parentElement!;
    expect(within(list).getByTestId('recurring-row-subject:302 fire separation'))
      .toBeTruthy();
  });

  it('★★★ the General pile is NOT given one discipline it does not deserve', async () => {
    renderView();
    await screen.findByTestId('recurring-list');
    // Drainage 206 vs Energy 203 is a coin toss; naming one would repeat the
    // junk-drawer mistake with a different word.
    const group = screen.getByTestId('recurring-group-Several disciplines');
    expect(group).toBeTruthy();
    const chip = screen.getByTestId('recurring-discipline-subject:general');
    expect(chip).toHaveTextContent('Drainage 206');
    expect(chip).toHaveTextContent('Energy 203');
  });

  it('★ groups follow the ranking, not the alphabet or their size', async () => {
    renderView();
    await screen.findByTestId('recurring-list');
    const groups = screen.getAllByTestId(/^recurring-group-/);
    expect(groups.map((g) => g.getAttribute('data-testid')))
      .toEqual(['recurring-group-Several disciplines', 'recurring-group-Building']);
  });
});

describe('fix-374 §5 the reviewer count is never stated as exact', () => {
  beforeEach(() => {
    state.items = [
      ...Array.from({ length: 145 }, () => ({
        reviewer: 'Jessica', discipline: 'Drainage' })),
      ...Array.from({ length: 28 }, () => ({
        reviewer: 'Jessica Batterman', discipline: 'Drainage' })),
      ...Array.from({ length: 5 }, () => ({
        reviewer: 'Jessica sewer main) and that is incorrect.',
        discipline: 'Drainage' })),
      ...Array.from({ length: 12 }, () => ({
        reviewer: null, discipline: 'Zoning' })),
    ];
  });

  it('★★★ says "at most", and why', async () => {
    renderView();
    const caveat = await screen.findByTestId('reviewer-caveat');
    expect(caveat).toHaveTextContent('At most 3 reviewers');
    expect(caveat).toHaveTextContent('the real number is smaller');
    // The two defects are named, and named as somebody else's to fix.
    expect(caveat).toHaveTextContent('body text');
    expect(caveat).toHaveTextContent('several spellings');
    expect(caveat).toHaveTextContent('fix-375');
  });

  it('★★ items with no reviewer are stated, not silently dropped', async () => {
    renderView();
    expect(await screen.findByTestId('reviewer-none'))
      .toHaveTextContent('12 comments carry no reviewer');
  });

  it('★★ flags a reviewer whose comments mostly sit in one discipline', async () => {
    state.items = [
      ...Array.from({ length: 140 }, () => ({
        reviewer: 'Jessica', discipline: 'Drainage' })),
      ...Array.from({ length: 5 }, () => ({
        reviewer: 'Jessica', discipline: 'Structural' })),
    ];
    renderView();
    const flags = await screen.findByTestId('reviewer-outliers');
    expect(flags).toHaveTextContent('140 Drainage');
    expect(flags).toHaveTextContent('5 Structural');
    // ★★★ A flag, never a correction.
    expect(flags).toHaveTextContent('Worth a look, not a correction');
    expect(flags).toHaveTextContent('Nothing here changes the discipline');
  });

  it('says nothing at all when there is nothing to flag', async () => {
    state.items = [{ reviewer: 'Matt Lewis', discipline: 'Zoning' }];
    renderView();
    await screen.findByTestId('recurring-list');
    expect(screen.queryByTestId('reviewer-outliers')).toBeNull();
  });
});
