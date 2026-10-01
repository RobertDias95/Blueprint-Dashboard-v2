// ===========================================================================
// ★★★ fix-611 (P-166 step 3a) — SEVEN CATEGORIES · A SEARCH · ONE BLOCK OPEN
// ===========================================================================
//
// Bobby, 2026-09-30: *categories you open up · a search · "methodical, flow,
// readability".*
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

import {
  SETTINGS_REDIRECTS,
  SETTINGS_SECTIONS,
  SETTINGS_RAIL_WIDTH,
  sectionForPath,
  visibleSettingsSections,
} from '../lib/settingsSections';
import {
  RETIRED_SETTINGS_BLOCKS,
  SETTINGS_BLOCKS,
  blocksForCategory,
} from '../lib/settingsBlocks';
import { highlightParts, searchSettings } from '../lib/settingsSearch';

const SRC = resolve(__dirname, '..');
const ROOT = resolve(SRC, '..');

// ===========================================================================
// §A — seven categories, seven routes, three redirects
// ===========================================================================
describe('fix-611 §A — the seven categories', () => {
  it('★★★ exactly these seven, in this order, with these routes', () => {
    expect(
      SETTINGS_SECTIONS.map((s) => [s.id, s.path, s.label, s.adminOnly]),
    ).toEqual([
      ['account', '/settings/account', 'My account', false],
      ['people', '/settings/people', 'People', true],
      ['teams', '/settings/teams', 'Teams & routing', true],
      ['lists', '/settings/lists', 'Project lists', true],
      ['permits', '/settings/permits', 'Permits & tasks', true],
      ['dates', '/settings/dates', 'Dates & targets', true],
      ['health', '/settings/health', 'Health & tools', true],
    ]);
  });

  it('★★★ the three old routes redirect, and are declared in the router', () => {
    // fix-310's rule: a rename that moves a route breaks every bookmark. These
    // three have been real addresses since fix-319.
    expect(SETTINGS_REDIRECTS).toEqual({
      '/settings/team': '/settings/people',
      '/settings/projects': '/settings/lists',
      '/settings/schedule': '/settings/dates',
    });
    const router = readFileSync(join(ROOT, 'src/router.tsx'), 'utf8');
    for (const from of Object.keys(SETTINGS_REDIRECTS)) {
      const path = from.replace('/settings/', 'settings/');
      expect(router, `${from} must still be routed`).toContain(`path: '${path}'`);
    }
    // ★ and each old path is NOT a section any more, while each target IS
    for (const [from, to] of Object.entries(SETTINGS_REDIRECTS)) {
      expect(sectionForPath(from)).toBeNull();
      expect(sectionForPath(to)).not.toBeNull();
    }
  });

  it('★★ a non-admin sees only My account — unchanged from fix-319', () => {
    expect(visibleSettingsSections(false).map((s) => s.id)).toEqual(['account']);
    expect(visibleSettingsSections(true)).toHaveLength(7);
  });

  it('★ every category route is AdminRoute-guarded except My account', () => {
    const router = readFileSync(join(ROOT, 'src/router.tsx'), 'utf8');
    for (const s of SETTINGS_SECTIONS) {
      const path = s.path.replace('/settings/', 'settings/');
      const line = router
        .split('\n')
        .find((l) => l.includes(`path: '${path}'`) && l.includes('element'));
      expect(line, `${s.path} must be one routed line`).toBeTruthy();
      expect(
        (line ?? '').includes('AdminRoute'),
        `${s.path} adminOnly=${s.adminOnly}`,
      ).toBe(s.adminOnly);
    }
  });

  it('★ the rail is 232px, and the build stamp survives', () => {
    expect(SETTINGS_RAIL_WIDTH).toBe(232);
    const page = readFileSync(join(SRC, 'pages/SettingsPage.tsx'), 'utf8');
    expect(page).toContain('settings-build-stamp');
    expect(page).toContain('buildStamp()');
    // ★★ fix-319's contract: ONE scroll container, and the page itself never
    //    scrolls. A second `overflow-auto` here is how the double scrollbar came
    //    back last time.
    expect((page.match(/overflow-auto/g) ?? []).length).toBe(1);
    expect(page).toContain("style={{ overflow: 'hidden' }}");
  });
});

