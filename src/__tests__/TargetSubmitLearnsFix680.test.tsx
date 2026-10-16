import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useAuthStore } from '../stores/authStore';
import {
  anchorForType,
  computeLearnedTargetSubmit,
  extractTargetSubmitSample,
  learnFromSamples,
  parseTargetSubmitAnchor,
  TARGET_SUBMIT_ANCHORS,
  type TargetSubmitAnchor,
} from '../lib/targetSubmitLearner';
import { STARTING_NUMBER_LABEL } from '../lib/targetSubmitPolicy';
import {
  formulaScopeKey,
  resolveTargetSubmitOffset,
} from '../hooks/useTargetSubmitFormulas';
import type {
  PermitCycle,
  PermitWithCycles,
  Project,
  TargetSubmitFormula,
} from '../lib/database.types';

// ===========================================================================
// fix-680 (P-318 #7, census tickets 1 + 2) — Target Submit learns from our
// own recent history (median of the last 5, per type + city), and ANY permit
// type gets one.
// ===========================================================================
//
// No live DB in CI: the SQL is pinned by reading the migration, and its logic
// through the TS twin (the fix-153 pattern). The prod behaviour was proved in
// a rolled-back preview before merge (§D of the brief).

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  resolve(ROOT, 'migrations', 'fix_680_target_submit_learns.sql'),
  'utf8',
);

/** SQL with `--` comments removed, so a pin can't be satisfied by prose. */
function code(sql: string): string {
  return sql
    .split('\n')
    .map((l) => (l.includes('--') ? l.slice(0, l.indexOf('--')) : l))
    .join('\n');
}

/** One CREATE FUNCTION body from the migration, comments stripped. */
function fnBody(name: string): string {
  const start = MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} is in the migration`).toBeGreaterThan(-1);
  const open = MIGRATION.indexOf('$function$', start);
  const close = MIGRATION.indexOf('$function$', open + 1);
  return code(MIGRATION.slice(open, close));
}

/** The backfill CASE in the migration → { type: anchor }. */
function backfill(): Record<string, string> {
  const start = MIGRATION.indexOf('UPDATE public.permit_types SET ts_anchor = CASE name');
  const end = MIGRATION.indexOf('END', start);
  const out: Record<string, string> = {};
  for (const m of MIGRATION.slice(start, end).matchAll(/WHEN '([^']+)'\s+THEN '([^']+)'/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

// ★ The non-BP `v_candidate := CASE v_permit.type` from LIVE prod's
//   bp_recompute_target_submits (pg_get_functiondef, 2026-10-15, before this
//   migration), verbatim. The backfill must give every one of these types the
//   anchor its branch counted from.
const PRE_FIX680_CASE = `
        WHEN 'Grading / Clearing' THEN v_bp_target
        WHEN 'LSM' THEN v_bp_target
        WHEN 'Demolition' THEN CASE WHEN v_proj_intake IS NOT NULL THEN v_proj_intake + COALESCE(bp_learn_target_submit_days('Demolition', v_juris, 'bp_c0_intake', v_tenant), 37) ELSE NULL END
        WHEN 'ECA Waiver' THEN CASE WHEN v_go IS NOT NULL THEN v_go + COALESCE(bp_learn_target_submit_days('ECA Waiver', v_juris, 'go_date', v_tenant), 10) ELSE NULL END
        WHEN 'IPR' THEN CASE WHEN v_proj_c1_resub IS NOT NULL THEN v_proj_c1_resub + COALESCE(bp_learn_target_submit_days('IPR', v_juris, 'bp_c1_resub', v_tenant), 7) ELSE NULL END
        WHEN 'ULS' THEN CASE WHEN v_proj_c1_resub IS NOT NULL THEN v_proj_c1_resub + COALESCE(bp_learn_target_submit_days('ULS', v_juris, 'bp_c1_resub', v_tenant), 7) ELSE NULL END
        WHEN 'LBA' THEN CASE WHEN v_go IS NOT NULL THEN v_go + COALESCE(bp_learn_target_submit_days('LBA', v_juris, 'go_date', v_tenant), 37) ELSE NULL END
        WHEN 'Short Plat' THEN CASE WHEN v_go IS NOT NULL THEN v_go + COALESCE(bp_learn_target_submit_days('Short Plat', v_juris, 'go_date', v_tenant), 37) ELSE NULL END
        WHEN 'SIP' THEN CASE WHEN v_go IS NOT NULL THEN v_go + COALESCE(bp_learn_target_submit_days('SIP', v_juris, 'go_date', v_tenant), 37) ELSE NULL END
        WHEN 'PAR/Pre-Sub' THEN CASE WHEN v_go IS NOT NULL THEN v_go + COALESCE(bp_learn_target_submit_days('PAR/Pre-Sub', v_juris, 'go_date', v_tenant), 10) ELSE NULL END
        WHEN 'SDOT Tree' THEN CASE WHEN v_go IS NOT NULL THEN v_go + COALESCE(bp_learn_target_submit_days('SDOT Tree', v_juris, 'go_date', v_tenant), 10) ELSE NULL END
        WHEN 'TRAO' THEN CASE WHEN v_go IS NOT NULL THEN v_go + COALESCE(bp_learn_target_submit_days('TRAO', v_juris, 'go_date', v_tenant), 10) ELSE NULL END
        WHEN 'Condo' THEN CASE WHEN v_proj_issue IS NOT NULL THEN v_proj_issue + COALESCE(bp_learn_target_submit_days('Condo', v_juris, 'bp_actual_issue', v_tenant), 129) ELSE NULL END
