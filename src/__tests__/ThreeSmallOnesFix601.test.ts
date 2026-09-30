import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initProjectDetailsForm,
  permitToRow,
  projectDetailsFormIsDirty,
} from '../lib/projectDetailsForm';
import {
  UNIT_LABEL_RETIRED_MARKER,
  unitLabelIsRetired,
  unitLabelOptions,
} from '../lib/unitTypeNaming';

// ===========================================================================
// ★★★ fix-601 — THREE SMALL ONES (P-294 · P-173 · P-172)
// ===========================================================================
//
// ⚠️ §C (P-172) IS NOT IN THIS FILE, AND THAT IS THE TICKET'S OWN INSTRUCTION.
//    §C.1: *"If the read is an RPC/view that needs a migration to add columns,
//    STOP and report instead."* It does. The join path and the reason are in
//    the PR body; nothing about §C shipped.

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
/** ★ Comments stripped — both §B surfaces carry a gravestone naming the very
 *  thing being asserted gone. Seventh-ish time in this repo. */
const code = (src: string) =>
  src
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');

// ═══════════════════════════════════════════════════════════════════════════
// §A — P-294 · changing only "Sub-permit of" must read dirty
// ═══════════════════════════════════════════════════════════════════════════

const PERMIT = {
  id: 10,
  project_id: 'p-1',
  type: 'Building Permit',
  ent_lead: 'Miles',
  da: 'Nicky',
  portal_url: null,
  num: 'BP-1',
  struct_address: null,
  expected_issue: null,
  parent_permit_id: null,
  updated_at: '2026-09-30T00:00:00Z',
  cycles: [],
} as never;

const PROJECT = { id: 'p-1', address: '1 Main St' } as never;

function formWith(parent: string | number | null) {
  return initProjectDetailsForm(
    PROJECT,
    [{ ...(PERMIT as object), parent_permit_id: parent } as never],
  );
}

