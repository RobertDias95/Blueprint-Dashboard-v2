import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

// Q6.3.a: smoke tests for LibraryMatrix. Mocks the two read hooks so the
// component renders synchronously with a fixed dataset; verifies row
// rendering, filter narrowing, sort toggling, and the empty state.

const T = 'test-tenant-uuid';

// fix-22 Mig 3: physical fields (units/zone/lot_*/alley/product_types/
// project_tags) live on projects now. Matrix rows read from project.
const fixtures = vi.hoisted(() => ({
  projects: [
    {
      id: 'a',
      address: '100 Apple Way',
      juris: 'Seattle',
      archived: false,
      notes: null,
      units: 3,
      // fix-122: project-level num_lots + is_corner_lot. Project a is
      // a 1-lot corner; project b is a 5-lot subdivision, not on a
      // corner; project c is unanswered (null) on both.
      num_lots: 1,
      is_corner_lot: true,
      zone: 'NR',
      lot_width: 40,
      lot_depth: 100,
      alley: 'Yes',
      product_types: ['SFR'],
      project_tags: ['ECA'],
      // fix-81: three Cottages — narrow + short. Used by the
      // unit-width filter test (25 ± 2 matches all three) and the
      // search-by-unit-name test ("cottage" surfaces this project).
      // fix-205: cottages carry stories=2; a-3 is a BLANK-label unit (4
      // stories) used by the "unnamed → single product type" + stories
      // filter tests.
      unit_types: [
        { label: 'Cottage 1', width_ft: 25, depth_ft: 60, qty: 1, stories: 2 },
        { label: 'Cottage 2', width_ft: 25, depth_ft: 60, qty: 1, stories: 2 },
        { label: 'Cottage 3', width_ft: 25, depth_ft: 60, qty: 1, stories: 2 },
        { label: '', width_ft: 30, depth_ft: 50, qty: 1, stories: 4 },
      ],
      // fix-206: OCC token so the editable Library unit table is enabled.
      updated_at: '2026-06-25T10:00:00Z',
    },
    {
      id: 'b',
      address: '300 Oak Ln',
      juris: 'Bellevue',
      archived: false,
      notes: null,
      units: 5,
      num_lots: 5,
      is_corner_lot: false,
      zone: 'R-2',
      lot_width: 60,
      lot_depth: 120,
      alley: 'No',
      product_types: ['Attached Units'],
      project_tags: ['SIP'],
      // One SFR unit at 40×80 — used by the unit-width filter test
      // (target 40 ± 2 matches this row's unit, none of project a's
      // 25-wide cottages).
      unit_types: [
        { label: 'SFR 1', width_ft: 40, depth_ft: 80, qty: 1, stories: 3 },
      ],
      updated_at: '2026-06-25T10:00:00Z',
    },
    {
      id: 'c',
      address: '500 Pike St',
      juris: 'Seattle',
      archived: false,
      notes: null,
      units: 7,
      zone: 'NR',
      lot_width: 80,
      lot_depth: 120,
      alley: 'Yes',
      product_types: ['SFR'],
      project_tags: [],
      // No unit_types at all — caret should not render; row drops out
      // of any unit-dim filter.
      unit_types: null,
    },
    { id: 'd', address: '700 Archived', juris: 'Seattle', archived: true, notes: null },
  ],
  permits: [
    {
      id: 1,
      project_id: 'a',
      type: 'Building Permit',
      stage: 'de',
      stage_override: 'de',
      status: null,
      num: null,
      da: null,
      dm: null,
      ent_lead: null,
      dual_da: null,
      go_date: null,
      target_submit: null,
      dd_start: null,
      dd_end: null,
      expected_issue: null,
      actual_issue: null,
      approval_date: null,
      intake_date: null,
      units: 3,
      notes: null,
      cycle_model: null,
      view_cycle: null,
      kickoff_date: null,
      zone: 'NR',
      product_types: ['SFR'],
      project_tags: ['ECA'],
      unit_types: null,
      parking_type: null,
      parking_stalls: null,
      lot_width: 40,
      lot_depth: 100,
      alley: 'Yes',
      corr_rounds: null,
      permit_owner: null,
      architect: null,
      nickname: null,
      struct_address: null,
      portal_url: null,
      updated_at: '2026-05-10T00:00:00Z',
      permit_cycles: [],
    },
    {
      id: 2,
      project_id: 'b',
      type: 'Building Permit',
      stage: 'pm',
      stage_override: 'pm',
      status: null,
      num: null,
      da: null,
      dm: null,
      ent_lead: null,
      dual_da: null,
      go_date: null,
      target_submit: null,
      dd_start: null,
      dd_end: null,
      expected_issue: null,
      actual_issue: null,
      approval_date: null,
      intake_date: null,
      units: 5,
      notes: null,
      cycle_model: null,
      view_cycle: null,
      kickoff_date: null,
      zone: 'R-2',
      product_types: ['Attached Units'],
      project_tags: ['SIP'],
      unit_types: null,
      parking_type: null,
      parking_stalls: null,
      lot_width: 60,
      lot_depth: 120,
      alley: 'No',
      corr_rounds: null,
      permit_owner: null,
      architect: null,
      nickname: null,
      struct_address: null,
      portal_url: null,
      updated_at: '2026-05-10T00:00:00Z',
      permit_cycles: [],
    },
    {
      id: 3,
      project_id: 'c',
      type: 'Building Permit',
      stage: 'de',
      stage_override: 'de',
      status: null,
      num: null,
      da: null,
      dm: null,
      ent_lead: null,
      dual_da: null,
      go_date: null,
      target_submit: null,
      dd_start: null,
      dd_end: null,
      expected_issue: null,
      actual_issue: null,
      approval_date: null,
      intake_date: null,
      units: 7,
      notes: null,
      cycle_model: null,
      view_cycle: null,
      kickoff_date: null,
      zone: 'NR',
      product_types: ['SFR'],
      project_tags: [],
      unit_types: null,
      parking_type: null,
      parking_stalls: null,
      lot_width: 80,
      lot_depth: 120,
      alley: 'Yes',
      corr_rounds: null,
      permit_owner: null,
      architect: null,
      nickname: null,
      struct_address: null,
      portal_url: null,
      updated_at: '2026-05-10T00:00:00Z',
      permit_cycles: [],
    },
  ],
}));

