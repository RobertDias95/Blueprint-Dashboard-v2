import type { CorrectionItem } from './database.types';
import {
  UNSPECIFIED_DISCIPLINE,
  correctionDisciplineLabel,
} from './correctionItems';

// fix-277: the Corrections report — every indexed correction-letter comment,
// across every project, with the repeat analysis the per-project panel could
// never do (it only ever saw one project).
//
// READ-ONLY. public.correction_items grants `authenticated` SELECT and nothing
// else; the rows come from the file_indexer on Bobby's PC.
//
// ── THE REPEAT RULE IS NOT THE ONE THE PROJECT PANEL USES ───────────────────
// fix-276's panel counts a topic as repeating if it appears in MORE THAN ONE
// cycle, anywhere. This report uses the stricter, consecutive definition asked
// for here: a topic raised in cycle N and AGAIN in cycle N+1. The difference is
// real — a comment raised in cycle 1, fixed, and raised again in cycle 3 is not
// the same failure as one the city had to repeat immediately. Both live in the
// codebase on purpose; neither is "the" definition.
//
// A topic is scoped TO ITS PROJECT. "Zoning / Setbacks" on one project in cycle
// 1 and on a different project in cycle 2 is two projects having a common
// problem, not a repeat — counting it as one would make the rate meaningless
// the moment the corpus grew.

export const UNSPECIFIED_THEME = 'Unspecified';
export const UNKNOWN_JURISDICTION = 'Unknown';
export const NO_ARCHITECT = 'Not recorded';

/** A correction item joined to the project facts the report filters on.
 *  `correction_items` carries none of these — they come from `projects` and
 *  `permits`, resolved client-side against caches the app already holds. */
export interface CorrectionReportRow extends CorrectionItem {
  address: string;
  juris: string;
  /** From permits.architect. Almost always absent — see architectCoverage(). */
  architect: string | null;
}

export interface ProjectFacts {
  id: string;
  address: string;
  juris: string | null;
}

/** Join correction items to their project + architect.
 *
 * Items whose project is missing from `projects` are DROPPED, not defaulted:
 * without a project we cannot say the jurisdiction, so every per-jurisdiction
 * figure the report prints would quietly include rows it could not place. RLS
 * scopes both reads to the same tenant, so a miss means the project was deleted
 * between the two queries.
 */
export function joinCorrectionRows(
  items: readonly CorrectionItem[],
  projects: readonly ProjectFacts[],
  architectByProjectId: ReadonlyMap<string, string> = new Map(),
): CorrectionReportRow[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const out: CorrectionReportRow[] = [];
  for (const item of items) {
    const project = byId.get(item.project_id);
    if (!project) continue;
    out.push({
      ...item,
      address: project.address,
      juris: (project.juris ?? '').trim() || UNKNOWN_JURISDICTION,
      architect: architectByProjectId.get(item.project_id) ?? null,
    });
  }
  return out;
}

export function correctionThemeLabel(theme: string | null): string {
  const t = (theme ?? '').trim();
  return t === '' ? UNSPECIFIED_THEME : t;
}

export function correctionArchitectLabel(architect: string | null): string {
  const a = (architect ?? '').trim();
  return a === '' ? NO_ARCHITECT : a;
}

// ------------------------------------------------------------------ filters --

export interface CorrectionFilters {
  juris: string;
  discipline: string;
  theme: string;
  /** '' = any. Otherwise the cycle number as a string. */
  cycle: string;
  architect: string;
  /** ISO yyyy-mm-dd, inclusive. '' = unbounded. */
  from: string;
  to: string;
}

export const EMPTY_FILTERS: CorrectionFilters = {
  juris: '',
  discipline: '',
  theme: '',
  cycle: '',
  architect: '',
  from: '',
  to: '',
};

export function filtersAreEmpty(f: CorrectionFilters): boolean {
  return (
    !f.juris && !f.discipline && !f.theme && !f.cycle && !f.architect &&
    !f.from && !f.to
  );
}

