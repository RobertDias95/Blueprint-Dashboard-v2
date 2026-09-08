import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { RIBBON_ENTRIES } from '../lib/ribbonNav';
import { JURISDICTION_LINKS_KEY, readJurisdictions } from '../lib/jurisdictionLinks';
import { projectTagNames, type ProjectInternalTeam } from '../lib/projectTeam';

// ===========================================================================
// ★★★ fix-503 — dividers, city rows, link priority, and who `@project` reaches
// ===========================================================================
//
// Three rulings, all Bobby 2026-09-04:
//
//   P-159  *"can we remove jurisdictions, and just make the jurisdictions
//          present but slightly indented with a carrot"* · *"we want to get rid
//          of the categorical titles. So we want to get rid of links, reports,
//          and more on that ribbon as well."* → thin divider lines, no words.
//   P-165  *"being able to drag or reorganize the links so we can… rearrange
//          their priority, or being able to click into the name of the link so
//          that we can rename it if we spelled it wrong."*
//   P-163  *"The app project chat function, it should not be including
//          schematic, construction administration, or acquisitions in that tag."*
//
// ★ The inverted fix-485 assertions live in RibbonGroupsFix485.test.tsx, each
//   marked SUPERSEDED BY fix-503 rather than deleted. This file covers what is
//   NEW.

const T = 'test-tenant-uuid';

const appConfigMap = vi.hoisted(() => ({ current: new Map<string, unknown>() }));
const setKeyMutate = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useAppConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useAppConfig')>();
  return { ...actual, useAppConfig: () => ({ map: appConfigMap.current }) };
});
vi.mock('../hooks/useSetAppConfigKey', () => ({
  useSetAppConfigKey: () => ({ mutate: setKeyMutate, isPending: false }),
}));
vi.mock('../hooks/useErrorReports', () => ({ useNewErrorCount: () => 0 }));
vi.mock('../hooks/useWhatsNew', () => ({
  useWhatsNewEntries: () => ({ data: [] }),
  useWhatsNewReads: () => ({ data: [] }),
}));
vi.mock('../hooks/useAgendaMember', () => ({ useIsAgendaMember: () => true }));
vi.mock('../hooks/useIsTenantAdmin', () => ({ useIsTenantAdmin: () => true }));

import Ribbon from '../components/Ribbon';
import JurisdictionLinksEditor from '../components/Settings/JurisdictionLinksEditor';

const SEATTLE_THREE = [
  {
    city: 'Seattle',
    links: [
      { label: 'DSO GIS', url: 'https://gis.example.gov/seattle' },
      { label: 'Building Code', url: 'https://code.example.gov/seattle' },
      { label: 'Zoning Code', url: 'https://zoning.example.gov/seattle' },
    ],
  },
  { city: 'Kirkland', links: [] },
];

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  setKeyMutate.mockReset();
  appConfigMap.current = new Map<string, unknown>();
  useAuthStore.setState({
    activeTenantId: T,
    user: { id: 'u-1', email: 'u@test', role: 'admin' },
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
});

