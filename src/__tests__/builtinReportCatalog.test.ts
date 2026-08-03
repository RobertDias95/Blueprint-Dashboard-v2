import { describe, it, expect } from 'vitest';
import {
  BUILTIN_REPORT_COMPONENTS,
  BUILTIN_REPORT_CATALOG,
  builtinReportCatalogDrift,
  builtinReportHowItWorks,
  builtinReportsMissingHowItWorks,
  seededBuiltinKeys,
  type BuiltinReportCatalogEntry,
} from '../lib/builtinReports';

// fix-267: the guard against the bug that hid a finished report.
//
// Registering a builtin in BUILTIN_REPORT_COMPONENTS gives it a route and a
// component, but the Reporting hub lists from the public.saved_reports TABLE.
// fix-265 registered vendor_schedule_forecast and never seeded the row, so the
// report worked and was reachable only by URL — Bobby could not find it. The
// prod audit for fix-267 then found the SAME omission had already happened once
// before (phase_durations, fix-253) and gone unnoticed for months.
//
// CI has no live database, so this cannot assert the row exists. What it CAN
// assert — and what actually prevents the recurrence — is that every registered
// builtin carries an explicit hub decision: either catalog metadata, or a
// deliberate null. Forgetting to decide now fails loudly here.

describe('fix-267 builtin registry ⇄ hub catalog', () => {
  it('every registered builtin has an explicit hub decision', () => {
    const { missingCatalog } = builtinReportCatalogDrift();
    expect(
      missingCatalog,
      `These builtins are registered but have no BUILTIN_REPORT_CATALOG entry. ` +
        `Add one (name/category/position) to have the seed migration list them ` +
        `in the Reporting hub, or set null to declare them URL-only. Leaving ` +
        `them out is how fix-265 shipped a report nobody could find.`,
    ).toEqual([]);
  });

  it('the catalog has no entries for builtins that no longer exist', () => {
    const { orphanCatalog } = builtinReportCatalogDrift();
    expect(
      orphanCatalog,
      'Catalog entries with no matching component — the seed migration would ' +
        'create hub cards whose Run button goes nowhere.',
    ).toEqual([]);
  });

  it('the two maps have identical key sets', () => {
    expect(Object.keys(BUILTIN_REPORT_CATALOG).sort()).toEqual(
      Object.keys(BUILTIN_REPORT_COMPONENTS).sort(),
    );
  });

  it('detects drift in either direction', () => {
    // Prove the guard actually catches the fix-265 shape of mistake rather than
    // passing vacuously.
    expect(
      builtinReportCatalogDrift({ a: 1, b: 2 }, { a: null }),
    ).toEqual({ missingCatalog: ['b'], orphanCatalog: [] });
    expect(
      builtinReportCatalogDrift({ a: 1 }, { a: null, gone: null }),
    ).toEqual({ missingCatalog: [], orphanCatalog: ['gone'] });
    expect(builtinReportCatalogDrift({ a: 1 }, { a: null })).toEqual({
      missingCatalog: [],
      orphanCatalog: [],
    });
  });

  it('every non-null catalog entry is complete enough to seed', () => {
    for (const [key, entry] of Object.entries(BUILTIN_REPORT_CATALOG)) {
      if (entry === null) continue;
      expect(entry.name.trim(), `${key}.name`).not.toBe('');
      expect(entry.category.trim(), `${key}.category`).not.toBe('');
      expect(entry.position, `${key}.position`).toBeGreaterThanOrEqual(0);
    }
  });

  it('positions are unique within a category', () => {
    const seen = new Map<string, string>();
    for (const [key, entry] of Object.entries(BUILTIN_REPORT_CATALOG)) {
      if (entry === null) continue;
      const slot = `${entry.category}#${entry.position}`;
      expect(seen.get(slot), `${key} collides with ${seen.get(slot)} at ${slot}`).toBeUndefined();
      seen.set(slot, key);
    }
  });

  it('pins the seeded set — matches what prod holds + what the migration inserts', () => {
    // Prod (verified 2026-08-03) holds exactly these four builtin rows.
    // phase_durations is deliberately absent: see the comment on its catalog
    // entry — that null is a FLAG for unreviewed drift, not a settled decision.
    expect(seededBuiltinKeys()).toEqual([
      'approved_awaiting_issuance',
      'vendor_schedule_forecast',
      'weekly_da_update',
      'weekly_updates',
    ]);
  });

  it('vendor_schedule_forecast is filed where the migration puts it', () => {
    expect(BUILTIN_REPORT_CATALOG.vendor_schedule_forecast?.name).toBe(
      'Structural Schedule Forecast',
    );
    expect(BUILTIN_REPORT_CATALOG.vendor_schedule_forecast?.category).toBe(
      'Weekly Updates',
    );
    expect(BUILTIN_REPORT_CATALOG.vendor_schedule_forecast?.position).toBe(2);
  });

});