`;

/** Which anchor an old branch's expression counted from. */
const OLD_EXPR_ANCHOR: Record<string, string> = {
  v_bp_target: 'mirror_bp',
  v_proj_intake: 'bp_c0_intake',
  v_go: 'go_date',
  v_proj_c1_resub: 'bp_c1_resub',
  v_proj_issue: 'bp_actual_issue',
};

describe('fix-680 §A — one anchor per type, stored once', () => {
  it('★★★ the backfill matches the old CASE for all 13 dated types (no anchor moves)', () => {
    const fill = backfill();
    const old: Record<string, string> = {
      // The BP block counted from its own dd_end; it was never in the CASE.
      'Building Permit': 'dd_end',
    };
    for (const m of PRE_FIX680_CASE.matchAll(/WHEN '([^']+)' THEN (?:CASE WHEN )?(v_[a-z0-9_]+)/g)) {
      old[m[1]] = OLD_EXPR_ANCHOR[m[2]];
    }
    expect(Object.keys(old)).toHaveLength(14); // BP + the 13 CASE branches
    for (const [type, anchor] of Object.entries(old)) {
      expect(anchor, `${type} parsed`).toBeTruthy();
      expect(fill[type], `${type} keeps its anchor`).toBe(anchor);
    }
  });

  it("★★ the four undated types follow Bobby's rulings: STFI GO date, PPR created, Vault + WAC none", () => {
    const fill = backfill();
    expect(fill.STFI).toBe('go_date');
    expect(fill.PPR).toBe('created');
    expect(fill.Vault).toBe('none');
    expect(fill.WAC).toBe('none');
    expect(Object.keys(fill)).toHaveLength(18);
  });

  it('★★ a new type defaults to the GO date; the CHECK list is the TS list', () => {
    expect(MIGRATION).toMatch(/ADD COLUMN IF NOT EXISTS ts_anchor text NOT NULL DEFAULT 'go_date'/);
    const check = /CHECK \(ts_anchor IN \(([^)]+)\)\)/.exec(code(MIGRATION));
    expect(check).not.toBeNull();
    const listed = [...check![1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(listed).toEqual([...TARGET_SUBMIT_ANCHORS]);
  });

  it('★ an unknown or missing stored anchor reads as none, never a guess', () => {
    expect(parseTargetSubmitAnchor('go_date')).toBe('go_date');
    expect(parseTargetSubmitAnchor('created')).toBe('created');
    expect(parseTargetSubmitAnchor(undefined)).toBe('none');
    expect(parseTargetSubmitAnchor('next_tuesday')).toBe('none');
    expect(anchorForType('Not In The Catalogue', [{ name: 'TRAO', ts_anchor: 'go_date' }])).toBe('none');
  });
});

describe('fix-680 §B — the learner (SQL)', () => {
  const learn = fnBody('bp_learn_target_submit_days');
  const bench = fnBody('bp_target_submit_benchmark');
  const obs = fnBody('bp_target_submit_observations');

  it('★★★ history first: median of the 5 most recent, then the starting number, nothing hard-coded', () => {
    expect(learn).toMatch(/percentile_cont\(0\.5\) WITHIN GROUP \(ORDER BY r\.days\)::numeric/);
    expect(learn).toMatch(/ORDER BY o\.submitted DESC, o\.permit_id DESC\s+LIMIT 5/);
    // the history query comes BEFORE the Settings lookup (fix-249 reversed)
    expect(learn.indexOf('bp_target_submit_observations')).toBeLessThan(
      learn.indexOf('bp_target_submit_offset'),
    );
    expect(learn).toMatch(/RETURN public\.bp_target_submit_offset\(p_type, p_juris, p_tenant\);/);
    // the old per-type last-resort numbers are gone
    expect(learn).not.toMatch(/CASE p_type/);
    expect(learn).not.toMatch(/\b129\b|\b37\b/);
  });

  it('★★ the benchmark reads the same observation list and reports learned / starting / none', () => {
    expect(bench).toMatch(/bp_target_submit_observations\(p_type, p_juris, p_anchor, v_tenant\)/);
    expect(bench).toMatch(/ORDER BY o\.submitted DESC, o\.permit_id DESC\s+LIMIT 5/);
    for (const label of ["'learned'", "'starting'", "'none'"]) expect(bench).toContain(label);
  });

  it('★★ observations: 730-day cap, hold days subtracted (fix-668), created excludes backfills', () => {
    expect(obs).toMatch(/ABS\(s\.sub_on - s\.anchor_on\) <= 730/);
    expect(obs).toMatch(/bp_held_permit_ids/);
    expect(obs).toMatch(/bp_held_days\(s\.pid, s\.anchor_on, s\.sub_on\)/);
    expect(obs).toMatch(/\(p_anchor <> 'created' OR s\.sub_on >= s\.anchor_on\)/);
    expect(obs).toMatch(/WHEN 'created'\s+THEN \(p\.created_at AT TIME ZONE 'America\/Los_Angeles'\)::date/);
  });

  it('★ the new helper is not open to anon', () => {
    expect(MIGRATION).toMatch(/REVOKE ALL ON FUNCTION public\.bp_target_submit_observations\(text, text, text, uuid\) FROM PUBLIC, anon;/);
  });
});

describe('fix-680 §C — the recompute reads the anchor', () => {
  const rec = fnBody('bp_recompute_target_submits');

  it('★★★ no per-type CASE is left; the anchor comes from permit_types', () => {
    expect(rec).not.toMatch(/CASE v_permit\.type/);
    expect(rec).toMatch(/LEFT JOIN permit_types pt ON pt\.name = p\.type/);
    expect(rec).toMatch(/COALESCE\(pt\.ts_anchor, 'none'\) AS ts_anchor/);
    expect(rec).toMatch(/bp_learn_target_submit_days\(v_permit\.type, v_juris, v_permit\.ts_anchor, v_tenant\)/);
    // the only type literal left is the Building Permit, the anchor permit
    const literals = new Set([...rec.matchAll(/'([A-Z][A-Za-z /&-]+)'/g)].map((m) => m[1]));
    expect([...literals]).toEqual(['Building Permit']);
  });

  it('★★★ manual targets and finished permits are untouched (fix-585/621/624 guards kept)', () => {
    const manual = rec.match(/IF COALESCE\(v_permit\.target_submit_is_manual, false\) THEN CONTINUE; END IF;/g);
    expect(manual).toHaveLength(2); // BP loop + the other-types loop
    const finished = rec.match(
      /IF public\.bp_permit_is_finished\(v_permit\.approval_date, v_permit\.actual_issue\)\s+AND v_permit\.target_submit IS NOT NULL THEN CONTINUE; END IF;/g,
    );
    expect(finished).toHaveLength(2);
    expect(rec).toMatch(/NOT COALESCE\(v_bp_is_manual, false\)/);
  });

  it('★★ a none anchor (Vault, WAC) produces no date; a NULL candidate is never written', () => {
    expect(rec).toMatch(/ELSE NULL\s+END;/);
    expect(rec).toMatch(/IF v_candidate IS NOT NULL AND v_candidate IS DISTINCT FROM v_permit\.target_submit THEN/);
  });

  it('★ projected is keyed by anchor, as before by type', () => {
    expect(rec).toMatch(/WHEN 'bp_c0_intake'\s+THEN v_intake_projected/);
    expect(rec).toMatch(/WHEN 'bp_c1_resub'\s+THEN v_c1_projected/);
    expect(rec).toMatch(/WHEN 'bp_actual_issue' THEN v_issue_projected/);
  });

  it('★ the header says it reverses fix-249', () => {
    expect(MIGRATION.slice(0, 600)).toMatch(/REVERSES fix-249/);
  });
});

// ---------------------------------------------------------------------------
// The TS twin
// ---------------------------------------------------------------------------

function cycle(permitId: number, over: Partial<PermitCycle>): PermitCycle {
  return {
    id: permitId * 10,
    permit_id: permitId,
    cycle_index: 0,
    submitted: null,
    intake_accepted: null,
    resubmitted: null,
    ...over,
  } as PermitCycle;
}
function permit(id: number, over: Partial<PermitWithCycles>): PermitWithCycles {
  return {
    id,
    project_id: `p${id}`,
    type: 'Brand New Type',
    dd_end: null,
    actual_issue: null,
    approval_date: null,
    created_at: null,
    permit_cycles: [],
    ...over,
  } as PermitWithCycles;
}
function project(id: string, over: Partial<Project> = {}): Project {
  return { id, juris: 'Seattle', go_date: '2026-09-01', ...over } as Project;
}

describe('fix-680 — the learner (TS twin)', () => {
  it('★★ PPR (created): a permit submitted BEFORE its row was created is a backfill and is left out', () => {
    const fresh = permit(1, {
      type: 'PPR',
      created_at: '2026-07-07T17:00:00Z', // 10:00 Pacific, 07-07
      permit_cycles: [cycle(1, { submitted: '2026-07-21' })],
    });
    const backfilled = permit(2, {
      type: 'PPR',
      created_at: '2026-09-30T17:00:00Z',
      permit_cycles: [cycle(2, { submitted: '2026-06-01' })],
    });
    expect(extractTargetSubmitSample(fresh, project('p1'), undefined, 'created')?.daysAnchorToSubmit).toBe(14);
    expect(extractTargetSubmitSample(backfilled, project('p2'), undefined, 'created')).toBeNull();
  });

  it('★ created is the PACIFIC calendar day (an evening entry is still that day)', () => {
    const evening = permit(3, {
      type: 'PPR',
      created_at: '2026-07-08T05:30:00Z', // 22:30 Pacific on 07-07
      permit_cycles: [cycle(3, { submitted: '2026-07-07' })],
    });
    expect(extractTargetSubmitSample(evening, project('p3'), undefined, 'created')?.daysAnchorToSubmit).toBe(0);
  });

  it('★★ median over 1, an even and an odd number of submittals', () => {
    const s = (permitId: number, d: number, date: string) => ({
      permitId,
      type: 'X',
      juris: 'Seattle',
      anchor: 'go_date' as const,
      anchorDate: date,
      submittedAt: date,
      daysAnchorToSubmit: d,
      recencyDate: date,
    });
    expect(learnFromSamples([s(1, 9, '2026-01-01')], 3).value).toBe(9);
    expect(learnFromSamples([s(1, 9, '2026-01-01'), s(2, 20, '2026-02-01')], 3).value).toBe(15); // 14.5 → 15
    expect(
      learnFromSamples([s(1, 9, '2026-01-01'), s(2, 20, '2026-02-01'), s(3, 4, '2026-03-01')], 3).value,
    ).toBe(9);
  });

  it('★★ fallback: the city row first, then the type row, then nothing', () => {
    const byScope = new Map<string, TargetSubmitFormula>([
      [formulaScopeKey('LBA', null), { type: 'LBA', jurisdiction: null, offset_days: 14, updated_at: '' }],
      [formulaScopeKey('LBA', 'Kirkland'), { type: 'LBA', jurisdiction: 'Kirkland', offset_days: 30, updated_at: '' }],
    ]);
    expect(learnFromSamples([], resolveTargetSubmitOffset(byScope, 'LBA', 'Kirkland'))).toMatchObject({ value: 30, source: 'starting' });
    expect(learnFromSamples([], resolveTargetSubmitOffset(byScope, 'LBA', 'Seattle'))).toMatchObject({ value: 14, source: 'starting' });
    expect(learnFromSamples([], resolveTargetSubmitOffset(byScope, 'Vault', 'Seattle'))).toMatchObject({ value: null, source: 'none' });
  });

  it('★★ Vault / WAC (none) stay without a number even with history and a starting number', () => {
    const p = permit(5, { type: 'Vault', permit_cycles: [cycle(5, { submitted: '2026-09-10' })] });
    const r = computeLearnedTargetSubmit([p], new Map([['p5', project('p5')]]), {
      type: 'Vault',
      juris: 'Seattle',
      anchor: 'none',
      startingDays: 10,
    });
    expect(r).toMatchObject({ value: null, source: 'none' });
  });
});

// ---------------------------------------------------------------------------
// ★★★ RED-PROVED ON MAIN: a brand-new type, added in Settings, gets a target
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  types: [] as { name: string; is_builtin: boolean | null; notes: string | null; ts_anchor?: string }[],
  formulas: [] as { type: string; jurisdiction: string | null; offset_days: number; updated_at: string }[],
}));
vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({ data: h.types, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('../hooks/useTargetSubmitFormulas', async (orig) => {
  const actual = await orig<typeof import('../hooks/useTargetSubmitFormulas')>();
  return {
    ...actual,
    useTargetSubmitFormulas: () => {
      const byScope = new Map<string, (typeof h.formulas)[number]>();
      for (const f of h.formulas) byScope.set(actual.formulaScopeKey(f.type, f.jurisdiction), f);
      return { formulas: h.formulas, byScope, isLoading: false, error: null, refetch: vi.fn() };
    },
  };
});
vi.mock('../hooks/usePermitTypeDefaults', () => ({
  usePermitTypeDefaults: () => ({
    rows: [], byType: new Map(), c1OffsetByType: new Map(), isLoading: false, error: null, refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useUpsertTargetSubmitFormula', () => ({ useUpsertTargetSubmitFormula: () => ({ mutate: vi.fn() }) }));
vi.mock('../hooks/useDeleteTargetSubmitFormula', () => ({ useDeleteTargetSubmitFormula: () => ({ mutate: vi.fn() }) }));
vi.mock('../hooks/useUpsertPermitTypeDefault', () => ({ useUpsertPermitTypeDefault: () => ({ mutate: vi.fn() }) }));
vi.mock('../hooks/useJurisdictions', () => ({
  useJurisdictions: () => ({ data: [{ name: 'Seattle', learn_window_days: null, notes: null }], isLoading: false, error: null }),
}));
vi.mock('../hooks/useTargetSubmitBenchmark', () => ({ useTargetSubmitBenchmarks: () => ({ byType: new Map() }) }));
vi.mock('../components/shared/RowHistoryPanel', () => ({ default: () => <div /> }));

import PerTypeScheduleTable from '../components/Settings/PerTypeScheduleTable';

describe('★★★ fix-680 — a brand-new type gets a Target Submit (red on main)', () => {
  beforeEach(() => {
    useAuthStore.setState({ activeTenantId: 't680', memberships: [{ tenant_id: 't680', role: 'admin' }] });
    // A type added through Settings → its row takes the column default.
    h.types = [{ name: 'Brand New Type', is_builtin: false, notes: null, ts_anchor: 'go_date' }];
    h.formulas = [{ type: 'Brand New Type', jurisdiction: null, offset_days: 10, updated_at: '2026-10-15T00:00:00Z' }];
  });

  it('Settings shows its starting-number box, labelled as a starting number', () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <PerTypeScheduleTable />
      </QueryClientProvider>,
    );
    const box = screen.getByTestId('pts-target-Brand New Type') as HTMLInputElement;
    expect(box.value).toBe('10');
    expect(screen.getByTestId('pts-anchor-Brand New Type').textContent).toBe('after the GO date');
    expect(screen.getByTestId('pts-target-header').textContent).toContain(STARTING_NUMBER_LABEL);
  });

  it('gets a GO-date target from its starting number, then learns after its first submittal', () => {
    const anchor: TargetSubmitAnchor = anchorForType('Brand New Type', h.types);
    expect(anchor).toBe('go_date');
    const projects = new Map([['p1', project('p1', { go_date: '2026-09-01' })]]);

    // No submittal yet → the starting number (10) from GO.
    const before = computeLearnedTargetSubmit([], projects, {
      type: 'Brand New Type', juris: 'Seattle', anchor, startingDays: 10,
    });
    expect(before).toMatchObject({ value: 10, source: 'starting' });

    // Its first submittal, 23 days after GO → it learns 23.
    const first = permit(1, { permit_cycles: [cycle(1, { submitted: '2026-09-24' })] });
    const after = computeLearnedTargetSubmit([first], projects, {
      type: 'Brand New Type', juris: 'Seattle', anchor, startingDays: 10,
    });
    expect(after).toMatchObject({ value: 23, source: 'learned', sampleCount: 1 });
  });
});

// ---------------------------------------------------------------------------
// ★★★ no permit-type name left in a Target Submit code path
// ---------------------------------------------------------------------------

const TS_PATH_FILES = [
  'src/lib/targetSubmitLearner.ts',
  'src/lib/targetSubmitPolicy.ts',
  'src/hooks/useTargetSubmitAnchors.ts',
  'src/hooks/useTargetSubmitBenchmark.ts',
  'src/components/ProjectDetail/TargetSubmitBenchmarkNote.tsx',
  'src/components/Settings/PerTypeScheduleTable.tsx',
];

/** Lines of code only: `//` line comments and `/* … *\/` blocks removed. */
function tsCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');
}