function renderRibbon(collapsed = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Ribbon onAddProject={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // ★ Collapse through the CONTROL rather than by writing the storage key by
  //   hand: the key's shape is ribbonPrefs' business, and a test that knows it
  //   breaks the day that file renames it for a reason unrelated to this.
  if (collapsed) fireEvent.click(screen.getByTestId('ribbon-collapse'));
  return r;
}

// ---------------------------------------------------------------------------
// §A — the ribbon
// ---------------------------------------------------------------------------

describe('fix-503 §A: captions become dividers', () => {
  it('★★★ the ribbon renders ZERO caption text', () => {
    // ★★★ Bobby: *"get rid of links, reports, and more on that ribbon."* The
    //     three words the captions carried were Work, Reports and Links.
    const { container } = renderRibbon();
    expect(container.querySelectorAll('[data-testid^="ribbon-caption-"]')).toHaveLength(0);
    // ★ `Work` and `Links` appear nowhere at all now; `Reports` survives ONLY
    //   as the group's own toggle, which names a destination rather than a
    //   category of the ribbon and which Bobby did not ask to remove.
    expect(screen.queryByText('Work')).toBeNull();
    expect(screen.queryByText('Links')).toBeNull();
    expect(screen.getAllByText('Reports')).toHaveLength(1);
  });

  it('★★★ three dividers, in the three places the captions were', () => {
    const { container } = renderRibbon();
    const dividers = container.querySelectorAll('[data-testid^="ribbon-divider-"]');
    expect(dividers).toHaveLength(3);
    expect(
      Array.from(dividers).map((d) => d.getAttribute('data-testid')),
    ).toEqual([
      'ribbon-divider-div-work',
      'ribbon-divider-div-reports',
      'ribbon-divider-div-links',
    ]);
  });

  it('★★ a divider is a rule and nothing else — no text, no label field', () => {
    renderRibbon();
    const reports = screen.getByTestId('ribbon-divider-div-reports');
    expect(reports.textContent).toBe('');
    expect(reports.childElementCount).toBe(0);
    expect(reports.style.borderTop).toContain('1px');
    // ★★ The kind carries no `label` at all, so the words cannot return by
    //    accident — structural, the way fix-485 made these kinds ungatable.
    for (const e of RIBBON_ENTRIES.filter((x) => x.kind === 'divider')) {
      expect(Object.keys(e).sort()).toEqual(['id', 'kind']);
    }
  });

  it('★★★ the COLLAPSED ribbon still draws all three dividers', () => {
    // ★ It always did: the caption rendered the rule and dropped the word at
    //   56px, so this is the one width where nothing changed.
    const { container } = renderRibbon(true);
    expect(container.querySelector('[data-testid="ribbon"]')!.getAttribute('data-collapsed')).toBe('true');
    expect(container.querySelectorAll('[data-testid^="ribbon-divider-"]')).toHaveLength(3);
  });

  it('★★ the FIRST divider still draws no rule', () => {
    // A hairline directly under the brand block reads as a mistake. Derived
    // from RIBBON_ENTRIES[0], not hard-coded, so re-ordering cannot strand it.
    renderRibbon();
    expect(screen.getByTestId('ribbon-divider-div-work').style.borderTop).toBe('');
  });
});

describe('fix-503 §A: the cities are indented rows with a caret', () => {
  it('★★★ present on arrival, with no folder to open first', () => {
    appConfigMap.current = new Map<string, unknown>([
      [JURISDICTION_LINKS_KEY, SEATTLE_THREE],
    ]);
    renderRibbon();
    expect(screen.queryByTestId('ribbon-jurisdictions-toggle')).toBeNull();
    expect(screen.getByTestId('ribbon-jurisdiction-Seattle')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-jurisdiction-Kirkland')).toBeInTheDocument();
  });

  it('★★★ opening Seattle lists its three links as externals, in stored order', () => {
    appConfigMap.current = new Map<string, unknown>([
      [JURISDICTION_LINKS_KEY, SEATTLE_THREE],
    ]);
    renderRibbon();
    fireEvent.click(screen.getByTestId('ribbon-jurisdiction-toggle-Seattle'));
    const anchors = Array.from(
      screen.getByTestId('ribbon-jurisdiction-links-Seattle').querySelectorAll('a'),
    );
    // ★★★ ORDER IS THE STORED ORDER — this is the half of §B that makes the
    //     Settings drag mean anything.
    expect(anchors.map((a) => a.textContent)).toEqual([
      'DSO GIS↗',
      'Building Code↗',
      'Zoning Code↗',
    ]);
    for (const a of anchors) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
  });

  it('★★ Kirkland, with no links, says so', () => {
    appConfigMap.current = new Map<string, unknown>([
      [JURISDICTION_LINKS_KEY, SEATTLE_THREE],
    ]);
    renderRibbon();
    fireEvent.click(screen.getByTestId('ribbon-jurisdiction-toggle-Kirkland'));
    expect(screen.getByTestId('ribbon-jurisdiction-empty-Kirkland').textContent).toBe(
      'No links yet — add in Settings',
    );
  });

  it('★★ the caret is Bobby\'s carrot: ▾ closed, ▴ open', () => {
    renderRibbon();
    expect(screen.getByTestId('ribbon-jurisdiction-caret-Seattle').textContent).toBe('▾');
    fireEvent.click(screen.getByTestId('ribbon-jurisdiction-toggle-Seattle'));
    expect(screen.getByTestId('ribbon-jurisdiction-caret-Seattle').textContent).toBe('▴');
  });

  it('★★ a city row is indented one step — the SAME indent the Reports children use', () => {
    // ★ Not a third indent invented for this block: a city row IS a child row,
    //   and two nearly-equal indents read as two designs.
    renderRibbon();
    const city = screen.getByTestId('ribbon-jurisdiction-toggle-Seattle');
    expect(city.style.padding).toBe('5px 10px 5px 30px');
    fireEvent.click(city);
    const link = screen
      .getByTestId('ribbon-jurisdiction-links-Seattle')
      .querySelector('div, a') as HTMLElement;
    // …and a link one step further in.
    expect(link.style.padding).toContain('44px');
  });

  it('★★★ COLLAPSED: cities show as their first letter and links stay hidden', () => {
    appConfigMap.current = new Map<string, unknown>([
      [JURISDICTION_LINKS_KEY, SEATTLE_THREE],
    ]);
    renderRibbon(true);
    expect(screen.getByTestId('ribbon-jurisdiction-initial-Seattle').textContent).toBe('S');
    expect(screen.getByTestId('ribbon-jurisdiction-initial-Kirkland').textContent).toBe('K');
    expect(screen.queryByTestId('ribbon-jurisdiction-caret-Seattle')).toBeNull();
    fireEvent.click(screen.getByTestId('ribbon-jurisdiction-toggle-Seattle'));
    expect(screen.queryByTestId('ribbon-jurisdiction-links-Seattle')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §B — the editor
// ---------------------------------------------------------------------------

function renderEditor(value: unknown = SEATTLE_THREE) {
  appConfigMap.current = new Map<string, unknown>([[JURISDICTION_LINKS_KEY, value]]);
  return render(<JurisdictionLinksEditor />);
}

/** The `links` array the editor last wrote for a city. */
function savedLinks(city: string): { label: string; url: string }[] {
  const last = setKeyMutate.mock.calls.at(-1)?.[0] as
    | { key: string; value: { city: string; links: { label: string; url: string }[] }[] }
    | undefined;
  return last?.value.find((c) => c.city === city)?.links ?? [];
}

describe('fix-503 §B: reorder', () => {
  it('★★★ ▼ on DSO GIS moves it below Building Code, and saves the new order', () => {
    // ★★ The ▲▼ path is the keyboard AND touch path, and it calls the same
    //    `moveLink` the drag does — one reorder, two gestures. jsdom cannot
    //    perform a pointer drag, so this is how the reorder itself is proven.
    renderEditor();
    fireEvent.click(screen.getByTestId('juris-links-down-Seattle-DSO GIS'));
    expect(savedLinks('Seattle').map((l) => l.label)).toEqual([
      'Building Code',
      'DSO GIS',
      'Zoning Code',
    ]);
  });

  it('★★★ ▲ on Building Code lifts it above DSO GIS — the brief\'s own case', () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('juris-links-up-Seattle-Building Code'));
    expect(savedLinks('Seattle').map((l) => l.label)).toEqual([
      'Building Code',
      'DSO GIS',
      'Zoning Code',
    ]);
  });

  it('★★ the ends are disabled — the first cannot go up, the last cannot go down', () => {
    renderEditor();
    expect(screen.getByTestId('juris-links-up-Seattle-DSO GIS')).toBeDisabled();
    expect(screen.getByTestId('juris-links-down-Seattle-Zoning Code')).toBeDisabled();
    expect(screen.getByTestId('juris-links-down-Seattle-DSO GIS')).not.toBeDisabled();
  });

  it('★★ every row has a drag handle, and the URL never changes with the order', () => {
    renderEditor();
    expect(screen.getByTestId('juris-links-drag-Seattle-DSO GIS')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('juris-links-down-Seattle-DSO GIS'));
    const urls = savedLinks('Seattle').map((l) => l.url);
    expect(new Set(urls).size).toBe(3);
    expect(urls).toContain('https://gis.example.gov/seattle');
  });

  it('★★★ the ribbon follows the saved order with no deploy', () => {
    // ★ Both read `app_config.jurisdictionLinks` — the reorder is the array, so
    //   proving the reader honours the array proves the round trip.
    const reordered = [
      {
        city: 'Seattle',
        links: [
          { label: 'Building Code', url: 'https://code.example.gov/seattle' },
          { label: 'DSO GIS', url: 'https://gis.example.gov/seattle' },
        ],
      },
    ];
    appConfigMap.current = new Map<string, unknown>([
      [JURISDICTION_LINKS_KEY, reordered],
    ]);
    renderRibbon();
    fireEvent.click(screen.getByTestId('ribbon-jurisdiction-toggle-Seattle'));
    const anchors = Array.from(
      screen.getByTestId('ribbon-jurisdiction-links-Seattle').querySelectorAll('a'),
    );
    expect(anchors.map((a) => a.textContent)).toEqual([
      'Building Code↗',
      'DSO GIS↗',
    ]);
  });
});

describe('fix-503 §B: rename', () => {
  it('★★★ clicking the name opens an input; Enter saves the LABEL only', () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('juris-links-label-text-Seattle-Zoning Code'));
    const input = screen.getByTestId(
      'juris-links-rename-Seattle-https://zoning.example.gov/seattle',
    ) as HTMLInputElement;
    expect(input.value).toBe('Zoning Code');
    fireEvent.change(input, { target: { value: 'Zoning code' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const links = savedLinks('Seattle');
    expect(links.map((l) => l.label)).toEqual([
      'DSO GIS',
      'Building Code',
      'Zoning code',
    ]);
    // ★★★ THE URL IS UNTOUCHED. Bobby's word was "if we spelled it wrong" — a
    //     typo fix, not a re-point. A URL edited in place is a link that
    //     silently leads somewhere new under a name people already trust.
    expect(links[2].url).toBe('https://zoning.example.gov/seattle');
  });

  it('★★ blur saves too, and Escape cancels', () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('juris-links-label-text-Seattle-DSO GIS'));
    let input = screen.getByTestId(
      'juris-links-rename-Seattle-https://gis.example.gov/seattle',
    );
    fireEvent.change(input, { target: { value: 'DSO GIS Map' } });
    fireEvent.blur(input);
    expect(savedLinks('Seattle')[0].label).toBe('DSO GIS Map');

    setKeyMutate.mockReset();
    fireEvent.click(screen.getByTestId('juris-links-label-text-Seattle-DSO GIS'));
    input = screen.getByTestId('juris-links-rename-Seattle-https://gis.example.gov/seattle');
    fireEvent.change(input, { target: { value: 'nonsense' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(setKeyMutate).not.toHaveBeenCalled();
  });

  it('★★★ an EMPTY label is rejected — it would DELETE the link, not blank it', () => {
    // ★★★ THE REASON THIS RULE IS NOT COSMETIC. `readJurisdictions` DROPS a row
    //     whose label is blank, so committing one would not save an unnamed
    //     link — it would remove the link on the next read, with a rename
    //     gesture. Proven both ways: the write is refused, and the reader is
    //     shown to be why.
    renderEditor();
    fireEvent.click(screen.getByTestId('juris-links-label-text-Seattle-DSO GIS'));
    const input = screen.getByTestId(
      'juris-links-rename-Seattle-https://gis.example.gov/seattle',
    );
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(setKeyMutate).not.toHaveBeenCalled();

    const wouldBe = readJurisdictions(
      new Map<string, unknown>([
        [
          JURISDICTION_LINKS_KEY,
          [{ city: 'Seattle', links: [{ label: '', url: 'https://gis.example.gov/seattle' }] }],
        ],
      ]),
    );
    expect(wouldBe[0].links).toHaveLength(0);
  });

  it('★★ a rename does not remount the row — the key is the URL, not label|url', () => {
    // ★ A `label|url` key changes the instant a rename does, unmounting the row
    //   mid-edit and taking the input's focus and its draft with it.
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/Settings/JurisdictionLinksEditor.tsx'),
      'utf8',
    );
    expect(src).toContain('key={l.url}');
    expect(src).not.toContain('key={`${l.label}|${l.url}`}');
  });

  it('★★ read-only hides every editing affordance', () => {
    appConfigMap.current = new Map<string, unknown>([
      [JURISDICTION_LINKS_KEY, SEATTLE_THREE],
    ]);
    render(<JurisdictionLinksEditor readOnly />);
    expect(screen.queryByTestId('juris-links-drag-Seattle-DSO GIS')).toBeNull();
    expect(screen.queryByTestId('juris-links-up-Seattle-DSO GIS')).toBeNull();
    fireEvent.click(screen.getByTestId('juris-links-label-text-Seattle-DSO GIS'));
    expect(
      screen.queryByTestId('juris-links-rename-Seattle-https://gis.example.gov/seattle'),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §C — who `@project` reaches
// ---------------------------------------------------------------------------

describe('fix-503 §C: @project is ENT · DM · DA', () => {
  const full: ProjectInternalTeam = {
    acq: 'Ada Acq',
    ent: 'Ernie Ent',
    sd: ['Sam Schematic'],
    dm: 'Dana Manager',
    da: 'Devon Associate',
    ca: 'Steve Construction',
  };

  it('★★★ a project with ALL SIX roles filled tags exactly three', () => {
    // ★★★ FAILS ON origin/main, which returns four — Acquisitions was still in.
    //     Bobby, 2026-09-04: *"it should not be including schematic,
    //     construction administration, or acquisitions in that tag."*
    expect(projectTagNames(full)).toEqual([
      'Ernie Ent',
      'Dana Manager',
      'Devon Associate',
    ]);
  });

  it('★★★ each of the three excluded roles is excluded on its own', () => {
    expect(projectTagNames({ ...full, ent: null, dm: null, da: null })).toEqual([]);
    expect(projectTagNames({ ...full, acq: 'Only Acq', ent: null, dm: null, da: null })).toEqual([]);
    expect(projectTagNames({ ...full, sd: ['Only SD'], ent: null, dm: null, da: null })).toEqual([]);
    expect(projectTagNames({ ...full, ca: 'Only CA', ent: null, dm: null, da: null })).toEqual([]);
  });

  it('★★ an unfilled role is fewer people, never an error', () => {
    // fix-347's rule, unchanged: "a smart tag on a project with an unfilled
    // role simply resolves to fewer people".
    expect(projectTagNames({ ...full, da: null })).toEqual(['Ernie Ent', 'Dana Manager']);
  });

  it('★★★ the CARD is untouched — one definition, two consumers', () => {
    // ★★ The third time this sentence has been needed (fix-344, fix-487, now),
    //    which is why it is load-bearing. Dropping a role from the shared shape
    //    to fix a mention list would take that person off the Team card.
    const src = readFileSync(resolve(process.cwd(), 'src/lib/projectTeam.ts'), 'utf8');
    expect(src).toContain('export function projectInternalTeam');
    // `projectTeamNames` — what the card uses — still pushes all five roles.
    for (const role of ['team.acq', 'team.ent', 'team.sd', 'team.dm', 'team.da', 'team.ca']) {
      expect(src).toContain(role);
    }
  });

  it('★★ one name in two roles is listed once', () => {
    expect(projectTagNames({ ...full, dm: 'Ernie Ent' })).toEqual([
      'Ernie Ent',
      'Devon Associate',
    ]);
  });
});
