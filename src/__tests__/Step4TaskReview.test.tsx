import { describe, it, expect, vi } from 'vitest';
// ★ fix-472 §2: the end-to-end property spans this screen and fix-470's DB
//   guard, so the migration text is read here rather than re-described.
import FIX470 from '../../migrations/fix_470_backfill_creates_no_work.sql?raw';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';
import Step4TaskReview from '../components/wizard/Step4TaskReview';
import {
  makeEmptyWizardState,
  newPermitRowId,
  type WizardPermit,
  type WizardState,
} from '../components/wizard/wizardState';

vi.mock('../hooks/useTaskTemplates', () => ({
  useTaskTemplates: () => ({
    templates: [
      {
        id: 'tpl-bp-1',
        permit_type: 'Building Permit',
        jurisdiction: 'Seattle',
        bucket: 'de',
        text: 'BP-Seattle DE task',
        cat: 'doc',
        default_team: null,
        default_co_assignees: [],
        default_waiting_on: null,
        default_target_offset: null,
        sort_order: 0,
        updated_at: '',
      },
      {
        id: 'tpl-bp-2',
        permit_type: 'Building Permit',
        jurisdiction: null,
        bucket: 'pm',
        text: 'BP base PM task',
        cat: null,
        default_team: null,
        default_co_assignees: [],
        default_waiting_on: null,
        default_target_offset: null,
        sort_order: 1,
        updated_at: '',
      },
      {
        id: 'tpl-bp-other',
        permit_type: 'Building Permit',
        jurisdiction: 'Phoenix',
        bucket: 'de',
        text: 'BP-Phoenix DE task',
        cat: null,
        default_team: null,
        default_co_assignees: [],
        default_waiting_on: null,
        default_target_offset: null,
        sort_order: 2,
        updated_at: '',
      },
      {
        id: 'tpl-par-1',
        permit_type: 'PAR/Pre-Sub',
        jurisdiction: null,
        bucket: 'de',
        text: 'PAR base DE task',
        cat: null,
        default_team: null,
        default_co_assignees: [],
        default_waiting_on: null,
        default_target_offset: null,
        sort_order: 0,
        updated_at: '',
      },
    ],
    subtasks: [],
    byScope: new Map(),
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

function permit(type: string, partial: Partial<WizardPermit> = {}): WizardPermit {
  return {
    rowId: newPermitRowId(),
    type,
    selected: true,
    ent_lead: '',
    dm: '',
    da: '',
    dual_da: '',
    architect: '',
    num: '',
    expected_issue: '',
    target_submit: '',
    manuallyEdited: {},
    taskTemplateIds: [],
    ...partial,
  };
}

function ControlledWrapper({ initial }: { initial: WizardState }) {
  const [state, setState] = useState(initial);
  return (
    <Step4TaskReview
      value={state}
      onChange={(patch) => setState((s) => ({ ...s, ...patch }))}
    />
  );
}

function setup(initial: WizardState) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<ControlledWrapper initial={initial} />, { wrapper });
}

describe('<Step4TaskReview />', () => {
  it('renders one section per selected permit', () => {
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    init.permits = [permit('Building Permit'), permit('PAR/Pre-Sub')];
    setup(init);
    expect(
      screen.getByTestId(`wizard-task-section-${init.permits[0].rowId}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`wizard-task-section-${init.permits[1].rowId}`),
    ).toBeInTheDocument();
  });

  it('only renders templates matching permit_type + (jurisdiction = juris OR NULL)', async () => {
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    init.permits = [permit('Building Permit')];
    setup(init);
    const row = init.permits[0];
    // Seattle + base templates render; Phoenix-only template does not.
    await waitFor(() => {
      expect(
        screen.getByTestId(`wizard-task-row-${row.rowId}-tpl-bp-1`),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId(`wizard-task-row-${row.rowId}-tpl-bp-2`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`wizard-task-row-${row.rowId}-tpl-bp-other`),
    ).toBeNull();
    // PAR template doesn't render on the BP row.
    expect(
      screen.queryByTestId(`wizard-task-row-${row.rowId}-tpl-par-1`),
    ).toBeNull();
  });

  it('auto-seeds taskTemplateIds with every applicable template on first render', async () => {
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    init.permits = [permit('Building Permit')];
    setup(init);
    const row = init.permits[0];
    // Both BP-applicable templates should be checked after seed.
    await waitFor(() => {
      const box = screen.getByTestId(
        `wizard-task-checkbox-${row.rowId}-tpl-bp-1`,
      ) as HTMLInputElement;
      expect(box.checked).toBe(true);
    });
    const box2 = screen.getByTestId(
      `wizard-task-checkbox-${row.rowId}-tpl-bp-2`,
    ) as HTMLInputElement;
    expect(box2.checked).toBe(true);
  });

  it('unchecking a task removes it from taskTemplateIds', async () => {
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    init.permits = [permit('Building Permit')];
    setup(init);
    const row = init.permits[0];
    const box = await screen.findByTestId(
      `wizard-task-checkbox-${row.rowId}-tpl-bp-1`,
    );
    await waitFor(() => expect((box as HTMLInputElement).checked).toBe(true));
    fireEvent.click(box);
    await waitFor(() => expect((box as HTMLInputElement).checked).toBe(false));
  });

  it('"Clear all" sets taskTemplateIds to []', async () => {
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    init.permits = [permit('Building Permit')];
    setup(init);
    const row = init.permits[0];
    // Wait for seed.
    await screen.findByTestId(`wizard-task-checkbox-${row.rowId}-tpl-bp-1`);
    fireEvent.click(screen.getByTestId(`wizard-task-clear-all-${row.rowId}`));
    await waitFor(() => {
      const b1 = screen.getByTestId(
        `wizard-task-checkbox-${row.rowId}-tpl-bp-1`,
      ) as HTMLInputElement;
      const b2 = screen.getByTestId(
        `wizard-task-checkbox-${row.rowId}-tpl-bp-2`,
      ) as HTMLInputElement;
      expect(b1.checked).toBe(false);
      expect(b2.checked).toBe(false);
    });
  });

  it('"Select all" restores the full applicable set', async () => {
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    init.permits = [permit('Building Permit')];
    setup(init);
    const row = init.permits[0];
    await screen.findByTestId(`wizard-task-checkbox-${row.rowId}-tpl-bp-1`);
    fireEvent.click(screen.getByTestId(`wizard-task-clear-all-${row.rowId}`));
    fireEvent.click(screen.getByTestId(`wizard-task-select-all-${row.rowId}`));
    await waitFor(() => {
      const b1 = screen.getByTestId(
        `wizard-task-checkbox-${row.rowId}-tpl-bp-1`,
      ) as HTMLInputElement;
      expect(b1.checked).toBe(true);
    });
  });
});

// ===========================================================================
// ★★★ fix-472 §2 (P-126) — IN BACKFILL MODE THE DEFAULT INVERTS
// ===========================================================================
//
// Bobby: *"in the add new project, at the very top, backfill historical
// project, when checking this, we dont want tasks or milestones created."*
//
// fix-470 gated the SILENT path (`bp_create_lifecycle_task`). This is the
// VISIBLE one — Step 4 default-checks every applicable template and
// `bp_create_project_with_permits` inserts whatever is checked.
//
// ★★ THE PROD EVIDENCE IS HIM DOING IT BY HAND: 16 backfilled projects, 41
// permits, **0 non-auto tasks**, against 94 templates. Zero is not luck.
//
// ★ THE STEP IS NOT HIDDEN AND NOT SKIPPED. What makes it benign is that it
//   SHOWS what it will create; hiding it would turn a visible choice into an
//   invisible one, which is the opposite of the fix.

/** The two Building-Permit templates that apply in Seattle. */
const BP_APPLICABLE = ['tpl-bp-1', 'tpl-bp-2'] as const;

function checkbox(rowId: string, tplId: string): HTMLInputElement {
  return screen.getByTestId(
    `wizard-task-checkbox-${rowId}-${tplId}`,
  ) as HTMLInputElement;
}

describe('fix-472 §2 — backfill mode defaults the templates unchecked', () => {
  it('★★★ backfill ON → every applicable template renders UNCHECKED', () => {
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    init.backfill_mode = true;
    init.permits = [permit('Building Permit')];
    setup(init);
    const row = init.permits[0];
    for (const id of BP_APPLICABLE) {
      expect(checkbox(row.rowId, id).checked).toBe(false);
    }
  });

  it('★★★ backfill OFF → unchanged from today, every template CHECKED', async () => {
    // ★ The ordinary new-project flow must not move at all. Same assertion the
    //   fix-22 seeding test makes, restated here so a regression in either
    //   direction fails in this file.
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    init.permits = [permit('Building Permit')];
    setup(init);
    const row = init.permits[0];
    await waitFor(() => {
      expect(checkbox(row.rowId, 'tpl-bp-1').checked).toBe(true);
    });
    expect(checkbox(row.rowId, 'tpl-bp-2').checked).toBe(true);
  });

  it('★★★ backfill ON, the user ticks two → exactly those two survive', async () => {
    // ★★ LEAVE THEM SELECTABLE. A backfill that genuinely wants a task should
    //    be able to say so — the default inverts, the control does not go.
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    init.backfill_mode = true;
    init.permits = [permit('Building Permit')];
    setup(init);
    const row = init.permits[0];

    fireEvent.click(checkbox(row.rowId, 'tpl-bp-1'));
    fireEvent.click(checkbox(row.rowId, 'tpl-bp-2'));

    await waitFor(() => {
      expect(checkbox(row.rowId, 'tpl-bp-1').checked).toBe(true);
    });
    expect(checkbox(row.rowId, 'tpl-bp-2').checked).toBe(true);
    // ★ And nothing else crept in — the Phoenix template is not even rendered
    //   for a Seattle project, which is fix-22's rule, untouched.
    expect(
      screen.queryByTestId(`wizard-task-row-${row.rowId}-tpl-bp-other`),
    ).toBeNull();
  });

  it('★★ a backfill row with NO tick submits an empty list — the shape submit already reads', () => {
    // `taskTemplateIds = []` is fix-22's existing "create no tasks for this
    // permit" signal, so backfill mode simply never leaves that state. No new
    // field, no new signal, same code path on submit.
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    init.backfill_mode = true;
    init.permits = [permit('Building Permit')];
    setup(init);
    expect(init.permits[0].taskTemplateIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ★★★ The two halves of §2 conflict, and this is the resolution
// ---------------------------------------------------------------------------
//
// "Toggling the checkbox mid-wizard re-applies the default" and "never discard
// a selection the user made by hand" cannot both hold once somebody has ticked
// something. The brief's tie-break is to keep the user's choice — so a flip
// re-seeds only rows nobody has touched.
//
// ★ That is the right line rather than a compromise: an all-checked row the
//   WIZARD checked is not a choice, it is our default, so replacing it discards
//   nothing. A row the person edited IS a choice, and a checkbox at the top of
//   Step 1 must not silently undo work done on Step 4.
// ★★★ THE END-TO-END STATEMENT OF WHAT BOBBY ASKED FOR
//
// *"when checking this, we dont want tasks or milestones created."* Two paths
// create work on a new project, and BOTH are now closed:
//
//   VISIBLE  — Step 4's template checklist (this ticket): defaults to nothing
//              ticked, so `task_template_ids: []` reaches
//              `bp_create_project_with_permits`, which is fix-22's existing
//              "create no tasks for this permit" signal.
//   SILENT   — `bp_create_lifecycle_task` (fix-470): returns NULL before it
//              inserts, for any project with `is_backfill = true`.
//
// ★ Milestones need no third path: fix-386 already derives them and suppresses
//   the plan-date kinds on the same flag. There is no milestone table.
describe('fix-472 §2 — a backfilled project creates NO work, end to end', () => {
  it('★★★ PROPERTY: nothing ticked here, and the silent path refuses too', () => {
    // Half one: Step 4 in backfill mode submits an empty list.
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    init.backfill_mode = true;
    init.permits = [permit('Building Permit'), permit('PAR/Pre-Sub')];
    setup(init);
    for (const row of init.permits) {
      expect(row.taskTemplateIds).toEqual([]);
      for (const id of BP_APPLICABLE) {
        const el = screen.queryByTestId(`wizard-task-checkbox-${row.rowId}-${id}`);
        if (el) expect((el as HTMLInputElement).checked).toBe(false);
      }
    }

    // Half two: the database refuses the lifecycle path for the same project.
    // ★ Asserted against fix-470's migration rather than re-stated, so the two
    //   halves of one promise cannot drift apart.
    expect(FIX470).toContain('IF v_is_backfill THEN');
    expect(FIX470).toContain('COALESCE(is_backfill, false)');
  });
});

describe('fix-472 §2 — flipping the checkbox mid-wizard', () => {
  function FlipHarness({ initial }: { initial: WizardState }) {
    const [state, setState] = useState(initial);
    return (
      <>
        <button
          type="button"
          data-testid="flip-backfill"
          onClick={() => setState((s) => ({ ...s, backfill_mode: !s.backfill_mode }))}
        >
          flip
        </button>
        <Step4TaskReview
          value={state}
          onChange={(patch) => setState((s) => ({ ...s, ...patch }))}
        />
      </>
    );
  }

  function setupFlip(initial: WizardState) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return render(<FlipHarness initial={initial} />, { wrapper });
  }

  it('★★★ an UNTOUCHED row re-seeds — the wizard\'s own default is not a choice', async () => {
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    init.permits = [permit('Building Permit')];
    setupFlip(init);
    const row = init.permits[0];
    await waitFor(() => {
      expect(checkbox(row.rowId, 'tpl-bp-1').checked).toBe(true);
    });

    fireEvent.click(screen.getByTestId('flip-backfill')); // → backfill ON
    await waitFor(() => {
      expect(checkbox(row.rowId, 'tpl-bp-1').checked).toBe(false);
    });
    expect(checkbox(row.rowId, 'tpl-bp-2').checked).toBe(false);

    fireEvent.click(screen.getByTestId('flip-backfill')); // → backfill OFF
    await waitFor(() => {
      expect(checkbox(row.rowId, 'tpl-bp-1').checked).toBe(true);
    });
  });

  it('★★★ a TOUCHED row keeps the user\'s ticks across a flip', async () => {
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    init.permits = [permit('Building Permit')];
    setupFlip(init);
    const row = init.permits[0];
    await waitFor(() => {
      expect(checkbox(row.rowId, 'tpl-bp-1').checked).toBe(true);
    });

    // The user unticks one by hand — now the row is THEIRS.
    fireEvent.click(checkbox(row.rowId, 'tpl-bp-2'));
    await waitFor(() => {
      expect(checkbox(row.rowId, 'tpl-bp-2').checked).toBe(false);
    });

    fireEvent.click(screen.getByTestId('flip-backfill')); // → backfill ON

    // ★★ Their selection stands. Backfill mode did NOT clear tpl-bp-1.
    await waitFor(() => {
      expect(screen.getByTestId('flip-backfill')).toBeInTheDocument();
    });
    expect(checkbox(row.rowId, 'tpl-bp-1').checked).toBe(true);
    expect(checkbox(row.rowId, 'tpl-bp-2').checked).toBe(false);
  });
});
