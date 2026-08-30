import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CANONICAL_PERMIT_OWNERS,
  PERMIT_OWNER_KEY,
  isRetiredPermitOwner,
  permitOwnerOptions,
} from '../lib/permitOwnerOptions';

// ===========================================================================
// ★★★ fix-449 (P-077) — THE LAST FREE-TEXT FIELDS
// ===========================================================================

describe('fix-449 §B: the permit-owner registry', () => {
  it('★★★ seeds the three prod values when the key was never written', () => {
    // fix-415's pattern, and the reason §B1 needs NO migration: the canonical
    // list is a client-side fallback, so a tenant that has never edited it
    // still gets a working list and the first admin edit creates the row.
    expect(permitOwnerOptions(new Map())).toEqual([
      'Entitlements',
      'Architecture',
      'Split',
    ]);
    expect([...CANONICAL_PERMIT_OWNERS]).toHaveLength(3);
  });

  it('★★ a written key wins over the seed', () => {
    const m = new Map<string, unknown>([[PERMIT_OWNER_KEY, ['Ent', 'Arch']]]);
    expect(permitOwnerOptions(m)).toEqual(['Ent', 'Arch']);
  });

  it('★★★ a stored value the list no longer offers is APPENDED, not dropped', () => {
    // fix-415's rule: a control must be able to display what it holds. A
    // dropdown that silently omits its own value rewrites data the moment
    // somebody saves the row next to it.
    const m = new Map<string, unknown>([[PERMIT_OWNER_KEY, ['Entitlements']]]);
    expect(permitOwnerOptions(m, 'Split')).toEqual(['Entitlements', 'Split']);
    // …and not duplicated when it IS offered.
    expect(permitOwnerOptions(m, 'Entitlements')).toEqual(['Entitlements']);
  });

  it('★★★ isRetiredPermitOwner marks exactly the values the list dropped', () => {
    const m = new Map<string, unknown>([[PERMIT_OWNER_KEY, ['Entitlements']]]);
    expect(isRetiredPermitOwner(m, 'Split')).toBe(true);
    expect(isRetiredPermitOwner(m, 'Entitlements')).toBe(false);
    // ★ A blank is not retired — "nothing recorded" is not a wrong answer, and
    //   493 of prod's 651 permits are exactly that.
    expect(isRetiredPermitOwner(m, '')).toBe(false);
    expect(isRetiredPermitOwner(m, null)).toBe(false);
  });

  it('★★ against the SEED, none of the three prod values is retired', () => {
    for (const v of ['Entitlements', 'Split', 'Architecture']) {
      expect(isRetiredPermitOwner(new Map(), v), v).toBe(false);
    }
  });
});

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
    const header = read('src/components/ProjectDetail/ProjectDetailHeader.tsx');
    expect(header).toContain("label=\"Alley\"");
    expect(header).toMatch(/label="Alley"[\s\S]{0,200}options=\{\['', 'Yes', 'No'\]\}/);

    const modal = read('src/components/ProjectDetail/ProjectSettingsModal.tsx');
    // ★ One definition, imported — not a second literal.
    expect(modal).toContain('WIZARD_ALLEY_OPTIONS');
    expect(modal).not.toMatch(/const ALLEY_OPTIONS = \['', 'Yes', 'No'\]/);

    const wizard = read('src/components/wizard/wizardState.ts');
    expect(wizard).toContain("export const ALLEY_OPTIONS = ['Yes', 'No'] as const;");
  });

  it('★★ no surface offers a free-text alley input', () => {
    for (const f of [
      'src/components/ProjectDetail/ProjectDetailHeader.tsx',
      'src/components/ProjectDetail/ProjectSettingsModal.tsx',
      'src/components/wizard/Step1ProjectInfo.tsx',
    ]) {
      const src = read(f);
      // An <input> whose value is the alley field would be the regression.
      expect(src, f).not.toMatch(/<input[^>]*value=\{[^}]*\balley\b/);
    }
  });
});
