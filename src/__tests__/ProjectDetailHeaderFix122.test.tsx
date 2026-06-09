import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { queryKeys } from '../lib/queryKeys';

// fix-122: three new project-level fields land in SiteEditor as
// inline-editable rows. These tests pin the DOM (Lots/Corner/Closing
// each have a pd-site-* testid + correct initial value) and the wire
// (each row commits the right typed value via useUpdateProject).

const T = 'test-tenant-uuid';
const OLD_TOKEN = '2026-05-15T12:00:00Z';

const updateMutateAsync = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({
    mutateAsync: updateMutateAsync,
    isPending: false,
  }),
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
    num_lots: null,
    is_corner_lot: null,
    closing_date: null,
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
    created_at: OLD_TOKEN,
    updated_at: OLD_TOKEN,
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
  const utils = render(
    <ProjectDetailHeader project={project} permits={[]} bp={null} />,
    { wrapper },
  );
  return { ...utils, queryClient };
}

beforeEach(() => {
  updateMutateAsync.mockReset();
  updateMutateAsync.mockResolvedValue({});
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('SiteEditor — fix-122 Number of Lots row', () => {
  it('renders blank when num_lots is null', () => {
    setup();
    const sel = screen.getByTestId('pd-site-lots') as HTMLSelectElement;
    expect(sel.value).toBe('');
  });

  it('renders the stored num_lots as the selected option', () => {
    setup({ num_lots: 5 });
    const sel = screen.getByTestId('pd-site-lots') as HTMLSelectElement;
    expect(sel.value).toBe('5');
  });

  it('lists blank + 1..20 (21 options total)', () => {
    setup();
    const sel = screen.getByTestId('pd-site-lots') as HTMLSelectElement;
    const values = [...sel.options].map((o) => o.value);
    expect(values).toHaveLength(21);
    expect(values[0]).toBe('');
    expect(values[20]).toBe('20');
  });

  it('picking a value commits num_lots as a number via useUpdateProject', async () => {
    setup();
    fireEvent.change(screen.getByTestId('pd-site-lots'), {
      target: { value: '3' },
    });
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    const call = updateMutateAsync.mock.calls[0][0];
    expect(call.projectId).toBe('p-test');
    expect(call.expectedUpdatedAt).toBe(OLD_TOKEN);
    expect(call.patch).toEqual({ num_lots: 3 });
    expect(call.fieldLabel).toBe('Number of Lots');
  });

  it('picking blank commits num_lots as null', async () => {
    setup({ num_lots: 7 });
    fireEvent.change(screen.getByTestId('pd-site-lots'), {
      target: { value: '' },
    });
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutateAsync.mock.calls[0][0].patch).toEqual({
      num_lots: null,
    });
  });
});

describe('SiteEditor — fix-122 Corner Lot row', () => {
  it('renders blank when is_corner_lot is null', () => {
    setup();
    const sel = screen.getByTestId('pd-site-corner') as HTMLSelectElement;
    expect(sel.value).toBe('');
  });

  it('renders Yes when is_corner_lot is true', () => {
    setup({ is_corner_lot: true });
    const sel = screen.getByTestId('pd-site-corner') as HTMLSelectElement;
    expect(sel.value).toBe('Yes');
  });

  it('renders No when is_corner_lot is false', () => {
    setup({ is_corner_lot: false });
    const sel = screen.getByTestId('pd-site-corner') as HTMLSelectElement;
    expect(sel.value).toBe('No');
  });

  it('picking Yes commits true', async () => {
    setup();
    fireEvent.change(screen.getByTestId('pd-site-corner'), {
      target: { value: 'Yes' },
    });
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutateAsync.mock.calls[0][0].patch).toEqual({
      is_corner_lot: true,
    });
  });

  it('picking No commits false (NOT null — preserves the explicit answer)', async () => {
    setup();
    fireEvent.change(screen.getByTestId('pd-site-corner'), {
      target: { value: 'No' },
    });
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutateAsync.mock.calls[0][0].patch).toEqual({
      is_corner_lot: false,
    });
  });

  it('picking blank from Yes commits null (user clearing the answer)', async () => {
    setup({ is_corner_lot: true });
    fireEvent.change(screen.getByTestId('pd-site-corner'), {
      target: { value: '' },
    });
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutateAsync.mock.calls[0][0].patch).toEqual({
      is_corner_lot: null,
    });
  });
});

// fix-148: Closing Date moved from the Project Site cell to the DD Phase cell
// (testid project-overview-closing). Behavior (commit closing_date via
// useUpdateProject, occMissing-disabled) is unchanged — only the location.
describe('DD Phase — Closing Date row (moved from Project Site, fix-148)', () => {
  it('renders blank when closing_date is null', () => {
    setup();
    const input = screen.getByTestId('project-overview-closing') as HTMLInputElement;
    expect(input.type).toBe('date');
    expect(input.value).toBe('');
  });

  it('renders the stored closing_date', () => {
    setup({ closing_date: '2026-12-31' });
    const input = screen.getByTestId('project-overview-closing') as HTMLInputElement;
    expect(input.value).toBe('2026-12-31');
  });

  it('typing a date and blurring commits the ISO string', async () => {
    setup();
    const input = screen.getByTestId('project-overview-closing') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-09-30' } });
    fireEvent.blur(input);
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutateAsync.mock.calls[0][0].patch).toEqual({
      closing_date: '2026-09-30',
    });
    expect(updateMutateAsync.mock.calls[0][0].fieldLabel).toBe('Closing Date');
  });

  it('clearing a stored date commits null', async () => {
    setup({ closing_date: '2026-09-30' });
    const input = screen.getByTestId('project-overview-closing') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutateAsync.mock.calls[0][0].patch).toEqual({
      closing_date: null,
    });
  });

  it('blurring without changes does NOT call mutateAsync', async () => {
    setup({ closing_date: '2026-09-30' });
    const input = screen.getByTestId('project-overview-closing') as HTMLInputElement;
    fireEvent.blur(input);
    await new Promise((r) => setTimeout(r, 20));
    expect(updateMutateAsync).not.toHaveBeenCalled();
  });
});

describe('fix-122 occMissing disables the inline rows', () => {
  it('Lots/Corner (Site) + Closing (DD Phase) are disabled when project.updated_at is missing', () => {
    setup({ updated_at: null });
    expect(
      (screen.getByTestId('pd-site-lots') as HTMLSelectElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('pd-site-corner') as HTMLSelectElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('project-overview-closing') as HTMLInputElement).disabled,
    ).toBe(true);
  });
});
