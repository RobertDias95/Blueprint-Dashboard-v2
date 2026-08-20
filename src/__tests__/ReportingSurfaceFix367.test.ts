import { describe, it, expect } from 'vitest';
import routerSrc from '../router.tsx?raw';
import {
  RIBBON_ENTRIES,
  ROUTES_INTENTIONALLY_NOT_IN_RIBBON,
  activeRibbonTarget,
  allRibbonRoutes,
  isRibbonEntryActive,
  ribbonExemptPaths,
} from '../lib/ribbonNav';
import { SETTINGS_SECTIONS, sectionForPath } from '../lib/settingsSections';
import {
  formatProductTypes,
  formatUnits,
  type VendorScheduleRow,
} from '../lib/vendorReport';
import { buildVendorEmailHtml } from '../lib/vendorReportEmail';
import screenSrc from '../pages/VendorScheduleForecastReport.tsx?raw';
import emailSrc from '../lib/vendorReportEmail.ts?raw';

// ===========================================================================
// fix-367 — Saved Reports is not a setting, and SSS cannot see the scope
// ===========================================================================

// ---------------------------------------------------------------------------
// ★★ §1 — Saved Reports takes you to Settings
// ---------------------------------------------------------------------------
//
// Bobby: "when you click Saved Reports under the Reporting tab it shows
// Account, Team, Projects, Permits, Schedule. But the moment you click any of
// those it takes you to Settings."
//
// ★★★ It was behaving exactly as its address said: /settings/reporting renders
// <SettingsPage />, so the whole Settings rail rendered beside it. Nothing was
// broken — the page was in the wrong place.

describe('fix-367 §1: the shelf leaves Settings', () => {
  it('★★★ /settings/reporting still resolves — as a redirect, never a 404', () => {
    // People have it bookmarked and fix-317 routed the entire Reports group
    // through it. fix-319's own comment promised it "keeps its meaning
    // exactly", and it does — it just arrives somewhere that is not Settings.
    expect(routerSrc).toContain("path: 'settings/reporting'");
    expect(routerSrc).toMatch(
      /path: 'settings\/reporting'[\s\S]{0,200}<Navigate to="\/reports\/saved" replace \/>/,
    );
  });

  it('★★★ the new address renders the shelf WITHOUT the Settings shell', () => {
    // The actual complaint. /reports/saved renders <SavedReports />, which
    // renders AdminReportingTab and no settings rail.
    expect(routerSrc).toContain("path: 'reports/saved'");
    expect(routerSrc).toMatch(
      /path: 'reports\/saved'[\s\S]{0,120}<SavedReports \/>/,
    );
    // ★ …and it is NOT <SettingsPage />, which is what put the rail there.
    const seg = routerSrc.slice(
      routerSrc.indexOf("path: 'reports/saved'"),
      routerSrc.indexOf("path: 'reports/saved'") + 200,
    );
    expect(seg).not.toContain('SettingsPage');
  });

  it('★★ Settings no longer offers Reporting, and nothing else moved', () => {
    // The second half of what he asked for: "system settings would lose the
    // Reporting tab".
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual([
      'account',
      'team',
      'projects',
      'permits',
      'schedule',
    ]);
    expect(sectionForPath('/settings/reporting')).toBeNull();
    // ★ Every other section keeps its path, its admin flag and its order.
    expect(SETTINGS_SECTIONS.map((s) => s.path)).toEqual([
      '/settings/account',
      '/settings/team',
      '/settings/projects',
      '/settings/permits',
      '/settings/schedule',
    ]);
    expect(SETTINGS_SECTIONS.map((s) => s.adminOnly)).toEqual([
      false,
      true,
      true,
      true,
      true,
    ]);
  });

  it('★ the Reports group still reads Overview + Saved reports', () => {
    // fix-317's decision stands. This changed WHERE Saved reports lives, not
    // what the group contains.
    const group = RIBBON_ENTRIES.find(
      (e) => e.kind === 'group' && e.group.id === 'reports',
    );
    const kids = group?.kind === 'group' ? group.group.children : [];
    expect(kids.map((k) => k.label)).toContain('Saved reports');
    expect(kids.find((k) => k.label === 'Saved reports')!.to).toBe('/reports/saved');
    expect(kids.map((k) => k.to)).not.toContain('/settings/reporting');
  });
});

