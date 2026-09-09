import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import MIGRATION from '../../migrations/fix_475_consultant_firm_clear_rounds.sql?raw';
import {
  CONSULTANT_CARD_MIN_WIDTH,
  CONSULTANT_DATE_INPUT_MIN,
  OVERVIEW_CARD_COLUMNS,
  OVERVIEW_ROW_MIN_WIDTH,
  TEAM_INTERNAL_ROWS,
} from '../lib/overviewCardLayout';
import { CONSULTANT_PILL_COMPACT_MIN } from '../lib/projectCardLayout';
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

// ★★★ fix-506 §A/§F: the Consultants CARD is a BAND across the foot of the
//     Team card now — the row is three cards, and its pills are a grid rather
//     than a one-per-line list. The pill's own behaviour (the firm prompt, the
//     status confirm, the date slots, the round history) is what this suite
//     tests and is unchanged.
import { ConsultantBand } from '../components/ProjectDetail/ConsultantBand';

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
  return render(<ConsultantBand projectId={PROJECT} bp={null} />, { wrapper });
}

/**
 * ★★★ fix-508 §F2 — THE FIRM PICKER IS IN PROJECT DATA, NOT ON THE OVERVIEW.
 *
 * fix-506 ruled *"type and firm do not [edit on the overview]"* and the
 * `<select>` fix-475 built was never taken out — STEP 0 confirmed six live,
 * enabled dropdowns on `233 31st Ave E`, so it **never shipped** rather than
 * having regressed. §F2 removes it from the overview and gives the firm the
 * pill's full width instead, which is what fixes Bobby's actual complaint
 * (*"you can't read their name because it gets cut off"*).
 *
 * ★★ THE RE-FIRM BEHAVIOUR ITSELF IS UNTOUCHED — same RPC, same prompt, same
 *    `consultantHasNothingToClear` predicate — so the three tests below keep
 *    every assertion and only change which surface they mount. That is the
 *    point: if the move had changed the behaviour, they would fail.
 */
