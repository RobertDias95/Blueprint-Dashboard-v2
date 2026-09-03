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
describe('fix-485 §A1: three captioned sections + a pinned utility block', () => {
  it('★★★ the whole ribbon, in order, in one assertion', () => {
    expect(entryIds()).toEqual([
      'cap-work',
      '/dashboard',
      '/draw-schedule',
      '/board',
      'cap-reports',
      '/library',
      'reports',
      'cap-links',
      'sharepoint',
      'jurisdictions',
      'util',
      '/whats-new',
      '/settings',
      '/settings/errors',
    ]);
  });

  it('★★★ the three captions carry Bobby\'s three words', () => {
    const captions = RIBBON_ENTRIES.filter((e) => e.kind === 'caption');
    expect(captions.map((c) => (c.kind === 'caption' ? c.label : ''))).toEqual([
      'Work',
      'Reports',
      'Links',
    ]);
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

  it('★★ the captions render at the mock\'s treatment, and the first draws no rule', () => {
    renderRibbon();
    const work = screen.getByTestId('ribbon-caption-cap-work');
    const reports = screen.getByTestId('ribbon-caption-cap-reports');
    expect(work.textContent).toBe('Work');
    // ★ 8.5px / 800 / uppercase / .08em, mock v9's `.cat`.
    const label = work.querySelector('div') as HTMLElement;
    expect(label.style.fontSize).toBe('8.5px');
    expect(label.style.fontWeight).toBe('800');
    expect(label.style.letterSpacing).toBe('0.08em');
    expect(label.style.color).toBe('var(--color-dim)');
    // ★★ The FIRST caption draws no rule — a hairline directly under the brand
    //    block reads as a mistake — and every later one does.
    expect(work.style.borderTop).toBe('');
    expect(reports.style.borderTop).toContain('1px');
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
      for (const id of ['cap-work', 'cap-reports', 'cap-links', 'util', 'jurisdictions']) {
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
    // ★ `activeRibbonTarget` considers links and group children only. A caption,
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
describe('fix-485 §A2: the Jurisdictions folder', () => {
  it('★★★ collapsed by default; opening it lists the seeded three', () => {
    renderRibbon();
    expect(screen.queryByTestId('ribbon-jurisdiction-cities')).toBeNull();
    fireEvent.click(screen.getByTestId('ribbon-jurisdictions-toggle'));
    for (const c of ['Seattle', 'Kirkland', 'Bellevue']) {
      expect(screen.getByTestId(`ribbon-jurisdiction-${c}`)).toBeInTheDocument();
    }
  });

  it('★★★ a city with NO links says so, and offers nothing to click', () => {
    // ★★ The state all three ship in: Bobby named the cities and has not given
    //    the URLs, so none were invented. This is what that renders.
    renderRibbon();
    fireEvent.click(screen.getByTestId('ribbon-jurisdictions-toggle'));
    fireEvent.click(screen.getByTestId('ribbon-jurisdiction-toggle-Seattle'));
    const empty = screen.getByTestId('ribbon-jurisdiction-empty-Seattle');
    expect(empty.textContent).toBe(NO_LINKS_YET);
    expect(
      screen.getByTestId('ribbon-jurisdiction-links-Seattle').querySelectorAll('a'),
    ).toHaveLength(0);
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
    fireEvent.click(screen.getByTestId('ribbon-jurisdictions-toggle'));
    fireEvent.click(screen.getByTestId('ribbon-jurisdiction-toggle-Seattle'));
    const gis = screen.getByTestId('ribbon-jurisdiction-link-Seattle-GIS');
    expect(gis.getAttribute('href')).toBe('https://gis.example.gov/seattle');
    expect(gis.getAttribute('target')).toBe('_blank');
    // ★ `noopener` — an external the app hands over to must not get a handle on
    //   the window it came from.
    expect(gis.getAttribute('rel')).toContain('noopener');
  });

  it('★★ one city expands at a time, and the folder\'s own state persists', () => {
    // ★ The FOLDER shares `openGroups` with the Reports group — one memory of
    //   what is open, not a second that could disagree. Which CITY is expanded
    //   is local: a browse, not a workspace.
    const first = renderRibbon();
    fireEvent.click(screen.getByTestId('ribbon-jurisdictions-toggle'));
    fireEvent.click(screen.getByTestId('ribbon-jurisdiction-toggle-Seattle'));
    expect(screen.getByTestId('ribbon-jurisdiction-links-Seattle')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ribbon-jurisdiction-toggle-Kirkland'));
    expect(screen.queryByTestId('ribbon-jurisdiction-links-Seattle')).toBeNull();
    expect(screen.getByTestId('ribbon-jurisdiction-links-Kirkland')).toBeInTheDocument();
    first.unmount();

    renderRibbon();
    // The folder is still open…
    expect(screen.getByTestId('ribbon-jurisdiction-cities')).toBeInTheDocument();
    // …and no city is.
    expect(screen.queryByTestId('ribbon-jurisdiction-links-Kirkland')).toBeNull();
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
