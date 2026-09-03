import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import MIGRATION from '../../migrations/fix_475_consultant_firm_clear_rounds.sql?raw';
import {
  CONSULTANT_CARD_MIN_WIDTH,
  OVERVIEW_CARD_COLUMNS,
  OVERVIEW_ROW_MIN_WIDTH,
  TEAM_INTERNAL_ROWS,
} from '../lib/overviewCardLayout';
import {
  CONSULTANT_DATE_SLOTS,
  CONSULTANT_STATUSES,
  type ConsultantCurrent,
} from '../lib/consultants';

// ===========================================================================
// ★★★ fix-475 (P-116) — THE CONSULTANTS COLUMN, AND THE OVERVIEW RESHUFFLE
// ===========================================================================
//
// Bobby: *"are the consultants complete? are we waiting on consultants?"* —
// for ACQUISITIONS, on the Project Overview. Built on fix-474's data layer,
// which was APPLIED TO PROD as this ticket's step 0 (2 tables, 5 RPCs, a
// security_invoker view, 0 rows — Bobby ruled not to seed).
//
// ---------------------------------------------------------------------------
// ★★★ §3 — THE WIDTH RULE, WHICH IS A TEST AND NOT A JUDGEMENT
// ---------------------------------------------------------------------------
// `OVERVIEW_ROW_MIN_WIDTH` must not increase. `builder` (190) left and
// `consultants` arrived, and Team ABSORBED Builder/Owner plus a five-role
// roster — so the budget was `team + consultants <= 350`.
//
// Measured in Chrome (`harness/consultant-column-floor.html`):
//
//     native <input type="date"> @ 10.5px          103px
//     the mock's plain TEXT box  @ 10.5px          140px   ← not what we ship
//     two dates SIDE BY SIDE, as the mock draws     252px of floor
//     the two dates STACKED                         144px of floor
//
// ★★ So the mock's arrangement alone busts the budget before Team gains
//    anything, and the pair stacks. That trades height — which a list-shaped
//    card has — for width, which this row has none of.

const T = 'tenant-uuid';
const PROJECT = 'p-1';

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  rounds: [] as unknown[],
  added: [] as unknown[],
  status: [] as unknown[],
  firm: [] as unknown[],
  dates: [] as unknown[],
}));

vi.mock('../hooks/useProjectConsultants', () => ({
  useProjectConsultants: () => ({ data: state.rows, isLoading: false }),
  useConsultantRounds: () => ({ data: state.rounds, isLoading: false }),
  useAddProjectConsultant: () => ({
    mutate: (i: unknown, o?: { onSuccess?: () => void }) => {
      state.added.push(i);
      o?.onSuccess?.();
    },
    isPending: false,
  }),
  useSetConsultantStatus: () => ({
    mutate: (i: unknown, o?: { onSuccess?: () => void }) => {
      state.status.push(i);
      o?.onSuccess?.();
    },
    isPending: false,
  }),
  useSetConsultantDate: () => ({
    mutate: (i: unknown) => state.dates.push(i),
    isPending: false,
  }),
  useSetConsultantPhase: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantFirm: () => ({
    mutate: (i: unknown) => state.firm.push(i),
    isPending: false,
  }),
}));

vi.mock('../hooks/useExternalTeamDirectory', () => ({
  useExternalTeamDirectory: () => ({
    data: [
      { id: 'f-geo', name: 'Nelson Geotechnical', discipline: 'Geotech', active: true },
      { id: 'f-geo2', name: 'Earth Solutions', discipline: 'Geotech', active: true },
      { id: 'f-civ', name: 'Encompass', discipline: 'Civil', active: true },
      { id: 'f-old', name: 'Retired Surveyors', discipline: 'Surveyor', active: false },
    ],
    isLoading: false,
  }),
}));

import ConsultantsCard from '../components/ProjectDetail/ConsultantsCard';

function row(over: Partial<ConsultantCurrent> = {}): ConsultantCurrent {
  return {
    consultant_id: 'c-1',
    project_id: PROJECT,
    discipline: 'Geotech',
    firm_id: 'f-geo',
    firm_name: 'Nelson Geotechnical',
    firm_active: true,
    notes: null,
    updated_at: '2026-09-01T00:00:00Z',
    round_id: 'r-0',
    round_index: 0,
    phase: 'Design',
    status: 'Scheduled',
    est_send: '2026-10-01',
    sent: null,
    est_recd: '2026-10-20',
    recd: null,
    round_updated_at: '2026-09-01T00:00:00Z',
    round_count: 1,
    ...over,
  } as ConsultantCurrent;
}

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<ConsultantsCard projectId={PROJECT} bp={null} />, { wrapper });
}

