import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import {
  RIBBON_ENTRIES,
  allRibbonExternals,
  allRibbonRoutes,
  activeRibbonTarget,
  visibleChildren,
  visibleEntries,
  type RibbonEntry,
} from '../lib/ribbonNav';
import {
  DEFAULT_JURISDICTIONS,
  JURISDICTION_LINKS_KEY,
  NO_LINKS_YET,
  isSafeJurisdictionUrl,
  readJurisdictions,
} from '../lib/jurisdictionLinks';

// ===========================================================================
// ★★★ fix-485 §A (P-147) — THREE CAPTIONED SECTIONS AND A JURISDICTIONS FOLDER
// ===========================================================================
//
// Bobby, 2026-09-02: *"What's New, Settings, Error Triage go to the bottom.
// Category 1: Pipeline, Draw Schedule, My Board. Then the reporting features:
// Library and Reports. Then links: D&E Studio, and a drop-down of Seattle,
// Kirkland, Bellevue with folders inside that take you to their GIS, their
// code, whatever."*
//
// ★★ THE BRIEF'S HARDEST REQUIREMENT is not the layout — it is that
// `allRibbonRoutes()` and the per-role gates are **byte-identical in
// behaviour** afterwards. Both are pinned below against the values recorded on
// origin/main @ 85fc86c, not against the current implementation.

const T = 'test-tenant-uuid';

const appConfigMap = vi.hoisted(() => ({ current: new Map<string, unknown>() }));
vi.mock('../hooks/useAppConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useAppConfig')>();
  return { ...actual, useAppConfig: () => ({ map: appConfigMap.current }) };
});
vi.mock('../hooks/useErrorReports', () => ({
  useNewErrorCount: () => 0,
}));
vi.mock('../hooks/useWhatsNew', () => ({
  useWhatsNewEntries: () => ({ data: [] }),
  useWhatsNewReads: () => ({ data: [] }),
}));
vi.mock('../hooks/useAgendaMember', () => ({
  useIsAgendaMember: () => true,
}));
vi.mock('../hooks/useIsTenantAdmin', () => ({
  useIsTenantAdmin: () => true,
}));

import Ribbon from '../components/Ribbon';

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  appConfigMap.current = new Map<string, unknown>();
  useAuthStore.setState({
    activeTenantId: T,
    user: { id: 'u-1', email: 'u@test', role: 'admin' },
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
});

