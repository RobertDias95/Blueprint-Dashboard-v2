import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import EntCascadePrompt from '../components/EntCascadePrompt';
import { milestoneCounterparty } from '../lib/boardOwnership';

// ===========================================================================
// fix-671 (P-352) — the last "Entitlement" words on screen become "Permitting"
// ===========================================================================
//
// fix-535 renamed the field to "Permitting Lead" everywhere it found a label
// (Bobby, 09-09: "everything that has Entitlements changed to Permitting").
// The Draw Schedule's DA-move prompt was missed: dragging a block to another
// DA's row still asked "Update Entitlement Lead as well?". The re-sweep found
// seven more sentences in the same state, plus three in live functions.
//
// ★★★ DISPLAY TEXT ONLY. The stored 'Entitlements' team, the
//     `entitlement_lead` column and the Report Builder key `entitlement_lead`
//     do not change — saved reports and 57 templates reference them.

const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), 'utf8');

/** Source with comments removed, so a comment that still says "Entitlement"
 *  (history, rationale) cannot fail the sweep — only rendered text can. */
const code = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('fix-671 — the DA-move prompt says Permitting Lead', () => {
  const renderPrompt = () =>
    render(
      <EntCascadePrompt
        movedAddress="123 Main St"
        newDa="Francesca"
        fromLead="Miles"
        toLead="Briana"
        pending={false}
        onUpdateEntLead={vi.fn()}
        onKeepEntLead={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

  it('★★★ no word on the prompt says Entitlement', () => {
    renderPrompt();
    const modal = screen.getByTestId('ent-cascade-prompt');
    expect(modal.textContent ?? '').not.toMatch(/entitlement/i);
    expect(modal.textContent).toContain('Update Permitting Lead as well?');
    expect(modal.textContent).toContain('would also change the Permitting Lead from');
    expect(modal.textContent).toContain('Apply the Permitting Lead change?');
  });

  it('★★★ the two buttons are "Keep current Permitting Lead" and "Update Permitting Lead"', () => {
    renderPrompt();
    expect(screen.getByRole('button', { name: 'Keep current Permitting Lead' })).toBe(
      screen.getByTestId('ent-cascade-prompt-keep'),
    );
    expect(screen.getByRole('button', { name: 'Update Permitting Lead' })).toBe(
      screen.getByTestId('ent-cascade-prompt-update'),
    );
    // ★ Cancel is unchanged.
    expect(screen.getByTestId('ent-cascade-prompt-cancel').textContent).toBe('Cancel move');
  });
});

describe('fix-671 — the re-sweep: every rendered sentence that still said it', () => {
  // ★ Found by re-running the sweep the brief asked for; none were on its list.
  const FILES = [
    'src/components/EntCascadePrompt.tsx',
    'src/components/ProjectDetail/PostRequestPanel.tsx',
    'src/components/Settings/DaRoutingEditor.tsx',
    'src/components/Settings/PermitsMissingLeadPanel.tsx',
    'src/pages/Errors.tsx',
    'src/lib/daRouting.ts',
  ];
  it.each(FILES)('%s renders no "entitlement lead"', (f) => {
    expect(code(read(f))).not.toMatch(/entitlement lead/i);
  });

  it('★★ an empty lead seat on the board is "the permitting lead"', () => {
    expect(milestoneCounterparty('design', { ent_lead: null }).label).toBe('the permitting lead');
  });
});

describe('fix-671 — the migration changes LABELS, never a key', () => {
  const sql = read('migrations/fix_671_permitting_lead_labels.sql');

  it('★★★ the Report Builder column keeps its key and gets the new label', () => {
    expect(sql).toContain(`_rbcol('entitlement_lead','Entitlement Lead',`);
    expect(sql).toContain(`_rbcol('entitlement_lead','Permitting Lead',`);
    // ★ The key is never rewritten.
    expect(sql).not.toMatch(/_rbcol\('permitting_lead'/);
  });

  it('★★ the two refusal sentences are reworded, and every patch is by anchor, once', () => {
    expect(sql).toContain("only the permit''s permitting lead or an admin may acknowledge");
    expect(sql).toContain("'a permitting lead is required'");
    expect(sql).toContain('pg_get_functiondef');
    expect(sql).toContain('anchor not found exactly once');
  });

  it('★★★ no stored value is touched — no UPDATE, INSERT or DELETE', () => {
    expect(sql).not.toMatch(/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\b/i);
  });
});
