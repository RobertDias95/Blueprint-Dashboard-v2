import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  DD_PHASE_STATUSES,
  DS_STATUS_LIST,
  PERMIT_DERIVED_STATUSES,
  STATUS_PICKER_NOTE,
  deriveBlockStatus,
  isPermitDerivedStatus,
  type DsStatus,
} from '../lib/drawScheduleStatus';
import type { DrawScheduleRow, Permit, PermitCycle } from '../lib/database.types';

// fix-316 — stop offering statuses the board will ignore.
//
// Miles set five draw blocks to "Approved" and came back to find them reading
// Under Review or Corrections. He filed it as the scraper overwriting his work.
//
// ★ VERIFIED IN PROD, AND IT HAD NOT. status='Approved' and manual_status=true
// were still saved on every row, and last_scraper_update_at was NULL on every
// permit involved. The board simply never displayed the saved value:
// deriveBlockStatus branches 1-3 (Corrections, Approved, Under Review)
// recompute from permit data on every render and win over any manual choice.
//
// The derivation is right and is NOT touched here. What changed is what the
// picker OFFERS: four options instead of seven.
//
// ★ AND THE BEHAVIOUR IS WORSE THAN "NEVER HONOURED", which is what made it
// look random. Measured on prod: of 8 blocks holding a manual permit-derived
// status, 5 are inert but 3 have no submitted cycle at all, so they fall
// through to branch 4 and their manual "Approved" IS on screen today. So those
// three statuses are honoured EXACTLY WHILE THE PERMIT HAS NOT BEEN SUBMITTED
// — and flip silently the moment it is. Both halves are asserted below.

// ---------------------------------------------------------------------------
// The two sets
// ---------------------------------------------------------------------------

describe('fix-316: what a person may choose vs what is derived', () => {
  it('★ the DD-phase four are choosable; the permit-driven three are not', () => {
    expect(DD_PHASE_STATUSES).toEqual([
      'Scheduled',
      'Schematic',
      'DD / Permit Set',
      'Pending Consultants',
    ]);
    expect(PERMIT_DERIVED_STATUSES).toEqual([
      'Under Review',
      'Corrections',
      'Approved',
    ]);
  });

  it('the two sets partition the canonical list, so nothing can go missing', () => {
    expect([...DD_PHASE_STATUSES, ...PERMIT_DERIVED_STATUSES]).toEqual([
      ...DS_STATUS_LIST,
    ]);
    for (const s of DD_PHASE_STATUSES) expect(isPermitDerivedStatus(s)).toBe(false);
    for (const s of PERMIT_DERIVED_STATUSES) expect(isPermitDerivedStatus(s)).toBe(true);
  });

  it('the note tells the person the real answer, not just the refusal', () => {
    expect(STATUS_PICKER_NOTE).toMatch(/Under Review/);
    expect(STATUS_PICKER_NOTE).toMatch(/Corrections/);
    expect(STATUS_PICKER_NOTE).toMatch(/Approved/);
    // ★ The actionable half — what Miles was actually trying to do.
    expect(STATUS_PICKER_NOTE).toMatch(/approval date/i);
  });
});

// ---------------------------------------------------------------------------
// deriveBlockStatus is UNCHANGED — the reason the narrowing is correct
// ---------------------------------------------------------------------------

function permit(over: Partial<Permit> = {}): Permit {
  return {
    id: 1,
    project_id: 'p1',
    type: 'Building Permit',
    status: null,
    approval_date: null,
    actual_issue: null,
    dd_start: null,
    dd_end: null,
    ...over,
  } as unknown as Permit;
}

function cycles(map: Record<number, Partial<PermitCycle>[]>): Map<number, PermitCycle[]> {
  const m = new Map<number, PermitCycle[]>();
  for (const [k, v] of Object.entries(map)) {
    m.set(Number(k), v as PermitCycle[]);
  }
  return m;
}

const TODAY = new Date('2026-08-15T12:00:00');