describe('fix-601 §A — the sub-permit selector makes the modal dirty', () => {
  it('★★★ changing ONLY `parent_permit_id` reads dirty', () => {
    // fix-517 §E brought this field here when it deleted `QuickEditPermitModal`;
    // it added the control and the save path and **not the comparison**, so the
    // footer stayed on Exit and the edit was dropped on the way out.
    const initial = formWith(null);
    const current = structuredClone(initial);
    current.permits[0]!.parent_permit_id = '7';
    expect(projectDetailsFormIsDirty(initial, current)).toBe(true);
  });

  it('★★★ …and CLEARING it reads dirty too', () => {
    // fix-194: a sub-permit is excluded from every rollup, so an unclearable one
    // is a permanently mis-counted permit. Setting and clearing are both edits.
    const initial = formWith(7);
    const current = structuredClone(initial);
    current.permits[0]!.parent_permit_id = '';
    expect(projectDetailsFormIsDirty(initial, current)).toBe(true);
  });

  it('★★★ `null` → `null` is NOT dirty — no stuck-dirty after a save', () => {
    // ★★★ THE HALF THAT MATTERS MORE THAN THE BUG. fix-519 §B freezes the form
    //     rebuild while dirty, so a field that reads dirty for ever would strand
    //     the modal on stale permit OCC tokens. Both snapshots are built by
    //     `permitToRow`, which normalises `null → ''`.
    const initial = formWith(null);
    const current = structuredClone(initial);
    expect(projectDetailsFormIsDirty(initial, current)).toBe(false);
  });

  it('★★★ a SAVED value re-reads clean on the rebuilt snapshot', () => {
    // ★★ The round trip the brief asks to be tested: the server returns the
    //    parent as a NUMBER, the form holds the select's STRING. `permitToRow`
    //    puts both through `String()`, so the rebuild compares equal.
    const afterSave = permitToRow({ ...(PERMIT as object), parent_permit_id: 7 } as never);
    expect(afterSave.parent_permit_id).toBe('7');
    const initial = formWith(7);
    const current = structuredClone(initial);
    expect(current.permits[0]!.parent_permit_id).toBe('7');
    expect(projectDetailsFormIsDirty(initial, current)).toBe(false);
  });

  it('★★★ the comparison covers EVERY field the tab can edit — all eight', () => {
    // ★★★ §A.3 ASKED FOR THE LIST, AND IT IS EXACTLY ONE LONG. Counted from the
    //     tab's own `onChange({ … })` call sites rather than from the interface:
    //     type · ent_lead · da · num · portal_url · struct_address ·
    //     expected_issue · parent_permit_id. Seven were compared; the eighth is
    //     this ticket. `id` / `projectId` / `updated_at` are identity and OCC.
    const form = code(read('components/ProjectDetail/ProjectDetailsForm.tsx'));
    const edited = [...form.matchAll(/onChange\(\{\s*(\w+):/g)].map((m) => m[1]!);
    const editable = [...new Set(edited)].sort();
    expect(editable).toEqual([
      'da',
      'ent_lead',
      'expected_issue',
      'num',
      'parent_permit_id',
      'portal_url',
      'struct_address',
      'type',
    ]);

    // …and every one of them is in the dirty comparison.
    const lib = code(read('lib/projectDetailsForm.ts'));
    const block = lib.slice(lib.indexOf('function permitsAreDirty'));
    for (const f of editable) {
      expect(block, f).toContain(`a.${f} !== b.${f}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §B — P-173 · a unit-type dropdown offers only what Settings holds
// ═══════════════════════════════════════════════════════════════════════════

const REGISTRY = ['Detached', 'Attached', 'ADU', 'DADU', 'Remodel'];

describe('fix-601 §B — no free text, and an off-list value still displays', () => {
  it('★★★ NEITHER surface renders an `Other…` option', () => {
    // Bobby, 2026-09-08: *"our drop downs need to match our settings and no free
    // form text."* Adding a unit type is a Settings action, full stop.
    for (const f of [
      'components/ProjectDetail/ProjectDataEditors.tsx',
      'components/wizard/UnitTypesEditor.tsx',
    ]) {
      const src = code(read(f));
      expect(src, f).not.toContain('Other…');
      expect(src, f).not.toContain('OTHER_UNIT_LABEL');
      // ★★★ AND THE PROMPT GOES WITH IT — the option was only the doorway.
      expect(src, f).not.toContain('window.prompt');
    }
  });

  it('★★★ the constant itself is deleted — no dead export left behind', () => {
    const lib = code(read('lib/unitTypeNaming.ts'));
    expect(lib).not.toContain('OTHER_UNIT_LABEL');
  });

  it('★★★ an off-list STORED value is still offered to its own row', () => {
    // ⛔ fix-415's append rule survives: *"do not blank it, do not substitute a
    //    registry value."* 0 of 566 unit rows are off-list today (measured
    //    2026-09-30), but Settings can retire a value tomorrow and 239 projects
    //    carry unit types.
    const opts = unitLabelOptions(REGISTRY, 'Townhouse');
    expect(opts).toContain('Townhouse');
    expect(opts).toEqual([...REGISTRY, 'Townhouse']);
  });

  it('★★★ …and it is marked RETIRED, so it displays without being a choice', () => {
    expect(unitLabelIsRetired('Townhouse', REGISTRY)).toBe(true);
    for (const t of REGISTRY) {
      expect(unitLabelIsRetired(t, REGISTRY), t).toBe(false);
    }
    // ★ a blank is not "retired" — it is the placeholder
    expect(unitLabelIsRetired('', REGISTRY)).toBe(false);
    expect(UNIT_LABEL_RETIRED_MARKER).toBe(' (not a current type)');
  });

  it('★★★ it is NOT offered on a SIBLING row', () => {
    // ★★★ THE WHOLE POINT OF THE DISABLED OPTION. A value that is no longer a
    //     type is a fact about THAT row. Another row, holding a registry value,
    //     must never see it in its list at all.
    const sibling = unitLabelOptions(REGISTRY, 'Detached');
    expect(sibling).not.toContain('Townhouse');
    expect(sibling).toEqual(REGISTRY);
  });

  it('★★★ both surfaces render the marker and disable the option', () => {
    for (const f of [
      'components/ProjectDetail/ProjectDataEditors.tsx',
      'components/wizard/UnitTypesEditor.tsx',
    ]) {
      const src = code(read(f));
      expect(src, f).toContain('unitLabelIsRetired(');
      expect(src, f).toContain('disabled={retired}');
      expect(src, f).toContain('UNIT_LABEL_RETIRED_MARKER');
    }
  });

  it('★★ a registry value still commits, unchanged', () => {
    // The ordinary path must be untouched by all of the above.
    const src = code(read('components/ProjectDetail/ProjectDataEditors.tsx'));
    expect(src).toContain("void commit('label', { label: e.target.value })");
    const wiz = code(read('components/wizard/UnitTypesEditor.tsx'));
    expect(wiz).toContain('update(i, { label: e.target.value })');
  });

  it('★★★ ⛔ `Step1ProjectInfo` was NOT edited — fix-555 owns that file', () => {
    // §B.3: *"Do not touch `Step1ProjectInfo.tsx` (fix-555 owns it) — audit it,
    // don't edit it."* Asserted so a future refactor of this ticket cannot
    // quietly reach into another session's file.
    const src = read('components/wizard/Step1ProjectInfo.tsx');
    expect(src).not.toContain('fix-601');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §C — P-172 · STOPPED, by the ticket's own instruction
// ═══════════════════════════════════════════════════════════════════════════

describe('fix-601 §C — stopped and reported, not built', () => {
  it('★★★ the chat row is UNCHANGED', () => {
    // §C.1: *"If the read is an RPC/view that needs a migration to add columns,
    // STOP and report instead."*
    //
    // ★★★ IT DOES. `bp_list_project_messages` is a `RETURNS TABLE(…)` SQL
    //     function that LEFT JOIN LATERALs `permit_tasks` for `pt.id, pt.text,
    //     pt.permit_id`. Adding `completion_status` / `done` / `done_at` /
    //     `assigned_to` / `due_date` changes its RETURN TYPE, and
    //     `CREATE OR REPLACE FUNCTION` cannot do that — Postgres refuses with
    //     *"cannot change return type of existing function"*, so it needs
    //     DROP + CREATE. **That is a migration**, and this ticket says it has
    //     none.
    //
    // ★★ AND THERE IS NO SECOND READ TO PIGGYBACK ON: no chat surface loads
    //    tasks today, so the alternative is a new query — which §C.1 also rules
    //    out (*"One read, no new write surface"*).
    const src = code(read('components/ProjectDetail/ChatMessageRow.tsx'));
    expect(src).toContain('created from this message');
    for (const field of ['completion_status', 'done_at', 'due_date', 'assigned_to']) {
      expect(src, field).not.toContain(field);
    }
  });

  it('★★★ no migration was added by this ticket', () => {
    const migrations = readdirSync(resolve(ROOT, '..', 'migrations'));
    expect(migrations.filter((f) => /fix_601/i.test(f))).toEqual([]);
  });
});
