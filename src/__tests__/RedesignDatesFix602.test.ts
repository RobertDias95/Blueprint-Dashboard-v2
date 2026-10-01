import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  TARGET_APPROVAL_DRIVER_LABEL,
  TARGET_APPROVAL_DRIVER_LABEL_MIRRORED,
  targetApproval,
  targetApprovalDateSource,
  targetApprovalIsMirrored,
} from '../lib/targetApproval';
import {
  DATE_INPUT_MAX_YEAR,
  DATE_INPUT_MIN_YEAR,
  DATE_INPUT_YEAR_MESSAGE,
  dateInputIsAcceptable,
  dateInputRejection,
} from '../lib/dateUtils';
import { lotSizeView, LOT_VARIES_LABEL } from '../lib/lotDimensions';

// ===========================================================================
// ★★★ fix-602 — THREE RULINGS (P-281 · P-301 · the fix-555 remainder)
// ===========================================================================

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const code = (src: string) =>
  src
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');

// ═══════════════════════════════════════════════════════════════════════════
// §A — P-281 · a reuse-redesign uses the ORIGINAL's dates
// ═══════════════════════════════════════════════════════════════════════════

/** ★ The shape `targetApprovalDateSource` is generic over — spelled out so the
 *  fixtures keep their `id` instead of collapsing to `never`. */
interface DateSourceFixture {
  id: string;
  go_date: string | null;
  closing_date: string | null;
  redesign_of_project_id: string | null;
  redesign_reuses_original_permit: boolean | null;
}

const ORIGINAL: DateSourceFixture = {
  id: 'orig',
  go_date: '2026-01-22',
  closing_date: null,
  redesign_of_project_id: null,
  redesign_reuses_original_permit: null,
};

const REUSE_REDESIGN: DateSourceFixture = {
  id: 'redesign',
  go_date: '2026-06-25',
  closing_date: null,
  redesign_of_project_id: 'orig',
  redesign_reuses_original_permit: true,
};

const OWN_PERMIT_REDESIGN: DateSourceFixture = {
  id: 'own',
  go_date: '2026-06-25',
  closing_date: null,
  redesign_of_project_id: 'orig',
  redesign_reuses_original_permit: false,
};

const ALL: DateSourceFixture[] = [ORIGINAL, REUSE_REDESIGN, OWN_PERMIT_REDESIGN];
/** The original's BP — what a reuse-redesign's page already shows (fix-556). */
const MIRRORED_BP = { expected_issue: '2026-10-09' } as never;