describe('fix-316: the derivation is untouched, and is why those three are not choices', () => {
  // ★ Proves the REAL path works: an approval date is how a block reads
  // Approved. This is the answer the note points people at.
  it('★ a BP with an approval_date derives Approved, with NO manual status set', () => {
    const out = deriveBlockStatus({
      permits: [permit({ approval_date: '2026-07-01' })],
      cyclesByPermit: cycles({ 1: [{ submitted: '2026-01-08' }] }),
      currentStatus: 'Scheduled',
      manualStatus: false,
      today: TODAY,
    });
    expect(out).toEqual({ status: 'Approved', isAuto: true });
  });

  it('an open corrections cycle derives Corrections whatever is stored', () => {
    const out = deriveBlockStatus({
      permits: [permit()],
      cyclesByPermit: cycles({
        1: [{ submitted: '2026-01-08', corr_issued: '2026-05-11', resubmitted: null }],
      }),
      // The stranded 4425 41st Ave SW shape, exactly.
      currentStatus: 'Approved',
      manualStatus: true,
      today: TODAY,
    });
    expect(out).toEqual({ status: 'Corrections', isAuto: true });
  });

  // ★ Miles's actual case, reproduced: submitted, no approval date, manual
  // "Approved" saved — and the board shows Under Review.
  it('★ a submitted BP with no approval_date derives Under Review, overruling the manual Approved', () => {
    const out = deriveBlockStatus({
      permits: [permit()],
      cyclesByPermit: cycles({ 1: [{ submitted: '2026-01-08' }] }),
      currentStatus: 'Approved',
      manualStatus: true,
      today: TODAY,
    });
    expect(out).toEqual({ status: 'Under Review', isAuto: true });
  });

  // ★ The half that made it look random: BEFORE submission the same manual
  // "Approved" IS honoured. Three prod blocks are in exactly this state.
  it('★★ the same stored value IS honoured while nothing has been submitted — then flips', () => {
    const before = deriveBlockStatus({
      permits: [permit()],
      cyclesByPermit: cycles({ 1: [] }),
      currentStatus: 'Approved',
      manualStatus: true,
      today: TODAY,
    });
    expect(before).toEqual({ status: 'Approved', isAuto: false });

    // One submitted cycle later — same row, same stored status — it flips, with
    // nothing on screen to say why. That is the trap the picker created.
    const after = deriveBlockStatus({
      permits: [permit()],
      cyclesByPermit: cycles({ 1: [{ submitted: '2026-01-08' }] }),
      currentStatus: 'Approved',
      manualStatus: true,
      today: TODAY,
    });
    expect(after.status).toBe('Under Review');
  });

  it('a DD-phase choice still persists and still survives the deriver', () => {
    for (const s of DD_PHASE_STATUSES) {
      const out = deriveBlockStatus({
        permits: [permit({ dd_start: '2026-08-01', dd_end: '2026-12-01' })],
        cyclesByPermit: cycles({ 1: [] }),
        currentStatus: s,
        manualStatus: true,
        today: TODAY,
      });
      expect(out, `${s} must be honoured`).toEqual({ status: s, isAuto: false });
    }
  });

  // fix-160's contract: one derived status drives label AND colour.
  it('block colours still come from the one derived status', async () => {
    const { DS_STATUS_COLORS, STATUS_PRESENTATION } = await import(
      '../lib/drawScheduleStatus'
    );
    for (const s of DS_STATUS_LIST) {
      expect(DS_STATUS_COLORS[s]).toEqual(STATUS_PRESENTATION[s].colors);
    }
    // The three removed from the PICKER are still fully presentable — they are
    // still derived and still painted.
    for (const s of PERMIT_DERIVED_STATUSES) {
      expect(STATUS_PRESENTATION[s].label).toBe(s);
    }
  });
});

// ---------------------------------------------------------------------------
// The popup picker
// ---------------------------------------------------------------------------

