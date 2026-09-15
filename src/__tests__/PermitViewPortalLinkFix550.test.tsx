import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useAuthStore } from '../stores/authStore';

// ===========================================================================
// ★★★ fix-550 (P-256 §1 and §2) — THE PERMIT VIEW SAYS WHERE IT CAME FROM,
//     AND STARTS AT THE TOP
// ===========================================================================
//
// ★★★ MEASURED ON PROD 2026-09-14 — the brief's four rows, re-derived:
//
//       permits                                686
//       with a number                          660
//       **with `portal_url` already stored**   587
//       number but NO url                       73
//         Seattle 66 · Phoenix 4 · Scottsdale 2 · Kirkland 1
//
//     ★★ AND 0 EMPTY STRINGS (99 null · 587 real). So `?? null` is safe today;
//        this ships a TRIMMED check anyway, because nothing stops the scraper
//        writing `''` and an empty `href` renders an anchor that navigates to
//        the current page.
//
// ★★★ THE URL IS READ, NEVER CONSTRUCTED. Bobby's own screenshot permit —
//     `26 108972 BS` at 3626 164th Pl SE — has had
//     `https://customer.mybuildingpermit.com/PermitDetail/1788918` in its row
//     the whole time (it is **Bellevue**, not Seattle). The badge simply never
//     used it. Jurisdictions differ and a constructed Seattle URL that 404s is
//     worse than plain text.
//
// ★★ THE NAMED SEATTLE UNLINKED FIXTURE is `006282-25PA` (PAR/Pre-Sub at
//    2627 25th Ave W) — one of the 66 Seattle rows with a number and no URL.

const T = 'test-tenant-uuid';
// ★ A REAL UUID: `ProjectDetail` gates the permits query on `UUID_RE`
//   (fix-466 §6 — a value that cannot be a project id never reaches Postgres),
//   so a fixture id like `p-1` silently yields zero permits.
const PROJECT = 'f89fce48-4ef4-400d-a096-2e0612043201';
const NOW = '2026-09-14T12:00:00Z';

/** Bobby's screenshot permit — linked. */
const LINKED_NUM = '26 108972 BS';
const LINKED_URL = 'https://customer.mybuildingpermit.com/PermitDetail/1788918';
/** One of the 66 Seattle rows with a number and no URL — named in the PR. */
const UNLINKED_NUM = '006282-25PA';

const refs = vi.hoisted(() => ({
  projects: [] as Record<string, unknown>[],
  permits: [] as Record<string, unknown>[],
}));

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: refs.projects, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermitsByProject', () => ({
  usePermitsByProject: (id: string | undefined) => ({
    data: id === PROJECT ? refs.permits : [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useAllPermitCycleReviewers', () => ({
  useAllPermitCycleReviewers: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
}));
vi.mock('../hooks/useUpdatePermit', () => ({
  useUpdatePermit: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
}));
vi.mock('../hooks/useProjectConsultants', () => ({
  useProjectConsultants: () => ({ data: [], isLoading: false }),
  useConsultantRounds: () => ({ data: [], isLoading: false }),
  useAddProjectConsultant: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantStatus: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantDate: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantPhase: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantFirm: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../components/ProjectDetail/ProjectDetailHeader', () => ({
  default: () => <div data-testid="stub-project-header" />,
}));
vi.mock('../components/ProjectDetail/NotesPanel', () => ({
  default: () => <div data-testid="stub-notes" />,
}));
vi.mock('../components/ProjectDetail/ProjectDetailsModal', () => ({ default: () => null }));
vi.mock('../components/ProjectDetail/DeleteProjectDialog', () => ({ default: () => null }));
vi.mock('../components/ProjectDetail/DeleteRedesignDialog', () => ({ default: () => null }));
vi.mock('../components/ProjectDetail/EditRedesignModal', () => ({ default: () => null }));
vi.mock('../components/NewProjectWizard', () => ({ default: () => null }));
// ★ The permits table is stubbed to one button per permit: this suite is about
//   what happens ON SELECTION and what the permit view renders, not about the
//   table, which has its own suite.
vi.mock('../components/ProjectDetail/ScheduleHealthTable', () => ({
  default: ({
    permits,
    onSelect,
  }: {
    permits: { id: number; num: string | null }[];
    onSelect: (id: number) => void;
  }) => (
    <div data-testid="stub-permits-table">
      {permits.map((p) => (
        <button key={p.id} type="button" data-testid={`pick-${p.id}`} onClick={() => onSelect(p.id)}>
          {p.num}
        </button>
      ))}
    </div>
  ),
}));

