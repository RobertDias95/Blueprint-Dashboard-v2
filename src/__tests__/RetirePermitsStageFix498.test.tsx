import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exportEnrichedPermitsToCSV, CSV_HEADERS } from '../lib/csvExport';
import { aggregateByProject, enrichPermits } from '../lib/reportMetrics';
import type {
  PermitCycle,
  PermitWithCycles,
  Project,
  ReportBuilderCatalog,
} from '../lib/database.types';

// ===========================================================================
// ★★★ fix-498 (P-025) — permits.stage RETIRES; the stage is DERIVED
// ===========================================================================
//
// Ruling (Bobby, 2026-09-04): *"Remove Stage from the builder and retire the
// column."*
//
// ★★★ THE COLUMN WAS SEEDED AND THEN ABANDONED. `permits.stage` defaulted to
//     'de' at insert and no trigger, scraper write or backfill ever moved it
//     again. Prod 2026-09-04: 667 permits reading de 583 / is 38 / pm 32 /
//     ap 10 / co 4, and **342 of 406 ISSUED permits still said 'de'**.
//
//     The named victim, and the fixture below: 5627 44th Ave SW, Building
//     Permit 7126697-CN, portal status "Issued", actual_issue 2026-08-31,
//     stored stage 'de'. The CSV export called it Design. The Reports ledger
//     ranked the whole project Design. The Dashboard, the Library and the
//     Project View — all of which DERIVE — called it Issued, correctly.
//
// ★★★ THREE READERS, NOT TWO. The brief's STEP 0 named csvExport.ts:65 and
//     reportMetrics.ts:597. The third was the Report Builder catalog, which
//     published `stage` as a selectable + filterable column compiling to a
//     bare `p.stage`. See the §B block at the bottom.
//
// ★★ AND TWO WRITERS IT ALSO MISSED — `useCreatePermit.ts` (a DIRECT table
//    insert, not an RPC) and `bp_insert_permit` (granted to service_role, so
//    reachable from the scraper). Both would have 400'd/failed on the next
//    call after the DROP.

const CYCLE: PermitCycle = {
  id: 'c0',
  permit_id: 175,
  cycle_index: 0,
  submitted: null,
  intake_accepted: null,
  city_target: null,
  corr_issued: null,
  resubmitted: null,
} as PermitCycle;

/** The real 5627 44th Ave SW Building Permit, minus the column that is gone. */
function issuedBp(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 175,
    project_id: 'p-5627',
    type: 'Building Permit',
    num: '7126697-CN',
    stage_override: null,
    status: 'Issued',
    actual_issue: '2026-08-31',
    approval_date: '2026-08-31',
    da: null,
    dm: null,
    ent_lead: null,
    dual_da: null,
    architect: null,
    target_submit: null,
    expected_issue: null,
    dd_start: null,
    dd_end: null,
    intake_date: null,
    notes: null,
    corr_rounds: 0,
    parent_permit_id: null,
    permit_cycles: [CYCLE],
    ...over,
  } as PermitWithCycles;
}

const PROJECT: Project = {
  id: 'p-5627',
  address: '5627 44th Ave SW',
  juris: 'Seattle',
  units: 1,
  go_date: null,
  product_types: [],
  project_tags: [],
} as unknown as Project;

const PROJECTS = new Map<string, Project>([[PROJECT.id, PROJECT]]);

// ---------------------------------------------------------------------------
// §A.1 — the CSV export
// ---------------------------------------------------------------------------