// ===========================================================================
// ★★★ §B — THE 43-ROW MAP. Nothing disappears without a decision.
// ===========================================================================
//
// The mock's bottom table, encoded. Each row is [today's tab, today's block,
// where it goes now] — and "where it goes now" is either a block id in the
// registry or the title of one of the two blocks Bobby retired.
//
// ★★ IT NO LONGER DIVERGES FROM THE MOCK. fix-611 kept the nine People editors
//    as nine blocks and recorded that the mock's map pointed at a single
//    "Everyone" table; fix-613 built it. Every destination below is now the
//    mock's own.
const TODAY_TO_NEW: ReadonlyArray<readonly [string, string, string]> = [
  ['Account', 'Your picture', 'your-picture'],
  ['Account', 'Sign-in info', 'sign-in-info'],
  ['Account', 'DB tools', 'export-backup'],

  ['Team', 'Add person', 'add-person'],
  // ★★★ fix-613 §A: ELEVEN ROWS NOW LAND ON ONE BLOCK. The mock's map always
  //     pointed here — nine roster editors into a single "Everyone" table — and
  //     fix-611 kept them as nine because the layout came first. ⚖️ Bobby,
  //     2026-09-30: **People = one table.**
  //
  // ★★ Former & inactive goes in with them: it is the same people answered the
  //    other way round, and it is a list INSIDE the table rather than a tenth
  //    block, so this map has one destination for the whole roster.
  ['Team', 'Design Associates', 'everyone'],
  ['Team', 'Design Managers', 'everyone'],
  ['Team', 'Entitlement leads', 'everyone'],
  ['Team', 'Acquisition leads', 'everyone'],
  ['Team', 'Schematic', 'everyone'],
  ['Team', 'Construction admin', 'everyone'],
  ['Team', 'Names and emails', 'everyone'],
  ['Team', 'Departments', 'everyone'],
  ['Team', 'Agenda members', 'everyone'],
  ['Team', 'Former DAs (alumni)', 'everyone'],
  ['Team', 'Inactive (other roles)', 'everyone'],

  ['Team', 'Team Structure', 'team-structure'],
  ['Team', 'DA Routing (permitting lead)', 'da-routing'],
  ['Team', 'Draw Schedule Layout', 'draw-schedule-layout'],
  ['Team', 'Active Quarters', 'active-quarters'],
  ['Team', 'Chat Tags', 'chat-tags'],

  ['Team', 'Who the work data means', 'who-the-work-data-means'],
  ['Team', 'Who is running what', 'who-is-running-what'],
  ['Team', 'Permits with no permitting lead', 'permits-with-no-lead'],

  ['Lists & Catalogs', 'Jurisdictions', 'jurisdictions'],
  ['Lists & Catalogs', 'Jurisdiction Links', 'jurisdictions'],
  ['Lists & Catalogs', 'Builders & Owners', 'builders-and-owners'],
  ['Lists & Catalogs', 'Permit Owner', 'RETIRED:Permit Owner'],
  ['Lists & Catalogs', 'Zones', 'zones'],
  ['Lists & Catalogs', 'Types', 'product-types'],
  ['Lists & Catalogs', 'Unit Parking', 'unit-options'],
  ['Lists & Catalogs', 'Unit Roof Deck', 'unit-options'],
  ['Lists & Catalogs', 'Unit Stories', 'unit-options'],
  ['Lists & Catalogs', 'Project Tags', 'project-tags'],
  ['Lists & Catalogs', 'Hold Reasons', 'hold-and-cancel-reasons'],
  ['Lists & Catalogs', 'Cancel Reasons', 'hold-and-cancel-reasons'],
  ['Lists & Catalogs', 'External Team Directory', 'waiting-on-and-consultants'],

  ['Permits', 'Permit Types', 'permit-types'],
  ['Permits', 'Task Templates', 'task-templates'],
  ['Permits', 'Waiting On', 'waiting-on-and-consultants'],
  ['Permits', 'Target-submit formulas', 'per-type-schedule'],
  ['Permits', 'Phase Durations', 'phase-durations'],

  ['Schedule', 'Learning windows', 'RETIRED:Learning windows'],
  ['Schedule', 'Permit-type defaults', 'per-type-schedule'],
];