import ProjectDetail from '../pages/ProjectDetail';

function permit(id: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, project_id: PROJECT, type: 'Building Permit', stage: 'de',
    stage_override: null, status: null, num: null, da: null, dm: null,
    ent_lead: null, dual_da: null, target_submit: null, dd_start: null,
    dd_end: null, expected_issue: null, actual_issue: null, approval_date: null,
    intake_date: null, notes: null, cycle_model: null, view_cycle: null,
    kickoff_date: null, corr_rounds: null, permit_owner: null, architect: null,
    nickname: null, struct_address: null, portal_url: null, extras: null,
    parent_permit_id: null, updated_at: NOW, permit_cycles: [], ...over,
  };
}

/** The tree, so a test can re-render it without remounting. */
function renderTree() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/project/${PROJECT}`]}>
        <Routes>
          <Route path="/project/:id" element={<ProjectDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/project/${PROJECT}`]}>
        <Routes>
          <Route path="/project/:id" element={<ProjectDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ activeTenantId: T });
  (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = vi.fn();
  refs.projects = [
    {
      id: PROJECT, address: '3626 164th Pl SE', juris: 'Bellevue', archived: false,
      notes: null, project_tags: null, go_date: null, external_team: {},
      redesign_of_project_id: null, redesign_reuses_original_permit: null,
      product_types: [], permit_order: [], created_at: NOW, updated_at: NOW,
    },
  ];
  refs.permits = [
    permit(1, { num: LINKED_NUM, portal_url: LINKED_URL }),
    permit(2, { num: UNLINKED_NUM, type: 'PAR/Pre-Sub', portal_url: null }),
    permit(3, { num: null, type: 'ULS', portal_url: null }),
  ];
});

describe('fix-550 §A — the permit number is the way out to the portal', () => {
  it('★★★ a permit WITH a portal_url renders a link to exactly that URL', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('pick-1'));
    const link = screen.getByTestId('pd-v2-portal-link');
    // ★ EXACTLY that URL — never one built from the number.
    expect(link.getAttribute('href')).toBe(LINKED_URL);
    expect(link.tagName).toBe('A');
    expect(link.textContent).toContain(LINKED_NUM);
  });

  it('★★★ it opens a new tab, safely', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('pick-1'));
    const link = screen.getByTestId('pd-v2-portal-link');
    expect(link.getAttribute('target')).toBe('_blank');
    // ★ `noopener` is not optional — an external the app hands over to must not
    //   get a handle on the window it came from.
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('★★★ one of the 73 — Seattle `006282-25PA` — renders PLAIN, with no anchor', () => {
    // ★★★ THE ASSERTION THE TICKET TURNS ON. 73 permits have a number and no
    //     URL (Seattle 66 · Phoenix 4 · Scottsdale 2 · Kirkland 1). A link that
    //     goes nowhere teaches people to stop clicking the ones that work.
    renderPage();
    fireEvent.click(screen.getByTestId('pick-2'));
    expect(screen.queryByTestId('pd-v2-portal-link')).toBeNull();
    const plain = screen.getByTestId('pd-v2-num');
    expect(plain.tagName).toBe('SPAN');
    expect(plain.textContent).toBe(UNLINKED_NUM);
    // ★ same number, same weight, no "N/A", no arrow.
    expect(plain.textContent).not.toContain('↗');
    expect(plain.className).toContain('font-mono');
  });

  it('★★ an EMPTY-STRING url is treated as no url — no dead anchor', () => {
    // ★ 0 on prod today (99 null · 587 real), and the guard removes the class
    //   rather than the instance: an empty href navigates to the current page.
    refs.permits = [permit(1, { num: LINKED_NUM, portal_url: '   ' })];
    renderPage();
    fireEvent.click(screen.getByTestId('pick-1'));
    expect(screen.queryByTestId('pd-v2-portal-link')).toBeNull();
    expect(screen.getByTestId('pd-v2-num').textContent).toBe(LINKED_NUM);
  });

  it('★★ a permit with NO number renders neither badge', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('pick-3'));
    expect(screen.queryByTestId('pd-v2-portal-link')).toBeNull();
    expect(screen.queryByTestId('pd-v2-num')).toBeNull();
  });

  it('★★ the number stays selectable — it is text, not an icon', () => {
    // ★ People paste it into the portal by hand today and will keep doing that
    //   for the 73. A glyph-only link would have taken that away.
    renderPage();
    fireEvent.click(screen.getByTestId('pick-1'));
    expect(screen.getByTestId('pd-v2-portal-link').textContent).toContain(LINKED_NUM);
  });
});

