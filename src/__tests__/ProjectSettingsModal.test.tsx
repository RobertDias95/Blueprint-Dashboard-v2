import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { Project } from '../lib/database.types';

// fix-23d: behavior tests for the dropdown rewire + unified permit row.
// The five Project Info fields (Jurisdiction, ENT, DM, BP DA, Acq) were
// previously <input list>+<datalist> pairs — click on the caret never
// opened a real menu. Now native <select>s with a "— none —" sentinel,
// matching the fix-22 wizard's Step-1 pattern.

const T = 'test-tenant-uuid';
const PROJECT_ID = 'p-23d';
const PROJECT_UPDATED_AT = '2026-05-14T12:00:00Z';

const project: Project = {
  id: PROJECT_ID,
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
  product_type: null,
  project_tags: null,
  builder_name: null,
  builder_company: null,
  builder_email: null,
  builder_phone: null,
  created_at: PROJECT_UPDATED_AT,
  updated_at: PROJECT_UPDATED_AT,
};

// Stable references — without these, every hook call returns a new array
// and ProjectSettingsModal's useEffect (deps include `permits`) re-fires
// indefinitely → infinite render loop → vitest worker OOMs. vi.hoisted
// runs before the vi.mock factories so the refs are available when the
// mocked module is first imported.
const refs = vi.hoisted(() => ({
  permits: [
    {
      id: 1,
      project_id: 'p-23d',
      type: 'Building Permit',
      stage: 'de',
      stage_override: null,
      status: null,
      num: null,
      da: 'Cam',
      dm: null,
      ent_lead: 'Bobby',
      dual_da: null,
      target_submit: null,
      dd_start: null,
      dd_end: null,
      expected_issue: null,
      actual_issue: null,
      approval_date: null,
      intake_date: null,
      notes: null,
      cycle_model: null,
      view_cycle: null,
      kickoff_date: null,
      corr_rounds: null,
      permit_owner: null,
      architect: null,
      nickname: null,
      struct_address: null,
      portal_url: null,
      updated_at: '2026-05-14T12:00:00Z',
      permit_cycles: [],
    },
  ],
  jurisdictions: [
    { name: 'Seattle', learn_window_days: 120, notes: null },
    { name: 'Bellevue', learn_window_days: 120, notes: null },
    { name: 'Phoenix', learn_window_days: 120, notes: null },
  ],
  team: [
    { id: '1a', name: 'Bobby', role: 'ent', active: true, former: false, email: null, notes: null, updated_at: '' },
    { id: '1b', name: 'Bobby', role: 'ent_lead', active: true, former: false, email: null, notes: null, updated_at: '' },
    { id: '2', name: 'Miles', role: 'ent', active: true, former: false, email: null, notes: null, updated_at: '' },
    { id: '3', name: 'Lindsay', role: 'dm', active: true, former: false, email: null, notes: null, updated_at: '' },
    { id: '4', name: 'Jade', role: 'dm', active: true, former: false, email: null, notes: null, updated_at: '' },
    { id: '5', name: 'OldDM', role: 'dm', active: false, former: false, email: null, notes: null, updated_at: '' },
    { id: '6a', name: 'Jake', role: 'acq', active: true, former: false, email: null, notes: null, updated_at: '' },
    { id: '6b', name: 'Jake', role: 'acq_lead', active: true, former: false, email: null, notes: null, updated_at: '' },
    { id: '7', name: 'Caleb', role: 'acq', active: true, former: false, email: null, notes: null, updated_at: '' },
    { id: '8', name: 'Cam', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '' },
    { id: '9', name: 'Trevor', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '' },
  ],
}));

