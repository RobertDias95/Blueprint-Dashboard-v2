// ===========================================================================
// ★★★ fix-588 §2a (P-288) — THE AUDIT ITSELF, AND THE MIGRATION IT NAMES
// ===========================================================================
//
// The modal half is `ATagThatSaysItSavedFix588.test.tsx` — a fake server with a
// column list, asserting the STORED ROW. This file is the two halves that fake
// server cannot reach: the rule on its own, and the staged SQL that closes the
// drop on the real one.
//
// ★★★ WHY THE RULE GETS ITS OWN TESTS. A warning that fires when it should not
//     is worse than no warning, because the third false one teaches everybody
//     to click past the true one. Every quiet case below is a case somebody
//     would otherwise have been shouted at about.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  droppedPatchKeys,
  droppedPatchMessage,
  fieldLabel,
  savedValuesEqual,
} from '../lib/savedPatchAudit';

const MIGRATIONS = join(process.cwd(), 'migrations');

/** The four real `projects` columns `bp_update_project_with_permits` does not
 *  apply, measured against the live `pg_get_functiondef` on 2026-09-16. */
const DROPPED_COLUMNS = [
  'project_tags',
  'closing_date',
  'num_lots',
  'is_corner_lot',
];

describe('fix-588 §2a — droppedPatchKeys reports a drop and nothing else', () => {
  it('★★★ THE REPORT: a tag we sent, a row that still holds what it held', () => {
    const before = { project_tags: ['ECA'] };
    const sent = { project_tags: ['ECA', 'HVL'] };
    const after = { project_tags: ['ECA'] };
    expect(droppedPatchKeys(sent, before, after)).toEqual(['project_tags']);
  });

  it('a column that landed is not reported', () => {
    const before = { project_tags: ['ECA'] };
    const sent = { project_tags: ['ECA', 'HVL'] };
    const after = { project_tags: ['ECA', 'HVL'] };
    expect(droppedPatchKeys(sent, before, after)).toEqual([]);
  });

  it('★★ a column the SERVER changed to something else is not reported', () => {
    // It is neither what we asked for nor what was there — so a write landed
    // and something downstream had an opinion about it. Normalisation, a
    // trigger, a concurrent edit: all of them are "stored", none of them are
    // the silent drop this exists to catch.
    const before = { zone: 'LR1' };
    const sent = { zone: 'NR3' };
    const after = { zone: 'NR3-M' };
    expect(droppedPatchKeys(sent, before, after)).toEqual([]);
  });

  it('★★★ a save nobody could verify says NOTHING', () => {
    // `projectAfter` is null when the read-back did not happen or failed. "I
    // could not check" is not "it failed", and reporting it as one would make
    // every offline blip look like data loss.
    const sent = { project_tags: ['ECA', 'HVL'] };
    expect(droppedPatchKeys(sent, { project_tags: ['ECA'] }, null)).toEqual([]);
    expect(droppedPatchKeys(sent, { project_tags: ['ECA'] }, undefined)).toEqual([]);
  });

  it('a column missing from the read-back is skipped, not accused', () => {
    const sent = { project_tags: ['ECA', 'HVL'], zone: 'NR3' };
    const after = { zone: 'NR3' };
    expect(droppedPatchKeys(sent, { project_tags: ['ECA'], zone: 'LR1' }, after)).toEqual(
      [],
    );
  });

  it('⚠️ AN EMPTY PATCH IS NEVER A COMPLAINT — the brief rules it out by name', () => {
    // *"Do NOT implement this as a toast that fires on every empty patch — an
    //  unchanged form saving cleanly is normal."*
    expect(droppedPatchKeys({}, { zone: 'LR1' }, { zone: 'LR1' })).toEqual([]);
    expect(droppedPatchMessage([])).toBeNull();
  });

  it('★ clearing a column to null is verified like any other value', () => {
    // Removing the last tag stores NULL, not [] — so a server that left the
    // array in place is a drop, and one that cleared it is a save.
    const before = { project_tags: ['HVL'] };
    expect(droppedPatchKeys({ project_tags: null }, before, { project_tags: ['HVL'] }))
      .toEqual(['project_tags']);
    expect(droppedPatchKeys({ project_tags: null }, before, { project_tags: null }))
      .toEqual([]);
  });

  it('★ null and an absent column are one fact', () => {
    expect(savedValuesEqual(null, undefined)).toBe(true);
    expect(savedValuesEqual(null, [])).toBe(false);
    // Order-sensitive, deliberately — the stored order is what the chips
    // render in, so a reorder is a real edit.
    expect(savedValuesEqual(['ECA', 'SIP'], ['SIP', 'ECA'])).toBe(false);
  });

  it('reports EVERY dropped column, not the first one', () => {
    const before = { project_tags: ['ECA'], num_lots: null, zone: 'LR1' };
    const sent = { project_tags: ['ECA', 'HVL'], num_lots: 3, zone: 'NR3' };
    const after = { project_tags: ['ECA'], num_lots: null, zone: 'NR3' };
    expect(droppedPatchKeys(sent, before, after)).toEqual(['project_tags', 'num_lots']);
  });
});

