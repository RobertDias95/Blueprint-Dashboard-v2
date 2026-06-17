import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { Builder } from '../lib/database.types';

// fix-24d: tests for the Builder/Owner autocomplete on Project Overview.
// Mirrors BuilderAutocomplete.test.tsx but exercises the surface where
// the picker is wired to useUpdateProject — picking a suggestion must
// fire ONE save with all four fields in a single patch (not four
// per-field saves) so OCC stays consistent.

const T = 'test-tenant-uuid';

const searchResults = vi.hoisted(() => ({
  current: [] as Builder[],
}));

const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: (query: string) => {
    const trimmed = query.trim();
    if (trimmed.length === 0) return { data: [], isLoading: false };
    const needle = trimmed.toLowerCase();
    const data = searchResults.current.filter(
      (b) =>
        (b.name ?? '').toLowerCase().includes(needle) ||
        (b.company ?? '').toLowerCase().includes(needle) ||
        (b.email ?? '').toLowerCase().includes(needle) ||
        (b.phone ?? '').toLowerCase().includes(needle),
    );
    return { data, isLoading: false };
  },
}));

vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({
    mutateAsync,
    isPending: false,
  }),
}));

// Inert — the cell uses these only when bp is non-null, which we leave null.
vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// Inert — ExternalTeamEditor renders an "unconfigured" placeholder when empty.
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: new Map() }),
  readConsultantTypes: () => [] as { type: string; firms: string[] }[],
}));

import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

function builder(over: Partial<Builder>): Builder {
  return {
    id: 'b-' + Math.random().toString(36).slice(2, 8),
    name: 'X',
    company: null,
    email: null,
    phone: null,
    address: null,
    notes: null,
    active: true,
    ...over,
  };
}

const NOW = '2026-05-15T12:00:00Z';

function projectFixture(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'p-24d',
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
    units: null,
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
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as unknown as Parameters<typeof ProjectDetailHeader>[0]['project'];
}

function renderCell(projectOverride: Partial<Record<string, unknown>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(
    <ProjectDetailHeader
      project={projectFixture(projectOverride)}
      permits={[]}
      bp={null}
    />,
    { wrapper },
  );
}