/** Apply the filter bar.
 *
 * A row with no letter_date is kept when NEITHER bound is set and dropped once
 * either is — an undated row cannot be shown to satisfy a date window, and
 * silently keeping it would inflate a "corrections in Q3" count.
 */
export function filterCorrectionRows(
  rows: readonly CorrectionReportRow[],
  f: CorrectionFilters,
): CorrectionReportRow[] {
  const hasDateBound = Boolean(f.from || f.to);
  return rows.filter((r) => {
    if (f.juris && r.juris !== f.juris) return false;
    if (f.discipline && correctionDisciplineLabel(r.discipline) !== f.discipline) {
      return false;
    }
    if (f.theme && correctionThemeLabel(r.theme) !== f.theme) return false;
    if (f.cycle && String(r.cycle ?? '') !== f.cycle) return false;
    if (f.architect && correctionArchitectLabel(r.architect) !== f.architect) {
      return false;
    }
    if (hasDateBound) {
      const d = r.letter_date;
      if (!d) return false;
      if (f.from && d < f.from) return false;
      if (f.to && d > f.to) return false;
    }
    return true;
  });
}

/** Distinct values for each filter dropdown, computed off the UNFILTERED set so
 *  the options don't collapse as you narrow. */
export interface CorrectionFilterOptions {
  jurisdictions: string[];
  disciplines: string[];
  themes: string[];
  cycles: number[];
  architects: string[];
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function sortedUnique(values: Iterable<string>, unspecified?: string): string[] {
  const list = [...new Set(values)];
  list.sort((a, b) => {
    // The "we don't know" bucket sorts last so a real value is never buried.
    if (unspecified) {
      if (a === unspecified) return b === unspecified ? 0 : 1;
      if (b === unspecified) return -1;
    }
    return collator.compare(a, b);
  });
  return list;
}

export function correctionFilterOptions(
  rows: readonly CorrectionReportRow[],
): CorrectionFilterOptions {
  return {
    jurisdictions: sortedUnique(rows.map((r) => r.juris), UNKNOWN_JURISDICTION),
    disciplines: sortedUnique(
      rows.map((r) => correctionDisciplineLabel(r.discipline)),
      UNSPECIFIED_DISCIPLINE,
    ),
    themes: sortedUnique(
      rows.map((r) => correctionThemeLabel(r.theme)),
      UNSPECIFIED_THEME,
    ),
    cycles: [...new Set(rows.map((r) => r.cycle).filter((c): c is number => c != null))]
      .sort((a, b) => a - b),
    architects: sortedUnique(
      rows.map((r) => correctionArchitectLabel(r.architect)),
      NO_ARCHITECT,
    ),
  };
}

/** How much of the corpus can actually answer an architect question.
 *  Production: 72 of 2,194 items (3%), across 3 of 93 projects. The filter is
 *  built as asked; the UI states the coverage so an almost-empty result reads
 *  as missing DATA rather than a broken report. */
export function architectCoverage(rows: readonly CorrectionReportRow[]): {
  withArchitect: number;
  total: number;
  pct: number;
} {
  const withArchitect = rows.filter(
    (r) => (r.architect ?? '').trim() !== '',
  ).length;
  const total = rows.length;
  return {
    withArchitect,
    total,
    pct: total === 0 ? 0 : Math.round((100 * withArchitect) / total),
  };
}

// -------------------------------------------------------------------- counts --

export interface CountRow {
  label: string;
  items: number;
  /** Distinct projects contributing — a theme hitting 30 projects once each is
   *  a different problem from one hitting a single project 30 times. */
  projects: number;
  pct: number;
}

function countBy(
  rows: readonly CorrectionReportRow[],
  keyFn: (r: CorrectionReportRow) => string,
  unspecified: string,
): CountRow[] {
  const items = new Map<string, number>();
  const projects = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = keyFn(r);
    items.set(key, (items.get(key) ?? 0) + 1);
    const set = projects.get(key);
    if (set) set.add(r.project_id);
    else projects.set(key, new Set([r.project_id]));
  }
  const total = rows.length;
  const out: CountRow[] = [...items].map(([label, n]) => ({
    label,
    items: n,
    projects: projects.get(label)?.size ?? 0,
    pct: total === 0 ? 0 : Math.round((1000 * n) / total) / 10,
  }));
  // Biggest first — the report exists to show where the volume is. Ties break
  // alphabetically, with the unknown bucket always last.
  out.sort((a, b) => {
    if (a.label === unspecified) return b.label === unspecified ? 0 : 1;
    if (b.label === unspecified) return -1;
    if (a.items !== b.items) return b.items - a.items;
    return collator.compare(a.label, b.label);
  });
  return out;
}