vi.mock('../hooks/usePermitsByProject', () => ({
  usePermitsByProject: () => ({
    data: refs.permits,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/useJurisdictions', () => ({
  useJurisdictions: () => ({
    data: refs.jurisdictions,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// fix-25-feat-d: permit_types catalog drives the per-permit Type
// dropdown. Match the prod shape (name + is_builtin + notes).
vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({
    data: [
      { name: 'Building Permit', is_builtin: true, notes: null },
      { name: 'Demolition', is_builtin: true, notes: null },
      { name: 'ULS', is_builtin: true, notes: null },
      { name: 'PAR/Pre-Sub', is_builtin: false, notes: null },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    data: refs.team,
    all: refs.team,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
}));

vi.mock('../hooks/useUpdatePermit', () => ({
  useUpdatePermit: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
}));

vi.mock('../hooks/useCreatePermit', () => ({
  useCreatePermit: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
}));

vi.mock('../hooks/useDeletePermit', () => ({
  useDeletePermit: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
}));

// fix-23f: drive the Builder/Owner autocomplete via a mocked
// useBuilderSearch. Substring-filtered against this fixture to mirror
// the real ILIKE OR query.
const builderFixtures = vi.hoisted(() => ({
  rows: [
    {
      id: 'b-boyd',
      name: 'Boyd Livek',
      company: 'Crafted Design Build',
      email: 'boyd@crafted.test',
      phone: '(206) 555-0199',
      notes: null,
      active: true,
    },
    {
      id: 'b-jane',
      name: 'Jane Builder',
      company: 'Acme Homes',
      email: 'jane@acme.test',
      phone: null,
      notes: null,
      active: true,
    },
  ],
}));

vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: (query: string) => {
    const t = query.trim().toLowerCase();
    if (t.length === 0) return { data: [], isLoading: false };
    const data = builderFixtures.rows.filter((b) => {
      return (
        (b.name ?? '').toLowerCase().includes(t) ||
        (b.company ?? '').toLowerCase().includes(t) ||
        (b.email ?? '').toLowerCase().includes(t) ||
        (b.phone ?? '').toLowerCase().includes(t)
      );
    });
    return { data, isLoading: false };
  },
}));

import ProjectSettingsModal from '../components/ProjectDetail/ProjectSettingsModal';

function renderModal() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(
    <ProjectSettingsModal project={project} onClose={() => {}} />,
    { wrapper },
  );
}

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('<ProjectSettingsModal /> fix-23d dropdowns', () => {
  it('opens Design Manager dropdown on click and surfaces dm role options', () => {
    renderModal();
    const dm = screen.getByTestId('psm-dm') as HTMLSelectElement;
    // Real <select>, not <input>. Click-to-open is browser-managed for
    // <select>s; the test verifies the contract (the element IS a select
    // with the expected options) rather than the open-popup pixel itself.
    expect(dm.tagName).toBe('SELECT');
    const names = [...dm.options].map((o) => o.value);
    expect(names).toContain(''); // "— none —" sentinel
    expect(names).toContain('Lindsay');
    expect(names).toContain('Jade');
    // Inactive DM excluded.
    expect(names).not.toContain('OldDM');
    // ent / acq / da members must NOT appear.
    expect(names).not.toContain('Bobby');
    expect(names).not.toContain('Jake');
    expect(names).not.toContain('Cam');
  });

  it('opens Entitlement Lead dropdown and includes both ent and ent_lead members deduped', () => {
    renderModal();
    const ent = screen.getByTestId('psm-ent') as HTMLSelectElement;
    expect(ent.tagName).toBe('SELECT');
    const names = [...ent.options].map((o) => o.value);
    expect(names).toContain('Bobby'); // appears in BOTH ent + ent_lead rows
    expect(names).toContain('Miles');
    // dedupByName: Bobby should appear exactly once.
    expect(names.filter((n) => n === 'Bobby')).toHaveLength(1);
    // — none — sentinel for clearable nullable column.
    expect(names).toContain('');
  });

  it('opens Acquisitions dropdown and surfaces acq+acq_lead members as one list', () => {
    // Per Bobby, acq and acq_lead represent the same person — surface ONE
    // selector that dedupes by name.
    renderModal();
    const acq = screen.getByTestId('psm-acq') as HTMLSelectElement;
    expect(acq.tagName).toBe('SELECT');
    const names = [...acq.options].map((o) => o.value);
    expect(names).toContain('Jake'); // both 'acq' and 'acq_lead'
    expect(names).toContain('Caleb'); // 'acq' only
    expect(names.filter((n) => n === 'Jake')).toHaveLength(1);
    expect(names).toContain(''); // none sentinel
    // No ent / dm / da bleed.
    expect(names).not.toContain('Bobby');
    expect(names).not.toContain('Lindsay');
    expect(names).not.toContain('Cam');
  });

  it('opens Design Associate dropdown and lists active DAs', () => {
    renderModal();
    const da = screen.getByTestId('psm-da') as HTMLSelectElement;
    expect(da.tagName).toBe('SELECT');
    const names = [...da.options].map((o) => o.value);
    expect(names).toContain('Cam');
    expect(names).toContain('Trevor');
    expect(names).toContain('');
    // No non-DA roles.
    expect(names).not.toContain('Lindsay');
    expect(names).not.toContain('Bobby');
  });

  it('opens Jurisdiction dropdown and lists all jurisdictions', () => {
    renderModal();
    const juris = screen.getByTestId('psm-juris') as HTMLSelectElement;
    expect(juris.tagName).toBe('SELECT');
    const names = [...juris.options].map((o) => o.value);
    expect(names).toEqual(['', 'Seattle', 'Bellevue', 'Phoenix']);
  });
});

describe('<ProjectSettingsModal /> fix-23d unified permit row', () => {
  it('renders each permit in a single unified card frame (no nested borders)', () => {
    renderModal();
    const card = screen.getByTestId(`psm-permit-row-${refs.permits[0].id}`);
    expect(card).toBeInTheDocument();

    // The card is the outer card. No other psm-permit-row-* descendants
    // should appear inside it (the previous broken layout had an inner
    // sub-bordered cell that looked like a separate card).
    const innerRows = card.querySelectorAll(
      '[data-testid^="psm-permit-row-"]',
    );
    // querySelectorAll within `card` doesn't include card itself.
    expect(innerRows.length).toBe(0);

    // All expected fields render inside this single card.
    const scope = within(card);
    // fix-25-feat-d: Type joined ENT + DA as a <select> -> 3 selects.
    const selects = card.querySelectorAll('select');
    expect(selects.length).toBe(3); // Type + ENT + DA
    // Inputs: Permit Portal URL, Permit #, Structure Address = 3.
    const inputs = card.querySelectorAll('input');
    expect(inputs.length).toBe(3);
    // Delete X stays inside the card (top-right corner).
    expect(scope.getByTitle('Remove permit')).toBeInTheDocument();
  });
});

describe('<ProjectSettingsModal /> fix-25-feat-d Type dropdown', () => {
  it('Type field renders as a <select> with all catalog options + the placeholder', () => {
    renderModal();
    const card = screen.getByTestId(`psm-permit-row-${refs.permits[0].id}`);
    const selects = Array.from(card.querySelectorAll('select'));
    // Type is the first select inside the card's top sub-grid.
    const typeSelect = selects[0] as HTMLSelectElement;
    const optionValues = Array.from(typeSelect.options).map((o) => o.value);
    expect(optionValues).toContain('Building Permit');
    expect(optionValues).toContain('Demolition');
    expect(optionValues).toContain('ULS');
    expect(optionValues).toContain('PAR/Pre-Sub');
    // Placeholder (empty value) is present so users can clear the type.
    expect(optionValues).toContain('');
    // No duplicate of the row's current value when it IS in the catalog.
    const buildingPermitCount = optionValues.filter(
      (v) => v === 'Building Permit',
    ).length;
    expect(buildingPermitCount).toBe(1);
  });

  it('preserves a legacy type value not in the catalog as a selectable option', () => {
    // Mutate the fixture so the row carries a custom type. Reset in
    // afterEach below.
    const original = refs.permits[0].type;
    refs.permits[0].type = 'CustomLegacyType';
    try {
      renderModal();
      const card = screen.getByTestId(`psm-permit-row-${refs.permits[0].id}`);
      const typeSelect = card.querySelector('select') as HTMLSelectElement;
      const optionValues = Array.from(typeSelect.options).map((o) => o.value);
      expect(optionValues).toContain('CustomLegacyType');
      expect(typeSelect.value).toBe('CustomLegacyType');
    } finally {
      refs.permits[0].type = original;
    }
  });

  it('changing the Type select fires onChange via the row patch', () => {
    renderModal();
    const card = screen.getByTestId(`psm-permit-row-${refs.permits[0].id}`);
    const typeSelect = card.querySelector('select') as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: 'Demolition' } });
    expect(typeSelect.value).toBe('Demolition');
  });
});