const updateMutate = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useUpdateDsRow', () => ({
  useUpdateDsRow: () => ({ mutateAsync: updateMutate, isPending: false }),
}));
vi.mock('../stores/toastStore', () => ({ pushToast: vi.fn() }));

import ProjectBlockPopup from '../components/DrawSchedule/ProjectBlockPopup';

function row(over: Partial<DrawScheduleRow> = {}): DrawScheduleRow {
  return {
    id: 'ds-1',
    project_id: 'p1',
    da_assigned: 'Ainsley',
    start_week: '2026-08-03',
    end_week: '2026-09-07',
    status: 'Scheduled',
    manual_status: false,
    updated_at: '2026-08-01T00:00:00Z',
    ...over,
  } as unknown as DrawScheduleRow;
}

function renderPopup(displayed: DsStatus = 'Scheduled') {
  return render(
    <MemoryRouter>
      <ProjectBlockPopup
        row={row()}
        address="6217 45th Ave NE"
        permits={[]}
        displayedStatus={displayed}
        isAutoDerived
        onClose={() => {}}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  updateMutate.mockReset();
  updateMutate.mockResolvedValue({});
});

describe('fix-316 ★ the picker offers only what can be honoured', () => {
  // ★★ THE ACCEPTANCE TEST.
  it('★★ renders exactly four options, and none of the derived three', () => {
    renderPopup();
    for (const s of DD_PHASE_STATUSES) {
      const id = `ds-popup-status-${s.toLowerCase().replace(/\W+/g, '-')}`;
      expect(screen.getByTestId(id), s).toBeInTheDocument();
    }
    for (const s of PERMIT_DERIVED_STATUSES) {
      const id = `ds-popup-status-${s.toLowerCase().replace(/\W+/g, '-')}`;
      expect(screen.queryByTestId(id), `${s} must not be offered`).toBeNull();
    }
    // Counted, not just spot-checked — a fifth pill appearing should fail.
    const pills = document.querySelectorAll('[data-testid^="ds-popup-status-"]');
    // 4 pills + the note, which shares the prefix.
    expect(pills.length - 1).toBe(4);
  });

  it('★ the explanatory line renders beside the picker', () => {
    renderPopup();
    const note = screen.getByTestId('ds-popup-status-note');
    expect(note.textContent).toBe(STATUS_PICKER_NOTE);
    expect(note.textContent).toMatch(/approval date/i);
  });

  it('choosing a DD-phase status still writes it, with manual_status set', async () => {
    renderPopup();
    screen.getByTestId('ds-popup-status-schematic').click();
    await vi.waitFor(() => expect(updateMutate).toHaveBeenCalled());
    const arg = updateMutate.mock.calls[0][0] as {
      patch: Record<string, unknown>;
    };
    expect(arg.patch.status).toBe('Schematic');
    // manual_status is still set — the DD phase genuinely needs the mechanism,
    // and fix-316 removes options, not the mechanism.
    expect(arg.patch.manual_status).toBe(true);
  });

  // ★ A block already displaying a derived status must still SAY so, even
  // though it can no longer be picked. Removing the option must not remove the
  // readout — that would trade one invisible state for another.
  it('★ a block deriving Approved still SAYS Approved, though it cannot be picked', () => {
    renderPopup('Approved');
    // Not offered as a choice...
    expect(screen.queryByTestId('ds-popup-status-approved')).toBeNull();
    // ...but still stated where the person can read it. Removing the option
    // must not remove the readout — that would trade one invisible state for
    // another, which is the defect this ticket exists to end.
    expect(document.body.textContent).toMatch(/Approved/);
  });
});

// ---------------------------------------------------------------------------
// ★ The reuse-redesign question, with the measured answer
// ---------------------------------------------------------------------------

