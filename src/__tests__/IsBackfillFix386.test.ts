import { describe, it, expect } from 'vitest';
import migrationSql from '../../migrations/fix_386_is_backfill.sql?raw';
import wizardSource from '../components/NewProjectWizard.tsx?raw';
import createHookSource from '../hooks/useCreateProjectWithPermits.ts?raw';
import projectsHookSource from '../hooks/useProjects.ts?raw';
import typesSource from '../lib/database.types.ts?raw';
import settingsSource from '../components/ProjectDetail/ProjectSettingsModal.tsx?raw';
import {
  milestoneIsHistory,
  milestonePredatesRecord,
  milestoneApplies,
  historicSuppressedKinds,
} from '../lib/myBoard';
import type { PermitWithCycles } from '../lib/database.types';

// ===========================================================================
// fix-386 — the wizard asks "Backfill?" and throws the answer away
// ===========================================================================
//
// Step 1's Backfill? checkbox did exactly one thing: unlock the manual DD-date
// inputs (fix-143). Then the answer was DISCARDED — no column, no RPC field,
// no type. Which is why fix-378 had to INFER the same fact by comparing the
// driving date against the row's created_at.
//
// Bobby has used this flag as his own vocabulary for weeks — "when we add a
// new project, it says 'backfill?'" was how he defined fix-381's population.

const sqlCode = migrationSql.replace(/^\s*--.*$/gm, '');

/** A permit created 2026-08-01. `target_submit` decides whether fix-378's date
 *  inference sees history. */
function permit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 1,
    project_id: 'p1',
    type: 'Building Permit',
    created_at: '2026-08-01T00:00:00Z',
    target_submit: '2026-12-01', // comfortably AFTER creation → looks current
    dd_end: null,
    intake_date: null,
    actual_issue: null,
    approval_date: null,
    status: 'Pre-Submittal — GO',
    permit_cycles: [],
    ...over,
  } as unknown as PermitWithCycles;
}

// ---------------------------------------------------------------------------
// ★★★ THE THREE STATES, THROUGH fix-378'S GATE
// ---------------------------------------------------------------------------

describe('fix-386: true / false / null through the history gate', () => {
  it('★★★ NULL behaves exactly as before this ticket', () => {
    // Every existing project. "Not recorded" is not "no" (fix-363), and the
    // date inference is the whole answer — which is what fix-378's own suite,
    // left untouched by this ticket, goes on asserting.
    const current = permit();
    const historic = permit({ target_submit: '2026-01-01' }); // past at creation

    expect(milestoneIsHistory('target_submit', current, null)).toBe(false);
    expect(milestoneIsHistory('target_submit', historic, null)).toBe(true);
    // ...and identical to calling fix-378's inference directly.
    expect(milestoneIsHistory('target_submit', current, null)).toBe(
      milestonePredatesRecord('target_submit', current),
    );
    expect(milestoneIsHistory('target_submit', historic, null)).toBe(
      milestonePredatesRecord('target_submit', historic),
    );
  });

  it('★★★ TRUE suppresses even when every date looks current', () => {
    // The gain: a backfilled project whose dates happen to sit in the future.
    // The date inference sees nothing; the person who entered it told us.
    const current = permit();
    expect(milestonePredatesRecord('target_submit', current)).toBe(false);
    expect(milestoneIsHistory('target_submit', current, true)).toBe(true);
  });

  it('★★★ FALSE does NOT un-suppress what the date inference caught', () => {
    // ★ THE ASYMMETRY. A genuinely new project can still be handed an
    // already-past target by hand, and fix-378's measured population (224 of
    // 312) mostly predates this flag anyway. The flag ADDS suppression on
    // true; it never REMOVES it on false.
    const historic = permit({ target_submit: '2026-01-01' });
    expect(milestonePredatesRecord('target_submit', historic)).toBe(true);
    expect(milestoneIsHistory('target_submit', historic, false)).toBe(true);
  });

  it('★★ TRUE silences only the PLAN-DATE kinds, not current portal state', () => {
    // fix-378's reasoning, unchanged: fees / corrections / reviewer_silent read
    // the portal's PRESENT. A backfilled project's unpaid fees are still
    // genuinely unpaid today, and "this project is history" must not be heard
    // as "stop telling me about its current state".
    const p = permit();
    for (const kind of ['target_submit', 'draw', 'intake'] as const) {
      expect(milestoneIsHistory(kind, p, true)).toBe(true);
    }
    for (const kind of ['fees', 'corrections', 'reviewer_silent'] as const) {
      expect(milestoneIsHistory(kind, p, true)).toBe(false);
    }
  });

  it('★★ the flag reaches milestoneApplies, and defaults to null there', () => {
    const current = permit();
    // Not history by date, so the milestone applies...
    expect(milestoneApplies('target_submit', current, [])).toBe(true);
    // ...until the recorded answer says it is history.
    expect(milestoneApplies('target_submit', current, [], true)).toBe(false);
    // and an omitted argument is the pre-fix-386 behaviour.
    expect(milestoneApplies('target_submit', current, [])).toBe(
      milestoneApplies('target_submit', current, [], null),
    );
  });
});

// ---------------------------------------------------------------------------