describe('fix-367 §1: the two guards that had to be satisfied', () => {
  it('★ fix-315 route coverage — the redirect carries a reason', () => {
    // A new route must be in the ribbon or exempt WITH a reason. The old path
    // is now neither a section nor an entry, so it needs the row.
    const row = ROUTES_INTENTIONALLY_NOT_IN_RIBBON.find(
      (r) => r.path === '/settings/reporting',
    );
    expect(row).toBeTruthy();
    expect(row!.why).toMatch(/redirect/i);
    expect(row!.why).toMatch(/reports\/saved/);
    // ★ …and the new path is NOT exempt, because it IS a ribbon entry. A path
    // may not be both — the guard would silently double-count it.
    expect(ribbonExemptPaths()).not.toContain('/reports/saved');
    expect(allRibbonRoutes()).toContain('/reports/saved');
  });

  /** ★ fix-335 §5's own predicate — matches AND nothing matches more
   *  specifically. Asserted through `isRibbonEntryActive`, which is what the
   *  Ribbon renders with, rather than through `isLinkActive` alone: that one
   *  lit two entries, which is the defect fix-335 fixed. */
  const litOn = (pathname: string) =>
    allRibbonRoutes().filter((to) => isRibbonEntryActive(to, pathname));

  it('★★★ fix-335 §5 — exactly ONE ribbon entry is active on the new route', () => {
    // A redirect plus a new route is precisely the shape that lights two
    // entries at once. Here the matching entries are /reports and
    // /reports/saved, and the LONGEST wins.
    expect(activeRibbonTarget('/reports/saved')).toBe('/reports/saved');
    expect(litOn('/reports/saved')).toEqual(['/reports/saved']);
  });

  it('★★ …and the redirected path lights at most one on the way through', () => {
    // The redirect is immediate and `replace`, so the ribbon only ever renders
    // at /reports/saved. Asserted for the pre-navigation instant anyway:
    // /settings/reporting is no longer an entry, so the one entry that can
    // claim it is Settings itself — never two, which is the fix-335 §5
    // contract either way.
    expect(litOn('/settings/reporting')).toEqual(['/settings']);
  });

  it('★ /reports and /settings themselves are unaffected', () => {
    expect(litOn('/reports')).toEqual(['/reports']);
    expect(litOn('/settings/account')).toEqual(['/settings']);
  });
});

// ---------------------------------------------------------------------------
// ★★★ §2 — the vendor forecast does not tell SSS the scope
// ---------------------------------------------------------------------------
//
// Bobby: "it would be useful if we add the units — how many units are on that
// site — and then the type, SFR, duplex, whatever the boxes are checked… so
// they can understand the scope of what's coming towards them."
//
// ★ MEASURED on prod 2026-08-20, of 160 active projects: units on 159,
// product_types on 154, and 44 of them multi-type. A display change.

function row(over: Partial<VendorScheduleRow> = {}): VendorScheduleRow {
  return {
    projectId: 'p1',
    address: '10044 37th Ave SW',
    juris: 'Seattle',
    startWeek: '2026-08-10',
    targetSend: '2026-09-18',
    status: 'Scheduled',
    bucket: 'new',
    overdue: false,
    previous: null,
    reuseFromAddress: null,
    reuseNotes: null,
    holdReason: null,
    units: 3,
    productTypes: ['SFR', 'ADU', 'Existing'],
    ...over,
  } as VendorScheduleRow;
}