describe('fix-316 ★ the reuse-redesign case does not genuinely differ', () => {
  // The reasoning that says it might: a reuse-redesign has no BP, so
  // deriveBlockStatus takes its empty-source branch and honours ANY manual
  // status. That branch is real — asserted here so the claim is not hand-waved.
  it('with a genuinely empty permit set, a manual status IS honoured', () => {
    const out = deriveBlockStatus({
      permits: [],
      cyclesByPermit: new Map(),
      currentStatus: 'Approved',
      manualStatus: true,
      today: TODAY,
    });
    expect(out).toEqual({ status: 'Approved', isAuto: false });
  });

  // ★ But the grid does not call deriveBlockStatus for a lane — it calls
  // deriveLaneStatus, which CHASES THE PARENT (fix-150). So a reuse-redesign
  // whose parent has a BP derives off the parent and branches 1-3 apply
  // exactly as everywhere else.
  it('★ but deriveLaneStatus chases the parent, so branches 1-3 still win', async () => {
    const { deriveLaneStatus } = await import('../lib/drawScheduleStatus');
    const permitsByProjectId = new Map<string, Permit[]>([
      ['child', []],
      ['parent', [permit({ id: 9, project_id: 'parent' })]],
    ]);
    const out = deriveLaneStatus({
      project: {
        id: 'child',
        redesign_of_project_id: 'parent',
        redesign_reuses_original_permit: true,
      },
      permitsByProjectId,
      cyclesByPermit: cycles({ 9: [{ submitted: '2026-01-08' }] }),
      currentStatus: 'Approved',
      manualStatus: true,
      today: TODAY,
    });
    // NOT the stored 'Approved' — the parent's permit decides.
    expect(out).toEqual({ status: 'Under Review', isAuto: true });
  });

  // ★ MEASURED ON PROD, 2026-08-15, and this is what settles it: of 146 draw
  // blocks, 12 are reuse-redesigns with no BP whose parent has one (so they
  // chase), and ZERO have an empty derive source. The honouring path is
  // unreachable for every block on the board today, and the theoretical
  // difference is not specific to reuse-redesigns anyway — it is "a project
  // with no permits at all", which is also zero. Same treatment.
  it('★ so the editor offers the same four, and says the same thing', async () => {
    const src = (await import('../components/ProjectDetail/ReuseRedesignDdEditor.tsx?raw'))
      .default;
    expect(src).toContain('DD_PHASE_STATUSES.map');
    expect(src).toContain('STATUS_PICKER_NOTE');
    // The whole seven-item list is no longer offered anywhere.
    expect(src).not.toContain('DS_STATUS_LIST.map');
  });

  it('and a stored out-of-list value is preserved rather than silently rewritten', async () => {
    const src = (await import('../components/ProjectDetail/ReuseRedesignDdEditor.tsx?raw'))
      .default;
    // The escape hatch that keeps a pre-fix-316 "Approved" visible in the
    // select instead of the control quietly showing something else.
    expect(src).toContain('!DD_PHASE_STATUSES.includes(status as DsStatus)');
  });
});

// ---------------------------------------------------------------------------
// The picker is the only thing that changed
// ---------------------------------------------------------------------------

describe('fix-316: nothing else moved', () => {
  it('DS_STATUS_LIST still carries all seven — the deriver still emits them', () => {
    expect(DS_STATUS_LIST).toHaveLength(7);
    expect(DS_STATUS_LIST).toContain('Approved');
    expect(DS_STATUS_LIST).toContain('Corrections');
    expect(DS_STATUS_LIST).toContain('Under Review');
  });

  it('the manual mechanism itself survives — the DD phase needs it', () => {
    const out = deriveBlockStatus({
      permits: [permit({ dd_start: '2026-01-01', dd_end: '2026-02-01' })],
      cyclesByPermit: cycles({ 1: [] }),
      // Without manual_status this would derive Pending Consultants (dd_end
      // is past). The manual choice still overrides branch 4.
      currentStatus: 'Schematic',
      manualStatus: true,
      today: TODAY,
    });
    expect(out).toEqual({ status: 'Schematic', isAuto: false });
  });
});
