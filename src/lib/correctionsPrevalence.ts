import type { CorrectionReportRow } from './correctionsReport';
import { correctionThemeLabel } from './correctionsReport';
import {
  NOT_RECORDED,
  segmentValues,
  type SegmentDef,
  type SegmentProject,
} from './correctionsSegments';

export * from './correctionsSegments';

// fix-279: PREVALENCE — "we get this correction 65% of the time".
//
// ── THIS IS NOT THE REPEAT RATE, AND THE TWO MUST NEVER SHARE A COLUMN ──────
//   prevalence   of the projects in scope, how many hit this category at all
//                -> what to fix in the TEMPLATE
//   repeat rate  of the topics raised in a round, how many came back next round
//                -> where the RESPONSE PROCESS breaks
//
// They move in opposite directions for the same category: something the city
// raises on 84% of projects and we fix first time has high prevalence and a low
// repeat rate. Putting them in one unlabelled column would point template work
// at exactly the wrong categories, so `PrevalenceRow` deliberately carries no
// repeat figure at all and the two live in separate views.
//
// ── THE DENOMINATOR IS THE WHOLE GAME ───────────────────────────────────────
// "65%" is meaningless until you know 65% OF WHAT. Here it is always: of the
// projects in scope that have any correction item at all. Never of all
// projects, never of letters, never of items.
//
// One subtlety that would otherwise produce nonsense: a THEME or CATEGORY
// filter must not shrink the denominator. Filter to theme='Stormwater' and
// compute prevalence over "projects with a Stormwater item" and every
// Stormwater category reads far higher than it is — the extreme case being a
// single-category filter showing 100%. So the denominator is computed from the
// scope BEFORE those two filters are applied; everything else (jurisdiction,
// discipline, cycle, dates, and every segment) narrows it, because "of the
// projects that got Drainage comments, how many got flow control" is a real
// question. `prevalenceScopeNote` says which of the two happened, on screen.

/** Below this many projects a percentage is noise dressed as a number. Cells
 *  under it are rendered de-emphasised, and the count is ALWAYS shown. */
export const LOW_CONFIDENCE_N = 10;

export type PrevalenceLevel = 'category' | 'theme';

export interface PrevalenceRow {
  /** Category or theme, depending on the level. */
  label: string;
  /** For a category row, the theme it rolls up into — so a template
   *  conversation can move between the two without a second lookup. */
  theme: string | null;
  /** Distinct projects with at least one item in this bucket. */
  projects: number;
  /** projects / denominator, 0–100, one decimal. */
  pct: number;
  /** Total items, which is NOT the same story: 88 items across 65 projects is
   *  a template problem; 88 across 3 is one project having a bad week. */
  items: number;
}

export interface PrevalenceResult {
  /** The denominator, stated on screen. */
  denominator: number;
  rows: PrevalenceRow[];
  /** True when a theme/category filter is active, i.e. the denominator is
   *  deliberately wider than the rows being displayed. */
  scopeWiderThanRows: boolean;
}

function pct(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((1000 * n) / d) / 10;
}

/**
 * Prevalence of each category (or theme) across the projects in scope.
 *
 * `scopeRows` sets the denominator; `displayRows` are the rows to count. Pass
 * the same array for both when no theme/category filter is active.
 */
export function computePrevalence(
  scopeRows: readonly CorrectionReportRow[],
  displayRows: readonly CorrectionReportRow[],
  level: PrevalenceLevel,
): PrevalenceResult {
  const denominator = new Set(scopeRows.map((r) => r.project_id)).size;

  const projectsByLabel = new Map<string, Set<string>>();
  const itemsByLabel = new Map<string, number>();
  const themeByLabel = new Map<string, string>();

  for (const row of displayRows) {
    const label =
      level === 'theme'
        ? correctionThemeLabel(row.theme)
        : (row.category ?? '').trim() || 'Unclassified';
    const set = projectsByLabel.get(label);
    if (set) set.add(row.project_id);
    else projectsByLabel.set(label, new Set([row.project_id]));
    itemsByLabel.set(label, (itemsByLabel.get(label) ?? 0) + 1);
    if (level === 'category' && !themeByLabel.has(label)) {
      themeByLabel.set(label, correctionThemeLabel(row.theme));
    }
  }

  const rows: PrevalenceRow[] = [...projectsByLabel].map(([label, set]) => ({
    label,
    theme: level === 'category' ? themeByLabel.get(label) ?? null : null,
    projects: set.size,
    pct: pct(set.size, denominator),
    items: itemsByLabel.get(label) ?? 0,
  }));

  // Highest prevalence first — the report exists to say what to fix next.
  rows.sort(
    (a, b) => b.pct - a.pct || b.projects - a.projects || a.label.localeCompare(b.label),
  );

  return {
    denominator,
    rows,
    scopeWiderThanRows: displayRows.length !== scopeRows.length,
  };
}

// ------------------------------------------------------------------- bands --
// "Here's everything over X, here's everything under 10%" was the actual ask.

export interface PrevalenceBand {
  key: string;
  label: string;
  min: number;
  max: number;
}