// fix-270: saved_reports.description says WHAT a report covers; nothing said HOW
// IT DECIDES. That gap is why the vendor forecast's stale rows read as a bug
// rather than a rule. A hub-placed report without an explanation now fails CI.
describe('fix-270 how-it-works', () => {
  /** Minimal valid entry, for driving the guard with synthetic catalogs. */
  function entry(
    over: Partial<BuiltinReportCatalogEntry> = {},
  ): BuiltinReportCatalogEntry {
    return {
      name: 'X',
      category: 'Pipeline',
      position: 0,
      howItWorks: { included: ['in'], excluded: ['out'] },
      ...over,
    };
  }

  it('every hub-placed builtin explains itself', () => {
    expect(
      builtinReportsMissingHowItWorks(),
      'A report placed in the hub with no howItWorks — or with an empty ' +
        'included/excluded list — is exactly the gap fix-270 exists to close.',
    ).toEqual([]);
  });

  it('all four hub-placed builtins have non-empty included AND excluded lists', () => {
    for (const key of seededBuiltinKeys()) {
      const h = BUILTIN_REPORT_CATALOG[key]?.howItWorks;
      expect(h?.included.length, `${key}.included`).toBeGreaterThan(0);
      // A report that excludes nothing has almost certainly not been thought
      // about — every one of these has real exclusion rules.
      expect(h?.excluded.length, `${key}.excluded`).toBeGreaterThan(0);
    }
  });

  it('the guard catches a hub-placed entry with no howItWorks at all', () => {
    const bad = { a: { name: 'A', category: 'C', position: 0 } } as unknown as Record<
      string,
      BuiltinReportCatalogEntry | null
    >;
    expect(builtinReportsMissingHowItWorks(bad)).toEqual(['a']);
  });

  it.each([
    ['empty included', { included: [], excluded: ['out'] }],
    ['empty excluded', { included: ['in'], excluded: [] }],
    ['both empty', { included: [], excluded: [] }],
  ])('the guard catches %s', (_label, howItWorks) => {
    expect(
      builtinReportsMissingHowItWorks({ a: entry({ howItWorks }) }),
    ).toEqual(['a']);
  });

  it('a NULL (URL-only) entry needs no howItWorks and passes', () => {
    expect(builtinReportsMissingHowItWorks({ a: null })).toEqual([]);
    // phase_durations is exactly this case on the real catalog.
    expect(BUILTIN_REPORT_CATALOG.phase_durations).toBeNull();
    expect(builtinReportsMissingHowItWorks()).not.toContain('phase_durations');
  });

  it('a complete entry passes', () => {
    expect(builtinReportsMissingHowItWorks({ a: entry() })).toEqual([]);
  });

  it('notes are optional', () => {
    expect(
      builtinReportsMissingHowItWorks({
        a: entry({ howItWorks: { included: ['in'], excluded: ['out'] } }),
      }),
    ).toEqual([]);
  });

  it('builtinReportHowItWorks resolves a key, and returns null for the rest', () => {
    expect(builtinReportHowItWorks('weekly_da_update')?.included.length).toBeGreaterThan(0);
    // URL-only, unknown, and custom reports (no builtin_key) all get nothing.
    expect(builtinReportHowItWorks('phase_durations')).toBeNull();
    expect(builtinReportHowItWorks('not_a_report')).toBeNull();
    expect(builtinReportHowItWorks(null)).toBeNull();
    expect(builtinReportHowItWorks(undefined)).toBeNull();
  });

  it('is written for Gena and Brittani, not developers', () => {
    // No identifiers leaking into vendor- and coordinator-facing copy. These
    // are the names that would most plausibly slip in from the implementation.
    const banned = [
      'allPermitsDone',
      'projectIsActive',
      'isPermitDone',
      'completion_status',
      'actual_issue',
      'approval_date',
      'waiting_on',
      'dd_end',
      'end_week',
      'draw_schedule',
      'permit_tasks',
      'saved_reports',
      'null',
      '()',
    ];
    for (const key of seededBuiltinKeys()) {
      const h = BUILTIN_REPORT_CATALOG[key]!.howItWorks;
      const text = [...h.included, ...h.excluded, ...(h.notes ?? [])].join(' ');
      for (const token of banned) {
        expect(text, `${key} mentions "${token}"`).not.toContain(token);
      }
    }
  });
});