export function countsByTheme(rows: readonly CorrectionReportRow[]): CountRow[] {
  return countBy(rows, (r) => correctionThemeLabel(r.theme), UNSPECIFIED_THEME);
}

export function countsByDiscipline(rows: readonly CorrectionReportRow[]): CountRow[] {
  return countBy(
    rows,
    (r) => correctionDisciplineLabel(r.discipline),
    UNSPECIFIED_DISCIPLINE,
  );
}

// ------------------------------------------------------------- repeat rate ---

/** building + discipline + category, within one project. */
export function reportTopicKey(row: CorrectionReportRow): string {
  return [
    (row.building ?? '').trim(),
    (row.discipline ?? '').trim(),
    (row.category ?? '').trim(),
  ].join('|');
}

export interface RepeatTopic {
  projectId: string;
  address: string;
  juris: string;
  building: string | null;
  discipline: string;
  category: string;
  /** Every cycle N where the topic recurred in N+1. */
  repeatedFromCycles: number[];
  /** All cycles the topic appears in, ascending. */
  cycles: number[];
  items: number;
}

export interface RepeatRate {
  /** (project, topic, cycle N) triples where the project HAS a cycle N+1 — the
   *  only ones that had the chance to repeat. */
  eligible: number;
  /** Of those, the ones that did recur in N+1. */
  repeated: number;
  /** repeated / eligible, 0–100, one decimal. */
  pct: number;
  /** Distinct topics that recurred at least once. */
  repeatedTopics: RepeatTopic[];
}

/**
 * Consecutive-cycle repeat rate.
 *
 * The denominator is the honest part. Counting every topic-cycle would punish a
 * project for its LAST cycle, where nothing can follow — a project reviewed once
 * would score 0% repeats and look excellent, when really it was never asked
 * twice. So a topic in cycle N only counts as eligible when the project actually
 * has a cycle N+1.
 *
 * Rows with no cycle are excluded entirely: "again in the next round" has no
 * meaning without a round. Production has none today, but the column is nullable.
 */