beforeEach(() => {
  state.rows = [];
  state.rounds = [];
  state.added = [];
  state.status = [];
  state.firm = [];
  state.dates = [];
  void T;
});

// ---------------------------------------------------------------------------
// §4.1–4.3 — the pill
// ---------------------------------------------------------------------------
describe('fix-475 §1 — the Consultants column', () => {
  it('★★★ no consultants → the button and NOTHING else', () => {
    // ★ Bobby ruled 2026-09-01 NOT to seed from `external_team`, so a project
    //   with no consultants has genuinely nothing to say. No placeholder text,
    //   no seeded disciplines — fix-406's rule, and the empty state the mock
    //   draws.
    renderCard();
    expect(screen.getByTestId('pd-consultant-add')).toBeInTheDocument();
    expect(screen.queryByTestId('pd-consultant-Geotech')).toBeNull();
    const body = screen.getByTestId('pd-consultants-body');
    expect(body.textContent).toBe('+ Add consultant');
  });

  it('★★★ adding one seeds Scheduled with both EST dates and no stamps', () => {
    renderCard();
    fireEvent.click(screen.getByTestId('pd-consultant-add'));
    fireEvent.change(screen.getByTestId('pd-consultant-add-discipline'), {
      target: { value: 'Geotech' },
    });
    expect(state.added).toHaveLength(1);
    // ★ The discipline list comes from the DIRECTORY (fix-474's rule), and the
    //   firm is a REFERENCE — never a typed name. P-100 stays closed.
    expect(state.added[0]).toMatchObject({ discipline: 'Geotech', firmId: 'f-geo' });
  });

  it('★★★ the two date slots RELABEL with the status, and the record keeps four', () => {
    // Scheduled → EST SEND · EST RECEIVED
    state.rows = [row({ status: 'Scheduled' })];
    const { unmount } = renderCard();
    let slots = within(screen.getByTestId('pd-consultant-dates-Geotech'))
      .getAllByText(/EST|SENT|RECEIVED/i)
      .map((e) => e.textContent);
    expect(slots).toEqual(['Est send', 'Est received']);
    unmount();

    // Pending → SENT · EST RECEIVED
    state.rows = [row({ status: 'Pending', sent: '2026-10-02' })];
    const two = renderCard();
    slots = within(screen.getByTestId('pd-consultant-dates-Geotech'))
      .getAllByText(/EST|SENT|RECEIVED/i)
      .map((e) => e.textContent);
    expect(slots).toEqual(['Sent', 'Est received']);
    two.unmount();

    // Received → SENT · RECEIVED
    state.rows = [row({ status: 'Received', sent: '2026-10-02', recd: '2026-10-19' })];
    renderCard();
    slots = within(screen.getByTestId('pd-consultant-dates-Geotech'))
      .getAllByText(/EST|SENT|RECEIVED/i)
      .map((e) => e.textContent);
    expect(slots).toEqual(['Sent', 'Received']);

    // ★★ …and the labels come from fix-474's ONE constant, never typed at a
    //    call site. This vocabulary has changed three times.
    for (const s of CONSULTANT_STATUSES) {
      expect(CONSULTANT_DATE_SLOTS[s]).toHaveLength(2);
    }
  });

  it('★★ a status flip goes to the RPC — the stamp is the server\'s, not ours', () => {
    // Bobby: *"okay, here's the status, auto date pops in."* The client sends
    // the status and nothing else; `bp_set_consultant_status` decides both the
    // date and whether a round is appended.
    state.rows = [row({ status: 'Scheduled' })];
    renderCard();
    fireEvent.change(screen.getByTestId('pd-consultant-status-Geotech'), {
      target: { value: 'Pending' },
    });
    expect(state.status).toHaveLength(1);
    expect(state.status[0]).toMatchObject({
      consultantId: 'c-1',
      status: 'Pending',
      // ★ OCC on the ROUND's token, since the round is what this write touches.
      expectedUpdatedAt: '2026-09-01T00:00:00Z',
    });
    // ★ No date was sent — nobody types `sent`.
    expect(state.dates).toHaveLength(0);
  });

  it('★★★ Received → Scheduled OPENS the history so the new round is visible', () => {
    // ★★ The RPC decides whether a round is appended; the client only decides
    //    whether to SHOW it. `transitionAppends` is the shared prediction and
    //    it is never used as the write.
    state.rows = [row({ status: 'Received', sent: '2026-10-02', recd: '2026-10-19' })];
    state.rounds = [
      { id: 'r-0', consultant_id: 'c-1', round_index: 0, phase: 'Design',
        status: 'Received', est_send: null, sent: '2026-10-02', est_recd: null,
        recd: '2026-10-19', created_at: '', updated_at: '' },
    ];
    renderCard();
    expect(screen.queryByTestId('pd-consultant-history-Geotech')).toBeNull();
    fireEvent.change(screen.getByTestId('pd-consultant-status-Geotech'), {
      target: { value: 'Scheduled' },
    });
    expect(screen.getByTestId('pd-consultant-history-Geotech')).toBeInTheDocument();
    // ★ The finished round is in it, unchanged — its dates are still there.
    const hist = screen.getByTestId('pd-consultant-history-Geotech');
    expect(hist.textContent).toContain('2026-10-02');
    expect(hist.textContent).toContain('2026-10-19');
  });

  it('★★★ changing the firm ASKS, and declining keeps every round', () => {
    // ★★★ fix-475's one NEW behaviour, ruled 2026-09-01 and not in the mock:
    //     *"maybe i selected the wrong firm at first and need to correct it…
    //      cancel/delete any previous data."*
    //
    // ★★ The dominant case is a CORRECTION, not a succession — but only the
    //    person doing it knows which, so it is neither automatic nor silent.
    state.rows = [row({ round_count: 3 })];
    renderCard();
    fireEvent.change(screen.getByTestId('pd-consultant-firm-Geotech'), {
      target: { value: 'f-geo2' },
    });
    // Nothing has been written yet — the question comes first.
    expect(state.firm).toHaveLength(0);
    const prompt = screen.getByTestId('pd-consultant-firm-prompt-Geotech');
    expect(prompt.textContent).toContain('3 rounds');

    fireEvent.click(screen.getByTestId('pd-consultant-firm-keep-Geotech'));
    expect(state.firm).toHaveLength(1);
    // ★★★ DECLINING KEEPS EVERY ROUND — `clearRounds: false`, which is also
    //     the RPC's default so a caller that forgets cannot destroy history.
    expect(state.firm[0]).toMatchObject({ firmId: 'f-geo2', clearRounds: false });
  });

  it('★★ …and accepting clears them, through the same one RPC call', () => {
    state.rows = [row({ round_count: 3 })];
    renderCard();
    fireEvent.change(screen.getByTestId('pd-consultant-firm-Geotech'), {
      target: { value: 'f-geo2' },
    });
    fireEvent.click(screen.getByTestId('pd-consultant-firm-clear-Geotech'));
    expect(state.firm[0]).toMatchObject({ firmId: 'f-geo2', clearRounds: true });
  });

  it('★★ an INACTIVE firm still resolves on a consultant that already has it', () => {
    // fix-474's rule: `active` stops a firm being offered for NEW work; it does
    // not un-say who did the old work.
    state.rows = [
      row({ discipline: 'Surveyor', firm_id: 'f-old', firm_name: 'Retired Surveyors', firm_active: false }),
    ];
    renderCard();
    const select = screen.getByTestId('pd-consultant-firm-Surveyor') as HTMLSelectElement;
    expect(select.value).toBe('f-old');
    expect(select.textContent).toContain('Retired Surveyors');
  });
});

