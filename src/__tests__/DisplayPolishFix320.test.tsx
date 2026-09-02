import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles, Project } from '../lib/database.types';
import indexHtml from '../../index.html?raw';
// ★ fix-335 §2: the wordmark moved from the ribbon to the header, so proving it
// LEFT means reading both sources, not just re-querying the DOM it left.
import ribbonSrc from '../components/Ribbon.tsx?raw';
import chromeSrc from '../components/Chrome.tsx?raw';

// fix-320 — three display fixes, no logic. Register #72, #73 and the fix-311
// follow-up.
//
// 1. The Milestones card printed ISO on read-only rows and the browser's own
//    format inside its date inputs. ★ A native date input renders in the
//    browser's locale and CANNOT be told otherwise, so the read-only rows are
//    the side that moved — not the inputs, and NOT the stored value.
// 2. The ribbon's collapse control was a bare glyph: no border, no background,
//    no word. It did not read as a button. ★★ NO MOTION — a pulse was proposed
//    and rejected; permanent movement is noise and an accessibility problem.
// 3. The wordmark led with BLUEPRINT and trailed BRIDGE in faint grey, so the
//    product's own name vanished into the white.

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

// --------------------------------------------------------------- 1 · dates --

const ddMutateAsync = vi.hoisted(() => vi.fn());
const permitsMutateAsync = vi.hoisted(() => vi.fn());
const projectMutateAsync = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: ddMutateAsync, isPending: false }),
}));
vi.mock('../hooks/useResolveDaOverlap', () => ({
  useResolveDaOverlap: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpdateProjectWithPermits', () => ({
  useUpdateProjectWithPermits: () => ({ mutateAsync: permitsMutateAsync, isPending: false }),
}));
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: projectMutateAsync, isPending: false }),
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