describe('fix-602 §A — the date source follows the permits', () => {
  it('★★★ a reuse-redesign reads the ORIGINAL — the real 4000 SW Concord St case', () => {
    // Measured 2026-09-30: redesign GO 2026-06-25, original GO 2026-01-22,
    // original BP ACQ 2026-10-09.
    const src = targetApprovalDateSource(REUSE_REDESIGN, ALL);
    expect(src?.id).toBe('orig');

    const t = targetApproval(src, MIRRORED_BP);
    // ★★★ MAX(ACQ 2026-10-09, original GO + 6 = 2026-07-22) = the ACQ.
    expect(t.date).toBe('2026-10-09');
    expect(t.driver).toBe('acq');

    // ★★★ AND THE BUG, STATED: the redesign's OWN GO + 6 is 2026-12-25, which is
    //     exactly what the header read before this ticket.
    const wrong = targetApproval(REUSE_REDESIGN, MIRRORED_BP);
    expect(wrong.date).toBe('2026-12-25');
    expect(wrong.driver).toBe('go');
    expect(wrong.date).not.toBe(t.date);
  });

  it('★★★ a NON-reuse redesign is unchanged — it keeps its own dates', () => {
    // 5 of the 21 redesigns. They file their own permits, so nothing mirrors.
    expect(targetApprovalDateSource(OWN_PERMIT_REDESIGN, ALL)?.id).toBe('own');
    expect(targetApprovalIsMirrored(OWN_PERMIT_REDESIGN, ALL)).toBe(false);
  });

  it('★★★ an ORDINARY project is unchanged', () => {
    expect(targetApprovalDateSource(ORIGINAL, ALL)?.id).toBe('orig');
    expect(targetApprovalIsMirrored(ORIGINAL, ALL)).toBe(false);
  });

  it('★★★ a missing original FALLS BACK to the project, never to null', () => {
    // ★★ A redesign whose original has not loaded must render its own dates, not
    //    a blank card — returning null would make a loading state look like a
    //    project with no dates recorded.
    const orphan = targetApprovalDateSource(REUSE_REDESIGN, [REUSE_REDESIGN]);
    expect(orphan?.id).toBe('redesign');
    expect(targetApprovalDateSource(REUSE_REDESIGN, [])?.id).toBe('redesign');
    expect(targetApprovalDateSource(null, ALL)).toBeNull();
  });

  it('★★★ §A.2 · the driver note says WHOSE date it is', () => {
    expect(TARGET_APPROVAL_DRIVER_LABEL.go).toBe('the GO date plus 6 months');
    expect(TARGET_APPROVAL_DRIVER_LABEL_MIRRORED.go).toBe(
      "the original's GO date plus 6 months",
    );
    expect(TARGET_APPROVAL_DRIVER_LABEL_MIRRORED.closing).toBe("the original's closing date");
    // ★ ACQ is NOT re-worded — the permit shown already belongs to the original
    //   and the page labels it as such.
    expect(TARGET_APPROVAL_DRIVER_LABEL_MIRRORED.acq).toBe(TARGET_APPROVAL_DRIVER_LABEL.acq);
  });

  it('★★★ it reuses the EXISTING predicate — no second one was written', () => {
    // §A: *"The predicate already exists: `reusesOriginalPermits()` — one hop,
    // reuse it; do not write a second predicate."*
    const lib = code(read('lib/targetApproval.ts'));
    expect(lib).toContain('permitSourceProjectId');
    expect(lib).not.toContain('redesign_reuses_original_permit ===');
  });

  it('★★★ the two surfaces now AGREE, because only one of them was wrong', () => {
    // ★★★ MEASURED, AND NARROWER THAN THE BRIEF ASSUMED. `ScheduleHealthTable`
    //     resolves its project by the PERMIT's `project_id`, so on a
    //     reuse-redesign it already read the original and was already right.
    //     `DatesBox` was handed the page's project. The header and the table
    //     under it printed two different Target Approvals.
    const health = code(read('components/ProjectDetail/ScheduleHealthTable.tsx'));
    expect(health).toContain('projectsById.get(permit.project_id)');

    const boxes = code(read('components/ProjectDetail/ProjectOverviewBoxes.tsx'));
    expect(boxes).toContain('targetApprovalDateSource(project, allProjects)');
    expect(boxes).toContain('targetApproval(dateSource, bp)');
    // ★ and it is no longer handed the raw page project
    expect(boxes).not.toContain('targetApproval(project, bp)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §B — P-301 · a date field refuses an impossible year
// ═══════════════════════════════════════════════════════════════════════════

describe('fix-602 §B — an impossible year saves nothing', () => {
  it('★★★ the three real prod values are all refused', () => {
    // Measured 2026-09-30, and left in place: Bobby ruled Miles retypes them,
    // which is the live test of this rule.
    for (const bad of ['202025-11-30', '252025-02-02', '5252-02-02']) {
      expect(dateInputRejection(bad), bad).toBe(DATE_INPUT_YEAR_MESSAGE);
      expect(dateInputIsAcceptable(bad), bad).toBe(false);
    }
  });

  it('★★★ an ordinary date passes', () => {
    for (const ok of ['2025-11-30', '2026-02-02', '2000-01-01', '2099-12-31']) {
      expect(dateInputRejection(ok), ok).toBeNull();
    }
    expect(DATE_INPUT_MIN_YEAR).toBe(2000);
    expect(DATE_INPUT_MAX_YEAR).toBe(2099);
  });

  it('★★★ CLEARING a date is still allowed', () => {
    // §B's own test. Clearing is a legitimate edit and must stay one.
    expect(dateInputRejection('')).toBeNull();
    expect(dateInputRejection(null)).toBeNull();
    expect(dateInputRejection(undefined)).toBeNull();
    expect(dateInputRejection('   ')).toBeNull();
  });

  it('★★ the boundaries are exact', () => {
    expect(dateInputRejection('1999-12-31')).toBe(DATE_INPUT_YEAR_MESSAGE);
    expect(dateInputRejection('2000-01-01')).toBeNull();
    expect(dateInputRejection('2099-12-31')).toBeNull();
    expect(dateInputRejection('2100-01-01')).toBe(DATE_INPUT_YEAR_MESSAGE);
  });

  it('★★ a non-ISO value is left alone, not refused', () => {
    // ★ A native date input cannot produce one, and refusing here would put this
    //   function in the business of parsing.
    expect(dateInputRejection('not a date')).toBeNull();
  });

  it('★★★ BOTH writers enforce it — the buffered input AND the batch form', () => {
    // ★★★ THE POINT OF §B.3. `BufferedDateInput` commits on blur; the Permits tab
    //     is a BATCH form whose footer Save writes every row at once. Two
    //     permits on one project share `updated_at` 2026-09-22 12:20:29 PT, so
    //     one Save wrote both — buffering alone would not have stopped it.
    const buffered = code(read('components/BufferedDateInput.tsx'));
    expect(buffered).toContain('dateInputRejection(draftRef.current)');
    expect(buffered).toContain('setRejection(rejection)');

    const form = code(read('components/ProjectDetail/ProjectDetailsForm.tsx'));
    expect(form).toContain('rejectValue={dateInputRejection}');
    expect(form).toContain('if (why) return;');
  });

  it('★★★ a refused value never reaches onCommit / onChange', () => {
    // The whole rule in one sentence: nothing saves, the previous value stays.
    const buffered = code(read('components/BufferedDateInput.tsx'));
    const commit = buffered.slice(buffered.indexOf('function commit()'));
    const guard = commit.indexOf('if (rejection)');
    const call = commit.indexOf('onCommit(');
    expect(guard).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(guard); // the guard returns before the call
  });

  it('★★★ ⛔ the three bad rows were NOT touched', () => {
    // §B.4: *"Do NOT touch the three rows. Bobby ruled 09-30: Miles retypes them
    // in the app — which is also the live test of §B.2."*
    const src = read('lib/dateUtils.ts');
    expect(src).not.toMatch(/UPDATE|INSERT|DELETE/);
    expect(src).toContain('202025-11-30'); // named in the record, not edited
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §C — irregular means a MISSING DIMENSION
// ═══════════════════════════════════════════════════════════════════════════

describe('fix-602 §C — Bobby, 2026-09-30', () => {
  it('★★★ width only → irregular, and the depth reads `varies`', () => {
    // 8 projects. The brief's first listed test.
    const v = lotSizeView(60, null, 7200);
    expect(v.irregular).toBe(true);
    expect(v.depthVaries).toBe(true);
    expect(v.depthText).toBe(LOT_VARIES_LABEL);
  });

  it('★★★ depth only → the same, mirrored', () => {
    // 1 project.
    const v = lotSizeView(null, 100, 7200);
    expect(v.irregular).toBe(true);
    expect(v.widthVaries).toBe(true);
    expect(v.widthText).toBe(LOT_VARIES_LABEL);
  });

  it('★★★ size only → irregular, and `varies × varies`', () => {
    // 3 projects. *"Or if both boxes are blank and just a lot size, then that is
    // irregular too."*
    const v = lotSizeView(null, null, 14136);
    expect(v.irregular).toBe(true);
    expect(v.pairText).toBe(`${LOT_VARIES_LABEL} × ${LOT_VARIES_LABEL}`);
  });

  it('★★★ both dimensions + a 40% size mismatch → NOT irregular', () => {
    // ★★★ THE CLAUSE THAT RETIRES THE OLD RULE. 253 projects have both
    //     dimensions; 20 of them tripped the old 5% mismatch and none of them
    //     trips this. *"A lot with both dimensions is never irregular, whatever
    //     the size says."*
    expect(lotSizeView(100, 100, 6000).irregular).toBe(false);   // 40% out
    expect(lotSizeView(100, 100, 14000).irregular).toBe(false);  // 40% the other way
    expect(lotSizeView(60, 100, 6000).irregular).toBe(false);    // exact
  });

  it('★★★ nothing typed → not irregular, and no `varies`', () => {
    // 6 projects. An unfinished form must not become an irregular lot.
    const v = lotSizeView(null, null, null);
    expect(v.irregular).toBe(false);
    expect(v.widthVaries).toBe(false);
    expect(v.depthVaries).toBe(false);
    expect(v.pairText).toBeNull();
  });

  it('★★★ §C.2 · a blank dimension reads `varies` WITHOUT a size', () => {
    // fix-555 required a size; Bobby's rule does not. 0 lots are in this state
    // today, so nothing on screen moves — this is the rule the next one meets.
    const v = lotSizeView(60, null, null);
    expect(v.depthVaries).toBe(true);
    expect(v.pairText).toBe(`60 × ${LOT_VARIES_LABEL}`);
    expect(v.irregular).toBe(true);
  });

  it('★★★ §C.3 · the tolerance is retired, and nothing reads it', () => {
    const lib = read('lib/lotDimensions.ts');
    expect(code(lib)).not.toContain('LOT_IRREGULAR_TOLERANCE');
    expect(code(lib)).not.toContain('Math.abs(derived - typed)');
    // ★ the gravestone stays — it records a number that was never Bobby's
    expect(lib).toContain('IS RETIRED');
  });

  it('★★★ §C.3 · both notes say a DIMENSION IS MISSING, not that sizes disagree', () => {
    for (const f of [
      'components/ProjectDetail/ProjectDataEditors.tsx',
      'components/LibraryMatrix.tsx',
    ]) {
      const src = code(read(f));
      expect(src, f).toContain('A dimension is missing, so this lot is irregular.');
      expect(src, f).not.toContain('more than 5% from width');
    }
  });

  it('★★★ §C.4 · no SECOND indicator was built for the size disagreement', () => {
    // *"The size-vs-dimensions disagreement is data, not shape: it stays in
    // `data/reports/fix_555_lot_size_disagreements.md`."*
    const report = readFileSync(
      resolve(ROOT, '..', 'data/reports/fix_555_lot_size_disagreements.md'),
      'utf8',
    );
    expect(report.length).toBeGreaterThan(500);
    const lib = code(read('lib/lotDimensions.ts'));
    expect(lib).not.toContain('sizeDisagrees');
    expect(lib).not.toContain('mismatch');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-602 — no migration, no data changes', () => {
  it('★★★ this ticket adds no migration', () => {
    // Asserted by absence, because the cheapest way to change data is to add a
    // file nobody reads closely.
    const migrations = readdirSync(resolve(ROOT, '..', 'migrations'));
    expect(migrations.filter((f) => /fix_602/i.test(f))).toEqual([]);
  });

  it('★★★ no source file writes to the four date columns in bulk', () => {
    // §B.4 forbids touching the three bad rows; §C forbids re-shaping any lot.
    for (const f of ['lib/dateUtils.ts', 'lib/lotDimensions.ts', 'lib/targetApproval.ts']) {
      const src = code(read(f));
      expect(src, f).not.toMatch(/from\(.{1,2}permits/);
      expect(src, f).not.toMatch(/from\(.{1,2}projects/);
      expect(src, f).not.toMatch(/\.update\(/);
    }
  });
});