describe('fix-386: one gate, one number', () => {
  it('★★ the suppressed count includes flag-suppressed milestones', () => {
    // The count must not need a second copy of the rules — it runs through the
    // same milestoneIsHistory the emit loop uses.
    const current = permit();
    expect(historicSuppressedKinds(current, [], null)).toEqual([]);
    expect(historicSuppressedKinds(current, [], true)).toContain(
      'target_submit',
    );
  });

  it('★★ a date-suppressed milestone is still counted, flag or no flag', () => {
    const historic = permit({ target_submit: '2026-01-01' });
    expect(historicSuppressedKinds(historic, [], null)).toContain('target_submit');
    expect(historicSuppressedKinds(historic, [], false)).toContain('target_submit');
    expect(historicSuppressedKinds(historic, [], true)).toContain('target_submit');
  });

  it('★ the gate composes on fix-378 rather than replacing it', () => {
    // milestonePredatesRecord is still exported and still pure — fix-378's own
    // suite pins it, and this ticket left it alone.
    const historic = permit({ target_submit: '2026-01-01' });
    expect(milestonePredatesRecord('target_submit', historic)).toBe(true);
    expect(milestonePredatesRecord('fees', historic)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('fix-386: the write path', () => {
  it('★★★ the column is nullable with no default', () => {
    expect(sqlCode).toMatch(
      /ADD COLUMN IF NOT EXISTS is_backfill boolean;/,
    );
    const alter = sqlCode.slice(
      sqlCode.indexOf('ALTER TABLE public.projects'),
      sqlCode.indexOf(';', sqlCode.indexOf('ALTER TABLE public.projects')),
    );
    expect(alter).not.toMatch(/NOT NULL/);
    expect(alter).not.toMatch(/DEFAULT/i);
  });

  it('★★ wizard field → RPC payload → column', () => {
    // wizardState.backfill_mode is sent unconditionally...
    expect(wizardSource).toContain('is_backfill: state.backfill_mode');
    // ...as part of p_project_data...
    expect(createHookSource).toContain('is_backfill?: boolean | null;');
    // ...and the RPC reads it with is_corner_lot's three-state shape.
    expect(sqlCode).toContain(
      "CASE WHEN v_pd ? ''is_backfill'' THEN (v_pd->>''is_backfill'')::boolean ELSE NULL END",
    );
  });

  it('★★★ the shared projects select fetches it', () => {
    // Without this the column is written and never read — the fix-122 trap,
    // where a real column rendered as "—" in prod for months.
    expect(projectsHookSource).toContain("'is_backfill'");
  });

  it('★ the type is hand-written and says what null means', () => {
    expect(typesSource).toContain('is_backfill?: boolean | null;');
    expect(typesSource).toContain('NULL MEANS NOT RECORDED');
  });

  it('★★ no row is written by the migration', () => {
    expect(sqlCode).not.toMatch(/UPDATE public\.projects\s+SET/i);
    expect(sqlCode).not.toMatch(/INSERT INTO public\.projects/i);
  });

  it('★★ the RPC patches are anchored and abort rather than mis-apply', () => {
    // bp_create_project_with_permits is 14.7KB; retyping it to add one column
    // risks a silently dropped line. Each patch raises unless its anchor
    // appears exactly once.
    expect(sqlCode).toContain('anchor matched % times, expected 1');
    expect(sqlCode).toContain('pg_get_functiondef');
    expect(sqlCode).toMatch(/RAISE EXCEPTION 'fix-386: create RPC did not gain is_backfill'/);
  });
});

// ---------------------------------------------------------------------------

describe('fix-386: editable after creation, quietly', () => {
  it('★★ it goes through the atomic RPC, not a side channel', () => {
    // fix-382's bp_update_project_with_permits, so the edit inherits its OCC.
    expect(sqlCode).toContain('bp_update_project_with_permits');
    expect(sqlCode).toContain(
      "is_backfill      = CASE WHEN v_patch ? ''is_backfill''       THEN (v_patch->>''is_backfill'')::boolean       ELSE is_backfill END",
    );
  });

  it('★★★ an unrelated save leaves a "not recorded" null alone', () => {
    // The modal only sends the key when there IS an answer, and the RPC patch
    // is key-presence based — so opening Settings on a pre-fix-386 project and
    // changing the address does not quietly assert "not a backfill".
    expect(settingsSource).toContain(
      "...(form.is_backfill === null ? {} : { is_backfill: form.is_backfill })",
    );
    expect(sqlCode).toContain("ELSE is_backfill END");
  });

  it('★ the control exists, is checked only on true, and says what it does', () => {
    expect(settingsSource).toContain('data-testid="psm-is-backfill"');
    expect(settingsSource).toContain('checked={form.is_backfill === true}');
    expect(settingsSource).toContain('Not recorded');
  });
});

// ---------------------------------------------------------------------------

describe('fix-386: what must not break', () => {
  it("★★ fix-143's DD unlock is untouched — this adds persistence, not UI", () => {
    // The checkbox still drives the manual DD inputs exactly as before; the
    // only new thing is that its answer is also sent.
    expect(wizardSource).toContain('state.backfill_mode &&');
    expect(wizardSource).toContain('manually_placed: !!(backfillDdStart && backfillDdEnd)');
  });

  it('★ the migration never touches draw_schedule or the DD path', () => {
    expect(sqlCode).not.toMatch(/draw_schedule/);
    expect(sqlCode).not.toMatch(/dd_start|dd_end/);
  });

  it('★ nothing re-runs fix-381, and no backfill list is applied', () => {
    expect(sqlCode).not.toMatch(/project_messages/);
    expect(sqlCode).not.toMatch(/bp_seed_project_posts/);
  });
});