export function repeatRate(rows: readonly CorrectionReportRow[]): RepeatRate {
  // project → the cycles that project has any item in
  const cyclesByProject = new Map<string, Set<number>>();
  // project|topic → cycle → item count
  const topicCycles = new Map<string, Map<number, number>>();
  const topicMeta = new Map<string, CorrectionReportRow>();

  for (const r of rows) {
    if (r.cycle == null) continue;
    const pc = cyclesByProject.get(r.project_id);
    if (pc) pc.add(r.cycle);
    else cyclesByProject.set(r.project_id, new Set([r.cycle]));

    const key = `${r.project_id}::${reportTopicKey(r)}`;
    const byCycle = topicCycles.get(key);
    if (byCycle) byCycle.set(r.cycle, (byCycle.get(r.cycle) ?? 0) + 1);
    else topicCycles.set(key, new Map([[r.cycle, 1]]));
    if (!topicMeta.has(key)) topicMeta.set(key, r);
  }

  let eligible = 0;
  let repeated = 0;
  const repeatedTopics: RepeatTopic[] = [];

  for (const [key, byCycle] of topicCycles) {
    const meta = topicMeta.get(key)!;
    const projectCycles = cyclesByProject.get(meta.project_id)!;
    const cycles = [...byCycle.keys()].sort((a, b) => a - b);
    const repeatedFrom: number[] = [];
    for (const n of cycles) {
      // Only a cycle the project actually continued past can evidence a repeat.
      if (!projectCycles.has(n + 1)) continue;
      eligible += 1;
      if (byCycle.has(n + 1)) {
        repeated += 1;
        repeatedFrom.push(n);
      }
    }
    if (repeatedFrom.length > 0) {
      repeatedTopics.push({
        projectId: meta.project_id,
        address: meta.address,
        juris: meta.juris,
        building: (meta.building ?? '').trim() || null,
        discipline: correctionDisciplineLabel(meta.discipline),
        category: (meta.category ?? '').trim() || 'Unclassified',
        repeatedFromCycles: repeatedFrom,
        cycles,
        items: [...byCycle.values()].reduce((a, b) => a + b, 0),
      });
    }
  }

  // Worst first: most recurrences, then most items, then address.
  repeatedTopics.sort(
    (a, b) =>
      b.repeatedFromCycles.length - a.repeatedFromCycles.length ||
      b.items - a.items ||
      collator.compare(a.address, b.address) ||
      collator.compare(a.discipline, b.discipline),
  );

  return {
    eligible,
    repeated,
    pct: eligible === 0 ? 0 : Math.round((1000 * repeated) / eligible) / 10,
    repeatedTopics,
  };
}

// -------------------------------------------------------------------- summary --

export interface CorrectionsReportSummary {
  items: number;
  projects: number;
  cycles: number[];
  jurisdictions: number;
  repeat: RepeatRate;
}

export function summarizeReport(
  rows: readonly CorrectionReportRow[],
): CorrectionsReportSummary {
  return {
    items: rows.length,
    projects: new Set(rows.map((r) => r.project_id)).size,
    cycles: [...new Set(rows.map((r) => r.cycle).filter((c): c is number => c != null))]
      .sort((a, b) => a - b),
    jurisdictions: new Set(rows.map((r) => r.juris)).size,
    repeat: repeatRate(rows),
  };
}

// ------------------------------------------------------------------------ CSV --

export const CORRECTIONS_CSV_COLUMNS = [
  { key: 'address', label: 'Address' },
  { key: 'juris', label: 'Jurisdiction' },
  { key: 'architect', label: 'Architect' },
  { key: 'building', label: 'Building' },
  { key: 'cycle', label: 'Cycle' },
  { key: 'discipline', label: 'Discipline' },
  { key: 'theme', label: 'Theme' },
  { key: 'category', label: 'Category' },
  { key: 'letter_date', label: 'Letter date' },
  { key: 'reviewer', label: 'Reviewer' },
  { key: 'item_no', label: 'Item #' },
  { key: 'subject', label: 'Subject' },
  { key: 'body', label: 'Body' },
  { key: 'codes', label: 'Codes' },
  { key: 'source_file', label: 'Source letter' },
] as const;

export function correctionsCsvRows(
  rows: readonly CorrectionReportRow[],
): Array<Record<string, unknown>> {
  return rows.map((r) => ({
    address: r.address,
    juris: r.juris,
    architect: correctionArchitectLabel(r.architect),
    building: r.building ?? '',
    cycle: r.cycle ?? '',
    discipline: correctionDisciplineLabel(r.discipline),
    theme: correctionThemeLabel(r.theme),
    category: r.category ?? '',
    letter_date: r.letter_date ?? '',
    reviewer: r.reviewer ?? '',
    item_no: r.item_no,
    subject: r.subject ?? '',
    body: r.body ?? '',
    codes: r.codes ?? '',
    source_file: r.source_file,
  }));
}