function trendsTargetSubmitSection(): string {
  const src = readFileSync(resolve(ROOT, 'src/pages/Trends.tsx'), 'utf8');
  const a = src.indexOf('interface TargetSubmitRow {');
  const b = src.indexOf('function TargetTh(');
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return src.slice(a, b);
}

describe('★★★ fix-680 — the type list lives in the database only', () => {
  const NAMES = Object.keys(backfill());

  it('the guard has the whole catalogue to look for', () => {
    expect(NAMES).toHaveLength(18);
  });

  it.each([...TS_PATH_FILES, 'src/pages/Trends.tsx (Target Submit section)'])(
    '%s names no permit type except the Building Permit (the anchor permit)',
    (path) => {
      const src = path.startsWith('src/pages/Trends.tsx')
        ? trendsTargetSubmitSection()
        : readFileSync(resolve(ROOT, path), 'utf8');
      const body = tsCode(src);
      expect(body.length).toBeGreaterThan(200); // the strip found code
      const found = NAMES.filter(
        (n) => n !== 'Building Permit' && new RegExp(`['"\`]${n.replace(/[/]/g, '\\/')}['"\`]`).test(body),
      );
      expect(found, `${path} names ${found.join(', ')}`).toEqual([]);
    },
  );

  it('the BP-as-anchor lookup is still found (the strip did not eat the code)', () => {
    expect(tsCode(readFileSync(resolve(ROOT, TS_PATH_FILES[0]), 'utf8'))).toContain("'Building Permit'");
  });

  it('the deleted twins stay deleted', () => {
    const all = TS_PATH_FILES.map((p) => readFileSync(resolve(ROOT, p), 'utf8')).join('\n') + trendsTargetSubmitSection();
    expect(all).not.toMatch(/HARDCODED_TARGET_SUBMIT_OFFSETS/);
    expect(all).not.toMatch(/\banchorFor\(/);
  });
});
