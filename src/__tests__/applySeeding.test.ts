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
});