describe('fix-498 §A: the CSV export writes the DERIVED stage', () => {
  const stageIdx = CSV_HEADERS.indexOf('Stage' as never);

  function stageCellFor(permit: PermitWithCycles): string {
    const enriched = enrichPermits([permit], PROJECTS);
    const spy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:fix-498');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    let captured = '';
    const realBlob = globalThis.Blob;
    class CapturingBlob extends realBlob {
      constructor(parts: BlobPart[], opts?: BlobPropertyBag) {
        super(parts, opts);
        if (typeof parts[0] === 'string' && parts[0].includes('Address')) {
          captured = parts[0];
        }
      }
    }
    globalThis.Blob = CapturingBlob as unknown as typeof Blob;
    try {
      exportEnrichedPermitsToCSV(enriched);
    } finally {
      globalThis.Blob = realBlob;
      spy.mockRestore();
      vi.restoreAllMocks();
    }
    const dataRow = captured.split('\n')[1] ?? '';
    // Every cell is quoted; split on '","' after trimming the outer quotes.
    const cells = dataRow.slice(1, -1).split('","');
    return cells[stageIdx] ?? '';
  }

  it('★★★ an ISSUED permit exports as "is" — it exported "de" before', () => {
    // ★★★ FAILS ON origin/main. The cell was `p.stage_override ?? p.stage`,
    //     and this permit's stored stage was 'de' — so the export said Design
    //     about a permit the city issued on 2026-08-31. 342 of 406 issued
    //     permits on prod were in exactly this state.
    expect(stageCellFor(issuedBp())).toBe('is');
  });

  it('★★ a permit with nothing recorded still exports "de"', () => {
    // ★ The honest floor: no dates, no cycles, no terminal status. The derived
    //   answer and the old seeded answer agree here — which is precisely why
    //   the column looked healthy for as long as it did.
    expect(
      stageCellFor(
        issuedBp({ status: null, actual_issue: null, approval_date: null }),
      ),
    ).toBe('de');
  });

  it('★★★ "ap" is now reachable at all — the seeded column never held it', () => {
    // ★★★ THE ORDER INSIDE effectiveStage, PINNED BECAUSE I GOT IT WRONG
    //     FIRST. A recorded approval_date is checked BEFORE the portal status,
    //     so an "Approved" permit that still has its approval date reads 'ap'
    //     — approved, issuance outstanding — not 'is'.
    expect(
      stageCellFor(issuedBp({ status: 'Approved', actual_issue: null })),
    ).toBe('ap');
    // ★★ Only with no approval_date does the terminal status carry it to 'is'.
    //    That is fix-31d's SDOT case: for permit types where the city never
    //    issues a separate document, "Approved" IS the final state.
    expect(
      stageCellFor(
        issuedBp({
          status: 'Approved',
          actual_issue: null,
          approval_date: null,
        }),
      ),
    ).toBe('is');
    // ★ And "Ready for Issuance" is the one status that means approved-but-
    //   not-issued on its own.
    expect(
      stageCellFor(
        issuedBp({
          status: 'Ready for Issuance',
          actual_issue: null,
          approval_date: null,
        }),
      ),
    ).toBe('ap');
  });
});

// ---------------------------------------------------------------------------
// §A.2 — the Reports project-stage rank
// ---------------------------------------------------------------------------

describe('fix-498 §A: the Reports ledger ranks by the DERIVED stage', () => {
  it('★★★ 5627 44th Ave SW ranks "is", not "de"', () => {
    // ★★★ FAILS ON origin/main. pickDominantStage read
    //     `e.permit.stage_override ?? e.permit.stage` and this project's
    //     Building Permit stored 'de'.
    const rows = aggregateByProject(enrichPermits([issuedBp()], PROJECTS));
    expect(rows[0]!.dominantStage).toBe('is');
  });

  it('★★★ the BP still decides the project, not the most-advanced permit', () => {
    // ★★ fix-14's rule is UNCHANGED and must stay: a project's stage follows
    //    its Building Permit. Only the value being compared changed, never the
    //    pool it is chosen from. An un-submitted BP beside an issued PAR is
    //    still a Design project.
    const bp = issuedBp({
      id: 1,
      status: null,
      actual_issue: null,
      approval_date: null,
    });
    const par = issuedBp({ id: 2, type: 'PAR/Pre-Sub', num: '000165-26PA' });
    const rows = aggregateByProject(enrichPermits([bp, par], PROJECTS));
    expect(rows[0]!.dominantStage).toBe('de');
  });

  it('★★ with no BP it falls back to the most-advanced derived stage', () => {
    const par = issuedBp({ id: 2, type: 'PAR/Pre-Sub' });
    const rows = aggregateByProject(enrichPermits([par], PROJECTS));
    expect(rows[0]!.dominantStage).toBe('is');
  });
});

// ---------------------------------------------------------------------------
// §B — "Stage" leaves the Report Builder, and the runner stops hiding why
// ---------------------------------------------------------------------------

const previewMutate = vi.hoisted(() => vi.fn());