describe('fix-588 §2a — the person reads a column name they recognise', () => {
  it('names the field the way the modal does', () => {
    expect(fieldLabel('project_tags')).toBe('Project Tags');
    expect(fieldLabel('num_lots')).toBe('Number of Lots');
    expect(fieldLabel('go_date')).toBe('GO date');
  });

  it('★ humanises an unlisted column rather than showing raw SQL', () => {
    expect(fieldLabel('some_new_column')).toBe('Some new column');
  });

  it('★★ says what did NOT save AND that the edit is still there', () => {
    const msg = droppedPatchMessage(['project_tags']) as string;
    expect(msg).toContain('Project Tags');
    expect(msg).toContain('did not save');
    expect(msg).toContain('still here');
    // A save that wrote six columns and dropped one is not a failed save;
    // telling somebody "couldn't save" would send them back to re-type five
    // fields that are already in the database.
    expect(msg).toContain('everything else saved');
  });

  it('lists several columns readably', () => {
    expect(droppedPatchMessage(['project_tags', 'num_lots'])).toContain(
      'Project Tags and Number of Lots',
    );
  });
});

// ===========================================================================
// ★★★ THE MIGRATION — THE SERVER HALF, STAGED
// ===========================================================================

describe('fix-588 — the staged migration closes the drop on the real server', () => {
  const file = readdirSync(MIGRATIONS).find(
    (f) => f.startsWith('fix_588_') && f.endsWith('_PENDING_APPROVAL.sql'),
  );

  it('★ the file is on the shelf', () => {
    expect(file).toBeTruthy();
  });

  const sql = file ? readFileSync(join(MIGRATIONS, file), 'utf8') : '';

  it('★★★ it adds ALL FOUR dropped columns, not just the reported one', () => {
    // `project_tags` is the report. `closing_date` has ZERO audited changes in
    // the history of the table — which is what a column nobody can save looks
    // like from the outside. Fixing one of four would leave three.
    for (const column of DROPPED_COLUMNS) {
      expect(sql).toContain(`v_patch ? ''${column}''`);
    }
  });

  it('★★ it patches the LIVE body by anchor and refuses to guess', () => {
    // fix-540's rule: read `pg_get_functiondef`, replace a counted anchor, and
    // RAISE if it matched nothing. Retyping a 27-column function body is how a
    // column goes missing in the first place.
    expect(sql).toContain('pg_get_functiondef');
    expect(sql).toContain('v_anchor');
    expect(sql).toContain('anchor not found');
    expect(sql).toContain('replacement changed nothing');
  });

  it('★★ every cast on a patch key is guarded — fix-580’s rule', () => {
    // `''::date` and `''::boolean` both RAISE, and a COALESCE around a cast
    // does not guard it.
    for (const column of ['closing_date', 'num_lots', 'is_corner_lot']) {
      expect(sql).toContain(`nullif(btrim(coalesce(v_patch->>''${column}''`);
    }
    // ★ `project_tags` is jsonb and is deliberately NOT cast through text: a
    //   key carrying JSON `null` must CLEAR the column rather than be ignored,
    //   which is the editor's "an empty list is NULL, not []" rule arriving
    //   intact.
    expect(sql).toContain("jsonb_typeof(v_patch->''project_tags'')");
  });

  it('⛔ it constrains no VALUE — §3 forbids a whitelist and this is not one', () => {
    // The opposite: four columns join an existing COLUMN list. No tag name was
    // ever the problem; none could have survived that path.
    expect(sql).not.toMatch(/\bCHECK\s*\(/i);
    expect(sql).not.toMatch(/\bADD\s+CONSTRAINT\b/i);
  });

  it('★ and it is listed on the one page, with the rest', () => {
    const index = readFileSync(join(MIGRATIONS, 'PENDING_APPROVAL_INDEX.md'), 'utf8');
    expect(index).toContain(file as string);
  });
});
