import { describe, it, expect } from 'vitest';
import {
  applySeeding,
  makeEmptyWizardState,
  newPermitRowId,
  type WizardPermit,
  type WizardState,
} from '../components/wizard/wizardState';

// fix-Phase-B: the wizard's reactive seeding orchestration. applySeeding is
// pure, so these cover the brief's "wizard integration" scenarios without the
// DOM-mock surface (the DOM wiring through patch is exercised separately).

function perm(type: string, over: Partial<WizardPermit> = {}): WizardPermit {
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
    ...over,
  };
}

function stateWith(go: string, permits: WizardPermit[]): WizardState {
  return { ...makeEmptyWizardState(), go_date: go, permits };
}

describe('applySeeding', () => {
  it('GO date pre-fills GO-anchored fields (PAR target_submit + expected_issue)', () => {
    const out = applySeeding(
      stateWith('2026-06-01', [perm('Building Permit'), perm('PAR/Pre-Sub')]),
    );
    const par = out.permits.find((p) => p.type === 'PAR/Pre-Sub')!;
    expect(par.expected_issue).toBe('2026-07-01'); // GO + 30
    expect(par.target_submit).toBe('2026-06-04'); // GO + 3
  });

  it('BP ACQ pre-fills BP-anchored expected_issue, with ULS +120', () => {
    const out = applySeeding(
      stateWith('2026-06-01', [
        perm('Building Permit', { expected_issue: '2026-12-01' }),
        perm('Demolition'),
        perm('IPR'),
        perm('Grading / Clearing'),
        perm('TRAO'),
        perm('ULS'),
      ]),
    );
    const byType = (t: string) => out.permits.find((p) => p.type === t)!;
    expect(byType('Demolition').expected_issue).toBe('2026-12-01');
    expect(byType('IPR').expected_issue).toBe('2026-12-01');
    expect(byType('Grading / Clearing').expected_issue).toBe('2026-12-01');
    expect(byType('TRAO').expected_issue).toBe('2026-12-01');
    expect(byType('TRAO').target_submit).toBe('2026-06-04'); // GO + 3
    expect(byType('ULS').expected_issue).toBe('2027-03-31'); // BP + 120
  });

  it('never auto-seeds the Building Permit row', () => {
    const out = applySeeding(
      stateWith('2026-06-01', [perm('Building Permit')]),
    );
    const bp = out.permits.find((p) => p.type === 'Building Permit')!;
    expect(bp.expected_issue).toBe('');
    expect(bp.target_submit).toBe('');
  });

  it('does not overwrite a manually-edited field', () => {
    const out = applySeeding(
      stateWith('2026-06-01', [
        perm('Building Permit'),
        perm('PAR/Pre-Sub', {
          expected_issue: '2099-01-01',
          manuallyEdited: { expected_issue: true },
        }),
      ]),
    );
    const par = out.permits.find((p) => p.type === 'PAR/Pre-Sub')!;
    expect(par.expected_issue).toBe('2099-01-01'); // user value preserved
    expect(par.target_submit).toBe('2026-06-04'); // not manual → seeded
  });

  it('re-seeds under the new type when type changes + flags cleared', () => {
    // A row that was Demolition (BP-anchored) becomes PAR/Pre-Sub (GO-anchored).
    // The updatePermit funnel clears manuallyEdited on type change; here we
    // model the post-clear state and assert the seed follows the new rule.
    const demo = perm('Demolition', {
      expected_issue: '2026-12-01', // stale Demo seed (= old BP ACQ)
      target_submit: '',
      manuallyEdited: {},
    });
    const retyped: WizardPermit = {
      ...demo,
      type: 'PAR/Pre-Sub',
      manuallyEdited: {},
    };
    const out = applySeeding(
      stateWith('2026-06-01', [
        perm('Building Permit', { expected_issue: '2026-12-01' }),
        retyped,
      ]),
    );
    const par = out.permits.find((p) => p.type === 'PAR/Pre-Sub')!;
    expect(par.expected_issue).toBe('2026-07-01'); // GO + 30, not the stale BP date
    expect(par.target_submit).toBe('2026-06-04'); // GO + 3
  });

  it('anchors BP-derived seeds on the FIRST Building Permit', () => {
    const out = applySeeding(
      stateWith('2026-06-01', [
        perm('Building Permit', { expected_issue: '2026-12-01' }),
        perm('Building Permit', { expected_issue: '2030-01-01' }),
        perm('Demolition'),
      ]),
    );
    const demo = out.permits.find((p) => p.type === 'Demolition')!;
    expect(demo.expected_issue).toBe('2026-12-01'); // first BP, not 2030
  });

  it('leaves a prior seed in place rather than clobbering with null when an anchor clears', () => {
    // Demo had a BP-anchored seed; BP ACQ is now empty → seed returns null →
    // keep the existing value (don't blank it out).
    const out = applySeeding(
      stateWith('2026-06-01', [
        perm('Building Permit', { expected_issue: '' }),
        perm('Demolition', { expected_issue: '2026-12-01' }),
      ]),
    );
    const demo = out.permits.find((p) => p.type === 'Demolition')!;
    expect(demo.expected_issue).toBe('2026-12-01');
  });

  it('returns the same object identity when nothing changes', () => {
    const s = stateWith('', [perm('Building Permit')]);
    expect(applySeeding(s)).toBe(s);
  });

  // fix-96-c: BP DA is collected on Step 1 (state.lead_da) and the BP
  // row's DA cell is read-only on Step 3. applySeeding mirrors lead_da
  // onto BP.da when BP.da hasn't been set yet, so the read-only cell on
  // Step 3 reflects the project-level pick without an extra round-trip
  // through the user.
  describe('fix-96-c: BP DA mirrors state.lead_da', () => {
    it('fills BP.da from state.lead_da when BP.da is empty', () => {
      const s: WizardState = {
        ...stateWith('2026-06-01', [perm('Building Permit')]),
        lead_da: 'Trevor',
      };
      const out = applySeeding(s);
      const bp = out.permits.find((p) => p.type === 'Building Permit')!;
      expect(bp.da).toBe('Trevor');
    });

    it('does not touch BP.da when lead_da is blank (BP stays empty)', () => {
      const s = stateWith('2026-06-01', [perm('Building Permit')]);
      const out = applySeeding(s);
      const bp = out.permits.find((p) => p.type === 'Building Permit')!;
      expect(bp.da).toBe('');
    });

    it('does not overwrite an existing BP.da when lead_da is also set', () => {
      // Shouldn't happen in practice (BP DA isn't editable on Step 3), but
      // guard against it anyway — never silently overwrite a stored value.
      const s: WizardState = {
        ...stateWith('2026-06-01', [
          perm('Building Permit', { da: 'Cam' }),
        ]),
        lead_da: 'Trevor',
      };
      const out = applySeeding(s);
      const bp = out.permits.find((p) => p.type === 'Building Permit')!;
      expect(bp.da).toBe('Cam');
    });
  });

  // fix-130: sibling inheritance. Bobby's "aligned with the other permits"
  // requirement — when a new row is added of a type that already has a
  // selected sibling with values filled, the new row inherits from the
  // sibling instead of relying on the per-type formula (which may not
  // know about user-touched values on the sibling).
  describe('sibling-inheritance (fix-130)', () => {
    it('a second BP inherits expected_issue from the first BP', () => {
      const bp1 = perm('Building Permit', { expected_issue: '2026-11-30' });
      const bp2 = perm('Building Permit'); // freshly added, empty
      const out = applySeeding(stateWith('2026-06-01', [bp1, bp2]));
      const newBp = out.permits.find(
        (p) => p.rowId === bp2.rowId,
      )!;
      expect(newBp.expected_issue).toBe('2026-11-30');
    });

    it('a second Demolition inherits expected_issue from the first Demolition', () => {
      // Demolition is BP-anchored (expected_issue = BP ACQ). With a sibling
      // present, that sibling wins over the formula.
      const bp = perm('Building Permit', { expected_issue: '2026-11-30' });
      const demo1 = perm('Demolition', { expected_issue: '2026-10-15' });
      const demo2 = perm('Demolition');
      const out = applySeeding(stateWith('2026-06-01', [bp, demo1, demo2]));
      const newDemo = out.permits.find((p) => p.rowId === demo2.rowId)!;
      expect(newDemo.expected_issue).toBe('2026-10-15');
    });

    it('inherits target_submit from a same-type sibling (PAR/Pre-Sub)', () => {
      const bp = perm('Building Permit');
      const par1 = perm('PAR/Pre-Sub', { target_submit: '2026-08-15' });
      const par2 = perm('PAR/Pre-Sub');
      const out = applySeeding(stateWith('2026-06-01', [bp, par1, par2]));
      const newPar = out.permits.find((p) => p.rowId === par2.rowId)!;
      expect(newPar.target_submit).toBe('2026-08-15');
    });

    it('falls back to the per-type formula when no sibling is present', () => {
      const bp = perm('Building Permit');
      const par = perm('PAR/Pre-Sub'); // only one PAR row → no sibling
      const out = applySeeding(stateWith('2026-06-01', [bp, par]));
      const seeded = out.permits.find((p) => p.rowId === par.rowId)!;
      // Formula: PAR target_submit = GO + 3 = 2026-06-04.
      expect(seeded.target_submit).toBe('2026-06-04');
      // Formula: PAR expected_issue = GO + 30 = 2026-07-01.
      expect(seeded.expected_issue).toBe('2026-07-01');
    });

    it('does NOT overwrite a manually-edited field on the new row', () => {
      // User added a row, picked Demolition, then manually set
      // expected_issue. A sibling Demolition exists but the manual edit
      // wins (manuallyEdited.expected_issue=true).
      const bp = perm('Building Permit', { expected_issue: '2026-11-30' });
      const demo1 = perm('Demolition', { expected_issue: '2026-10-15' });
      const demo2 = perm('Demolition', {
        expected_issue: '2027-01-15',
        manuallyEdited: { expected_issue: true },
      });
      const out = applySeeding(stateWith('2026-06-01', [bp, demo1, demo2]));
      const manual = out.permits.find((p) => p.rowId === demo2.rowId)!;
      expect(manual.expected_issue).toBe('2027-01-15');
    });

    it('an empty-type row is left untouched (no rule, no sibling-search target)', () => {
      const bp = perm('Building Permit');
      const blank = perm('', {});
      const out = applySeeding(stateWith('2026-06-01', [bp, blank]));
      const stillBlank = out.permits.find((p) => p.rowId === blank.rowId)!;
      expect(stillBlank.type).toBe('');
      expect(stillBlank.expected_issue).toBe('');
      expect(stillBlank.target_submit).toBe('');
    });

    it('ignores unselected siblings (Step 2 toggles them off)', () => {
      const bp = perm('Building Permit');
      const par1 = perm('PAR/Pre-Sub', {
        selected: false,
        target_submit: '2026-08-15',
      });
      const par2 = perm('PAR/Pre-Sub');
      const out = applySeeding(stateWith('2026-06-01', [bp, par1, par2]));
      const newPar = out.permits.find((p) => p.rowId === par2.rowId)!;
      // Falls back to formula because the unselected par1 isn't a valid
      // inheritance source.
      expect(newPar.target_submit).toBe('2026-06-04');
    });
  });
});