// ---------------------------------------------------------------------------
// §2 — the roster
// ---------------------------------------------------------------------------
describe('fix-475 §2 — the internal roster', () => {
  it('★★★ SIX roles, spelled out, in TEAM_INTERNAL_ROWS order', () => {
    // ★ The order and the words are READ from the layout table, never retyped —
    //   `title` has carried the spelled-out name since fix-321 as the
    //   abbreviation's tooltip, and fix-475 promotes it to the label.
    //
    // ★★★ fix-487 (P-144) MAKES IT SIX, and fix-475's own note predicted it:
    //     *"a sixth role added to the table appears here for free."* It did —
    //     the card, the chat modal's avatar strip and the fix-479 height
    //     harness all iterate this one list. What did NOT come free is this
    //     assertion and its four siblings, which is the fix-350 lesson (a list
    //     everybody reads is a list several suites have pinned).
    expect(TEAM_INTERNAL_ROWS.map((r) => r.key)).toEqual([
      'acq', 'ent', 'sd', 'dm', 'da', 'ca',
    ]);
    expect(TEAM_INTERNAL_ROWS.map((r) => r.title)).toEqual([
      'Acquisitions',
      'Entitlements',
      'Schematic design',
      'Design Manager',
      'Design Associate',
      'Construction Admin',
    ]);
  });
});

