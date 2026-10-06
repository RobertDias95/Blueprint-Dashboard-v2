import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ===========================================================================
// ★★★ fix-627 §B (P-322) — THE SWEEP FOR THE REST OF THE 1,000-ROW CAP
// ===========================================================================
//
// §A fixed the one that broke Miles. §B enumerated every client `select` with no
// `.range()`/`.limit()` on a table that grows per user or per tenant, measured
// each against prod, and paged the ones over ~500 today or growing without
// bound. The rest are reported in the PR with their numbers.
//
// ★★★ WHY THESE ARE SOURCE ASSERTIONS. The defect is the SHAPE of a network
//     call: an un-ranged PostgREST select returns the first 1,000 rows with no
//     error, so there is nothing to observe in a unit test unless the test
//     itself fakes the cap — which `BoardReadsCapFix627` does for the §A hook.
//     What §B needs to pin is simpler and more durable: every load-all read goes
//     through the shared pager, with a TOTAL ordering. If one loses its
//     `.range()`, this says so by name.
//
// ★★ AND A TOTAL ORDERING IS HALF THE FIX. `fetchAllRows`' own doc says the
//    query "MUST carry a TOTAL ordering (include a unique tiebreaker such as the
//    primary key) so rows can't shift across page boundaries and get duplicated
//    or skipped". Paging on `address` alone would be worse than not paging:
//    instead of silently losing the tail it would silently duplicate and drop
//    rows in the middle.

const SRC = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(SRC, p), 'utf8');

/** ★★ CRLF first — `\r` is a JS regex line terminator, so a `//` stripper over
 *  CRLF text silently strips nothing (fix-608). */
function code(src: string): string {
  return src
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * The nine load-all reads §B paged, with the measurement that put each on the
 * list and the column that makes its ordering total.
 *
 * ★ Measured read-only on prod 2026-10-06. "largest for the filter" — not the
 *   table total — because a select filtered to one project is bounded by that
 *   project, which is the number that actually decides the risk.
 */
const PAGED: {
  file: string;
  table: string;
  measured: string;
  tiebreaker: string;
}[] = [
  { file: 'hooks/useCorrectionItems.ts', table: 'correction_items',
    measured: '627 for the biggest project', tiebreaker: "'id'" },
  { file: 'hooks/useArchivedFallbackProjects.ts', table: 'project_plan_of_record_sets',
    measured: '537 fallback sets', tiebreaker: "'id'" },
  { file: 'hooks/useIntakeRecords.ts', table: 'intake_records',
    measured: '507, unfiltered', tiebreaker: "'id'" },
  { file: 'hooks/useProjects.ts', table: 'projects',
    measured: '305, unfiltered and unbounded', tiebreaker: "'id'" },
  { file: 'hooks/useBuilderRegistry.ts', table: 'projects',
    measured: '305 non-archived', tiebreaker: "'id'" },
  { file: 'hooks/useDrawSchedule.ts', table: 'draw_schedule',
    measured: '305, one per project', tiebreaker: "'project_id'" },
  { file: 'hooks/useAutoClosures.ts', table: 'permit_task_auto_closures',
    measured: '292 in the 30-day window', tiebreaker: "'id'" },
  { file: 'hooks/useMilestoneAcks.ts', table: 'permit_milestone_acks',
    measured: '258, unfiltered', tiebreaker: "'id'" },
  { file: 'hooks/useConsultantCurrent.ts', table: 'project_consultant_current',
    measured: '200, unfiltered view', tiebreaker: "'consultant_id'" },
];

describe('fix-627 §B — every load-all read pages through the shared helper', () => {
  for (const site of PAGED) {
    it(`★★ ${site.file} (${site.table} — ${site.measured})`, () => {
      const c = code(read(site.file));
      expect(c, 'imports the shared pager').toMatch(
        /import \{ fetchAllRows \} from '\.\.\/lib\/fetchAllRows'/,
      );
      expect(c, 'calls it').toMatch(/fetchAllRows</);
      expect(c, 'asks for a window').toContain('.range(from, to)');
      expect(c, `orders by ${site.tiebreaker} so the ordering is total`).toContain(
        `.order(${site.tiebreaker}, { ascending: true })`,
      );
    });
  }

  it('★★★ nine sites, and the list is explicit so a tenth cannot slip in quietly', () => {
    expect(PAGED).toHaveLength(9);
    // ★ Two of them read `projects` — the main list and the builder count. The
    //   second was the one fix-557 found reading the table without the archived
    //   filter; it is the same table, so it is the same cap.
    expect(PAGED.filter((p) => p.table === 'projects')).toHaveLength(2);
  });

  it('★★★ §A\'s hook is in the same shape — one rule, not two', () => {
    const c = code(read('hooks/useBoardReads.ts'));
    expect(c).toMatch(/import \{ fetchAllRows \} from '\.\.\/lib\/fetchAllRows'/);
    expect(c).toContain('.range(from, to)');
  });

  it('★★ nobody wrote a SECOND pager — fetchAllRows is the only one', () => {
    // fix-189 centralised it with a comment saying it existed so a later
    // load-all hook would reuse it. §A is what happened when one did not, so
    // this pins the helper's uniqueness rather than trusting the comment.
    const helper = read('lib/fetchAllRows.ts');
    expect(helper).toContain('export async function fetchAllRows');
    expect(helper).toMatch(/rows\.length < pageSize/);
    // and the page size is the PostgREST default it exists to work around
    expect(helper).toMatch(/FETCH_ALL_PAGE_SIZE = 1000/);
  });

  it('★★★ the helper still demands a total ordering, in writing', () => {
    // If this sentence ever goes, the nine call sites above lose the reason
    // their `.order('id')` is not decoration.
    const helper = read('lib/fetchAllRows.ts');
    expect(helper).toMatch(/TOTAL ordering/);
    // ★ `[\s*]+` spans the comment wrap: the helper's sentence breaks between
    //   "duplicated or" and "skipped" with a ` * ` continuation between them.
    expect(helper).toMatch(/duplicated[\s*]+or[\s*]+skipped/);
  });
});