// fix-206: capture the editable-table write path.
const updateMutateAsync = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
}));

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: fixtures.projects,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: fixtures.permits,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import LibraryMatrix from '../components/LibraryMatrix';

beforeEach(() => {
  updateMutateAsync.mockReset();
  updateMutateAsync.mockResolvedValue({ id: 'a', updated_at: '2026-06-25T11:00:00Z' });
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LibraryMatrix />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('<LibraryMatrix />', () => {
  it('renders one row per non-archived project that has a permit', () => {
    renderIt();
    expect(screen.getByTestId('library-row-a')).toBeInTheDocument();
    expect(screen.getByTestId('library-row-b')).toBeInTheDocument();
    expect(screen.getByTestId('library-row-c')).toBeInTheDocument();
    // 'd' is archived → not rendered.
    expect(screen.queryByTestId('library-row-d')).not.toBeInTheDocument();
    expect(screen.getByTestId('library-count').textContent).toMatch(/^3 projects/);
  });

  it('renders the address as a link to the project detail page', () => {
    renderIt();
    const link = screen.getByTestId('library-row-a').querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/project/a');
  });

  it('search filter narrows by address tokens', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('library-search'), {
      target: { value: 'pike' },
    });
    expect(screen.getByTestId('library-row-c')).toBeInTheDocument();
    expect(screen.queryByTestId('library-row-a')).not.toBeInTheDocument();
    expect(screen.queryByTestId('library-row-b')).not.toBeInTheDocument();
  });

  it('lot-width target ± buf narrows correctly', () => {
    renderIt();
    // Target 60 ± 2 → matches lotWidth in [58, 62]. Only row b (60) qualifies.
    fireEvent.change(screen.getByTestId('lotw-target'), { target: { value: '60' } });
    expect(screen.getByTestId('library-row-b')).toBeInTheDocument();
    expect(screen.queryByTestId('library-row-a')).not.toBeInTheDocument();
    expect(screen.queryByTestId('library-row-c')).not.toBeInTheDocument();
  });

  it('jurisdiction filter is exact match', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('filter-juris'), {
      target: { value: 'Bellevue' },
    });
    expect(screen.getByTestId('library-row-b')).toBeInTheDocument();
    expect(screen.queryByTestId('library-row-a')).not.toBeInTheDocument();
    expect(screen.queryByTestId('library-row-c')).not.toBeInTheDocument();
  });

  it('Clear button resets all filters', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('filter-juris'), {
      target: { value: 'Seattle' },
    });
    expect(screen.queryByTestId('library-row-b')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('filter-clear'));
    expect(screen.getByTestId('library-row-b')).toBeInTheDocument();
    expect(screen.getByTestId('library-count').textContent).toMatch(/^3 projects/);
  });

  it('clicking a sortable header toggles the sort direction (units numeric)', () => {
    renderIt();
    const rows = () =>
      Array.from(document.querySelectorAll('[data-testid^="library-row-"]')).map(
        (el) => (el as HTMLElement).dataset.testid?.replace('library-row-', ''),
      );
    // Default sort is address ascending → [a, b, c].
    expect(rows()).toEqual(['a', 'b', 'c']);
    // Click "Units" once → ascending (3, 5, 7) → [a, b, c] (same as default).
    fireEvent.click(screen.getByTestId('library-th-units'));
    expect(rows()).toEqual(['a', 'b', 'c']);
    // Click again → descending (7, 5, 3) → [c, b, a].
    fireEvent.click(screen.getByTestId('library-th-units'));
    expect(rows()).toEqual(['c', 'b', 'a']);
  });

  it('shows the empty state when filters exclude every row', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('library-search'), {
      target: { value: 'nonexistent-address-token' },
    });
    expect(screen.getByText(/No projects match/i)).toBeInTheDocument();
    expect(screen.getByTestId('library-count').textContent).toMatch(/^0 projects/);
  });

  // fix-81: per-row caret expands a nested mini-table that lists every
  // unit_type on the project (name + width + depth + qty).
  it('clicking the caret expands a row to show its unit_types', () => {
    renderIt();
    // Default: collapsed; mini-table should not be in the DOM.
    expect(screen.queryByTestId('library-unit-table-a')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('library-caret-a'));
    const miniTable = screen.getByTestId('library-unit-table-a');
    expect(miniTable).toBeInTheDocument();
    // fix-206: cells are now editable inputs — assert their values.
    expect(
      (screen.getByTestId('library-unit-a-0-label') as HTMLInputElement).value,
    ).toBe('Cottage 1');
    expect(
      (screen.getByTestId('library-unit-a-0-w') as HTMLInputElement).value,
    ).toBe('25');
    expect(
      (screen.getByTestId('library-unit-a-0-d') as HTMLInputElement).value,
    ).toBe('60');
    expect(
      (screen.getByTestId('library-unit-a-1-label') as HTMLInputElement).value,
    ).toBe('Cottage 2');
    expect(
      (screen.getByTestId('library-unit-a-2-label') as HTMLInputElement).value,
    ).toBe('Cottage 3');
  });

  it('projects with no unit_types do not render an expand caret', () => {
    renderIt();
    expect(screen.queryByTestId('library-caret-c')).not.toBeInTheDocument();
  });

  it('unit-width target ± buf filters by per-unit dim and auto-expands + highlights matches', () => {
    renderIt();
    // Target 40 ± 2 → matches [38, 42]. Project a's cottages are 25 wide
    // (out). Project b's SFR 1 is 40 wide (in). Project c has no units
    // (drops when unit filter is active).
    fireEvent.change(screen.getByTestId('unitw-target'), { target: { value: '40' } });
    expect(screen.queryByTestId('library-row-a')).not.toBeInTheDocument();
    expect(screen.getByTestId('library-row-b')).toBeInTheDocument();
    expect(screen.queryByTestId('library-row-c')).not.toBeInTheDocument();
    // Auto-expanded because the unit filter is active.
    expect(screen.getByTestId('library-unit-table-b')).toBeInTheDocument();
    // The matching unit row is flagged via data-matched="true".
    expect(
      screen.getByTestId('library-unit-row-b-0').getAttribute('data-matched'),
    ).toBe('true');
  });

  it('unit-width filter narrows project a to its Cottage rows (all three match 25 ± 2)', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('unitw-target'), { target: { value: '25' } });
    expect(screen.getByTestId('library-row-a')).toBeInTheDocument();
    expect(screen.queryByTestId('library-row-b')).not.toBeInTheDocument();
    // All three Cottages highlight.
    expect(screen.getByTestId('library-unit-row-a-0').getAttribute('data-matched')).toBe('true');
    expect(screen.getByTestId('library-unit-row-a-1').getAttribute('data-matched')).toBe('true');
    expect(screen.getByTestId('library-unit-row-a-2').getAttribute('data-matched')).toBe('true');
  });

  it('search by unit_type name surfaces projects with a matching unit (e.g. "cottage")', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('library-search'), {
      target: { value: 'cottage' },
    });
    expect(screen.getByTestId('library-row-a')).toBeInTheDocument();
    expect(screen.queryByTestId('library-row-b')).not.toBeInTheDocument();
    expect(screen.queryByTestId('library-row-c')).not.toBeInTheDocument();
  });

  it('clicking the caret on an auto-expanded row collapses it', () => {
    renderIt();
    // Activate the unit filter so a auto-expands.
    fireEvent.change(screen.getByTestId('unitw-target'), { target: { value: '25' } });
    expect(screen.getByTestId('library-unit-table-a')).toBeInTheDocument();
    // Toggle off via the caret.
    fireEvent.click(screen.getByTestId('library-caret-a'));
    expect(screen.queryByTestId('library-unit-table-a')).not.toBeInTheDocument();
  });

  // fix-205: Stories column + "unnamed" fix + Stories filter.
  describe('fix-205: stories + unnamed', () => {
    it('expand shows a Stories column with each unit_type stories value', () => {
      renderIt();
      fireEvent.click(screen.getByTestId('library-caret-a'));
      const table = screen.getByTestId('library-unit-table-a');
      expect(table.textContent).toContain('Stories'); // column header
      // Cottage rows carry stories=2 (now an editable input value).
      expect(
        (screen.getByTestId('library-unit-a-0-stories') as HTMLInputElement)
          .value,
      ).toBe('2');
    });

    it('a blank-label unit auto-labels via the single product type (placeholder), never "unnamed"', () => {
      renderIt();
      fireEvent.click(screen.getByTestId('library-caret-a'));
      // a-3 has label '' and the project's single product type is SFR: the
      // editable Label input shows the type as its placeholder (auto-label),
      // and the row never renders the word "unnamed".
      const labelInput = screen.getByTestId(
        'library-unit-a-3-label',
      ) as HTMLInputElement;
      expect(labelInput.value).toBe('');
      expect(labelInput.placeholder).toBe('SFR');
      expect(
        screen.getByTestId('library-unit-row-a-3').textContent,
      ).not.toContain('unnamed');
    });

    it('Stories filter = 4+ narrows to projects with a 4+-story unit, auto-expands + highlights it', () => {
      renderIt();
      fireEvent.change(screen.getByTestId('filter-stories'), {
        target: { value: '4+' },
      });
      // Project a has the 4-story unit (a-3); b's SFR is 3, c has no units.
      expect(screen.getByTestId('library-row-a')).toBeInTheDocument();
      expect(screen.queryByTestId('library-row-b')).not.toBeInTheDocument();
      expect(screen.queryByTestId('library-row-c')).not.toBeInTheDocument();
      // Auto-expanded; only the 4-story unit is flagged matched.
      expect(screen.getByTestId('library-unit-table-a')).toBeInTheDocument();
      expect(
        screen.getByTestId('library-unit-row-a-3').getAttribute('data-matched'),
      ).toBe('true');
      expect(
        screen.getByTestId('library-unit-row-a-0').getAttribute('data-matched'),
      ).not.toBe('true');
    });

    it('Stories filter = 2 narrows to projects with a 2-story unit', () => {
      renderIt();
      fireEvent.change(screen.getByTestId('filter-stories'), {
        target: { value: '2' },
      });
      // Only project a's cottages are 2-story.
      expect(screen.getByTestId('library-row-a')).toBeInTheDocument();
      expect(screen.queryByTestId('library-row-b')).not.toBeInTheDocument();
      expect(screen.getByTestId('library-count').textContent).toMatch(/^1 project/);
    });
  });

  // fix-206: the unit table is editable through the SAME useUpdateProject path
  // as Project Overview (one store → bidirectional by construction).
  describe('fix-206: editable unit table', () => {
    function expandA() {
      renderIt();
      fireEvent.click(screen.getByTestId('library-caret-a'));
    }

    it('editing a unit width persists via useUpdateProject with the project OCC token + resolved rows', () => {
      expandA();
      const wInput = screen.getByTestId('library-unit-a-0-w') as HTMLInputElement;
      fireEvent.change(wInput, { target: { value: '27.5' } });
      fireEvent.blur(wInput);
      expect(updateMutateAsync).toHaveBeenCalledTimes(1);
      const call = updateMutateAsync.mock.calls[0][0];
      expect(call.projectId).toBe('a');
      expect(call.expectedUpdatedAt).toBe('2026-06-25T10:00:00Z');
      // Decimal persists; the edited row carries the new width.
      expect(call.patch.unit_types[0].width_ft).toBe(27.5);
      // Other rows untouched; labels preserved (resolveUnitTypesForSave).
      expect(call.patch.unit_types[0].label).toBe('Cottage 1');
      expect(call.patch.unit_types).toHaveLength(4);
    });

    it('editing stories persists the new stories value', () => {
      expandA();
      const sty = screen.getByTestId('library-unit-a-0-stories') as HTMLInputElement;
      fireEvent.change(sty, { target: { value: '3' } });
      fireEvent.blur(sty);
      expect(updateMutateAsync).toHaveBeenCalledTimes(1);
      expect(updateMutateAsync.mock.calls[0][0].patch.unit_types[0].stories).toBe(3);
    });

    it('a blank-label row saved under a single product type persists that type (no "unnamed")', () => {
      expandA();
      // a-3 has a blank label; editing its depth triggers a save that resolves
      // the label to the project's single product type (SFR).
      const dInput = screen.getByTestId('library-unit-a-3-d') as HTMLInputElement;
      fireEvent.change(dInput, { target: { value: '52' } });
      fireEvent.blur(dInput);
      expect(updateMutateAsync).toHaveBeenCalledTimes(1);
      const row = updateMutateAsync.mock.calls[0][0].patch.unit_types[3];
      expect(row.depth_ft).toBe(52);
      expect(row.label).toBe('SFR');
    });

    it('a no-op blur (unchanged value) does not fire a write', () => {
      expandA();
      const wInput = screen.getByTestId('library-unit-a-0-w') as HTMLInputElement;
      // Blur without changing the value (still 25).
      fireEvent.blur(wInput);
      expect(updateMutateAsync).not.toHaveBeenCalled();
    });

    it('single-product-type project renders a freeform Label input with the type as placeholder (auto-label)', () => {
      // Project a has the single product type SFR → no dropdown; the Label is a
      // text input whose placeholder is the auto-label (parity with Project
      // Overview). The multi-type dropdown rules are covered by the shared
      // resolveUnitLabel tests + ProjectDetailHeaderFix205.
      expandA();
      const label = screen.getByTestId('library-unit-a-0-label');
      expect(label.tagName.toLowerCase()).toBe('input');
      expect((label as HTMLInputElement).placeholder).toBe('SFR');
    });
  });

  // fix-122: two new Library columns (Lots, Corner) + two new filters.
  describe('fix-122: Lots / Corner columns + filters', () => {
    it('renders Lots column with project-level num_lots', () => {
      renderIt();
      expect(screen.getByTestId('library-num-lots-a').textContent).toBe('1');
      expect(screen.getByTestId('library-num-lots-b').textContent).toBe('5');
      // Project c has no num_lots → em-dash.
      expect(screen.getByTestId('library-num-lots-c').textContent).toBe('—');
    });

    it('renders Corner column with project-level is_corner_lot', () => {
      renderIt();
      expect(screen.getByTestId('library-corner-a').textContent).toBe('Yes');
      expect(screen.getByTestId('library-corner-b').textContent).toBe('No');
      // Project c has no is_corner_lot → em-dash (NULL ≠ confirmed No).
      expect(screen.getByTestId('library-corner-c').textContent).toBe('—');
    });

    it('filter-num-lots=5 narrows to the matching subdivision', () => {
      renderIt();
      fireEvent.change(screen.getByTestId('filter-num-lots'), {
        target: { value: '5' },
      });
      expect(screen.queryByTestId('library-row-a')).not.toBeInTheDocument();
      expect(screen.getByTestId('library-row-b')).toBeInTheDocument();
      // Project c has NULL num_lots → falls out when the filter is set.
      expect(screen.queryByTestId('library-row-c')).not.toBeInTheDocument();
    });

    it('filter-corner=Yes keeps only is_corner_lot=true rows; NULL falls out', () => {
      renderIt();
      fireEvent.change(screen.getByTestId('filter-corner'), {
        target: { value: 'Yes' },
      });
      expect(screen.getByTestId('library-row-a')).toBeInTheDocument();
      expect(screen.queryByTestId('library-row-b')).not.toBeInTheDocument();
      expect(screen.queryByTestId('library-row-c')).not.toBeInTheDocument();
    });

    it('filter-corner=No keeps only is_corner_lot=false rows', () => {
      renderIt();
      fireEvent.change(screen.getByTestId('filter-corner'), {
        target: { value: 'No' },
      });
      expect(screen.getByTestId('library-row-b')).toBeInTheDocument();
      expect(screen.queryByTestId('library-row-a')).not.toBeInTheDocument();
      expect(screen.queryByTestId('library-row-c')).not.toBeInTheDocument();
    });

    it('Clear button resets the Lots + Corner filters too', () => {
      renderIt();
      fireEvent.change(screen.getByTestId('filter-num-lots'), {
        target: { value: '5' },
      });
      fireEvent.change(screen.getByTestId('filter-corner'), {
        target: { value: 'Yes' },
      });
      fireEvent.click(screen.getByTestId('filter-clear'));
      expect(screen.getByTestId('library-count').textContent).toMatch(
        /^3 projects/,
      );
      expect(
        (screen.getByTestId('filter-num-lots') as HTMLSelectElement).value,
      ).toBe('');
      expect(
        (screen.getByTestId('filter-corner') as HTMLSelectElement).value,
      ).toBe('');
    });

    it('Closing Date does NOT render as a column (Library exclusion per spec)', () => {
      renderIt();
      // No "Closing" header in the matrix.
      const ths = Array.from(
        document.querySelectorAll('[data-testid="library-table"] thead th'),
      ).map((el) => el.textContent ?? '');
      for (const t of ths) {
        expect(t.toLowerCase()).not.toContain('closing');
      }
    });
  });
});