// ---------------------------------------------------------------------------
// §3 — the width rule, and §4.7's property
// ---------------------------------------------------------------------------
describe('fix-475 §3 — the row minimum did not increase', () => {
  it('★★★ PROPERTY: OVERVIEW_ROW_MIN_WIDTH after ≤ before (1218)', () => {
    // ★★★ THE RULE, AS A NUMBER SO A FUTURE CARD CANNOT WIDEN THE ROW BY
    //     ACCIDENT. It did not merely hold — it FELL 46px, because
    //     `builder`'s 190px floor left and a measured 144 replaced it.
    expect(OVERVIEW_ROW_MIN_WIDTH).toBeLessThanOrEqual(1218);
    expect(OVERVIEW_ROW_MIN_WIDTH).toBe(1172);
  });

  it('★★★ the Consultants floor is DERIVED and states its reason', () => {
    const c = OVERVIEW_CARD_COLUMNS.find((x) => x.key === 'consultants')!;
    expect(c.minPx).toBe(CONSULTANT_CARD_MIN_WIDTH);
    expect(c.minPx).toBe(144);
    // ★ Below the 190 it replaces, so §3's stop condition is not met.
    expect(c.minPx).toBeLessThan(190);
    // The reason names the measurement rather than asserting a preference.
    expect(c.floorReason).toContain('103px');
    expect(c.floorReason).toContain('harness/consultant-column-floor.html');
  });

  it('★★ Team keeps its 160px floor — the permits rail was NOT touched', () => {
    // ★★★ Team ABSORBED Builder/Owner, whose floor was 190 because *"an input
    //     does NOT wrap"* (fix-417). It did not inherit that floor, because
    //     fix-448 had already made those fields TEXT and fix-475 made the text
    //     WRAP — so readability stopped depending on the column's width.
    // ★ Bobby offered the permits rail as relief if the floor demanded it. It
    //   did not, so the rail is untouched.
    const team = OVERVIEW_CARD_COLUMNS.find((x) => x.key === 'team')!;
    expect(team.minPx).toBe(160);
    expect(OVERVIEW_CARD_COLUMNS.map((c) => c.key)).toEqual([
      'dd', 'proj', 'team', 'por', 'consultants',
    ]);
    // ★ Five before, five after.
    expect(OVERVIEW_CARD_COLUMNS).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// The migration
// ---------------------------------------------------------------------------
describe('fix-475 — the clear-rounds RPC', () => {
  it('★★★ the OLD signature is DROPPED first — fix-438\'s overload trap', () => {
    // `CREATE OR REPLACE` with a new argument list makes an OVERLOAD, and
    // PostgREST then cannot resolve the name at all. fix-438 shipped exactly
    // that and had to come back for it. Verified on prod after apply: exactly
    // one `bp_set_consultant_firm`.
    expect(MIGRATION).toContain(
      'drop function if exists public.bp_set_consultant_firm(uuid, uuid, timestamptz);',
    );
    expect(MIGRATION).toContain('p_clear_rounds        boolean default false');
  });

  it('★★★ "clear" means back to ONE EMPTY ROUND, never zero', () => {
    // fix-474's invariant is that a consultant always has at least one round —
    // `bp_set_consultant_status` raises 'has no rounds' otherwise, and the
    // current-status view would render a consultant with no status at all.
    expect(MIGRATION).toContain('delete from public.project_consultant_rounds');
    expect(MIGRATION).toContain('insert into public.project_consultant_rounds');
    expect(MIGRATION).toContain("'Design', 'Scheduled', null, null");
  });

  it('★★ the OCC check runs BEFORE the delete — fix-382, and it matters most here', () => {
    const occ = MIGRATION.indexOf('is distinct from p_expected_updated_at');
    const del = MIGRATION.indexOf('delete from public.project_consultant_rounds');
    expect(occ).toBeGreaterThan(-1);
    expect(occ).toBeLessThan(del);
  });
});