/** A catalog that still offers Stage — the shape prod served BEFORE fix-498. */
const CATALOG_WITH_STAGE: ReportBuilderCatalog = {
  version: 1,
  entities: [
    {
      key: 'permits',
      label: 'Permits',
      default_sort: { column: 'target_submit', dir: 'asc' },
      columns: [
        {
          key: 'num',
          label: 'Permit #',
          type: 'text',
          filterable: true,
          operators: ['='],
          source: 'direct',
        },
        {
          key: 'stage',
          label: 'Stage',
          type: 'text',
          filterable: true,
          operators: ['='],
          source: 'direct',
        },
      ],
    },
  ],
} as ReportBuilderCatalog;

vi.mock('../hooks/useReportBuilder', () => ({
  useReportBuilderCatalog: () => ({
    data: catalogForRender,
    isLoading: false,
    error: null,
  }),
  useSavedReport: () => ({ data: null, isLoading: false, error: null }),
  usePreviewReportSpec: () => ({
    mutate: previewMutate,
    data: undefined,
    isPending: false,
  }),
  useUpsertCustomReportSpec: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useReportHub', () => ({
  useReportHub: () => ({ data: { categories: [], reports: [] }, isLoading: false }),
}));
vi.mock('../hooks/useIsTenantAdmin', () => ({ useIsTenantAdmin: () => true }));

let catalogForRender: ReportBuilderCatalog = CATALOG_WITH_STAGE;

const { default: ReportBuilder } = await import('../pages/ReportBuilder');