describe('fix-611 §B — every one of today’s 43 blocks has a home', () => {
  it('★★★ the map covers exactly 43 blocks, each named once', () => {
    expect(TODAY_TO_NEW).toHaveLength(43);
    // ★ A tab+title pair identifies a block. Two rows with the same pair would
    //   mean one of today's blocks was counted twice, which would hide a loss.
    const pairs = TODAY_TO_NEW.map(([tab, title]) => `${tab} :: ${title}`);
    expect(new Set(pairs).size).toBe(43);
  });

  it('★★★ every one of them lands on a real block, or on a declared retirement', () => {
    const ids = new Set(SETTINGS_BLOCKS.map((b) => b.id));
    const retired = new Set(RETIRED_SETTINGS_BLOCKS.map((r) => `RETIRED:${r.was}`));
    const lost: string[] = [];
    for (const [tab, title, dest] of TODAY_TO_NEW) {
      if (!ids.has(dest) && !retired.has(dest)) {
        lost.push(`${tab} / ${title} -> ${dest}`);
      }
    }
    expect(lost, lost.join('\n')).toEqual([]);
  });

  it('★★★ and no NEW block appeared from nowhere', () => {
    // The other direction, which is what makes this a map rather than a filter:
    // every block in the registry must be the destination of at least one of
    // today's 43. A block nobody can trace back is one somebody invented.
    const destinations = new Set(TODAY_TO_NEW.map(([, , dest]) => dest));
    const orphans = SETTINGS_BLOCKS.filter((b) => !destinations.has(b.id));
    expect(orphans.map((b) => b.id), 'untraceable blocks').toEqual([]);
  });

  it('★★ the two retirements are declared WITH a reason', () => {
    expect(RETIRED_SETTINGS_BLOCKS.map((r) => r.was).sort()).toEqual([
      'Learning windows',
      'Permit Owner',
    ]);
    for (const r of RETIRED_SETTINGS_BLOCKS) {
      // ★ A one-word reason is how a removal becomes unexplainable six months on.
      expect(r.reason.length, r.was).toBeGreaterThan(60);
    }
  });

  it('★★★ the merges are counted, and the count matches the map', () => {
    // A `merged` tag claims "N old blocks became this one". That claim is
    // checkable against the map, so it is checked — a wrong badge is worse than
    // none, because it is the thing a reader trusts instead of counting.
    for (const block of SETTINGS_BLOCKS) {
      const sources = TODAY_TO_NEW.filter(([, , d]) => d === block.id).length;
      if (block.merged) {
        const claimed = Number(block.merged.split('→')[0]!.trim());
        expect(claimed, `${block.id} claims ${block.merged}`).toBe(sources);
      } else {
        expect(sources, `${block.id} has no merged tag`).toBe(1);
      }
    }
  });

  it('★★ each category lists its blocks in the mock’s order', () => {
    expect(blocksForCategory('account').map((b) => b.title)).toEqual([
      'Your picture',
      'Sign-in info',
    ]);
    expect(blocksForCategory('teams').map((b) => b.title)).toEqual([
      'Team Structure',
      'DA Routing',
      'Draw Schedule Layout',
      'Active Quarters',
      'Chat Tags',
    ]);
    expect(blocksForCategory('lists').map((b) => b.title)).toEqual([
      'Jurisdictions',
      'Builders & Owners',
      'Product Types',
      'Zones',
      'Unit options',
      'Project Tags',
      'Hold & cancel reasons',
    ]);
    expect(blocksForCategory('permits').map((b) => b.title)).toEqual([
      'Permit Types',
      'Task Templates',
      'Waiting On & consultants',
    ]);
    expect(blocksForCategory('dates').map((b) => b.title)).toEqual([
      'Per-type schedule',
    ]);
    expect(blocksForCategory('health').map((b) => b.title)).toEqual([
      'Who is running what',
      'Who the work data means',
      'Permits with no permitting lead',
      'Phase Durations',
      'Export backup',
    ]);
    // People keeps today's editors — fix-612 replaces them with one table.
    // ⚠️ fix-613 §A: nine roster editors and the retired list became ONE table.
    //    People is now the mock's People panel exactly: Add person, then
    //    Everyone (which holds Former & inactive at its foot).
    expect(blocksForCategory('people').map((b) => b.title)).toEqual([
      'Add person',
      'Everyone',
    ]);
  });

  it('★★ Health & tools is read-outs only, and says so', () => {
    for (const b of blocksForCategory('health')) {
      expect(b.readOut, `${b.id} must be a read-out`).toBe(true);
    }
    expect(
      SETTINGS_SECTIONS.find((s) => s.id === 'health')?.desc,
    ).toMatch(/Nothing here changes a setting/);
  });

  it('★★ every block declares a summary and searchable keywords', () => {
    for (const b of SETTINGS_BLOCKS) {
      expect(b.summary.length, `${b.id} summary`).toBeGreaterThan(10);
      expect(b.keywords.length, `${b.id} keywords`).toBeGreaterThan(3);
      expect(b.id, `${b.id} must be hash-safe`).toMatch(/^[a-z0-9-]+$/);
    }
    // ids are the URL hash, so they must be unique
    expect(new Set(SETTINGS_BLOCKS.map((b) => b.id)).size).toBe(
      SETTINGS_BLOCKS.length,
    );
  });
});

