import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ===========================================================================
// ★★★ fix-449 (P-077) — THE LAST FREE-TEXT FIELDS
// ===========================================================================

// ---------------------------------------------------------------------------
// §A — the alley finding, pinned so it cannot regress into free text
// ---------------------------------------------------------------------------
describe('fix-449 §A: alley is a list on every write surface', () => {
  const read = (f: string) =>
    readFileSync(resolve(process.cwd(), f), 'utf8');

  it('★★★ all three surfaces are pickers, and ONE list defines them', () => {
    // ★★★ STEP 0 FOUND SCOPE A ALREADY DONE. The Overview SITE card uses the
    //     SAME `SiteSelectRow` with the SAME options as fix-410's Regular
    //     Shape — the control §A1 asked to copy — and the modal and wizard are
    //     both <select>s. What was actually wrong was TWO copies of the list.
    const header = read('src/components/ProjectDetail/ProjectDataEditors.tsx');
    expect(header).toContain("label=\"Alley\"");
    expect(header).toMatch(/label="Alley"[\s\S]{0,200}options=\{\['', 'Yes', 'No'\]\}/);

    // ★★ fix-514 §A: `ProjectSettingsModal` is deleted, and its alley picker
    //    went with it — Site data's per-field `SiteSelectRow` above is now the
    //    ONLY alley control outside the wizard. The rule this test defends
    //    ("one definition, not a second literal") therefore has one fewer
    //    surface to defend, which is a smaller claim and a true one.
    const detailsForm = read('src/components/ProjectDetail/ProjectDetailsForm.tsx');
    expect(detailsForm).not.toMatch(/const ALLEY_OPTIONS = \['', 'Yes', 'No'\]/);

    const wizard = read('src/components/wizard/wizardState.ts');
    expect(wizard).toContain("export const ALLEY_OPTIONS = ['Yes', 'No'] as const;");
  });

  it('★★ no surface offers a free-text alley input', () => {
    for (const f of [
      'src/components/ProjectDetail/ProjectDataEditors.tsx',
      'src/components/ProjectDetail/ProjectDetailsForm.tsx',
      'src/components/wizard/Step1ProjectInfo.tsx',
    ]) {
      const src = read(f);
      // An <input> whose value is the alley field would be the regression.
      expect(src, f).not.toMatch(/<input[^>]*value=\{[^}]*\balley\b/);
    }
  });
});