function renderRibbon() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Ribbon onAddProject={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Every entry's id, in order — links by route, the rest by their own id. */
function entryIds(entries: readonly RibbonEntry[] = RIBBON_ENTRIES): string[] {
  return entries.map((e) =>
    e.kind === 'link'
      ? e.link.to
      : e.kind === 'external'
        ? e.external.id
        : e.kind === 'group'
          ? e.group.id
          : e.id,
  );
}

// ---------------------------------------------------------------------------
// §A1 — the order
// ---------------------------------------------------------------------------
describe('fix-485 §A1: three sections + a pinned utility block', () => {
  it('★★★ the whole ribbon, in order, in one assertion', () => {
    // ★★★ SUPERSEDED BY fix-503 §A: `cap-*` → `div-*`, and `jurisdictions` →
    //     `cities`. The ORDER and the SECTIONS are byte-identical — this ticket
    //     removed three words and a folder wrapper, not a structure.
    expect(entryIds()).toEqual([
      'div-work',
      '/dashboard',
      '/draw-schedule',
      '/board',
      'div-reports',
      '/library',
      'reports',
      'div-links',
      'sharepoint',
      'cities',
      'util',
      '/whats-new',
      '/settings',
      '/settings/errors',
    ]);
  });

  it('★★★ SUPERSEDED BY fix-503 §A: the three sections carry NO words at all', () => {
    // ★★★ THIS ASSERTION IS INVERTED, AND IT IS THE TICKET. It read: "the three
    //     captions carry Bobby's three words" — Work, Reports, Links. Bobby,
    //     2026-09-04: *"we want to get rid of the categorical titles. So we want
    //     to get rid of links, reports, and more on that ribbon as well."*
    //     Ruled by popup to thin divider lines where the captions were.
    //
    // ★★ The three are still THREE, in the same three places. A divider has no
    //    `label` field at all, so the words cannot come back by accident —
    //    structural, the way fix-485 made these kinds ungatable.
    const dividers = RIBBON_ENTRIES.filter((e) => e.kind === 'divider');
    expect(dividers.map((d) => (d.kind === 'divider' ? d.id : ''))).toEqual([
      'div-work',
      'div-reports',
      'div-links',
    ]);
    for (const d of dividers) {
      expect(d).not.toHaveProperty('label');
    }
  });

  it('★★★ there are NO separators left — captions and the spacer draw the rules', () => {
    expect(entryIds().some((id) => id.startsWith('sep-'))).toBe(false);
  });

  it('★★★ the utility block is EVERYTHING AFTER the spacer, and it is the three', () => {
    const ids = entryIds();
    expect(ids.slice(ids.indexOf('util') + 1)).toEqual([
      '/whats-new',
      '/settings',
      '/settings/errors',
    ]);
  });

  it('★★★ SUPERSEDED BY fix-503 §A: a divider is the RULE, with no text', () => {
    // ★★★ It asserted the mock v9 `.cat` treatment — 8.5px / 800 / uppercase /
    //     .08em — on a label that no longer exists.
    // ★★ WHAT SURVIVES UNCHANGED is the half that carried the meaning: the same
    //    1px `var(--color-s3)`, the same first-entry exception (a hairline
    //    directly under the brand block reads as a mistake).
    renderRibbon();
    const work = screen.getByTestId('ribbon-divider-div-work');
    const reports = screen.getByTestId('ribbon-divider-div-reports');
    expect(work.textContent).toBe('');
    expect(reports.textContent).toBe('');
    expect(work.style.borderTop).toBe('');
    expect(reports.style.borderTop).toContain('1px');
    expect(reports.style.borderTop).toContain('var(--color-s3)');
  });

  it('★★★ NOT ONE of the three words is left anywhere in the ribbon chrome', () => {
    // ★★ "Reports" survives as the GROUP's own label and "Links" must not — the
    //    guard is against the CAPTIONS, so it checks the divider elements and
    //    the absence of any `ribbon-caption-*` node rather than the whole tree.
    const { container } = renderRibbon();
    expect(container.querySelectorAll('[data-testid^="ribbon-caption-"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid^="ribbon-divider-"]')).toHaveLength(3);
    // ★ The one word that legitimately remains is the Reports GROUP toggle,
    //   which Bobby did not ask to remove — it names a destination, not a
    //   category of the ribbon.
    expect(screen.getByTestId('ribbon-group-toggle-reports').textContent).toContain(
      'Reports',
    );
  });

  it('★★ the spacer pushes, and carries the utility block\'s own rule', () => {
    renderRibbon();
    const spacer = screen.getByTestId('ribbon-spacer-util');
    expect(spacer.className).toContain('flex-1');
    expect(spacer.style.borderBottom).toContain('1px');
    // ★ …and the nav is a flex column, or `flex-1` pushes nothing.
    expect(screen.getByTestId('ribbon-nav').className).toContain('flex-col');
  });
});

// ---------------------------------------------------------------------------
// §A1 — THE PIN THE BRIEF ASKED FOR
// ---------------------------------------------------------------------------
describe('fix-485 §A1: routes and gates are byte-identical', () => {
  /** Recorded on origin/main @ 85fc86c, before this ticket touched anything. */
  const ROUTES_BEFORE = [
    '/dashboard',
    '/draw-schedule',
    '/board',
    '/library',
    '/reports',
    '/projects',
    '/agenda',
    '/reports/saved',
    '/whats-new',
    '/settings',
    '/settings/errors',
  ];

  it('★★★ `allRibbonRoutes()` is UNCHANGED — the same set, the same order', () => {
    // ★★★ Captions, the spacer and the jurisdictions folder contribute nothing,
    //     structurally: none of the three carries a `to` anywhere in its shape,
    //     and `allRibbonRoutes` walks links and group children only.
    expect(allRibbonRoutes()).toEqual(ROUTES_BEFORE);
  });

  it('★★★ per-role visibility is UNCHANGED, for all four viewers', () => {
    const routesFor = (isAdmin: boolean, isMember: boolean) =>
      visibleEntries(isAdmin, isMember).flatMap((e) =>
        e.kind === 'link'
          ? [e.link.to]
          : e.kind === 'group'
            ? e.group.children.map((c) => c.to)
            : [],
      );
    // admin — everything
    expect(routesFor(true, false)).toEqual(ROUTES_BEFORE);
    expect(routesFor(true, true)).toEqual(ROUTES_BEFORE);
    // ★ non-admin: Project View survives (fix-331 §8's 23-of-29 measurement),
    //   Agenda only for a member (fix-462, moved under Reports by fix-483 §C).
    expect(routesFor(false, false)).toEqual([
      '/dashboard',
      '/draw-schedule',
      '/board',
      '/library',
      '/projects',
      '/whats-new',
      '/settings',
    ]);
    expect(routesFor(false, true)).toEqual([
      '/dashboard',
      '/draw-schedule',
      '/board',
      '/library',
      '/projects',
      '/agenda',
      '/whats-new',
      '/settings',
    ]);
  });

  it('★★★ the new kinds fall through UNGATED, like the externals', () => {
    for (const [admin, member] of [
      [false, false],
      [false, true],
      [true, false],
    ] as const) {
      const ids = entryIds(visibleEntries(admin, member));
      for (const id of ['div-work', 'div-reports', 'div-links', 'util', 'cities']) {
        expect(ids, `${id} for admin=${admin} member=${member}`).toContain(id);
      }
    }
  });

  it('★★ `visibleChildren` still answers exactly what it did', () => {
    const reports = RIBBON_ENTRIES.find(
      (e) => e.kind === 'group' && e.group.id === 'reports',
    );
    const group = reports!.kind === 'group' ? reports!.group : null!;
    expect(visibleChildren(group, false).map((c) => c.to)).toEqual(['/projects']);
    expect(visibleChildren(group, false, true).map((c) => c.to)).toEqual([
      '/projects',
      '/agenda',
    ]);
    expect(visibleChildren(group, true).map((c) => c.to)).toHaveLength(4);
  });

  it('★★ nothing new can claim to be the current page', () => {
    // ★ `activeRibbonTarget` considers links and group children only. A divider,
    //   a spacer and a city's GIS are never "where you are".
    for (const p of ['/dashboard', '/library', '/agenda', '/settings/errors']) {
      expect(activeRibbonTarget(p)).toBe(p);
    }
    expect(activeRibbonTarget('/nowhere')).toBeNull();
  });

  it('★ the studio external is untouched — fix-483 §C\'s rename included', () => {
    const sp = allRibbonExternals().find((e) => e.id === 'sharepoint')!;
    expect(sp.label).toBe('D&E Studio');
    expect(allRibbonExternals()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// §A2 / §A3 — Jurisdictions
// ---------------------------------------------------------------------------
// ★★★ fix-503 §A: THE FOLDER IS GONE AND THE CITIES ARE ROWS. Every assertion
//     below kept its subject — the seeded three, the empty state, the external
//     treatment, the persisted open state — and lost one click: there is no
//     "◎ Jurisdictions ▾" toggle to open first.
describe('fix-485 §A2 → fix-503 §A: the cities are ribbon rows', () => {
  it('★★★ SUPERSEDED: the three cities are ALWAYS listed, not behind a folder', () => {
    // ★★★ It asserted `ribbon-jurisdiction-cities` was absent until the folder
    //     was opened. Bobby: *"can we remove jurisdictions, and just make the
    //     jurisdictions present but slightly indented with a carrot."* Present
    //     is the word: the rows are there on arrival.
    renderRibbon();
    expect(screen.queryByTestId('ribbon-jurisdictions-toggle')).toBeNull();
    for (const c of ['Seattle', 'Kirkland', 'Bellevue']) {
      expect(screen.getByTestId(`ribbon-jurisdiction-${c}`)).toBeInTheDocument();
      // ★ Bobby's "carrot", closed.
      expect(screen.getByTestId(`ribbon-jurisdiction-caret-${c}`).textContent).toBe('▾');
    }
    // ★★ …and their links are NOT, until a city is opened.
    expect(screen.queryByTestId('ribbon-jurisdiction-links-Seattle')).toBeNull();
  });

  it('★★★ a city with NO links says so, and offers nothing to click', () => {
    // ★★ The state all three ship in: Bobby named the cities and has not given
    //    the URLs, so none were invented. This is what that renders.
    renderRibbon();
    fireEvent.click(screen.getByTestId('ribbon-jurisdiction-toggle-Seattle'));
    const empty = screen.getByTestId('ribbon-jurisdiction-empty-Seattle');
    expect(empty.textContent).toBe(NO_LINKS_YET);
    expect(
      screen.getByTestId('ribbon-jurisdiction-links-Seattle').querySelectorAll('a'),
    ).toHaveLength(0);
    // ★ The caret flips when it opens.
    expect(screen.getByTestId('ribbon-jurisdiction-caret-Seattle').textContent).toBe('▴');
  });

  it('★★★ a city WITH links renders them as externals, in a new tab', () => {
    appConfigMap.current = new Map<string, unknown>([
      [
        JURISDICTION_LINKS_KEY,
        [
          {
            city: 'Seattle',
            links: [
              { label: 'GIS', url: 'https://gis.example.gov/seattle' },
              { label: 'Code', url: 'https://code.example.gov/seattle' },
            ],
          },
        ],
      ],
    ]);
    renderRibbon();
    fireEvent.click(screen.getByTestId('ribbon-jurisdiction-toggle-Seattle'));
    const gis = screen.getByTestId('ribbon-jurisdiction-link-Seattle-GIS');
    expect(gis.getAttribute('href')).toBe('https://gis.example.gov/seattle');
    expect(gis.getAttribute('target')).toBe('_blank');
    // ★ `noopener` — an external the app hands over to must not get a handle on
    //   the window it came from.
    expect(gis.getAttribute('rel')).toContain('noopener');
  });

  it('★★★ SUPERSEDED: cities open INDEPENDENTLY, and each one is remembered', () => {
    // ★★★ TWO RULINGS INVERTED, and both were the folder's doing. fix-485 kept
    //     ONE city open at a time and forgot which on reload, on the reasoning
    //     that "a browse is not a workspace" and the FOLDER was the thing worth
    //     remembering. With the folder gone the cities ARE the ribbon's rows,
    //     and the brief asks for exactly this: open state per city, persisted
    //     "the way `openGroups` does today".
    //
    // ★★ Still ONE memory, not a second that could disagree: the ids are
    //    `juris-<city>` inside the same `openGroups` list the Reports group uses.
    const first = renderRibbon();
    fireEvent.click(screen.getByTestId('ribbon-jurisdiction-toggle-Seattle'));
    fireEvent.click(screen.getByTestId('ribbon-jurisdiction-toggle-Kirkland'));
    expect(screen.getByTestId('ribbon-jurisdiction-links-Seattle')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-jurisdiction-links-Kirkland')).toBeInTheDocument();
    first.unmount();

    renderRibbon();
    // ★ Both survive the remount — that is the persistence, and it is the same
    //   store the Reports group writes to.
    expect(screen.getByTestId('ribbon-jurisdiction-links-Seattle')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-jurisdiction-links-Kirkland')).toBeInTheDocument();
  });
});

describe('fix-485 §A3: the registry', () => {
  it('★★★ an unwritten key falls back to the three cities, with no links', () => {
    expect(readJurisdictions(new Map())).toEqual([...DEFAULT_JURISDICTIONS]);
    expect(DEFAULT_JURISDICTIONS.every((c) => c.links.length === 0)).toBe(true);
  });

  it('★★★ …but an EMPTY ARRAY is respected — clearing the list is possible', () => {
    // ★ The trap in a "fall back to defaults" reader: re-seeding on empty makes
    //   the delete impossible and the control lies about what it did.
    expect(readJurisdictions(new Map([[JURISDICTION_LINKS_KEY, []]]))).toEqual([]);
  });

  it('★★★ it decodes FIELD BY FIELD — one bad row costs that row', () => {
    const map = new Map<string, unknown>([
      [
        JURISDICTION_LINKS_KEY,
        [
          null,
          'nonsense',
          { city: '   ' }, // no name
          { city: 'Seattle', links: 'not an array' },
          {
            city: 'Kirkland',
            links: [
              { label: 'GIS', url: 'https://ok.example.gov' },
              { label: '', url: 'https://ok.example.gov' }, // no label
              { label: 'Bad', url: 'javascript:alert(1)' }, // not http(s)
              { label: 'Rel', url: '/local/path' }, // not absolute
            ],
          },
        ],
      ],
    ]);
    expect(readJurisdictions(map)).toEqual([
      { city: 'Seattle', links: [] },
      { city: 'Kirkland', links: [{ label: 'GIS', url: 'https://ok.example.gov' }] },
    ]);
  });

  it('★★★ only http(s) is a link — the fix-387 finding, other end', () => {
    // *"starts with /" is not a safe URL rule* — pointed at an href this time.
    // A stored value is hand-typed in Settings and reaches an anchor.
    expect(isSafeJurisdictionUrl('https://example.gov')).toBe(true);
    expect(isSafeJurisdictionUrl('http://example.gov')).toBe(true);
    expect(isSafeJurisdictionUrl(' https://example.gov ')).toBe(true);
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,<script>',
      '//evil.example.com',
      '/local',
      'example.gov',
      '',
      null,
      42,
    ]) {
      expect(isSafeJurisdictionUrl(bad), String(bad)).toBe(false);
    }
  });

  it('★★ the seed migration writes exactly the three cities, with no links', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'migrations/fix_485_seed_jurisdiction_links.sql'),
      'utf8',
    );
    const code = sql
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    expect(code).toContain('"city":"Seattle","links":[]');
    expect(code).toContain('"city":"Kirkland","links":[]');
    expect(code).toContain('"city":"Bellevue","links":[]');
    // ★★ NOT an upsert: re-running must not flatten links somebody added.
    expect(code).toContain('where not exists');
    expect(code.toLowerCase()).not.toContain('on conflict');
    // ★ The tenant is READ, not typed — app_config.tenant_id is NOT NULL with
    //   no default, and a typo'd uuid would create an orphan row.
    expect(code).toContain('select distinct c.tenant_id');
    expect(code).not.toMatch(/'[0-9a-f]{8}-[0-9a-f]{4}-/);
    // ★★★ AND NO URL IS INVENTED, anywhere in the file.
    expect(code).not.toContain('http');
  });
});