describe('fix-367 §2: the formatters', () => {
  it('★ a multi-type project renders all of its types', () => {
    // 10044 37th Ave SW, verbatim from prod: 3 units, SFR + ADU + Existing.
    expect(formatProductTypes(['SFR', 'ADU', 'Existing'])).toBe('SFR, ADU, Existing');
    // ★ Comma-space, not the middot the Reuse column uses: there the middot
    // joins two DIFFERENT facts (address · notes); here it is one fact with
    // several values.
    expect(formatProductTypes(['SFR', 'ADU', 'Existing'])).not.toContain('·');
  });

  it('★★ an empty value is a BLANK, never a word', () => {
    // fix-269 settled this for reuseFromAddress: "the visible gap is what
    // prompts someone to fill it in". A word in the cell reads as an answer.
    expect(formatUnits(null)).toBe('');
    expect(formatProductTypes([])).toBe('');
    for (const out of [formatUnits(null), formatProductTypes([])]) {
      expect(out).not.toMatch(/unknown|n\/a|none|tbd/i);
    }
  });

  it('★★ zero units is a VALUE, not a gap', () => {
    // Zero means something different from "nobody has said yet", and a
    // formatter that conflated them would hide a real number.
    expect(formatUnits(0)).toBe('0');
    expect(formatUnits(1)).toBe('1');
  });

  it('★ blank entries inside the array do not become gaps in the list', () => {
    expect(formatProductTypes(['SFR', '', '  ', 'DADU'])).toBe('SFR, DADU');
  });
});

describe('fix-367 §2: the screen and the email carry the SAME columns', () => {
  /** The real email builder, with one row through it. */
  function email(r: VendorScheduleRow): string {
    return buildVendorEmailHtml({
      sections: { newRows: [r], changedRows: [], pipelineRows: [] },
      transmitted: [],
      corrections: [],
      vendorLabel: 'SSS Engineering',
      weekOf: '2026-08-24',
    });
  }

  const html = email(row());

  it('★★★ the EMAIL carries Units and Type — not just the page', () => {
    // "A column that exists on screen and not in the email is worse than
    // neither": it makes the two disagree about what was sent, and fix-269's
    // ledger already treats the email as what the consultant knows.
    expect(html).toContain('>Units<');
    expect(html).toContain('>Type<');
    // …with this project's real values in the body.
    expect(html).toContain('SFR, ADU, Existing');
    expect(html).toMatch(/>3</);
  });

  it('★★★ …and the screen declares exactly the same two headers', () => {
    expect(screenSrc).toMatch(/<th className=\{TH\}>Units<\/th>/);
    expect(screenSrc).toMatch(/<th className=\{TH\}>Type<\/th>/);
  });

  it('★★★ both call the SAME formatters — one definition, two surfaces', () => {
    // The structural half of "they must agree". Two implementations of
    // "how a product-type list reads" is how they drift.
    for (const src of [screenSrc, emailSrc]) {
      expect(src).toMatch(/formatUnits\(/);
      expect(src).toMatch(/formatProductTypes\(/);
    }
    expect(emailSrc).toMatch(/import \{ formatProductTypes, formatUnits \} from '\.\/vendorReport'/);
  });

  it('★★ an absent value renders the email\'s ordinary BLANK, not a word', () => {
    const blank = email(row({ units: null, productTypes: [] }));
    expect(blank).not.toMatch(/unknown/i);
    expect(blank).not.toMatch(/>n\/a</i);
    // ★ The same BLANK the Reuse column has used since fix-269 — one
    // convention, not a second one for the new columns.
    expect(blank).toContain('>Units<');
  });

  it('★ the email\'s column widths still add to 100', () => {
    // fix-274's invariant: every date column is 15% everywhere it appears, so
    // the three tables line up when read one after another. Two new columns
    // come out of Address, which is the column that flexes by design.
    const m = emailSrc.match(/const W_ADDRESS_SCHEDULE =\s*([\s\S]*?);/);
    expect(m).toBeTruthy();
    expect(m![1]).toContain('W_UNITS');
    expect(m![1]).toContain('W_PRODUCT_TYPES');
    // 100 - 15 - 13 - 6 - 12 - 15 - 18 = 21
    expect(emailSrc).toMatch(/const W_UNITS = 6;/);
    expect(emailSrc).toMatch(/const W_PRODUCT_TYPES = 12;/);
  });
});