export const PREVALENCE_BANDS: PrevalenceBand[] = [
  { key: 'high', label: '50% and over', min: 50, max: Infinity },
  { key: 'mid', label: '25–49%', min: 25, max: 49.999999 },
  { key: 'low', label: '10–24%', min: 10, max: 24.999999 },
  { key: 'rare', label: 'Under 10%', min: -Infinity, max: 9.999999 },
];

export interface BandedPrevalence {
  band: PrevalenceBand;
  rows: PrevalenceRow[];
}

/** Group prevalence rows into the bands, dropping empty ones. */
export function bandPrevalence(rows: readonly PrevalenceRow[]): BandedPrevalence[] {
  return PREVALENCE_BANDS.map((band) => ({
    band,
    rows: rows.filter((r) => r.pct >= band.min && r.pct <= band.max),
  })).filter((g) => g.rows.length > 0);
}

export interface SegmentPrevalenceRow {
  value: string;
  /** Projects in this bucket that are in scope — THE DENOMINATOR FOR THIS ROW.
   *  This is the n the ★ note is about: 4 and 54 must not look alike. */
  projectsInSegment: number;
  /** Of those, how many hit the selected category/theme. */
  affected: number;
  pct: number;
  items: number;
  /** Below LOW_CONFIDENCE_N — render de-emphasised. */
  lowConfidence: boolean;
}

/**
 * Prevalence of ONE category (or theme) broken down by a project attribute.
 *
 * This is the shape of the business question: "does flow-control detention hit
 * bigger projects harder?" — 25% at 1 unit, 71% at 6+.
 *
 * The denominator per row is projects IN SCOPE in that bucket, not projects
 * affected — otherwise every row is 100%.
 */
export function segmentPrevalence(
  scopeRows: readonly CorrectionReportRow[],
  projectsById: ReadonlyMap<string, SegmentProject>,
  seg: SegmentDef,
  level: PrevalenceLevel,
  label: string,
): SegmentPrevalenceRow[] {
  const inScope = new Set(scopeRows.map((r) => r.project_id));
  const affectedProjects = new Set(
    scopeRows
      .filter((r) =>
        level === 'theme'
          ? correctionThemeLabel(r.theme) === label
          : ((r.category ?? '').trim() || 'Unclassified') === label,
      )
      .map((r) => r.project_id),
  );
  const itemsByProject = new Map<string, number>();
  for (const r of scopeRows) {
    const matches =
      level === 'theme'
        ? correctionThemeLabel(r.theme) === label
        : ((r.category ?? '').trim() || 'Unclassified') === label;
    if (matches) {
      itemsByProject.set(r.project_id, (itemsByProject.get(r.project_id) ?? 0) + 1);
    }
  }

  const denom = new Map<string, Set<string>>();
  const hits = new Map<string, Set<string>>();
  const items = new Map<string, number>();

  for (const projectId of inScope) {
    const project = projectsById.get(projectId);
    // A project we cannot look up cannot be placed in a bucket. Dropping it
    // from the denominator is right — putting it in "Not recorded" would claim
    // we asked and the project said nothing.
    if (!project) continue;
    for (const value of segmentValues(seg, project)) {
      const d = denom.get(value);
      if (d) d.add(projectId);
      else denom.set(value, new Set([projectId]));
      if (affectedProjects.has(projectId)) {
        const h = hits.get(value);
        if (h) h.add(projectId);
        else hits.set(value, new Set([projectId]));
        items.set(value, (items.get(value) ?? 0) + (itemsByProject.get(projectId) ?? 0));
      }
    }
  }

  const rows: SegmentPrevalenceRow[] = [...denom].map(([value, set]) => ({
    value,
    projectsInSegment: set.size,
    affected: hits.get(value)?.size ?? 0,
    pct: pct(hits.get(value)?.size ?? 0, set.size),
    items: items.get(value) ?? 0,
    lowConfidence: set.size < LOW_CONFIDENCE_N,
  }));

  const order = seg.order;
  rows.sort((a, b) => {
    // "Not recorded" is never the headline, whatever its number.
    if (a.value === NOT_RECORDED) return b.value === NOT_RECORDED ? 0 : 1;
    if (b.value === NOT_RECORDED) return -1;
    if (order) {
      const ai = order.indexOf(a.value);
      const bi = order.indexOf(b.value);
      if (ai !== -1 || bi !== -1) {
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      }
    }
    return b.pct - a.pct || b.projectsInSegment - a.projectsInSegment
      || a.value.localeCompare(b.value);
  });
  return rows;
}

// ------------------------------------------------------- permit-link coverage --

export interface PermitLinkCoverage {
  linked: number;
  total: number;
  pct: number;
}

/** How much of the slice can answer a permit-level question at all.
 *
 *  correction_items.permit_id is set on 49.8% of rows in production, so a
 *  permit-type or DA slice silently covers half the corpus. The page states
 *  this whenever such a filter is active — a smaller number with an explanation
 *  beats two unexplained totals on one page. */
export function permitLinkCoverage(
  rows: readonly CorrectionReportRow[],
): PermitLinkCoverage {
  const linked = rows.filter((r) => r.permit_id != null).length;
  return {
    linked,
    total: rows.length,
    pct: rows.length === 0 ? 0 : Math.round((100 * linked) / rows.length),
  };
}