beforeEach(() => {
  searchResults.current = [];
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({});
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('Project Overview <BuilderOwnerCell /> — fix-24d', () => {
  it('typing in OWNER opens the autocomplete with matching catalog entries', () => {
    searchResults.current = [
      builder({ id: 'boyd-lybeck', name: 'Boyd Lybeck', company: "Jake'sD Corp" }),
      builder({ id: 'aaron', name: 'Aaron Cole', company: 'Cole Building' }),
    ];
    renderCell();
    fireEvent.change(screen.getByTestId('pd-builder-name'), {
      target: { value: 'boyd' },
    });
    expect(screen.getByTestId('pd-builder-name-menu')).toBeInTheDocument();
    expect(
      screen.getByTestId('pd-builder-name-option-boyd-lybeck'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('pd-builder-name-option-aaron'),
    ).toBeNull();
  });

  it('selecting a suggestion fills all 4 fields AND fires ONE save with the full patch', async () => {
    searchResults.current = [
      builder({
        id: 'boyd-lybeck',
        name: 'Boyd Lybeck',
        company: "Jake'sD Corporation",
        email: 'jakesbd@comcast.net',
        phone: '(206) 387-6534',
        // fix-175: entity LLC address travels on pick.
        address: '123 Main St, Seattle WA',
      }),
    ];
    renderCell();
    fireEvent.change(screen.getByTestId('pd-builder-name'), {
      target: { value: 'boyd' },
    });
    fireEvent.click(screen.getByTestId('pd-builder-name-option-boyd-lybeck'));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
    const call = mutateAsync.mock.calls[0][0];
    expect(call.projectId).toBe('p-24d');
    expect(call.expectedUpdatedAt).toBe(NOW);
    // fix-175: builder_address rides along in the single atomic patch; POC
    // (per-project) is intentionally NOT included.
    expect(call.patch).toEqual({
      builder_name: 'Boyd Lybeck',
      builder_company: "Jake'sD Corporation",
      builder_email: 'jakesbd@comcast.net',
      builder_phone: '(206) 387-6534',
      builder_address: '123 Main St, Seattle WA',
    });
    expect(call.fieldLabel).toBe('Builder');
    expect(
      (screen.getByTestId('pd-builder-address') as HTMLInputElement).value,
    ).toBe('123 Main St, Seattle WA');

    // All 4 inputs reflect the picked builder.
    expect((screen.getByTestId('pd-builder-name') as HTMLInputElement).value).toBe('Boyd Lybeck');
    expect((screen.getByTestId('pd-builder-company') as HTMLInputElement).value).toBe(
      "Jake'sD Corporation",
    );
    expect((screen.getByTestId('pd-builder-email') as HTMLInputElement).value).toBe(
      'jakesbd@comcast.net',
    );
    expect((screen.getByTestId('pd-builder-phone') as HTMLInputElement).value).toBe(
      '(206) 387-6534',
    );
  });

  it('typing without selecting commits the typed value on blur via the single-field patch (auto-promote path in useUpdateProject handles catalog insert)', async () => {
    searchResults.current = []; // no suggestions
    renderCell();
    fireEvent.change(screen.getByTestId('pd-builder-name'), {
      target: { value: 'Brand New Builder' },
    });
    fireEvent.blur(screen.getByTestId('pd-builder-name'));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
    const call = mutateAsync.mock.calls[0][0];
    expect(call.patch).toEqual({ builder_name: 'Brand New Builder' });
    expect(call.fieldLabel).toBe('Builder Name');
  });

  it('blurring without changes does not fire a save (idempotency)', async () => {
    renderCell({
      builder_name: 'Existing Name',
      builder_company: null,
      builder_email: null,
      builder_phone: null,
    });
    // Focus + blur with the original value — should be a no-op.
    fireEvent.focus(screen.getByTestId('pd-builder-name'));
    fireEvent.blur(screen.getByTestId('pd-builder-name'));
    // Wait a tick to ensure no async save sneaks through.
    await new Promise((r) => setTimeout(r, 0));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  // fix-175 — owner LLC address + per-project point-of-contact.
  it('editing LLC Address commits builder_address on blur', async () => {
    searchResults.current = [];
    renderCell();
    fireEvent.change(screen.getByTestId('pd-builder-address'), {
      target: { value: '900 Olive Way, Seattle' },
    });
    fireEvent.blur(screen.getByTestId('pd-builder-address'));
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
    const call = mutateAsync.mock.calls[0][0];
    expect(call.patch).toEqual({ builder_address: '900 Olive Way, Seattle' });
    expect(call.fieldLabel).toBe('LLC Address');
  });

  it('editing Point of Contact name + email each commit the per-project poc_* field on blur', async () => {
    renderCell();
    fireEvent.change(screen.getByTestId('pd-poc-name'), {
      target: { value: 'Dana Contact' },
    });
    fireEvent.blur(screen.getByTestId('pd-poc-name'));
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mutateAsync.mock.calls[0][0].patch).toEqual({ poc_name: 'Dana Contact' });
    expect(mutateAsync.mock.calls[0][0].fieldLabel).toBe('Point of Contact');

    fireEvent.change(screen.getByTestId('pd-poc-email'), {
      target: { value: 'dana@deal.test' },
    });
    fireEvent.blur(screen.getByTestId('pd-poc-email'));
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(2);
    });
    expect(mutateAsync.mock.calls[1][0].patch).toEqual({ poc_email: 'dana@deal.test' });
    expect(mutateAsync.mock.calls[1][0].fieldLabel).toBe('Contact Email');
  });

  it('blank POC + address are optional — blurring empty fields fires no save', async () => {
    renderCell();
    fireEvent.focus(screen.getByTestId('pd-poc-name'));
    fireEvent.blur(screen.getByTestId('pd-poc-name'));
    fireEvent.focus(screen.getByTestId('pd-builder-address'));
    fireEvent.blur(screen.getByTestId('pd-builder-address'));
    await new Promise((r) => setTimeout(r, 0));
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
