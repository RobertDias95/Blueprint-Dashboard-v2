import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { queryKeys } from '../lib/queryKeys';

// fix-205: Project Overview unit-types editor — W/D decimals (wider inputs +
// step 0.5), per-row Stories, product-type Label dropdown (multi) / auto-label
// (single → "unnamed" fix on save).

const T = 'test-tenant-uuid';
const TOKEN = '2026-05-15T12:00:00Z';
const NEW_TOKEN = '2026-05-15T12:05:00Z';

const updateMutateAsync = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
}));
vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: new Map() }),
  readConsultantTypes: () => [] as { type: string; firms: string[] }[],
}));
vi.mock('../stores/toastStore', () => ({ pushToast: vi.fn() }));

import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

function projectFixture(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'p-test',
    address: '500 Pike St',
    juris: 'Seattle',
    archived: false,
    notes: null,
    acq_lead: null,
    external_team: {},
    builder_id: null,
    permit_order: [],
    entitlement_lead: null,
    design_manager: null,
    go_date: null,
    units: 4,
    zone: null,
    lot_width: null,
    lot_depth: null,
    unit_types: null,
    parking_type: null,
    parking_stalls: null,
    alley: null,
    product_types: [],
    project_tags: null,
    builder_name: null,
    builder_company: null,
    builder_email: null,
    builder_phone: null,
    created_at: TOKEN,
    updated_at: TOKEN,
    ...over,
  } as unknown as Parameters<typeof ProjectDetailHeader>[0]['project'];
}

function setup(over: Partial<Record<string, unknown>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const project = projectFixture(over);
  queryClient.setQueryData(queryKeys.projects(T), [project]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(
    <ProjectDetailHeader project={project} permits={[]} bp={null} />,
    { wrapper },
  );
}

beforeEach(() => {
  updateMutateAsync.mockReset();
  updateMutateAsync.mockResolvedValue({ id: 'p-test', updated_at: NEW_TOKEN });
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

// A single NAMED row forces the expanded grid (compact only renders for a lone
// unlabeled row).
const NAMED_ROW = [{ label: 'Type A', width_ft: 20, depth_ft: 30, qty: 1 }];

describe('fix-205: W/D decimals in the expanded grid', () => {
  it('W/D inputs allow half-foot steps and persist a decimal width', async () => {
    setup({ product_types: ['SFR'], unit_types: NAMED_ROW });
    const wInput = screen.getByTestId('pd-unit-w') as HTMLInputElement;
    expect(wInput.getAttribute('step')).toBe('0.5');
    expect(
      (screen.getByTestId('pd-unit-d') as HTMLInputElement).getAttribute('step'),
    ).toBe('0.5');
    fireEvent.change(wInput, { target: { value: '17.5' } });
    fireEvent.blur(wInput);
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutateAsync.mock.calls[0][0].patch.unit_types[0].width_ft).toBe(
      17.5,
    );
  });
});

describe('fix-205: per-row Stories', () => {
  it('Stories input persists onto the unit_types row', async () => {
    setup({ product_types: ['SFR'], unit_types: NAMED_ROW });
    const sty = screen.getByTestId('pd-unit-stories') as HTMLInputElement;
    fireEvent.change(sty, { target: { value: '3' } });
    fireEvent.blur(sty);
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutateAsync.mock.calls[0][0].patch.unit_types[0].stories).toBe(3);
  });
});

describe('fix-205: Label = product-type dropdown', () => {
  it('multiple product types → a Label dropdown whose options include the product types', () => {
    setup({
      product_types: ['SFR', 'Duplex'],
      unit_types: NAMED_ROW,
    });
    const select = screen.getByTestId('pd-unit-label-select') as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).toContain('SFR');
    expect(opts).toContain('Duplex');
    // Current off-list label is preserved as an option (no data loss).
    expect(opts).toContain('Type A');
  });

  it('picking a product type from the dropdown saves it as the label', async () => {
    setup({ product_types: ['SFR', 'Duplex'], unit_types: NAMED_ROW });
    const select = screen.getByTestId('pd-unit-label-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'Duplex' } });
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutateAsync.mock.calls[0][0].patch.unit_types[0].label).toBe(
      'Duplex',
    );
  });

  it('single product type → no dropdown (freeform input with the type as placeholder)', () => {
    setup({ product_types: ['SFR'], unit_types: NAMED_ROW });
    expect(screen.queryByTestId('pd-unit-label-select')).not.toBeInTheDocument();
  });
});

describe('fix-205: "unnamed" fix on save (single product type)', () => {
  it('a blank-label row saved under a single product type persists that type as its label', async () => {
    // A lone unlabeled row renders the COMPACT editor; editing a dimension
    // saves the row, and writeTypes resolves the blank label to the type.
    setup({
      product_types: ['SFR'],
      unit_types: [{ label: '', width_ft: null, depth_ft: null, qty: 1 }],
    });
    const wInput = screen.getByTestId('pd-units-compact-w') as HTMLInputElement;
    fireEvent.change(wInput, { target: { value: '96' } });
    fireEvent.blur(wInput);
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    const row = updateMutateAsync.mock.calls[0][0].patch.unit_types[0];
    expect(row.label).toBe('SFR');
    expect(row.width_ft).toBe(96);
  });

  it('does NOT clobber an existing non-empty label on save', async () => {
    setup({ product_types: ['SFR'], unit_types: NAMED_ROW });
    const wInput = screen.getByTestId('pd-unit-w') as HTMLInputElement;
    fireEvent.change(wInput, { target: { value: '21' } });
    fireEvent.blur(wInput);
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutateAsync.mock.calls[0][0].patch.unit_types[0].label).toBe(
      'Type A',
    );
  });
});
