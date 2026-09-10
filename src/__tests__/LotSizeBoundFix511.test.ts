import { describe, it, expect } from 'vitest';
import {
  LOT_SIZE_MESSAGES,
  LOT_SIZE_SF_MAX,
  parseLotSizeSf,
} from '../lib/lotDimensions';
import { mutationErrorContext } from '../lib/mutationErrorContext';

import editorsSrc from '../components/ProjectDetail/ProjectDataEditors.tsx?raw';
// ★ fix-514 §A: `ProjectSettingsModal` is DELETED. Its form state and atomic
//   save are `hooks/useProjectDetailsForm`; its controls are
//   `components/ProjectDetail/ProjectDetailsForm`. The claims below are
//   unchanged — only the address of the code is.
import modalSrc from '../hooks/useProjectDetailsForm.ts?raw';
import wizardSrc from '../components/NewProjectWizard.tsx?raw';
import appSrc from '../App.tsx?raw';
import updateProjectSrc from '../hooks/useUpdateProject.ts?raw';

// ===========================================================================
// fix-511 §C (P-198) — A NUMBER FIELD STOPS OVERFLOWING AN INTEGER COLUMN
// ===========================================================================
//
// PROD, 2026-09-09 12:31 PT (row 696). Cam, on `10150 NE 64th St`:
// `invalid input syntax for type integer: "1.015e+68"`. His edit was lost and
// the sentence he read was Postgres's. He retried a minute later and the row
// took `lot_size_sf = 10500` — the app recovered nothing, the user did.
//
//   projects.lot_width    numeric   no ceiling
//   projects.lot_depth    numeric   no ceiling
//   projects.lot_size_sf  INTEGER   2,147,483,647
//
// ★★★ `<input type="number">` ACCEPTS EXPONENT NOTATION, which is the part
// worth remembering. `1.015e+68` is a *valid* value for that input; `Number()`
// parses it, `Math.round` leaves it, and `Number.isFinite` says yes. Every
// guard on the old path passed a number 60 orders of magnitude past the column,
// so this was never a validation somebody forgot — it was a validation nobody
// could have known was missing without reading the column type.

function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('fix-511 §C1 — the bound, at the field', () => {
  it('★★★ the exact prod value is refused, with a sentence about lot sizes', () => {
    const r = parseLotSizeSf('1.015e+68');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('exponent');
    expect(r.message).toBe(LOT_SIZE_MESSAGES.exponent);
    // ★ NOT the driver's. The row Cam saw began "invalid input syntax for".
    expect(r.message).not.toMatch(/invalid input syntax|integer|postgres/i);
  });

  it('★★★ exponent notation is refused by NOTATION, not by magnitude', () => {
    // `1e5` is a perfectly ordinary 100,000. It is still refused, because the
    // person meant to type 100000 and the box turned it into something else —
    // and a rule that refuses only huge exponents leaves the confusing ones in.
    for (const raw of ['1e5', '1E5', '1.05e4', '2e-3', '1.015e+68', '1e400']) {
      const r = parseLotSizeSf(raw);
      expect(r.ok, raw).toBe(false);
      if (!r.ok) expect(r.reason, raw).toBe('exponent');
    }
  });

  it('★★★ out of range is refused at the COLUMN\'s ceiling, not a made-up one', () => {
    expect(LOT_SIZE_SF_MAX).toBe(2_147_483_647);
    const ok = parseLotSizeSf(String(LOT_SIZE_SF_MAX));
    expect(ok).toEqual({ ok: true, value: LOT_SIZE_SF_MAX });
    const over = parseLotSizeSf(String(LOT_SIZE_SF_MAX + 1));
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.reason).toBe('range');
      expect(over.message).toContain('2,147,483,647');
      expect(over.message).toContain('77 square miles');
    }
  });

  it('★★ it REFUSES rather than clamping — a clamp would store a number nobody typed', () => {
    const r = parseLotSizeSf('99999999999');
    expect(r.ok).toBe(false);
    // If this ever became a clamp, the assertion below is the one that fails.
    expect(r).not.toHaveProperty('value');
  });

  it('★★ ordinary entries are unchanged, including the one Cam retyped', () => {
    expect(parseLotSizeSf('10500')).toEqual({ ok: true, value: 10500 });
    expect(parseLotSizeSf(' 7200 ')).toEqual({ ok: true, value: 7200 });
    // Rounded, as this box always did — square feet are whole numbers here.
    expect(parseLotSizeSf('7200.4')).toEqual({ ok: true, value: 7200 });
    expect(parseLotSizeSf('7200.6')).toEqual({ ok: true, value: 7201 });
  });

  it('★★ empty CLEARS, and zero/negative still clear — a long-standing behaviour', () => {
    expect(parseLotSizeSf('')).toEqual({ ok: true, value: null });
    expect(parseLotSizeSf('   ')).toEqual({ ok: true, value: null });
    expect(parseLotSizeSf('0')).toEqual({ ok: true, value: null });
    expect(parseLotSizeSf('-5')).toEqual({ ok: true, value: null });
  });

  it('★ nonsense is refused rather than silently cleared', () => {
    const r = parseLotSizeSf('abc');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid');
  });
});