describe('<ProjectSettingsModal /> fix-25-feat-e-redo permits fill section width', () => {
  it('modal container is 720px wide (original; not the over-wide fix-25-feat-e value)', () => {
    renderModal();
    const backdrop = screen.getByTestId('project-settings-modal');
    const container = backdrop.firstElementChild as HTMLElement | null;
    expect(container).not.toBeNull();
    expect(container!.className).toMatch(/w-\[720px\]/);
    expect(container!.className).not.toMatch(/w-\[960px\]/);
  });

  it('permits container carries col-span-2 so it fills the full Section width', () => {
    // Section's body is a `grid grid-cols-2`. Without col-span-2 on the
    // permits wrapper, each card gets confined to half the modal width.
    renderModal();
    const card = screen.getByTestId(`psm-permit-row-${refs.permits[0].id}`);
    // Walk up from the card until we hit the wrapping flex-col container
    // that contains all permits + the add button.
    let parent: HTMLElement | null = card.parentElement;
    while (parent && !/flex-col/.test(parent.className)) {
      parent = parent.parentElement;
    }
    expect(parent).not.toBeNull();
    expect(parent!.className).toMatch(/col-span-2/);
  });

  it('permit row uses 2 horizontal sub-grids (Type/ENT/DA + Num/URL/Address)', () => {
    renderModal();
    const card = screen.getByTestId(`psm-permit-row-${refs.permits[0].id}`);
    const grids = Array.from(
      card.querySelectorAll<HTMLElement>(':scope > div'),
    ).filter((el) => /grid/.test(el.className));
    expect(grids.length).toBe(2);
  });
});

describe('<ProjectSettingsModal /> fix-23f builder autocomplete', () => {
  it('Builder Name field surfaces matching builders and fills sibling fields on select', () => {
    renderModal();
    const nameInput = screen.getByTestId('psm-builder-name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Boyd' } });

    // Dropdown opens with Boyd Livek as a match.
    const option = screen.getByTestId('psm-builder-name-option-b-boyd');
    expect(option).toBeInTheDocument();

    fireEvent.click(option);

    // All four siblings filled from the picked builder.
    expect((screen.getByTestId('psm-builder-name') as HTMLInputElement).value).toBe('Boyd Livek');
    expect((screen.getByTestId('psm-builder-co') as HTMLInputElement).value).toBe('Crafted Design Build');
    expect((screen.getByTestId('psm-builder-email') as HTMLInputElement).value).toBe('boyd@crafted.test');
    expect((screen.getByTestId('psm-builder-phone') as HTMLInputElement).value).toBe('(206) 555-0199');
    // Menu closes after select.
    expect(screen.queryByTestId('psm-builder-name-menu')).toBeNull();
  });
});
