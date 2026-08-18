import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles, Project } from '../lib/database.types';
import { VENDOR_SEND_LEAD_DAYS, vendorTargetSend } from '../lib/vendorReport';
// ★ fix-320 #1: read-only rows render the browser's short date rather than ISO.
// These suites are about WHICH date is shown, so they keep naming ISO and ask
// the shared helper what it renders as.
import { shownDate } from '../test/milestoneDate';

// fix-311 · register #56 — every date on the Milestones card looks the same.
//
// fix-309 shipped the SD window as bare text beside boxed DD inputs, under a GO
// Date wearing a dashed underline: three presentations for one kind of fact.
// Bobby: "we want the SD start and the SD end to also match the same kind of
// format as DD start, DD end. Same thing with the go date … that way it all kind
// of looks uniform … make sure that all of them have the same horizontal width
// as well."
//
// ★ THE ASSERTION THAT MATTERS is not "a class string is present" — it is that
// every date value on the card resolves to the SAME component, so a ninth row
// cannot be built the old way. jsdom has no layout engine (every
// getBoundingClientRect is 0), so a pixel-width comparison would pass vacuously
// whatever the CSS said. What IS honest in jsdom: the shared component stamps
// `data-milestone-value` on the box, and the box's class string and inline style
// are identical on every row — read back off the rendered DOM, compared row to
// row rather than against a literal.

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

const ddMutateAsync = vi.hoisted(() => vi.fn());
const permitsMutateAsync = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: ddMutateAsync, isPending: false }),
}));
vi.mock('../hooks/useResolveDaOverlap', () => ({
  useResolveDaOverlap: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpdateProjectWithPermits', () => ({
  useUpdateProjectWithPermits: () => ({
    mutateAsync: permitsMutateAsync,
    isPending: false,
  }),
}));
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpdateRedesignDdPhase', () => ({
  useUpdateRedesignDdPhase: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
const drawRowsRef = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({ data: drawRowsRef.current, isLoading: false }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: new Map() }),
  readAppConfigStringArray: () => [] as string[],
  readConsultantTypes: () => [] as { type: string; firms: string[] }[],
}));
vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useExternalTeamDirectory', () => ({
  useExternalTeamDirectory: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useUpsertDirectoryFirm: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useNotes', () => ({
  useProjectNotes: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useAddNote: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateNote: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/usePlanOfRecord', () => ({
  usePlanOfRecord: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn() }),
  usePlanOfRecordThumbnail: () => ({ data: null, isLoading: false, error: null }),
}));
vi.mock('../stores/toastStore', () => ({
  pushToast: vi.fn(),
  useToastStore: () => ({ toasts: [], push: vi.fn(), dismiss: vi.fn() }),
}));

import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

function projectFixture(over: Partial<Project> = {}): Project {
  return {
    id: 'p-311',
    address: '6605 57th Ave NE',
    juris: 'Seattle',
    archived: false,
    notes: null,
    acq_lead: null,
    external_team: {},
    builder_id: null,
    permit_order: [],
    entitlement_lead: null,
    design_manager: null,
    go_date: '2026-06-05',
    closing_date: '2026-06-19',
    units: null,
    product_types: [],
    project_tags: null,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as Project;
}

/** A cycle row, minimal but real-shaped. */
function cycleFixture(
  index: number,
  over: Record<string, unknown> = {},
): PermitWithCycles['permit_cycles'][number] {
  return {
    id: `c-${index}`,
    permit_id: 100,
    cycle_index: index,
    submitted: null,
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    intake_accepted: null,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as PermitWithCycles['permit_cycles'][number];
}

function bpFixture(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 100,
    project_id: 'p-311',
    type: 'Building Permit',
    num: 'BP-100',
    da: 'Ainsley',
    dd_start: '2026-07-17',
    dd_end: '2026-09-11',
    target_submit: '2026-09-04',
    target_submit_is_manual: false,
    created_at: NOW,
    updated_at: '2026-05-14T09:00:00Z',
    permit_cycles: [],
    ...over,
  } as unknown as PermitWithCycles;
}

function renderHeader(
  project: Project = projectFixture(),
  permits: PermitWithCycles[] = [bpFixture()],
) {
  const bp = permits.find((p) => p.type === 'Building Permit') ?? permits[0] ?? null;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {/* ★ fix-335 §7: the Milestones card ends in a <Link> to this
          project's block on the draw schedule, so the card needs a router
          around it. It has always had one in the app — this card only ever
          renders inside /project/:id — so the harness is catching up with the
          real mount rather than acquiring a new dependency. */}
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectDetailHeader project={project} permits={permits} bp={bp} />,
    { wrapper },
  );
}