describe('fix-511 §C1 — all three write paths use it', () => {
  // ★★★ fix-415's rule: site fields have THREE write paths — the Site card
  //     (direct table update), the settings modal (atomic RPC) and the wizard
  //     (atomic RPC). A bound on one of them is a bound on none of them.
  // ★★★ fix-520 §A (P-227) — THE MODAL IS NO LONGER A THIRD WRITE PATH FOR
  //     THE LOT SIZE, so it is no longer a place the bound has to be enforced.
  //     `lot_size_sf` is edited by `LotSizeEditor` on the Site data tab, which
  //     is the `editorsSrc` row below and always called `parseLotSizeSf` on
  //     blur. The modal's atomic save carried a copy of the value and therefore
  //     a copy of the guard; it now writes permits and nothing else.
  // ★★ fix-511 §C's RULING IS UNCHANGED — *"a bound on one of them is a bound
  //    on none of them"* — there are simply two of them now. Removing the
  //    check from a path that no longer writes the column is not a hole; a
  //    guard over a value a function cannot send can only ever pass.
  it.each([
    ['Project Data — Site card', editorsSrc],
    ['New Project wizard', wizardSrc],
  ])('★★★ %s parses through parseLotSizeSf', (_name, src) => {
    expect(code(src)).toContain('parseLotSizeSf(');
  });

  it('★★★ …and the modal does not write `lot_size_sf` at all any more', () => {
    const c = code(modalSrc);
    expect(c).toContain('const projectPatch: Record<string, unknown> = {};');
    expect(c).not.toContain('lot_size_sf');
  });

  it('★★★ …and none of them still has the old unbounded parse', () => {
    for (const [name, src] of [
      ['editors', editorsSrc],
      ['modal', modalSrc],
      ['wizard', wizardSrc],
    ] as const) {
      // The shape that let `1.015e+68` through: finite + positive, no ceiling.
      expect(code(src), name).not.toMatch(
        /Number\.isFinite\(n\)\s*&&\s*n\s*>\s*0\s*\?\s*Math\.round\(n\)/,
      );
    }
  });

  it('★★ the Site card puts the box back to what is STORED after a refusal', () => {
    // Leaving the rejected number on screen is how Cam lost an edit without
    // knowing which field the database had objected to.
    const c = code(editorsSrc);
    expect(c).toMatch(/if\s*\(!parsed\.ok\)\s*\{[\s\S]*?pushToast\(parsed\.message/);
    expect(c).toMatch(
      /if\s*\(!parsed\.ok\)\s*\{[\s\S]*?setDraft\(project\.lot_size_sf != null/,
    );
  });

  it('★★ the SITE EDITOR refuses before it writes — which is where the value is now', () => {
    // ★ Same shape as the assertion this replaces: parse first, write second.
    //   What changed is which function owns the write.
    const c = code(editorsSrc);
    const guard = c.indexOf('parseLotSizeSf(');
    expect(guard).toBeGreaterThan(-1);
    expect(c.indexOf('mutateAsync', guard)).toBeGreaterThan(guard);
  });
});

// ---------------------------------------------------------------------------
// §C2 — the compounding half
// ---------------------------------------------------------------------------

describe('fix-511 §C2 — a reported mutation error names what it was writing', () => {
  it('★★★ the RPC/table name comes off the hook\'s own meta', () => {
    const ctx = mutationErrorContext(undefined, { write: 'projects.update' }, {
      projectId: 'p1',
      patch: { lot_size_sf: 1.015e68 },
      fieldLabel: 'Lot Size',
    });
    expect(ctx.write).toBe('projects.update');
  });

  it('★★★ …and the FIELD, which is what row 696 could not say', () => {
    const ctx = mutationErrorContext(undefined, { write: 'projects.update' }, {
      projectId: 'p1',
      patch: { lot_size_sf: 1.015e68 },
      fieldLabel: 'Lot Size',
    });
    expect(ctx.fields).toEqual(['Lot Size', 'lot_size_sf']);
  });

  it('★★★ KEYS ONLY — a value typed into a patch never reaches the table', () => {
    const ctx = mutationErrorContext(undefined, undefined, {
      patch: {
        address: '10150 NE 64th St',
        builder_name: 'a real person',
        lot_size_sf: 1.015e68,
      },
    });
    expect(ctx.fields).toEqual(['address', 'builder_name', 'lot_size_sf']);
    expect(JSON.stringify(ctx)).not.toContain('10150 NE 64th St');
    expect(JSON.stringify(ctx)).not.toContain('a real person');
  });

  it('★★ a bulk patch is capped rather than carrying a schema into the row', () => {
    const patch: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) patch[`col_${i}`] = i;
    const ctx = mutationErrorContext(undefined, undefined, { patch });
    expect(ctx.fields).toHaveLength(12);
  });

  it('★★ a hook that declares nothing produces exactly the row it produces today', () => {
    // Every key is absent, not null — `JSON.stringify` drops undefined, so the
    // context is byte-identical to the pre-fix-511 one for an un-annotated hook.
    expect(mutationErrorContext(undefined, undefined, undefined)).toEqual({});
    expect(JSON.stringify(mutationErrorContext(undefined, undefined, 'nope'))).toBe('{}');
  });

  it('★ a mutationKey is still carried when a hook actually declares one', () => {
    // fix-87 has sent this since the beginning; it is undefined in every prod
    // row because no hook sets it. The field is kept, not replaced.
    const ctx = mutationErrorContext(['upsert-cycle'], undefined, undefined);
    expect(ctx.mutationKey).toEqual(['upsert-cycle']);
  });

  it('★★★ App.tsx spreads it into the mutation report', () => {
    const c = code(appSrc);
    expect(c).toContain('mutationErrorContext(key, mutation.options.meta, vars)');
    // …and the query side is untouched: it already carries its queryKey.
    expect(c).toContain("kind: 'query'");
    expect(c).toContain('queryKey: query.queryKey');
  });

  it('★★★ the hook that produced prod row 696 now declares its write', () => {
    expect(code(updateProjectSrc)).toContain("meta: { write: 'projects.update' }");
  });

  it('★★ …as do the other write paths this ticket touched, named by RPC', () => {
    expect(code(modalSrc)).toContain('useUpdateProjectWithPermits');
    // The three lot_size_sf writers + the four da_time_blocks writers from §B.
    const declared = [
      'bp_update_project_with_permits',
      'bp_create_project_with_permits',
      'bp_upsert_da_time_block_row',
      'bp_resize_da_time_block',
      'bp_delete_da_time_block_row',
      'bp_rename_da',
    ];
    const hooks = import.meta.glob('../hooks/*.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const all = Object.values(hooks).map(code).join('\n');
    for (const rpc of declared) {
      expect(all, rpc).toContain(`meta: { write: '${rpc}' }`);
    }
  });
});