describe('fix-550 §B — selecting a permit starts you at its top', () => {
  /**
   * Record every write to `scrollTop` on the pillbox.
   *
   * ★★★ WHY NOT JUST READ `pillbox.scrollTop` AFTER THE CLICK: because that
   *     test CANNOT FAIL. Selecting a permit swaps the pane inside the pillbox,
   *     and `getByTestId` after the click can hand back a fresh node whose
   *     scrollTop is 0 whatever the code did — it passed with the scroll
   *     disabled, which is how it was caught. Recording the WRITES asserts the
   *     thing the ticket is about: that something set it to 0, once.
   */
  function watchScrollTop(el: HTMLElement): number[] {
    const writes: number[] = [];
    let value = 0;
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get: () => value,
      set: (v: number) => {
        value = v;
        writes.push(v);
      },
    });
    return writes;
  }

  it('★★★ the PANEL is scrolled to the top, not the window', () => {
    // ★★★ fix-313 made the shell a fixed viewport with overflow hidden; the
    //     only thing that scrolls is the pillbox. Before this, clicking a row
    //     left its scroll position wherever the overview had been — Bobby:
    //     *"it lands three-quarters down and everyone scrolls up."*
    renderPage();
    const writes = watchScrollTop(screen.getByTestId('pd-right-pillbox'));
    fireEvent.click(screen.getByTestId('pick-1'));
    expect(writes).toEqual([0]);
  });

  it('★★★ it does NOT re-fire on a re-render — only on the permit changing', () => {
    // ★★★ A scroll that repeats on each data refresh is worse than the
    //     behaviour being fixed: it yanks the page back mid-read.
    const { rerender } = renderPage();
    const writes = watchScrollTop(screen.getByTestId('pd-right-pillbox'));
    fireEvent.click(screen.getByTestId('pick-1'));
    expect(writes).toEqual([0]);
    // ★ The permit stays selected and the tree re-renders — a data refresh, an
    //   OCC retry, a sibling's invalidation. The effect's guard must hold.
    rerender(renderTree());
    rerender(renderTree());
    expect(writes).toEqual([0]);
  });

  it('★★★ selecting a DIFFERENT permit scrolls again', () => {
    renderPage();
    const writes = watchScrollTop(screen.getByTestId('pd-right-pillbox'));
    fireEvent.click(screen.getByTestId('pick-1'));
    fireEvent.click(screen.getByTestId('permit-edit-back-overview'));
    fireEvent.click(screen.getByTestId('pick-2'));
    expect(writes).toEqual([0, 0]);
  });

  it('★★★ NO focus is stolen — the keyboard does nothing surprising', () => {
    // ★★ People select a permit to READ it. Focusing the status input would
    //    make the next keystroke type into the permit.
    renderPage();
    fireEvent.click(screen.getByTestId('pick-1'));
    const active = document.activeElement;
    expect(active?.tagName).not.toBe('INPUT');
    expect(active?.tagName).not.toBe('TEXTAREA');
    expect(active?.tagName).not.toBe('SELECT');
  });

  it('★★ it is INSTANT — no second motion vocabulary', () => {
    // ★ Nothing in this app uses `behavior: 'smooth'`; all 8 scrollIntoView
    //   calls are instant. One panel animating would be the odd one out.
    //
    // ★★★ COMMENTS STRIPPED FIRST — the gravestone trap, and it caught this
    //     test on its first run: the source note explaining *why this is not
    //     smooth* contains the literal string, so the raw-text assertion
    //     matched its own explanation. Assert on CODE, never on prose.
    const src = readFileSync(
      resolve(__dirname, '../pages/ProjectDetail.tsx'),
      'utf8',
    );
    const code = src
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toContain("behavior: 'smooth'");
    expect(code).not.toContain('scroll-smooth');
  });
});