function renderBuilder(catalog: ReportBuilderCatalog) {
  catalogForRender = catalog;
  return render(
    <MemoryRouter initialEntries={['/reports/builder']}>
      <Routes>
        <Route path="/reports/builder" element={<ReportBuilder />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('fix-498 §B: the catalog is the ONLY gate on the Stage checkbox', () => {
  it('★★★ a catalog WITHOUT stage renders no Stage checkbox', () => {
    // ★★★ THIS IS WHY THE MIGRATION IS SUFFICIENT. ReportBuilder renders one
    //     checkbox per catalog column and nothing else — there is no separate
    //     client-side column list to also edit. Removing the _rbcol() line
    //     server-side removes the control.
    const without = {
      ...CATALOG_WITH_STAGE,
      entities: [
        {
          ...CATALOG_WITH_STAGE.entities[0]!,
          columns: CATALOG_WITH_STAGE.entities[0]!.columns.filter(
            (c) => c.key !== 'stage',
          ),
        },
      ],
    } as ReportBuilderCatalog;
    renderBuilder(without);
    expect(screen.getByTestId('report-builder-col-num')).toBeInTheDocument();
    expect(screen.queryByTestId('report-builder-col-stage')).toBeNull();
  });

  it('★★ the same page WITH stage in the catalog does render it', () => {
    // ★ The control half of the pair. Without it the test above passes for a
    //   page that renders no checkboxes at all.
    renderBuilder(CATALOG_WITH_STAGE);
    expect(screen.getByTestId('report-builder-col-stage')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// THE MIGRATION, AND THE SOURCE-GREP
// ---------------------------------------------------------------------------

const MIGRATION = readFileSync(
  resolve(process.cwd(), 'migrations/fix_498_retire_permits_stage.sql'),
  'utf8',
);

describe('fix-498 §B/§C/§D: the migration', () => {
  it('★★★ removes the Stage column from the catalog', () => {
    expect(MIGRATION).toContain(
      "_rbcol(''stage'',''Stage'',''text'',true,''direct'')",
    );
    expect(MIGRATION).toContain('bp_get_report_builder_catalog');
  });

  it('★★★ the runner NAMES an unresolvable column instead of hiding it', () => {
    // ★★★ `RAISE EXCEPTION 'report execution failed'` swallowed every SQL
    //     error in the generated report — no column, no table, nothing to
    //     chase. It is the line that would have hidden this bug's successor.
    //     Proven on prod against a temporary bogus catalog column in a
    //     rolled-back transaction: "report refers to a column that no longer
    //     exists (column p.ghost_col does not exist)".
    expect(MIGRATION).toContain('WHEN undefined_column THEN');
    expect(MIGRATION).toContain('report refers to a column that no longer exists');
    // ★ …and every OTHER failure keeps the deliberately generic message.
    expect(MIGRATION).toContain("RAISE EXCEPTION ''report execution failed''");
  });

  it('★★★ patches BOTH halves of every positional INSERT', () => {
    // ★★★ A column list and its VALUES list are ONE edit. Patch the list and
    //     not the values and every column after `stage` shifts by one — the
    //     permit would get its stage_override written into its status.
    for (const anchor of [
      "    stage, stage_override, status,",          // bp_insert_permit list
      "COALESCE(p_data->>''stage'', ''de'')",        // bp_insert_permit values
      'kickoff_date, stage, status, notes',          // create list
      "''kickoff_date'', '''')::date, ''de'', ",     // create values
      'target_submit, stage, status',                // update list
      "''de'', ''Pre-Submittal",                     // update values
    ]) {
      expect(MIGRATION).toContain(anchor);
    }
  });

  it('★★ every anchor is asserted to hit exactly once before it is used', () => {
    // ★ Anchor-patching a live body is only safe if a missed or doubled anchor
    //   STOPS the migration. EIGHT anchors, eight guards: the catalog, the
    //   runner, and then a column-list AND a values-list for each of the three
    //   positional INSERTs.
    const guards = MIGRATION.match(/want 1/g) ?? [];
    expect(guards.length).toBe(8);
  });

  it('★★★ drops the column, and keeps the two that only look like it', () => {
    expect(MIGRATION).toContain('ALTER TABLE public.permits DROP COLUMN stage;');
    expect(MIGRATION).not.toContain('DROP COLUMN stage_override');
    expect(MIGRATION).not.toContain('permit_tasks DROP COLUMN');
  });
});

describe('fix-498: nothing in src/ reads the stored column any more', () => {
  it('★★★ no `.stage` read of a permit survives', () => {
    // ★★ COMMENT-STRIPPED — the TWELFTH time this repo has needed that. Every
    //    note recording the removal quotes the expression it removed.
    const files = [
      'src/lib/csvExport.ts',
      'src/lib/reportMetrics.ts',
      'src/hooks/useCreatePermit.ts',
    ];
    for (const f of files) {
      const src = stripComments(readFileSync(resolve(process.cwd(), f), 'utf8'));
      expect(src).not.toMatch(/\bp\.stage\b(?!_override)/);
      expect(src).not.toMatch(/permit\.stage\b(?!_override)/);
      expect(src).not.toMatch(/\bstage:\s*'de'/);
    }
  });

  it('★★★ the Permit type no longer declares it', () => {
    const types = stripComments(
      readFileSync(resolve(process.cwd(), 'src/lib/database.types.ts'), 'utf8'),
    );
    expect(types).not.toContain('  stage: string | null;');
    // ★ stage_override stays — a DIFFERENT column, and the escape hatch
    //   computeStage honours.
    expect(types).toContain('  stage_override: string | null;');
    // ★ permit_tasks.stage stays too (fix-79's phase mirror).
    expect(types).toContain('  stage: string;');
  });

  it('★★ both readers now call effectiveStage with cycles AND reviewers', () => {
    // ★ Full fidelity, not the computeStage fallback: EnrichedPermit already
    //   carries both (`permit` is a PermitWithCycles, `reviewers` is indexed
    //   in by enrichPermits), so the reviewer-rollup half of the derivation is
    //   available to these two surfaces exactly as it is to the Dashboard.
    const csv = readFileSync(resolve(process.cwd(), 'src/lib/csvExport.ts'), 'utf8');
    const rm = readFileSync(resolve(process.cwd(), 'src/lib/reportMetrics.ts'), 'utf8');
    expect(csv).toContain('effectiveStage(p, p.permit_cycles ?? [], e.reviewers)');
    expect(rm).toContain(
      'effectiveStage(e.permit, e.permit.permit_cycles ?? [], e.reviewers)',
    );
  });
});

/** ★ Strip comments before a source-grep: the note recording a removed
 *  expression has to quote it. Twelfth time. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const at = line.indexOf('//');
      if (at < 0) return line;
      const before = line.slice(0, at);
      const quotes = (before.match(/['"`]/g) ?? []).length;
      return quotes % 2 === 0 ? before : line;
    })
    .join('\n');
}