beforeEach(() => {
  ddMutateAsync.mockReset();
  ddMutateAsync.mockResolvedValue({ overlapKind: null });
  permitsMutateAsync.mockReset();
  permitsMutateAsync.mockResolvedValue({ conflict: false });
  drawRowsRef.current = [
    {
      project_id: 'p-311',
      da_assigned: 'Ainsley',
      updated_at: '2026-05-14T09:00:00Z',
      start_week: '2026-07-20',
      end_week: '2026-09-11',
    },
  ];
  useAuthStore.setState({
    activeTenantId: T,
    user: { id: 'u', email: 'u@test', role: 'admin' },
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
});

/** ISO +/- whole days, staying in ISO. Noon UTC so no DST boundary rolls it. */
function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function card(): HTMLElement {
  return screen.getByTestId('pd-milestones-card');
}

/** Every date VALUE on the card, in DOM order. */
function valueBoxes(): HTMLElement[] {
  return Array.from(
    card().querySelectorAll('[data-milestone-value]'),
  ) as HTMLElement[];
}

// ----------------------------------------------------------------- the rows --

describe('fix-311: the eight rows, in order, under three headings', () => {
  it('renders all eight in the briefed order', () => {
    renderHeader(
      projectFixture(),
      [bpFixture({ permit_cycles: [cycleFixture(0, { intake_accepted: '2026-09-25' })] } as Partial<PermitWithCycles>)],
    );
    const text = card().textContent ?? '';
    const order = [
      'GO Date',
      'Closing',
      'SD start',
      'SD end',
      'DD start',
      'DD end',
      'Target Submit',
      'Intake Accepted',
    ];
    let previous = -1;
    for (const label of order) {
      const at = text.indexOf(label);
      expect(at, `${label} is missing from the card`).toBeGreaterThan(-1);
      expect(at, `${label} is out of order`).toBeGreaterThan(previous);
      previous = at;
    }
  });

  it('groups them under Key dates, DD window and Permit intake', () => {
    renderHeader();
    const headings = within(card())
      .getAllByText(/^(Key dates|DD window|Permit intake)$/)
      .map((el) => el.textContent);
    expect(headings).toEqual(['Key dates', 'DD window', 'Permit intake']);
  });

  it('Target Submit sits in Permit intake, not in the DD window', () => {
    renderHeader();
    const ddWindow = within(card()).getByText('DD window')
      .closest('section') as HTMLElement;
    const intake = within(card()).getByText('Permit intake')
      .closest('section') as HTMLElement;
    expect(within(ddWindow).queryByTestId('pd-target-submit')).toBeNull();
    expect(within(intake).getByTestId('pd-target-submit')).toBeInTheDocument();
    expect(within(intake).getByTestId('pd-intake-accepted')).toBeInTheDocument();
    // ...and the DD window kept its own two dates.
    expect(within(ddWindow).getByTestId('pd-bp-dd_start')).toBeInTheDocument();
    expect(within(ddWindow).getByTestId('pd-bp-dd_end')).toBeInTheDocument();
  });
});

// ------------------------------------------------------------ the uniformity --

describe('fix-311: one presentation for every date on the card', () => {
  it('every date value resolves to the same shared component', () => {
    renderHeader(
      projectFixture(),
      [bpFixture({ permit_cycles: [cycleFixture(0, { intake_accepted: '2026-09-25' })] } as Partial<PermitWithCycles>)],
    );
    const boxes = valueBoxes();
    // The eight briefed rows plus the Consultant date, which the brief adds
    // between DD start and DD end — nine boxes, one component.
    expect(boxes).toHaveLength(9);

    // ★ Same component ⇒ same box class string and same inline style, read off
    // the rendered DOM and compared row to row. Editable rows differ ONLY in
    // what they nest inside the box.
    const classes = new Set(
      boxes.map((b) => b.className.replace(' cursor-default', '')),
    );
    expect(classes.size, `boxes disagree: ${[...classes].join(' | ')}`).toBe(1);

    const styles = new Set(
      boxes.map((b) => {
        const cs = getComputedStyle(b);
        return `${cs.borderColor}|${cs.background}|${cs.color}`;
      }),
    );
    expect(styles.size).toBe(1);

    // The value column is one shared width rule, not eight — flex-1 (basis 0)
    // is what makes the boxes equal whatever they contain. Asserted as "they
    // all carry the same rule", never as a measured pixel width, which jsdom
    // cannot produce.
    for (const b of boxes) expect(b.className).toContain('flex-1');
  });

  it('the label column is one width for every row', () => {
    renderHeader();
    const labels = Array.from(
      card().querySelectorAll('[data-milestone-row] > span:first-child'),
    ) as HTMLElement[];
    expect(labels.length).toBe(valueBoxes().length);
    expect(new Set(labels.map((l) => l.className)).size).toBe(1);
  });

  it('read-only rows wear the box too, without becoming clickable', () => {
    renderHeader();
    for (const testId of ['pd-go-date', 'pd-sd-start', 'pd-sd-end', 'pd-intake-accepted']) {
      const box = screen.getByTestId(testId);
      expect(box.getAttribute('data-milestone-value')).not.toBeNull();
      expect(box.getAttribute('data-milestone-editable')).toBe('false');
      // No input inside, and nothing focusable — the box is the display format,
      // editability is a separate property.
      expect(box.querySelector('input')).toBeNull();
      expect(box.getAttribute('tabindex')).toBeNull();
      expect(box.className).toContain('cursor-default');
    }
    // ...while the editable ones still hold a real date input.
    for (const testId of ['pd-bp-dd_start', 'pd-bp-dd_end', 'pd-target-submit', 'project-overview-closing']) {
      const input = screen.getByTestId(testId) as HTMLInputElement;
      expect(input.tagName).toBe('INPUT');
      expect(input.type).toBe('date');
    }
  });
});

// -------------------------------------------------------------- the dividers --

describe('fix-311: the dividers', () => {
  it('no dashed treatment under GO Date any more', () => {
    renderHeader();
    const row = screen.getByText('GO Date').parentElement as HTMLElement;
    expect(row.className).not.toContain('dashed');
    expect(row.className).not.toContain('border-b');
  });

  // ★ fix-325 #3 removed the Permit intake divider — fix-311 added it to say
  // which row was the plan and which the outcome; Bobby has seen it and does not
  // want it. The SD / DD one STAYS: that separates two phases, not a plan from
  // its result, and the brief was explicit that only one goes.
  it('one divider, between SD end and DD start', () => {
    renderHeader();
    const text = card().textContent ?? '';
    const sdDivider = screen.getByTestId('pd-sd-dd-divider');
    expect(screen.queryByTestId('pd-intake-divider')).toBeNull();
    // Between, in DOM order: SD end … divider … DD start.
    const rows = Array.from(
      card().querySelectorAll('[data-milestone-row], [role="separator"]'),
    );
    const at = (el: Element) => rows.indexOf(el);
    const rowOf = (testId: string) =>
      screen.getByTestId(testId).closest('[data-milestone-row]') as Element;
    expect(at(rowOf('pd-sd-end'))).toBeLessThan(at(sdDivider));
    expect(at(sdDivider)).toBeLessThan(at(rowOf('pd-bp-dd_start')));
    // Same visual language as the rule GO Date used to wear.
    expect(sdDivider.className).toContain('dashed');
    // ★ The two Permit intake rows are still there, and still in order — the
    // divider went, not the content.
    expect(at(rowOf('pd-target-submit'))).toBeLessThan(at(rowOf('pd-intake-accepted')));
    expect(card().querySelectorAll('[role="separator"]')).toHaveLength(1);
    expect(text).toContain('Permit intake');
  });

  it('no SD rows means no orphan divider', () => {
    renderHeader(projectFixture(), [bpFixture({ dd_start: null } as Partial<PermitWithCycles>)]);
    expect(screen.queryByTestId('pd-sd-start')).toBeNull();
    expect(screen.queryByTestId('pd-sd-dd-divider')).toBeNull();
  });
});

// --------------------------------------------------------- the new two rows --

describe('fix-311: Intake Accepted reads cycle 0, and only cycle 0', () => {
  it('shows the cycle-0 date even when the permit is on cycle 2', () => {
    renderHeader(
      projectFixture(),
      [
        bpFixture({
          permit_cycles: [
            cycleFixture(0, { intake_accepted: '2026-07-02', submitted: '2026-06-20' }),
            cycleFixture(1, { submitted: '2026-08-01' }),
            cycleFixture(2, { submitted: '2026-09-01' }),
          ],
        } as Partial<PermitWithCycles>),
      ],
    );
    expect(screen.getByTestId('pd-intake-accepted')).toHaveTextContent(
      shownDate('2026-07-02'),
    );
  });

  it('renders an empty row rather than a fabricated date when cycle 0 has none', () => {
    renderHeader(
      projectFixture(),
      [
        bpFixture({
          permit_cycles: [cycleFixture(0), cycleFixture(1, { submitted: '2026-08-01' })],
        } as Partial<PermitWithCycles>),
      ],
    );
    const box = screen.getByTestId('pd-intake-accepted');
    expect(box.textContent).toBe('—');
    expect(box.textContent).not.toMatch(/\d/);
  });

  it('is display only — there is no write path for it', () => {
    renderHeader(
      projectFixture(),
      [bpFixture({ permit_cycles: [cycleFixture(0, { intake_accepted: '2026-07-02' })] } as Partial<PermitWithCycles>)],
    );
    const box = screen.getByTestId('pd-intake-accepted');
    expect(box.querySelector('input')).toBeNull();
    expect(box.querySelector('select')).toBeNull();
    expect(box.getAttribute('contenteditable')).toBeNull();
  });
});

describe('fix-311: the Consultant date is the vendor send date, not a second copy of it', () => {
  it('renders dd_end minus the vendor lead, between DD start and DD end', () => {
    renderHeader();
    const expected = vendorTargetSend({ dd_end: '2026-09-11', end_week: null });
    // ★ vendorTargetSend still returns ISO — the ROW is what got reformatted,
    // not the function. That split is the presentation-only claim in one line.
    expect(expected).toBe('2026-09-04');
    expect(screen.getByTestId('pd-consultant-date')).toHaveTextContent(
      shownDate(expected as string),
    );

    const rows = Array.from(card().querySelectorAll('[data-milestone-row]'));
    const rowOf = (testId: string) =>
      rows.indexOf(screen.getByTestId(testId).closest('[data-milestone-row]') as Element);
    expect(rowOf('pd-bp-dd_start')).toBeLessThan(rowOf('pd-consultant-date'));
    expect(rowOf('pd-consultant-date')).toBeLessThan(rowOf('pd-bp-dd_end'));
  });

  // ★ THE POINT of importing vendorTargetSend instead of writing `- 7` again:
  // if the lead ever changes, this row and the consultant email move together.
  // Driving the assertion off the exported constant is what makes that testable
  // — a hard-coded second literal in the component fails here.
  it('moves with VENDOR_SEND_LEAD_DAYS, so it cannot drift from the email', () => {
    renderHeader();
    // Walk back a day at a time from dd_end until the rendered text matches:
    // locale-agnostic, and it measures the LEAD rather than trusting a literal.
    const shown = screen.getByTestId('pd-consultant-date').textContent as string;
    const ddEnd = '2026-09-11';
    let days = 0;
    while (days <= 60 && shownDate(shiftIso(ddEnd, -days)) !== shown) days += 1;
    expect(days).toBe(VENDOR_SEND_LEAD_DAYS);
  });

  it('renders no row at all when there is no DD end', () => {
    renderHeader(projectFixture(), [bpFixture({ dd_end: null } as Partial<PermitWithCycles>)]);
    expect(screen.queryByTestId('pd-consultant-date')).toBeNull();
    // ...and never borrows the draw block's end_week under the DD end label.
    expect(card().textContent ?? '').not.toContain(shownDate('2026-09-04'));
  });

  it('follows the DD end draft as it is typed', () => {
    renderHeader();
    fireEvent.change(screen.getByTestId('pd-bp-dd_end'), {
      target: { value: '2026-10-09' },
    });
    expect(screen.getByTestId('pd-consultant-date')).toHaveTextContent(
      shownDate('2026-10-02'),
    );
  });
});

// ------------------------------------------------------- nothing regressed --

describe('fix-311: the rows that could write still write', () => {
  // ★ Target Submit MOVED SECTIONS; it did not become read-only. Assert the
  // write, not the label.
  it('Target Submit still writes permits.target_submit', async () => {
    renderHeader();
    const input = screen.getByTestId('pd-target-submit') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-09-18' } });
    fireEvent.blur(input);
    await waitFor(() => expect(permitsMutateAsync).toHaveBeenCalled());
    const arg = permitsMutateAsync.mock.calls[0][0] as {
      permitUpserts: Array<Record<string, unknown>>;
    };
    expect(arg.permitUpserts[0].id).toBe(100);
    expect(arg.permitUpserts[0].target_submit).toBe('2026-09-18');
    // The trigger owns the manual flag — we never send it.
    expect(arg.permitUpserts[0]).not.toHaveProperty('target_submit_is_manual');
  });

  it('DD start / DD end still write through bp_set_bp_dd_dates', async () => {
    renderHeader();
    fireEvent.change(screen.getByTestId('pd-bp-dd_start'), {
      target: { value: '2026-07-20' },
    });
    fireEvent.change(screen.getByTestId('pd-bp-dd_end'), {
      target: { value: '2026-09-18' },
    });
    fireEvent.blur(screen.getByTestId('pd-bp-dd_end'));
    await waitFor(() => expect(ddMutateAsync).toHaveBeenCalled());
    const arg = ddMutateAsync.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.ddStart).toBe('2026-07-20');
    expect(Object.keys(arg).join(',')).not.toMatch(/sd_|schematic|consultant|intake/i);
  });
});

describe('fix-311: the branches that are not the happy path', () => {
  it('no building permit → the plain message under both headings, not empty boxes', () => {
    renderHeader(projectFixture(), []);
    expect(within(card()).getAllByText('No building permit')).toHaveLength(2);
    expect(screen.queryByTestId('pd-bp-dd_start')).toBeNull();
    expect(screen.queryByTestId('pd-intake-accepted')).toBeNull();
    expect(screen.queryByTestId('pd-target-submit')).toBeNull();
    // Key dates still renders its two rows through the shared component.
    expect(screen.getByTestId('pd-go-date')).toBeInTheDocument();
    expect(screen.getByTestId('project-overview-closing')).toBeInTheDocument();
  });

  it('reuse-redesign still renders its lane editor', () => {
    renderHeader(
      projectFixture({
        redesign_of_project_id: 'parent-1',
        redesign_reuses_original_permit: true,
      } as Partial<Project>),
      [],
    );
    expect(screen.getByTestId('redesign-dd-editor-start')).toBeInTheDocument();
    // fix-309's DD naming survives on that editor.
    expect(screen.getByText('DD start')).toBeInTheDocument();
    expect(screen.getByText('DD end')).toBeInTheDocument();
    expect(within(card()).queryByText('No building permit')).toBeNull();
  });

  it('a project with a BP but no cycles at all still renders the intake row empty', () => {
    renderHeader(projectFixture(), [bpFixture({ permit_cycles: [] } as Partial<PermitWithCycles>)]);
    expect(screen.getByTestId('pd-intake-accepted').textContent).toBe('—');
  });

  it('fix-296 still holds: the card is called Milestones', () => {
    renderHeader();
    expect(
      within(card()).getAllByTestId('overview-card-banner')[0],
    ).toHaveTextContent('Milestones');
  });
});