// ★★★ fix-475 (P-116) — THE CONSULTANTS CARD IS INERT HERE.
//
// It joined the Overview row (taking Builder/Owner's slot), so every test that
// renders `ProjectDetailHeader` now mounts it — and it READS: the consultant
// list, its round history, and the firm directory.
//
// ★★ WHY THAT MATTERED RATHER THAN JUST BEING NOISE: several of these suites
// share one supabase mock whose `.select()` SHIFTS A QUEUED RESPONSE. A new
// component issuing a read silently ate the response the test had queued for
// its own write, and the failure surfaced as "expected 1 to be 2" three files
// away from the cause. Mocked inert, exactly as `useBuilderSearch` and
// `useSetBpDdDates` already are in the files that have this shape.
vi.mock('../hooks/useProjectConsultants', () => ({
  useProjectConsultants: () => ({ data: [], isLoading: false }),
  useConsultantRounds: () => ({ data: [], isLoading: false }),
  useAddProjectConsultant: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantStatus: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantDate: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantPhase: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantFirm: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/useIsTenantAdmin', () => ({ useIsTenantAdmin: () => true }));

import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';
import Ribbon from '../components/Ribbon';

function projectFixture(over: Partial<Project> = {}): Project {
  return {
    id: 'p-320',
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
    project_id: 'p-320',
    type: 'Building Permit',
    num: 'BP-100',
    da: 'Ainsley',
    dd_start: '2026-07-17',
    dd_end: '2026-09-11',
    target_submit: '2026-09-04',
    target_submit_is_manual: false,
    created_at: NOW,
    updated_at: '2026-05-14T09:00:00Z',
    permit_cycles: [cycleFixture(0, { intake_accepted: '2026-09-25' })],
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
  projectMutateAsync.mockReset();
  projectMutateAsync.mockResolvedValue({});
  drawRowsRef.current = [
    {
      project_id: 'p-320',
      da_assigned: 'Ainsley',
      updated_at: '2026-05-14T09:00:00Z',
      start_week: '2026-07-20',
      end_week: '2026-09-11',
    },
  ];
  window.localStorage.clear();
  useAuthStore.setState({
    activeTenantId: T,
    user: { id: 'u', email: 'u@test', role: 'admin' },
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
});

/** Is this runner formatting dates the American way? Two assertions below pin
 *  the literal `09/11/2026` Bobby will see, and they are meaningless anywhere
 *  else — so they run where they mean something and skip where they do not,
 *  rather than pretending the machine's locale is a constant. */
const RUNNER_IS_US = new Intl.DateTimeFormat().resolvedOptions().locale.startsWith('en-US');

function readOnlyBoxes(): HTMLElement[] {
  return Array.from(
    screen
      .getByTestId('pd-milestones-card')
      .querySelectorAll('[data-milestone-editable="false"]'),
  ) as HTMLElement[];
}

describe('fix-320 #1: the Milestones card reads in ONE date format', () => {
  // ★ The shape, not a literal: a read-only row and the input beside it must
  // agree, and what they agree ON is the browser's own short date.
  it('read-only rows render the same shape the date inputs render', () => {
    renderHeader();
    const boxes = readOnlyBoxes().filter((b) => (b.textContent ?? '') !== '—');
    expect(boxes.length).toBeGreaterThanOrEqual(4); // GO · SD start · SD end · Consultant · Intake

    // Whatever this locale's separator is, every row uses the SAME one, with
    // the same fixed-width parts — that is what keeps the value column lined
    // up, which was ISO's one virtue and had to survive the change.
    const shapes = new Set(
      boxes.map((b) => (b.textContent ?? '').replace(/\d/g, '#')),
    );
    expect(shapes.size, `rows disagree on format: ${[...shapes].join(' | ')}`).toBe(1);
    for (const b of boxes) {
      expect((b.textContent ?? '').length).toBe(10); // 8 digits + 2 separators
    }
  });

  it('★ and it is no longer ISO — the fix-311 form is gone from the card', () => {
    renderHeader();
    for (const b of readOnlyBoxes()) {
      expect(b.textContent ?? '').not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it.runIf(RUNNER_IS_US)('on a US runner it reads 09/11/2026, matching the input', () => {
    renderHeader();
    // dd_end is 2026-09-11 and Intake Accepted is 2026-09-25.
    expect(screen.getByTestId('pd-intake-accepted')).toHaveTextContent('09/25/2026');
    expect(screen.getByTestId('pd-go-date')).toHaveTextContent('06/05/2026');
    expect(screen.getByTestId('pd-sd-end')).toHaveTextContent('07/17/2026');
  });

  it('an absent date is still the em-dash, never a formatted zero or an epoch', () => {
    renderHeader(
      projectFixture({ go_date: null } as Partial<Project>),
      [bpFixture({ permit_cycles: [cycleFixture(0)] } as Partial<PermitWithCycles>)],
    );
    expect(screen.getByTestId('pd-intake-accepted').textContent).toBe('—');
    expect(screen.getByTestId('pd-go-date').textContent).toBe('—');
    const card = screen.getByTestId('pd-milestones-card').textContent ?? '';
    expect(card).not.toMatch(/1970|12\/31\/1969|Invalid|NaN/);
  });

  // ★ THE ASSERTION THAT PROVES IT IS PRESENTATION ONLY. Formatting happens at
  // the last inch; everything upstream still speaks ISO.
  it('the dd_start / dd_end write path still sends ISO', async () => {
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
    expect(arg.ddEnd).toBe('2026-09-18');
  });

  it('the target_submit write path still sends ISO', async () => {
    renderHeader();
    const input = screen.getByTestId('pd-target-submit') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-09-18' } });
    fireEvent.blur(input);
    await waitFor(() => expect(permitsMutateAsync).toHaveBeenCalled());
    const arg = permitsMutateAsync.mock.calls[0][0] as {
      permitUpserts: Array<Record<string, unknown>>;
    };
    expect(arg.permitUpserts[0].target_submit).toBe('2026-09-18');
  });

  it('the closing-date write path still sends ISO', async () => {
    renderHeader();
    const input = screen.getByTestId('project-overview-closing') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-06-26' } });
    fireEvent.blur(input);
    await waitFor(() => expect(projectMutateAsync).toHaveBeenCalled());
    const arg = projectMutateAsync.mock.calls[0][0] as {
      patch: Record<string, unknown>;
    };
    expect(arg.patch.closing_date).toBe('2026-06-26');
  });

  // The inputs themselves must keep holding ISO — that is the contract with the
  // DOM, and a formatter applied one layer too high would break saving outright.
  it('the date inputs still hold ISO values', () => {
    renderHeader();
    for (const testId of ['pd-bp-dd_start', 'pd-bp-dd_end', 'pd-target-submit', 'project-overview-closing']) {
      const input = screen.getByTestId(testId) as HTMLInputElement;
      expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  // fix-311's contract, re-checked on the reformatted card.
  it('fix-311 survives: one shared row component, three headings', () => {
    renderHeader();
    const card = screen.getByTestId('pd-milestones-card');
    const boxes = Array.from(card.querySelectorAll('[data-milestone-value]')) as HTMLElement[];
    expect(boxes.length).toBe(9);
    expect(
      new Set(boxes.map((b) => b.className.replace(' cursor-default', ''))).size,
    ).toBe(1);
    for (const heading of ['Key dates', 'DD window', 'Permit intake']) {
      expect(card.textContent).toContain(heading);
    }
  });
});

// ------------------------------------------------------------- 2 · the chip --

function renderRibbon() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Ribbon onAddProject={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('fix-320 #72: the collapse control reads as a button', () => {
  it('has a border, a background and the word Collapse', () => {
    renderRibbon();
    const btn = screen.getByTestId('ribbon-collapse');
    const cs = getComputedStyle(btn);
    // The three things a bare glyph was missing. Read off the element rather
    // than matched against a class name.
    expect(cs.borderStyle).toBe('solid');
    expect(cs.borderWidth).toBe('1px');
    expect(cs.backgroundColor).not.toBe('');
    expect(cs.backgroundColor).not.toBe('transparent');
    expect(btn.textContent).toContain('Collapse');
    expect(screen.getByTestId('ribbon-collapse-label')).toBeInTheDocument();
  });

  it('★ nothing about it moves — no animation, no transition', () => {
    renderRibbon();
    const btn = screen.getByTestId('ribbon-collapse');
    const cs = getComputedStyle(btn);
    // A pulse was proposed and REJECTED. Assert the ABSENCE, because that is
    // the decision — permanent motion is noise and an accessibility problem.
    // ('' when the property was never set, 'none' when jsdom fills the initial
    // value in; both mean "nothing moves".)
    expect(['', 'none']).toContain(cs.animation ?? '');
    expect(['', 'none']).toContain(cs.animationName ?? '');
    expect(['', 'none', 'all 0s ease 0s']).toContain(cs.transition ?? '');
    expect(btn.outerHTML).not.toMatch(/animate|pulse|keyframes|blink/i);
  });

  it('collapses to the glyph alone, since 56px has no room for the word', () => {
    renderRibbon();
    fireEvent.click(screen.getByTestId('ribbon-collapse'));
    expect(screen.getByTestId('ribbon').dataset.collapsed).toBe('true');
    const btn = screen.getByTestId('ribbon-collapse');
    expect(screen.queryByTestId('ribbon-collapse-label')).toBeNull();
    expect(btn.textContent).not.toContain('Collapse');
    // Still a button, still tinted — it loses the word, not the chip.
    expect(getComputedStyle(btn).borderStyle).toBe('solid');
    expect(btn.getAttribute('title')).toBe('Expand the ribbon');
  });

  // fix-313's contract: the choice persists, and it is per user.
  it('fix-313 survives: the collapsed choice is still stored', () => {
    renderRibbon();
    fireEvent.click(screen.getByTestId('ribbon-collapse'));
    expect(window.localStorage.getItem('ribbon.collapsed.u')).toBe('1');
  });
});

// --------------------------------------------------------- 3 · the wordmark --

// ★★ fix-335 §2 MOVED THE WORDMARK OUT OF THE RIBBON, so this section's subject
// is no longer here. Bobby: "we want to remove the wording Blueprint The Bridge,
// and we actually want to move that to the white header on all the screens."
//
// ★ fix-320's ACTUAL contract — "The Bridge" as the bold navy hero in title
// case, never shouted caps — did not lapse; it is asserted on the header in
// BrandingRibbonFix335, against the same #1d3f6e and the same 750 weight. What
// remains this suite's business is the ribbon, and the ribbon's half of the
// contract is now a negative one: the words are not here, and nothing was left
// behind switched off.
describe('fix-320 #73: the wordmark leads with The Bridge', () => {
  it('renders The Bridge in title case, under a small BLUEPRINT line', () => {
    renderRibbon();
    expect(screen.queryByTestId('ribbon-wordmark')).toBeNull();
    expect(screen.queryByTestId('ribbon-wordmark-row')).toBeNull();
    expect(screen.queryByTestId('ribbon-wordmark-hero')).toBeNull();
    // ★ AND NOT MERELY UNMOUNTED. The row is gone from the component source, so
    // the next person finds one place that renders the product's name rather
    // than two with one of them disabled.
    expect(ribbonSrc).not.toContain('ribbon-wordmark');
  });

  it('★ nothing on the ribbon renders THE BRIDGE in caps', () => {
    renderRibbon();
    // Still true, and now trivially so — the ribbon renders neither word.
    expect(screen.getByTestId('ribbon').textContent).not.toMatch(/THE BRIDGE/);
    expect(screen.getByTestId('ribbon').textContent).not.toMatch(/BLUEPRINT BRIDGE/);
  });

  // ★★ fix-351 — THE RULE NOW BINDS RENDERED TEXT ONLY, AND THAT IS REPORTED.
  //
  // fix-320's contract was about type this app SETS: no CSS shouting a name in
  // caps. That still holds everywhere, and is asserted above and in
  // BrandingRibbonFix335.
  //
  // ★ What it cannot bind is Bobby's artwork. Measured off bridge-logo-2026.png,
  // the word in the lockup is drawn "THE" in capitals — not the lowercase "the"
  // fix-345 §2 wrote out in full at his request. That is his file and this
  // ticket's standing rule is that the artwork is referenced, never redrawn, so
  // nothing here changes it; it is flagged in the PR for him to decide.
  it('★ the app still sets no shouted caps in CSS — the artwork is his', () => {
    expect(chromeSrc).not.toMatch(/textTransform:\s*'uppercase'/);
    expect(chromeSrc).not.toContain('THE BRIDGE');
    expect(ribbonSrc).not.toMatch(/textTransform:\s*'uppercase'.*[Bb]ridge/);
  });

  // ★★★ fix-351 — THE COLOUR IS IN THE ARTWORK NOW, so this assertion inverted.
  //
  // fix-320 chose #1d3f6e for a wordmark it rendered as styled text, and the
  // rule was "a BRAND literal, never a theme token — --color-de would change the
  // logo the day somebody retuned the design accent". Bobby's 2026 lockup
  // contains the words, so there is no styled text to colour and BRAND_NAVY
  // describes nothing.
  //
  // ★ The rule survives in the strongest possible form: the colour is no longer
  // a constant that COULD be pointed at a theme token, because it is pixels in a
  // file. And the file's blue is rgb(79, 99, 177) — measured off the rules —
  // which is not #1d3f6e, so a constant kept "just in case" would have been the
  // wrong value from the day it was orphaned.
  it('the brand colour cannot be retuned by a theme token', () => {
    // ★ Comments stripped first, the same way RealLogoFix322 does it: the
    // file's own history explains what it used to colour and why the constant
    // went, and a test that cannot tell prose from code would forbid saying so.
    const chromeCode = chromeSrc.replace(/^\s*\/\/.*$/gm, '');
    // Gone from the CODE, not merely unused — the brief asked for absence.
    expect(chromeCode).not.toContain('BRAND_NAVY');
    expect(chromeCode).not.toContain('#1d3f6e');
    expect(ribbonSrc).not.toContain('#1d3f6e');
    // ★ And no theme token crept in to replace it on the brand block.
    const centre = chromeCode.slice(chromeCode.indexOf('chrome-brand-center') - 900);
    expect(centre.slice(0, 900)).not.toMatch(/--color-de|var\(--color/);
  });

  it('collapsed shows the mark alone', () => {
    renderRibbon();
    fireEvent.click(screen.getByTestId('ribbon-collapse'));
    // ★ fix-335 §1: the ribbon's mark is the Blueprint roundel now; the Bridge
    // illustration moved to the header with the words.
    expect(screen.getByTestId('blueprint-mark')).toBeInTheDocument();
    const ribbon = screen.getByTestId('ribbon').textContent ?? '';
    expect(ribbon).not.toContain('BLUEPRINT');
    expect(ribbon).not.toContain('The Bridge');
  });

  // ★ fix-320 recoloured the placeholder mark; fix-322 replaced it in the
  // ribbon; ★ fix-325 #2 replaced it in the TAB as well and deleted the file.
  // Bobby: "the tab has the old logo as well." So the placeholder is now gone
  // from the app entirely, and what this pins is that it did not survive
  // anywhere — the drawing was scaffolding, and the scaffolding is down.
  it('the placeholder mark is gone from the app entirely', () => {
    renderRibbon();
    // ★ fix-335 §1: whichever mark the ribbon carries, it is a referenced image
    // and never a drawing. That is the rule, and it outlived the artwork.
    const mark = screen.getByTestId('blueprint-mark');
    expect(mark.tagName).toBe('IMG');
    expect(mark.querySelector('rect')).toBeNull();
    // Nothing points at it, and the tab carries Bobby's own artwork instead.
    expect(indexHtml).not.toContain('href="/bridge-mark.svg"');
    // ★ fix-326: the tab carries the brand sheet's simplified icon now.
    // ★ fix-351 retargets the filename; the rule is unchanged.
    expect(indexHtml).toContain('href="/bridge-favicon-2026-32.png"');
  });
});
