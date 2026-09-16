import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OCCConflictError } from '../lib/occ';
import { mutationErrorContext } from '../lib/mutationErrorContext';

// ===========================================================================
// fix-579 (P-283) — the refusal explains itself
// ===========================================================================
//
// ⚠️⚠️ **THIS TICKET DOES NOT FIX THE BUG, AND NOTHING HERE ASSERTS THAT IT
//        DOES.** *"Time block changed since you loaded it"* has refused edits
//        from five people across four weeks. Four mechanisms have been proposed
//        and all four were killed by measurement:
//
//          ❌ a sibling rewrite invalidates the token
//          ❌ an insert retry reports a duplicate id as a conflict
//          ❌ the popup holds a stale snapshot across saves
//          ❌ `resetQueries` discards the cache mid-edit
//
// ★★★ SO THIS MAKES THE **NEXT** OCCURRENCE ANSWER THE QUESTION. The client
//     knows what it sent; the RPC knows what was there. **Nobody recorded both
//     together, which is the whole reason this is unsolved.**
//
// ★★ THE SERVER'S SIDE WAS ALREADY ON THE WIRE. Verified against the live
//    functions rather than assumed — each conflict path does:
//
//      SELECT b.updated_at INTO v_actual FROM da_time_blocks b WHERE b.id = p_id;
//      out_id := p_id; updated_at := v_actual; conflict := true;
//
//    and the client threw the value away.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const strip = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const EXPECTED = '2026-09-15T22:21:14.500Z';

const ctxOf = (detail: unknown) =>
  mutationErrorContext(
    undefined,
    { write: 'bp_upsert_da_time_block_row' },
    { patch: { type: 'Training' } },
    Object.assign(new Error('x'), { detail }),
  );

// ---------------------------------------------------------------------------
// §A · BOTH SIDES OF THE COMPARISON
// ---------------------------------------------------------------------------

describe('fix-579 §A — the refusal carries what was sent AND what was there', () => {
  it('★★★ a stale token reports both stamps and the signed gap', () => {
    // ★★★ THE NUMBER THAT ANSWERS THE QUESTION. Sub-second says the row moved
    //     DURING the save; minutes say it moved while the editor sat open.
    //     Until now neither was recoverable from the report.
    const c = ctxOf({
      rowId: 'np_1755000000000_ab12',
      expected: EXPECTED,
      actual: '2026-09-15T22:21:16.000Z',
    });
    expect(c.occRowId).toBe('np_1755000000000_ab12');
    expect(c.occExpected).toBe(EXPECTED);
    expect(c.occActual).toBe('2026-09-15T22:21:16.000Z');
    expect(c.occDeltaMs).toBe(1500);
    expect(c.occConflict).toBe('stale-token');
  });

  it('★★★ `row-missing` — a NULL actual means the row is GONE, not changed', () => {
    // ★★★ A SECOND FACT NOBODY COULD SEE. `v_actual` is NULL when the row no
    //     longer exists, so `conflict = true` with no actual stamp is a DELETE
    //     racing an edit — a different incident wearing the same message.
    const c = ctxOf({ rowId: 'np_1', expected: EXPECTED, actual: null });
    expect(c.occConflict).toBe('row-missing');
    expect(c.occActual).toBeUndefined();
    // ★ The delta is meaningless with nothing to subtract, so it is ABSENT
    //   rather than 0 — a zero here would read as `same-instant`.
    expect(c.occDeltaMs).toBeUndefined();
  });

  it('★★★ `same-instant` — identical stamps that refused anyway', () => {
    // ★★★ THIS WOULD BE A DIFFERENT BUG ENTIRELY, and it is why the raw strings
    //     are kept beside the delta: the stamps round-trip as JSON text and are
    //     compared as `timestamptz`, so a precision or formatting difference
    //     would refuse a write whose two sides mean the same moment. Named so
    //     it announces itself instead of hiding inside a delta of zero.
    const c = ctxOf({ rowId: 1, expected: EXPECTED, actual: EXPECTED });
    expect(c.occDeltaMs).toBe(0);
    expect(c.occConflict).toBe('same-instant');
  });

  it('★★ a backwards stamp survives as a NEGATIVE delta', () => {
    // ★ Should be impossible. If it ever appears, the sign is the finding —
    //   so the delta is signed rather than an absolute difference.
    const c = ctxOf({
      rowId: 'np_1',
      expected: '2026-09-15T22:21:16.000Z',
      actual: EXPECTED,
    });
    expect(c.occDeltaMs).toBe(-1500);
  });

  it('★★ the token age is reported, and named for what it really is', () => {
    const c = ctxOf({ rowId: 'np_1', expected: EXPECTED, actual: EXPECTED });
    expect(typeof c.occTokenAgeMs).toBe('number');
    // ★ It is the age of the TOKEN, not of an open popup: a row nobody has
    //   touched for a week hands out a week-old token. The doc says so too.
    expect(read('BUG_BACKLOG.md')).toContain('how old the client');
  });

  it('★★★ an INSERT contributes nothing — there is no comparison to describe', () => {
    // ★ The insert path posts `p_expected_updated_at = null`, so a refusal
    //   there is an id collision rather than a stale token.
    const c = ctxOf({ rowId: 'np_1', expected: null, actual: null });
    expect(c.occExpected).toBeUndefined();
    expect(c.occConflict).toBeUndefined();
    expect(c.occDeltaMs).toBeUndefined();
  });

  it('★★★ an error with no detail reports EXACTLY what it reports today', () => {
    // ★★★ THE REGRESSION GUARD. Every other hook in the app flows through this
    //     same reporter; a plain failure must be byte-identical to before.
    const before = mutationErrorContext(undefined, { write: 'projects.update' }, {
      fieldLabel: 'Lot Size',
    });
    const after = mutationErrorContext(
      undefined,
      { write: 'projects.update' },
      { fieldLabel: 'Lot Size' },
      new Error('boom'),
    );
    expect(after).toEqual(before);
    expect(after).toEqual({ write: 'projects.update', fields: ['Lot Size'] });
  });
});