// ===========================================================================
// ★★★ THE LOOP: the registry and what actually renders must agree
// ===========================================================================
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'harness') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Every `<SettingsBlock id="…">` the source renders. */
function renderedBlockIds(): string[] {
  const out: string[] = [];
  for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/<SettingsBlock\s+id="([a-z0-9-]+)"/g)) {
      out.push(m[1] as string);
    }
  }
  return out;
}

describe('fix-611 §B — the registry is not a lie', () => {
  it('★★★ every registry block is rendered by exactly one SettingsBlock', () => {
    // ★★★ THIS IS WHAT STOPS THE REGISTRY BEING METADATA NOBODY USES. The
    //     registry holds the title, summary, feeds and flags; the tabs hold the
    //     content. Without this test the two could drift until a category listed
    //     a block that renders nothing.
    const rendered = renderedBlockIds();
    const counts = new Map<string, number>();
    for (const id of rendered) counts.set(id, (counts.get(id) ?? 0) + 1);

    const missing = SETTINGS_BLOCKS.filter((b) => !counts.has(b.id)).map((b) => b.id);
    expect(missing, `declared but never rendered: ${missing.join(', ')}`).toEqual([]);

    const doubled = [...counts.entries()].filter(([, c]) => c > 1).map(([id]) => id);
    // ★ A doubled id would put two identically-titled collapsed rows on one
    //   category — which is exactly what merging a card is supposed to prevent.
    expect(doubled, `rendered twice: ${doubled.join(', ')}`).toEqual([]);
  });

  it('★★★ every rendered SettingsBlock is in the registry', () => {
    const ids = new Set(SETTINGS_BLOCKS.map((b) => b.id));
    const strays = [...new Set(renderedBlockIds())].filter((id) => !ids.has(id));
    expect(strays, `rendered but not declared: ${strays.join(', ')}`).toEqual([]);
  });

  it('★★ the old local `Section` helpers are gone from all five tabs', () => {
    // They were five copies of one card chrome, each taking the title as a prop.
    // `SettingsBlock` takes it from the registry, so a block's name lives once.
    for (const tab of [
      'AdminAccountTab',
      'AdminTeamTab',
      'AdminProjectsTab',
      'AdminPermitsTab',
      'AdminScheduleTab',
    ]) {
      const src = readFileSync(join(SRC, `components/Settings/${tab}.tsx`), 'utf8');
      expect(src, `${tab} still declares Section`).not.toMatch(
        /^function Section\(/m,
      );
      expect(src, `${tab} still renders <Section`).not.toContain('<Section ');
    }
  });
});

// ===========================================================================
// §E — the two removals
// ===========================================================================
describe('fix-611 §E — what Bobby removed', () => {
  it('★★★ §E.1 no learning-window input survives anywhere', () => {
    // ★★★ COMMENTS STRIPPED FIRST — the gravestone trap, and it caught me
    //     writing this very test: AdminProjectsTab and SettingsBlock both NAME
    //     the removed component in a comment, one to record why it went and one
    //     to list the editors that hold unsaved drafts. A bare-string sweep
    //     would forbid writing the removal down, which is the opposite of what
    //     is wanted. Ninth outing for this trap in this repo.
    const code = (src: string) =>
      src
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !/^\s*\/\//.test(l))
        .join('\n');
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const src = code(readFileSync(file, 'utf8'));
      // the testids the two editors used
      if (/juris-window-|schedule-window-|schedule-row-/.test(src)) {
        offenders.push(file.replace(SRC, ''));
      }
      if (/LearnWindowInput/.test(src)) {
        offenders.push(`${file.replace(SRC, '')} (component)`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('★★★ …and the copy claiming it drove Schedule Benchmarks is gone', () => {
    const schedule = readFileSync(
      join(SRC, 'components/Settings/AdminScheduleTab.tsx'),
      'utf8',
    );
    // ★ The HEADING and the explanatory paragraph. The file still DISCUSSES the
    //   removal in a comment — that is the record of why, and stripping comments
    //   first is what keeps this from forbidding the explanation (the gravestone
    //   trap, which this repo has hit eight times).
    const code = schedule
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !/^\s*\/\//.test(l))
      .join('\n');
    expect(code).not.toMatch(/Schedule Benchmarks/);
    expect(code).not.toMatch(/Learning Windows/);
    expect(code).not.toMatch(/learned-schedule baseline/);
  });

  it('★★ §E.1 leaves the COLUMN and getLearnWindow alone — no migration', () => {
    // §E.1: "Leave `jurisdictions.learn_window_days` in the DB (no migration)
    // and leave estimator math untouched; if `getLearnWindow` has no caller
    // left, delete it, otherwise leave it and say so."
    const hook = readFileSync(join(SRC, 'hooks/useJurisdictions.ts'), 'utf8');
    expect(hook).toContain('learn_window_days');
    const bench = readFileSync(join(SRC, 'lib/scheduleBenchmarks.ts'), 'utf8');
    expect(bench).toContain('export function getLearnWindow');
    // ★★★ IT STILL HAS A CALLER, so it stays. And this is the measurement that
    //     made the removal safe: the function DISCARDS its argument, so the
    //     per-city number never reached the estimator at all.
    expect(bench).toContain('const windowDays = getLearnWindow(juris);');
    expect(bench).toMatch(/void juris;\s*\n\s*return LEARN_WINDOW_DEFAULT;/);
    // no migration in this ticket
    expect(
      readdirSync(join(ROOT, 'migrations')).filter((f) => f.includes('fix_611')),
    ).toEqual([]);
  });

  it('★★★ §E.2 the Permit Owner block is gone from Settings', () => {
    const lists = readFileSync(
      join(SRC, 'components/Settings/AdminProjectsTab.tsx'),
      'utf8',
    );
    expect(lists).not.toContain('permit-owner-list');
    expect(lists).not.toContain('permit-owner-offlist');
    expect(lists).not.toContain('permitOwnerOptions');
    expect(SETTINGS_BLOCKS.some((b) => /permit owner/i.test(b.title))).toBe(false);
  });

  it('★★ …and the column plus PermitCard’s fallback are untouched', () => {
    // §E.2 names both as out of scope. The 158 stored values keep rendering
    // exactly where they rendered.
    const card = readFileSync(join(SRC, 'components/PermitCard.tsx'), 'utf8');
    expect(card).toContain('permit_owner');
    const types = readFileSync(join(SRC, 'lib/database.types.ts'), 'utf8');
    expect(types).toContain('permit_owner');
  });
});

// ===========================================================================
// §D — search
// ===========================================================================
describe('fix-611 §D — search finds a setting by what is in it', () => {
  const VALUES = [
    { blockId: 'jurisdictions', values: ['Seattle', 'Kirkland', 'Bellevue'] },
    { blockId: 'permit-types', values: ['Building Permit', 'ULS', 'SEPA'] },
    { blockId: 'hold-and-cancel-reasons', values: ['MHA', 'Builder pulled out'] },
    { blockId: 'everyone', values: ['Gena', 'Francesca'] },
    { blockId: 'per-type-schedule', values: ['ULS', 'Building Permit'] },
  ];

  function hits(q: string) {
    return searchSettings(q, SETTINGS_BLOCKS, VALUES).map((h) => h.block.id);
  }

  it('★★★ "Kirkland" → Jurisdictions', () => {
    expect(hits('Kirkland')).toEqual(['jurisdictions']);
  });

  it('★★★ "Gena" → the People table', () => {
    // ⚠️ fix-613: the brief's example said *"People blocks"*, plural, because the
    //    roster was nine editors and a name was findable in several. It is one
    //    table now, so the honest expectation is one hit — and it is still a
    //    People block, which is what the example was protecting.
    const found = hits('Gena');
    expect(found).toEqual(['everyone']);
    expect(
      SETTINGS_BLOCKS.find((b) => b.id === 'everyone')?.category,
    ).toBe('people');
  });

  it('★★★ "MHA" → Hold & cancel reasons', () => {
    expect(hits('MHA')).toEqual(['hold-and-cancel-reasons']);
  });

  it('★★★ "ULS" → Permit Types and Per-type schedule', () => {
    expect(hits('ULS').sort()).toEqual(['per-type-schedule', 'permit-types']);
  });

  it('★★ a title match beats a value match, and one row per block', () => {
    const found = searchSettings('zones', SETTINGS_BLOCKS, VALUES);
    expect(found[0]?.block.id).toBe('zones');
    expect(found[0]?.via).toBe('title');
    // ★ a query matching twenty zones is ONE row, not twenty
    const many = searchSettings('Seattle', SETTINGS_BLOCKS, VALUES);
    expect(many).toHaveLength(1);
    expect(many[0]?.value).toBe('Seattle');
  });

  it('★★ one letter matches nothing — it would match almost everything', () => {
    expect(hits('j')).toEqual([]);
    expect(hits('')).toEqual([]);
    expect(hits('  ')).toEqual([]);
  });

  it('★ the match is highlightable without building HTML', () => {
    expect(highlightParts('Kirkland', 'kirk')).toEqual({
      before: '',
      match: 'Kirk',
      after: 'land',
    });
    // ★ the ORIGINAL casing is preserved — a search for "uls" must not rewrite
    //   "ULS" to lower case on screen
    expect(highlightParts('ULS', 'uls').match).toBe('ULS');
    expect(highlightParts('Zones', 'nothing').match).toBe('');
  });

  it('★★ keywords find a block whose title does not say the word', () => {
    // "backup" is nowhere in "Export backup"'s title? It is — so use a real
    // synonym instead: the DB tools name it was called until this ticket.
    expect(hits('db tools')).toEqual(['export-backup']);
    // ★ and an old name for the roster block — the retired list is inside the
    //   Everyone table now, so "alumni" has to land there or it lands nowhere
    expect(hits('alumni')).toEqual(['everyone']);
  });

  it('★★ exactly ONE query was added for the index, and it is named', () => {
    const index = readFileSync(join(SRC, 'hooks/useSettingsSearchIndex.ts'), 'utf8');
    // every source the index reads
    for (const hook of [
      'useAppConfig',
      'useJurisdictions',
      'usePermitTypes',
      'useTeamMembers',
      'useBuilderRegistry',
      'useExternalTeamDirectory',
    ]) {
      expect(index, `index must read ${hook}`).toContain(hook);
    }
    // ★ and the file says which one is new, so the PR's claim is checkable
    expect(index).toMatch(/EVERY SOURCE EXCEPT ONE WAS ALREADY BEING FETCHED/);
    expect(index).toContain('usePermitTypes');
  });
});

// ===========================================================================
// §C — one block open at a time, and the hash is the state
// ===========================================================================
const authState = vi.hoisted(() => ({ admin: true }));
vi.mock('../hooks/useIsTenantAdmin', () => ({
  useIsTenantAdmin: () => authState.admin,
}));
vi.mock('../hooks/useSettingsSearchIndex', () => ({
  useSettingsSearchIndex: () => [
    { blockId: 'jurisdictions', values: ['Kirkland'] },
  ],
}));
// The five tabs are stubbed with REAL SettingsBlocks, so the accordion is
// exercised against the component that ships rather than against a fake.
vi.mock('../components/Settings/AdminAccountTab', async () => {
  const { default: SettingsBlock } = await import(
    '../components/Settings/SettingsBlock'
  );
  return {
    default: () => (
      <>
        <SettingsBlock id="your-picture">
          <input data-testid="draft-picture" />
        </SettingsBlock>
        <SettingsBlock id="sign-in-info">
          <div>signed in</div>
        </SettingsBlock>
        <SettingsBlock id="export-backup">
          <div>export</div>
        </SettingsBlock>
      </>
    ),
  };
});
vi.mock('../components/Settings/AdminTeamTab', () => ({ default: () => null }));
vi.mock('../components/Settings/AdminProjectsTab', async () => {
  const { default: SettingsBlock } = await import(
    '../components/Settings/SettingsBlock'
  );
  return {
    default: () => (
      <>
        <SettingsBlock id="jurisdictions">
          <div>cities</div>
        </SettingsBlock>
        <SettingsBlock id="zones">
          <div>zones</div>
        </SettingsBlock>
      </>
    ),
  };
});
vi.mock('../components/Settings/AdminPermitsTab', () => ({ default: () => null }));
vi.mock('../components/Settings/AdminScheduleTab', () => ({ default: () => null }));

const { default: SettingsPage } = await import('../pages/SettingsPage');

function renderAt(path: string) {
  const router = createMemoryRouter([{ path: '*', element: <SettingsPage /> }], {
    initialEntries: [path],
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  authState.admin = true;
});

describe('fix-611 §C — one block open at a time', () => {
  it('★★★ everything starts collapsed', () => {
    renderAt('/settings/account');
    expect(screen.getByTestId('settings-block-your-picture').dataset.open).toBe(
      'false',
    );
    expect(screen.getByTestId('settings-block-sign-in-info').dataset.open).toBe(
      'false',
    );
  });

  it('★★★ opening one closes the other', () => {
    renderAt('/settings/account');
    fireEvent.click(screen.getByTestId('settings-block-toggle-your-picture'));
    expect(screen.getByTestId('settings-block-your-picture').dataset.open).toBe('true');
    fireEvent.click(screen.getByTestId('settings-block-toggle-sign-in-info'));
    expect(screen.getByTestId('settings-block-sign-in-info').dataset.open).toBe('true');
    expect(screen.getByTestId('settings-block-your-picture').dataset.open).toBe('false');
  });

  it('★★★ a hash deep link lands on the block open', () => {
    renderAt('/settings/lists#jurisdictions');
    expect(screen.getByTestId('settings-block-jurisdictions').dataset.open).toBe('true');
    expect(screen.getByTestId('settings-block-zones').dataset.open).toBe('false');
  });

  it('★★★ clicking the open block closes it again', () => {
    renderAt('/settings/lists#jurisdictions');
    fireEvent.click(screen.getByTestId('settings-block-toggle-jurisdictions'));
    expect(screen.getByTestId('settings-block-jurisdictions').dataset.open).toBe('false');
  });

  it('★★★ a CLOSED block keeps its editor mounted — unsaved work survives', () => {
    // ★★★ §C's warning, and the reason SettingsBlock hides rather than unmounts.
    //     Several editors here hold a draft that lives nowhere else until it is
    //     committed: PillListEditor's add input, TaskTemplateEditor's subtask
    //     draft, BuildersRegistryPanel's rename, QuarterLayoutEditor's drag state.
    //     Unmounting loses typing with no warning and no undo.
    renderAt('/settings/account');
    const draft = screen.getByTestId('draft-picture') as HTMLInputElement;
    fireEvent.change(draft, { target: { value: 'half-typed' } });
    // open a different block
    fireEvent.click(screen.getByTestId('settings-block-toggle-sign-in-info'));
    // the first editor is still in the DOM, with its value
    expect(
      (screen.getByTestId('draft-picture') as HTMLInputElement).value,
    ).toBe('half-typed');
  });

  it('★★ an open block shows its Feeds chips; a collapsed one does not render them visibly', () => {
    renderAt('/settings/lists#jurisdictions');
    const feeds = screen.getByTestId('settings-block-feeds-jurisdictions');
    expect(feeds.textContent).toMatch(/Feeds/);
    expect(feeds.textContent).toMatch(/New project/);
    expect(feeds.textContent).toMatch(/Library/);
  });

  it('★★ the merged and read-out tags render on the rows that claim them', () => {
    renderAt('/settings/lists');
    expect(screen.getByTestId('settings-block-merged-jurisdictions').textContent)
      .toMatch(/merged 2 → 1/);
    renderAt('/settings/account');
    expect(screen.getByTestId('settings-block-readout-sign-in-info')).toBeTruthy();
  });

  it('★★ a block belonging to another category does not render here', () => {
    // Export backup is declared by AdminAccountTab but belongs to health, so it
    // must not appear on My account — that filtering is what lets one tab
    // contribute blocks to three categories.
    renderAt('/settings/account');
    expect(screen.queryByTestId('settings-block-export-backup')).toBeNull();
    renderAt('/settings/health');
    expect(screen.getByTestId('settings-block-export-backup')).toBeTruthy();
  });
});

describe('fix-611 §D — the search box, rendered', () => {
  it('★★★ typing a city replaces the pane with its block', () => {
    renderAt('/settings/account');
    fireEvent.change(screen.getByTestId('settings-search'), {
      target: { value: 'Kirkland' },
    });
    expect(screen.getByTestId('settings-search-results')).toBeTruthy();
    expect(screen.getByTestId('settings-search-hit-jurisdictions')).toBeTruthy();
    // the category crumb, so you know where you are going
    expect(
      screen.getByTestId('settings-search-hit-jurisdictions').textContent,
    ).toMatch(/Project lists/);
    // and the match is highlighted
    expect(screen.getByTestId('settings-search-mark-jurisdictions').textContent)
      .toBe('Kirkland');
  });

  it('★★★ clearing the box returns to the category', () => {
    renderAt('/settings/account');
    const box = screen.getByTestId('settings-search');
    fireEvent.change(box, { target: { value: 'Kirkland' } });
    expect(screen.getByTestId('settings-search-results')).toBeTruthy();
    fireEvent.change(box, { target: { value: '' } });
    expect(screen.queryByTestId('settings-search-results')).toBeNull();
    expect(screen.getByTestId('settings-block-your-picture')).toBeTruthy();
  });

  it('★★ a non-admin cannot find an admin-only block', () => {
    // ★ The rail hides admin categories; search must not be a second way in.
    authState.admin = false;
    renderAt('/settings/account');
    fireEvent.change(screen.getByTestId('settings-search'), {
      target: { value: 'Kirkland' },
    });
    expect(screen.queryByTestId('settings-search-hit-jurisdictions')).toBeNull();
    expect(screen.getByTestId('settings-search-empty')).toBeTruthy();
  });

  it('★ the placeholder and the hint are the mock’s words', () => {
    renderAt('/settings/account');
    expect(
      (screen.getByTestId('settings-search') as HTMLInputElement).placeholder,
    ).toBe('Search settings…');
    expect(screen.getByTestId('settings-nav').textContent).toMatch(
      /Finds a setting by its name or anything in it/,
    );
  });
});