function renderManage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<ConsultantBand projectId={PROJECT} bp={null} manage />, { wrapper });
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
  it('★★★ SUPERSEDED: no consultants → FOUR named empty slots, not one button', () => {
    // ★★★ fix-475 ruled that a project with no consultants has nothing to say,
    //     and said nothing: one "+ Add consultant" button, no placeholder text,
    //     no seeded disciplines. Bobby's v14 is more specific and it is the
    //     newer ruling: **minimum four slots always**, and Surveyor · Arborist
    //     · Structural · Civil are the first four in that order — so the grid
    //     reads the same way on every project.
    //
    // ★★ AND THAT IS NOT A PLACEHOLDER RETURNING. An empty slot names the
    //    discipline it is waiting for, which is information ("no Arborist
    //    yet") rather than decoration; fix-475's rule was against SEEDING
    //    a consultant record from `external_team`, and nothing is seeded.
    renderCard();
    expect(screen.queryByTestId('pd-consultant-Geotech')).toBeNull();
    const band = screen.getByTestId('pd-consultant-band');
    expect(band.dataset.slotCount).toBe('4');
    expect(band.dataset.split).toBe('2+2');
    for (const d of ['Surveyor', 'Arborist', 'Structural', 'Civil']) {
      expect(screen.getByTestId(`pd-consultant-empty-${d}`)).toBeInTheDocument();
    }
  });

  it('★★★ adding one seeds Scheduled with both EST dates and no stamps', () => {
    renderCard();
    fireEvent.click(screen.getByTestId('pd-consultant-empty-Surveyor'));
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

  it('★★★ SUPERSEDED BY fix-506 §F (P-164): a status flip ASKS FIRST', () => {
    // ★★★ THIS ASSERTION IS INVERTED, AND IT IS THE DEFECT. It read "a status
    //     flip goes to the RPC" and proved that ONE `<select>` change wrote —
    //     which is exactly what Bobby asked to stop: a mis-click on a
    //     three-item list moved a consultant to Received, stamping `recd`,
    //     with no way back but another write.
    //
    // ★★ WHAT SURVIVES UNCHANGED is the half fix-475 was really protecting:
    //    when the write DOES happen the client sends the status and nothing
    //    else, and `bp_set_consultant_status` decides the date — asserted in
    //    the Confirm test below.
    state.rows = [row({ status: 'Scheduled' })];
    renderCard();
    // ★★★ fix-506 §F: the control is a BUTTON, not a `<select>`. P-164 made
    //     every change open a confirm, and a menu whose every option opens the
    //     same dialog is a menu pretending to be one. The click ADVANCES along
    //     `CONSULTANT_STATUSES` and the confirm names where it is going.
    fireEvent.click(screen.getByTestId('pd-consultant-status-Geotech'));
    expect(state.status).toHaveLength(0);
    expect(state.dates).toHaveLength(0);
    expect(screen.getByTestId('pd-consultant-status-prompt-Geotech')).toBeInTheDocument();
  });

  it('★★★ Confirm writes ONCE, with the status and no date', () => {
    state.rows = [row({ status: 'Scheduled' })];
    renderCard();
    // ★★★ fix-506 §F: the control is a BUTTON, not a `<select>`. P-164 made
    //     every change open a confirm, and a menu whose every option opens the
    //     same dialog is a menu pretending to be one. The click ADVANCES along
    //     `CONSULTANT_STATUSES` and the confirm names where it is going.
    fireEvent.click(screen.getByTestId('pd-consultant-status-Geotech'));
    fireEvent.click(screen.getByTestId('pd-consultant-status-confirm-Geotech'));
    expect(state.status).toHaveLength(1);
    expect(state.status[0]).toMatchObject({
      consultantId: 'c-1',
      status: 'Pending',
      // ★ OCC on the ROUND's token, since the round is what this write touches.
      expectedUpdatedAt: '2026-09-01T00:00:00Z',
    });
    // ★★ No date was sent — nobody EDITED one, and an untouched slot must not
    //    overwrite the stamp the RPC is about to make.
    expect(state.dates).toHaveLength(0);
    expect(screen.queryByTestId('pd-consultant-status-prompt-Geotech')).toBeNull();
  });

  it('★★★ Cancel writes NOTHING, and the pill keeps its old status', () => {
    // ★★★ THE ASSERTION P-164 EXISTS FOR. Fails on origin/main, where the
    //     change had already been written before anyone could cancel.
    state.rows = [row({ status: 'Scheduled' })];
    renderCard();
    fireEvent.click(screen.getByTestId('pd-consultant-status-Geotech'));
    fireEvent.click(screen.getByTestId('pd-consultant-status-cancel-Geotech'));
    expect(state.status).toHaveLength(0);
    expect(state.dates).toHaveLength(0);
    expect(screen.queryByTestId('pd-consultant-status-prompt-Geotech')).toBeNull();
    // ★★ THE BUTTON READS THE ROW, so cancelling needs no revert — we simply
    //    never wrote, and the next render puts the old word back. A local
    //    "pending value" would be a second source of truth for something the
    //    row already knows. (fix-506 §F: it was a controlled `<select>`; the
    //    property is the same and the element is a button.)
    expect(
      screen.getByTestId('pd-consultant-status-Geotech').textContent,
    ).toBe('Scheduled');
  });

  it('★★★ the confirm shows the slots the NEW status will carry', () => {
    // ★★ A status change is not just a label: the RPC stamps `sent` on Pending
    //    and `recd` on Received, and the two visible slots change with it. So
    //    "move this to Received?" is really "…with THESE two dates?", and the
    //    dialog asks the real question.
    state.rows = [row({ status: 'Pending', sent: '2026-10-02' })];
    renderCard();
    fireEvent.click(screen.getByTestId('pd-consultant-status-Geotech'));
    for (const f of CONSULTANT_DATE_SLOTS.Received) {
      expect(
        screen.getByTestId(`pd-consultant-confirm-slot-Geotech-${f}`),
      ).toBeInTheDocument();
    }
    // ★ …and NOT the slot only the old status had.
    expect(screen.queryByTestId('pd-consultant-confirm-slot-Geotech-est_recd')).toBeNull();
  });

  it('★★ an EDITED date is written after the status, and only that one', () => {
    state.rows = [row({ status: 'Scheduled' })];
    renderCard();
    // ★★★ fix-506 §F: the control is a BUTTON, not a `<select>`. P-164 made
    //     every change open a confirm, and a menu whose every option opens the
    //     same dialog is a menu pretending to be one. The click ADVANCES along
    //     `CONSULTANT_STATUSES` and the confirm names where it is going.
    fireEvent.click(screen.getByTestId('pd-consultant-status-Geotech'));
    const input = screen.getByTestId('pd-consultant-confirm-date-Geotech-est_recd');
    fireEvent.change(input, { target: { value: '2026-11-05' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByTestId('pd-consultant-status-confirm-Geotech'));
    expect(state.status).toHaveLength(1);
    expect(state.dates).toHaveLength(1);
    expect(state.dates[0]).toMatchObject({ field: 'est_recd', value: '2026-11-05' });
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
    fireEvent.click(screen.getByTestId('pd-consultant-status-Geotech'));
    // ★ fix-506 §F: the step back out of Received asks like every other one —
    //   the history opens once it is CONFIRMED, not on the click.
    fireEvent.click(screen.getByTestId('pd-consultant-status-confirm-Geotech'));
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
    renderManage();
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
    renderManage();
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
    renderManage();
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
    // ★★★ fix-506 §A: 1,172 → 904. fix-475's PROPERTY — the row minimum must not
    //     INCREASE — is what this test is for, and it holds by a much wider
    //     margin now: two whole cards left the line.
        // ★★★ fix-508: the row minimum is 996 — the Plan of Record's floor rose to
    //     the width its capped thumbnail uses (486), replacing fix-417's
    //     retired rank (D-2026-09-09). The PROPERTY each of these tests was
    //     written for is unchanged; only the number it is held against is.
    expect(OVERVIEW_ROW_MIN_WIDTH).toBe(996);
  });

  it('★★★ SUPERSEDED: there is no Consultants COLUMN, and the pill is re-measured', () => {
    // ★★★ fix-475's FINDING IS WHY THE COLUMN COULD GO. It measured a native
    //     `<input type="date">` at 103px in Chrome and concluded that the
    //     mock's SIDE-BY-SIDE date pair cost 252px of floor against the 190
    //     Builder/Owner vacated — so the pair STACKED, trading width the row
    //     did not have for height a list-shaped card did, and the floor landed
    //     at 144.
    //
    // ★★★ fix-506 §F PUTS THE PAIR BACK SIDE BY SIDE BY MAKING IT TEXT. The
    //     pills are a GRID across the Team card's foot now — four across at
    //     eight consultants — so 144 per pill was never going to fit either.
    //     A printed `05/01` is 36px; the editor that writes it is a floating
    //     panel, so `BufferedDateInput` keeps its honest 103 and fix-073's rule
    //     (no raw onChange on a server-committing date) is untouched.
    expect(OVERVIEW_CARD_COLUMNS.some((x) => x.key === 'consultants')).toBe(false);
    // ★ The old measurement is still declared, and still 103 — it is what the
    //   floating panel is sized for.
    expect(CONSULTANT_DATE_INPUT_MIN).toBe(103);
    expect(CONSULTANT_CARD_MIN_WIDTH).toBe(144);
    // ★★ …and the GRID pill is derived from what it actually holds.
    expect(CONSULTANT_PILL_COMPACT_MIN).toBeLessThan(CONSULTANT_CARD_MIN_WIDTH);
  });

  it('★★ Team keeps its 160px floor — the permits rail was NOT touched', () => {
    // ★★★ Team ABSORBED Builder/Owner, whose floor was 190 because *"an input
    //     does NOT wrap"* (fix-417). It did not inherit that floor, because
    //     fix-448 had already made those fields TEXT and fix-475 made the text
    //     WRAP — so readability stopped depending on the column's width.
    // ★ Bobby offered the permits rail as relief if the floor demanded it. It
    //   did not, so the rail is untouched.
    // ★★ fix-506 §F moved it by TWO PIXELS, 160 → 162, and the two are the
    //    difference between the top block's floor and one consultant pill plus
    //    card chrome. The claim — Team does not inherit a 190px floor, and the
    //    permits rail is not touched — is unchanged.
    const team = OVERVIEW_CARD_COLUMNS.find((x) => x.key === 'team')!;
    expect(team.minPx).toBeLessThan(190);
    expect(OVERVIEW_CARD_COLUMNS.map((c) => c.key)).toEqual([
      'por', 'proj', 'team',
    ]);
    // ★ Five before, THREE after — fix-506 §A.
    expect(OVERVIEW_CARD_COLUMNS).toHaveLength(3);
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