// ---------------------------------------------------------------------------
// The whitelist is still a whitelist
// ---------------------------------------------------------------------------

describe('fix-579 — timestamps and an id, never row content', () => {
  it('★★★ nothing a person typed can reach the report through this door', () => {
    // ⚠️ `mutationErrorContext` is a whitelist ON PURPOSE — column names and
    //    captions, never values — because Error Reports is a table 29 people
    //    can read. An ISO stamp and a row id say WHICH row and WHEN; they carry
    //    no address, no name and no typed number.
    const c = ctxOf({
      rowId: 'np_1',
      expected: EXPECTED,
      actual: EXPECTED,
      // Anything not on the list must be dropped, not passed through.
      label: '2621 Eastlake Ave E',
      da_name: 'Qisheng',
      project_id: 'bdeedc93-0000-0000-0000-000000000000',
    });
    const json = JSON.stringify(c);
    expect(json).not.toContain('Eastlake');
    expect(json).not.toContain('Qisheng');
    expect(json).not.toContain('bdeedc93');
    expect(Object.keys(c).sort()).toEqual([
      'fields',
      'occActual',
      'occConflict',
      'occDeltaMs',
      'occExpected',
      'occRowId',
      'occTokenAgeMs',
      'write',
    ]);
  });

  it('★★ a non-string stamp is ignored rather than coerced', () => {
    // ★ A number where an ISO string belongs would produce a nonsense delta.
    const c = ctxOf({ rowId: 'np_1', expected: 1757974874500, actual: EXPECTED });
    expect(c.occExpected).toBeUndefined();
    expect(c.occDeltaMs).toBeUndefined();
  });

  it('★★ it is DUCK-TYPED, so it cannot fail on a second copy of the class', () => {
    // ★★ This module is imported by App's MutationCache, which sees errors from
    //    every hook. Requiring `instanceof` would couple the reporter to
    //    `lib/occ` and contribute nothing if bundling ever produced two copies.
    const real = new OCCConflictError(0, 'Time block', {
      rowId: 'np_1',
      expected: EXPECTED,
      actual: EXPECTED,
    });
    expect(ctxOf(real.detail).occConflict).toBe('same-instant');
    expect(strip(read('src/lib/mutationErrorContext.ts'))).not.toContain(
      'instanceof',
    );
  });
});

// ---------------------------------------------------------------------------
// §A/§B · THE THREE CONFLICT SITES RAISE IT
// ---------------------------------------------------------------------------

