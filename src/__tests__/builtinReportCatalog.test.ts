import { describe, it, expect } from 'vitest';
import {
  BUILTIN_REPORT_COMPONENTS,
  BUILTIN_REPORT_CATALOG,
  builtinReportCatalogDrift,
  seededBuiltinKeys,
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
    expect(BUILTIN_REPORT_CATALOG.vendor_schedule_forecast).toEqual({
      name: 'Structural Schedule Forecast',
      category: 'Weekly Updates',
      position: 2,
    });
  });
});