describe('fix-579 — every OCC refusal on these two tables says both sides', () => {
  it('★★★ the time block hook stops discarding the server’s stamp', () => {
    const h = strip(read('src/hooks/useUpsertDaTimeBlock.ts'));
    expect(h).toContain("throw new OCCConflictError(0, 'Time block', {");
    expect(h).toContain('expected: isInsert ? null : input.block.updated_at,');
    expect(h).toContain('actual: row.updated_at ?? null,');
  });

  it('★★★ §B — the Intake pair gets the same treatment, not the same CLAIM', () => {
    // ★★★ Report 729 is *"Intake changed since you loaded it"* on the same page,
    //     a different write. **Whether it shares a cause is unknown**, and
    //     nothing here assumes it does — instrumenting both is what makes the
    //     next occurrence of either comparable with the other.
    const up = strip(read('src/hooks/useUpsertIntakeRecord.ts'));
    const del = strip(read('src/hooks/useDeleteIntakeRecord.ts'));
    expect(up).toContain("throw new OCCConflictError(0, 'Intake', {");
    expect(del).toContain("throw new OCCConflictError(0, 'Intake', {");
    // ★ The delete RPC names its side explicitly and the field was declared in
    //   `Row` but read by nobody.
    expect(del).toContain('actual: row.current_updated_at ?? null,');
  });

  it('★★ …and both Intake hooks now name their RPC at all', () => {
    // ★ fix-511 §C's line, which these two never got: report 729 arrived with
    //   no RPC name, so a reader had to infer the write from the message.
    expect(strip(read('src/hooks/useUpsertIntakeRecord.ts'))).toContain(
      "meta: { write: 'bp_upsert_intake_records_row' }",
    );
    expect(strip(read('src/hooks/useDeleteIntakeRecord.ts'))).toContain(
      "meta: { write: 'bp_delete_intake_records_row' }",
    );
  });

  it('★★★ App passes the ERROR, so the detail can reach the report', () => {
    expect(strip(read('src/App.tsx'))).toContain(
      'mutationErrorContext(key, mutation.options.meta, vars, err)',
    );
  });
});

// ---------------------------------------------------------------------------
// ★★★ NO BEHAVIOUR CHANGED — the guardrail, asserted
// ---------------------------------------------------------------------------

describe('fix-579 — nothing about the write path moved', () => {
  it('★★★ no retry, no token refresh, no cache-verb change', () => {
    // ★★★ A BEHAVIOUR CHANGE NOW WOULD DESTROY THE EVIDENCE THIS TICKET EXISTS
    //     TO COLLECT. If the next refusal is silently retried, the delta that
    //     would have explained it never gets recorded.
    const h = strip(read('src/hooks/useUpsertDaTimeBlock.ts'));
    expect(h).not.toContain('retry');
    expect(h).not.toContain('resetQueries');
    expect(h).not.toContain('refetchQueries');
    // The onError path is the one fix-442 shipped: toast + invalidate.
    expect(h).toContain('pushToast(error.message');
    expect(h).toContain('queryClient.invalidateQueries({');
  });

  it('★★★ the message itself is unchanged — fix-341’s honest sentence', () => {
    // ★ fix-341 removed "modified by someone else" because four times in three
    //   months there was no someone else. The detail rides alongside; it does
    //   not appear on screen.
    const e = new OCCConflictError(0, 'Time block', {
      rowId: 'np_1',
      expected: EXPECTED,
      actual: EXPECTED,
    });
    expect(e.message).toBe(
      'Time block changed since you loaded it — your edit was reverted. Refresh and try again.',
    );
    expect(e.message).not.toContain('np_1');
    expect(e.message).not.toContain(EXPECTED);
  });

  it('★★ the RPC and the forbidden neighbours are untouched', () => {
    // Guardrails: no migration, and P-283's live area stays still.
    const block = strip(read('src/hooks/useUpsertDaTimeBlock.ts'));
    expect(block).toContain("supabase.rpc(\n        'bp_upsert_da_time_block_row',");
    expect(block).not.toContain('forgetDaTimeBlocks');
  });
});

// ---------------------------------------------------------------------------
// §C · THE RUNBOOK
// ---------------------------------------------------------------------------

describe('fix-579 §C — the next reader does not re-derive four dead theories', () => {
  const doc = read('BUG_BACKLOG.md');

  it('★★★ all four killed mechanisms are named, with how each died', () => {
    // ★★★ THE POINT OF THE TICKET. Four people-weeks of investigation are worth
    //     nothing if the fifth person starts from theory one.
    for (const phrase of [
      'exactly one row',
      'UPDATE to a row created 2025-08-20',
      'so every save closes it',
      'fix-511 §B argues it',
    ]) {
      expect(doc, phrase).toContain(phrase);
    }
  });

  it('★★★ it says how to READ the delta, case by case', () => {
    for (const phrase of [
      'Sub-second',
      'occDeltaMs',
      'same-instant',
      'row-missing',
      'Negative',
    ]) {
      expect(doc, phrase).toContain(phrase);
    }
  });

  it('★★★ it warns that older rows carry none of this', () => {
    // ★ Otherwise the first thing the next reader does is query for a field
    //   that cannot be there and conclude the instrumentation is broken.
    expect(doc).toContain('before** fix-579 carry none of these fields');
    expect(doc).toContain('729');
  });

  it('★★ it is honest that the bug is still open', () => {
    expect(doc).toContain('OPEN and UNEXPLAINED');
    expect(doc).toContain('This section is not a fix');
  });
});
