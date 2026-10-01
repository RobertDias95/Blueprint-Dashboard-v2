// ===========================================================================
// ★★★ fix-606 (P-302 part 2) — THE SETTINGS "WAITING ON" LIST DRIVES EVERY
//     PICKER THAT USES THOSE WORDS
// ===========================================================================
//
// Bobby, 2026-09-30: *"our drop downs need to match our settings."*
//
// ★★★ "WAITING ON" WAS ALREADY A SETTINGS LIST — fix-364 §3 built the editor and
//     the `app_config.waitingOnOptions` key. What this ticket found is that
//     THREE pickers never asked it, reading the code constant `WAITING_ON_OPTIONS`
//     instead, so a discipline an admin added could not appear in them.
//
// ★★★ AND ONE OF THE THREE IS A GATE, NOT JUST A PICKER. `ConsultantBand`'s
//     "+ Add consultant" offers only disciplines the FIRM DIRECTORY has an
//     active firm for (fix-474's rule). The directory editor decided which
//     disciplines can hold a firm from the code constant — so a Settings-added
//     discipline could never hold a firm, and therefore could never reach a
//     project at all. Fixing the directory editor is what makes the Settings
//     list actually arrive on the project surface.
//
// ---------------------------------------------------------------------------
// ★★★ THIS REVERSES fix-364's DELIBERATE SPLIT, AND fix-364 WAS NOT WRONG
// ---------------------------------------------------------------------------
// `lib/waitingOn.ts` has said since fix-364: *"`WAITING_ON_OPTIONS` in
// database.types is ALSO the external-team discipline vocabulary… A firm
// directory with a 'City' entry would be nonsense: we do not hire the city. So
// the consultant vocabulary stays exactly as it was."*
//
// That reasoning is correct and it survives — as a FILTER (`NON_FIRM_WAITING_ON`)
// rather than as a second hard-coded array. What fix-364 could not see was the
// price of the split: the editable list it had just built could not reach the
// surfaces that shared its words. **SUPERSEDED, NOT MISTAKEN.**
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

import {
  DEFAULT_WAITING_ON_OPTIONS,
  NON_FIRM_WAITING_ON,
  WAITING_ON_CITY,
  WAITING_ON_CONFIG_KEY,
  WAITING_ON_RETIRED_MARKER,
  firmDisciplineLabel,
  firmDisciplineOptions,
  isNonFirmWaitingOn,
  isRetiredWaitingOn,
  waitingOnLabel,
  waitingOnOptions,
} from '../lib/waitingOn';
import {
  assignedFrom,
  disciplineSlots,
  externalTeamShowRules,
  EXTERNAL_TEAM_COMMON_DISCIPLINES,
} from '../lib/externalTeam';
import { RETIRED_OPTION_MARKER, retiredOptionLabel } from '../lib/retiredOption';

const SRC = resolve(__dirname, '..');

/** A config map as `useAppConfig().map` hands it over. */
function cfg(options: string[]): Map<string, unknown> {
  return new Map<string, unknown>([[WAITING_ON_CONFIG_KEY, options]]);
}

/** No app_config row — prod's state today, since nobody has edited the list. */
const EMPTY = new Map<string, unknown>();

// The discipline an admin adds in the tests below. Deliberately not a real
// consultant trade, so a stray hard-coded list cannot accidentally contain it.
const ADDED = 'Acoustics';

describe('fix-606 §A.2 — a firm discipline is not every answer', () => {
  it('★★★ the firm list is the Settings list minus City and Other', () => {
    const list = firmDisciplineOptions(EMPTY);
    expect(list).not.toContain(WAITING_ON_CITY);
    expect(list).not.toContain('Other');
    // …and nothing else was dropped
    expect(list).toEqual(
      DEFAULT_WAITING_ON_OPTIONS.filter((o) => !NON_FIRM_WAITING_ON.includes(o)),
    );
    expect(NON_FIRM_WAITING_ON).toEqual([WAITING_ON_CITY, 'Other']);
  });

  it('★★ the TASK list still offers both — only FIRM pickers narrow', () => {
    // ★★★ fix-364's reason for adding City at all: *"sometimes a task is waiting
    //     on the city for a vendor to respond."* Narrowing the task list would
    //     have undone the ticket this one builds on.
    const tasks = waitingOnOptions(EMPTY);
    expect(tasks).toContain(WAITING_ON_CITY);
    expect(tasks).toContain('Other');
  });

  it('★★★ City is excluded even when STORED as a firm discipline', () => {
    // ★★ THE ASYMMETRY WITH waitingOnOptions, ASSERTED. `waitingOnOptions`
    //    appends an unknown stored value so a task never renders blank. A firm
    //    picker must NOT do that for City: appending it would offer the city as
    //    a consultant on every other project in the app.
    const list = firmDisciplineOptions(EMPTY, WAITING_ON_CITY);
    expect(list).not.toContain(WAITING_ON_CITY);
    expect(firmDisciplineOptions(EMPTY, 'Other')).not.toContain('Other');
  });

  it('★ isNonFirmWaitingOn asks the question instead of re-listing the values', () => {
    expect(isNonFirmWaitingOn(WAITING_ON_CITY)).toBe(true);
    expect(isNonFirmWaitingOn('Other')).toBe(true);
    expect(isNonFirmWaitingOn('  City  ')).toBe(true);
    expect(isNonFirmWaitingOn('Structural')).toBe(false);
    expect(isNonFirmWaitingOn(null)).toBe(false);
  });

  it('★★ an admin-added discipline reaches the firm list', () => {
    const list = firmDisciplineOptions(cfg(['Civil', ADDED, WAITING_ON_CITY]));
    expect(list).toEqual(['Civil', ADDED]);
  });
});

describe('fix-606 §A.3 — a retired value shows, marked, and is never offered', () => {
  it('★★★ isRetiredWaitingOn is now fix-605’s rule, not a second copy', () => {
    const map = cfg(['Civil', 'Surveyor']);
    expect(isRetiredWaitingOn(map, 'Structural')).toBe(true);
    expect(isRetiredWaitingOn(map, 'Civil')).toBe(false);
    expect(isRetiredWaitingOn(map, '')).toBe(false);
    expect(isRetiredWaitingOn(map, null)).toBe(false);
    // ★ the shared predicate agrees, which is the point of the aliasing
    expect(retiredOptionLabel('Structural', ['Civil'], WAITING_ON_RETIRED_MARKER)).toBe(
      `Structural${WAITING_ON_RETIRED_MARKER}`,
    );
  });

  it('★★ the marker says the right WORD, and fix-605’s default is untouched', () => {
    // ★★★ A discipline is not a "type". The rule is shared; the wording is not,
    //     because `Structural (not a current type)` would be wrong in a way a
    //     reader would notice and mistrust.
    expect(WAITING_ON_RETIRED_MARKER).toBe(' (not a current option)');
    expect(RETIRED_OPTION_MARKER).toBe(' (not a current type)');
    // the default parameter keeps every fix-601 / fix-605 caller byte-identical
    expect(retiredOptionLabel('SEPA Old', ['SEPA'])).toBe(
      'SEPA Old (not a current type)',
    );
  });

  it('★ a stored waiting-on value still renders when an admin removed it', () => {
    const map = cfg(['Civil']);
    expect(waitingOnOptions(map, 'Structural')).toEqual(['Civil', 'Structural']);
    expect(waitingOnLabel(map, 'Structural')).toBe(
      `Structural${WAITING_ON_RETIRED_MARKER}`,
    );
    expect(waitingOnLabel(map, 'Civil')).toBe('Civil');
  });

  it('★★ a firm filed under a removed discipline keeps its row, at the END', () => {
    const map = cfg(['Civil', 'Surveyor']);
    expect(firmDisciplineOptions(map, 'Geotech')).toEqual([
      'Civil',
      'Surveyor',
      'Geotech',
    ]);
    expect(firmDisciplineLabel(map, 'Geotech')).toBe(
      `Geotech${WAITING_ON_RETIRED_MARKER}`,
    );
  });
});

describe('fix-606 §A.1 — the slot rule, shared, vocabulary-driven', () => {
  const NONE = new Set<string>();

  it('★★ an admin-added discipline becomes addable on a project', () => {
    const r = externalTeamShowRules({}, NONE, firmDisciplineOptions(cfg([
      'Civil', 'Surveyor', 'Structural', 'Arborist', ADDED,
    ])));
    expect(r.addableDisciplines).toContain(ADDED);
    // the common four still hold their slots
    expect(r.shownDisciplines).toEqual([...EXTERNAL_TEAM_COMMON_DISCIPLINES]);
  });

  it('★★★ a blob key OUTSIDE the vocabulary is no longer invisible', () => {
    // ★★★ THE LATENT BUG THIS TICKET FOUND. The old rule built `assigned` by
    //     iterating the VOCABULARY and looking each key up in the blob, so a
    //     firm stored under anything else was in the data, absent from the
    //     screen, and impossible to clear. It now reads the blob's OWN keys.
    const vocab = firmDisciplineOptions(cfg(['Civil', 'Surveyor']));
    const r = externalTeamShowRules({ Acoustics: 'EchoCo' }, NONE, vocab);
    expect(r.assignedDisciplines.has('Acoustics')).toBe(true);
    expect(r.shownDisciplines).toContain('Acoustics');
    expect(r.noneAssigned).toBe(false);
    // ★ appended, not interleaved — a retired value reads as a fact
    expect(r.shownDisciplines[r.shownDisciplines.length - 1]).toBe('Acoustics');
    // ★★ and never offered for a NEW assignment
    expect(r.addableDisciplines).not.toContain('Acoustics');
  });

  it('★ assignedFrom ignores blank and whitespace firms', () => {
    expect([...assignedFrom({ A: 'Firm', B: '', C: '   ' })]).toEqual(['A']);
    expect([...assignedFrom(null)]).toEqual([]);
  });

  it('★★ disciplineSlots partitions the vocabulary exactly once', () => {
    const vocab = ['Civil', 'Surveyor', 'Structural', 'Arborist', ADDED, 'Geotech'];
    const { shown, addable } = disciplineSlots(new Set(['Geotech']), NONE, vocab);
    for (const d of vocab) {
      expect(shown.includes(d) || addable.includes(d)).toBe(true);
      expect(shown.includes(d) && addable.includes(d)).toBe(false);
    }
    expect(shown).toContain('Geotech');
    expect(addable).toEqual([ADDED]);
  });
});

// ===========================================================================
// The three pickers, RENDERED
// ===========================================================================
//
// ★ One mocked Settings list for all of them, holding `Acoustics` — a discipline
//   that is in NO hard-coded array anywhere in the app. If it reaches a picker,
//   that picker read Settings; there is no other way for it to have got there.

vi.mock('../hooks/useAppConfig', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useAppConfig')>();
  return {
    ...actual,
    useAppConfig: () => ({
      map: new Map<string, unknown>([
        [
          'waitingOnOptions',
          ['Civil', 'Surveyor', 'Structural', 'Arborist', 'Acoustics', 'City', 'Other'],
        ],
      ]),
      rows: [],
      isLoading: false,
      error: null,
      refetch: () => undefined,
    }),
  };
});

const DIR_REF = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock('../hooks/useExternalTeamDirectory', () => ({
  useExternalTeamDirectory: () => ({
    data: DIR_REF.rows,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpsertDirectoryFirm: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

const TPL = vi.hoisted(() => {
  const t = {
    id: 't1', permit_type: 'Building Permit', jurisdiction: null, bucket: 'de',
    text: 'Survey', default_team: null, default_co_assignees: [] as string[],
    default_waiting_on: null as string | null, default_target_offset: null,
    cat: 'reports', sort_order: 0, updated_at: '2026-05-11T12:00:00Z',
    subtasks: [] as unknown[],
  };
  return { rows: [t] };
});
vi.mock('../hooks/useTaskTemplates', () => ({
  useTaskTemplates: () => {
    const byScope = new Map<string, unknown[]>();
    byScope.set('Building Permit||||de', TPL.rows);
    return {
      templates: TPL.rows, subtasks: [], byScope,
      isLoading: false, error: null, refetch: vi.fn(),
    };
  },
  scopeKey: (pt: string, j: string | null, b: string) => `${pt}||${j ?? ''}||${b}`,
}));
vi.mock('../hooks/useJurisdictions', () => ({
  useJurisdictions: () => ({
    data: [{ name: 'Seattle', learn_window_days: 120, notes: null }],
    isLoading: false, error: null, refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({
    data: [{ name: 'Building Permit', is_builtin: true, notes: null }],
    isLoading: false, error: null, refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useTeamMembers', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useTeamMembers')>();
  return {
    ...actual,
    useTeamMembers: () => ({
      all: [], activeDas: [], formerDas: [], dms: [], ents: [], acqs: [],
      schematics: [], isLoading: false, error: null, data: [], refetch: vi.fn(),
    }),
  };
});
vi.mock('../hooks/useUpsertTaskTemplate', () => ({
  useUpsertTaskTemplate: () => ({ mutate: vi.fn() }),
}));
vi.mock('../hooks/useDeleteTaskTemplate', () => ({
  useDeleteTaskTemplate: () => ({ mutate: vi.fn() }),
}));
vi.mock('../hooks/useReorderTaskTemplates', async (importActual) => ({
  ...(await importActual<typeof import('../hooks/useReorderTaskTemplates')>()),
  useReorderTaskTemplates: () => ({ mutate: vi.fn() }),
}));
vi.mock('../hooks/useUpsertTaskTemplateSubtask', () => ({
  useUpsertTaskTemplateSubtask: () => ({ mutate: vi.fn() }),
}));
vi.mock('../hooks/useDeleteTaskTemplateSubtask', () => ({
  useDeleteTaskTemplateSubtask: () => ({ mutate: vi.fn() }),
}));

import ExternalTeamDirectoryEditor from '../components/Settings/ExternalTeamDirectoryEditor';
import TaskTemplateEditor from '../components/Settings/TaskTemplateEditor';
import { useAuthStore } from '../stores/authStore';

function renderTemplates() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskTemplateEditor readOnly={false} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  DIR_REF.rows = [];
  TPL.rows[0].default_waiting_on = null;
  useAuthStore.setState({
    activeTenantId: 'test-tenant-uuid',
    memberships: [{ tenant_id: 'test-tenant-uuid', role: 'admin' }],
  });
});

describe('fix-606 — picker 1 + 2: the firm directory (Settings)', () => {
  it('★★★ an admin-added discipline becomes addable here', () => {
    render(<ExternalTeamDirectoryEditor readOnly={false} />);
    // ★★★ THE GATE. ConsultantBand offers only disciplines the directory has an
    //     active firm for, so until Acoustics can hold a firm HERE it can never
    //     reach a project. Before this ticket the list was WAITING_ON_OPTIONS,
    //     which has no Acoustics and no way to gain one.
    const add = screen.getByTestId('etd-add-discipline') as HTMLSelectElement;
    const labels = Array.from(add.options).map((o) => o.textContent);
    expect(labels).toContain('Acoustics');
  });

  it('★★ City and Other are never offered as firm disciplines', () => {
    render(<ExternalTeamDirectoryEditor readOnly={false} />);
    const add = screen.getByTestId('etd-add-discipline') as HTMLSelectElement;
    const labels = Array.from(add.options).map((o) => o.textContent);
    // ★ both ARE in the mocked Settings list above — so this proves the filter
    //   runs, not that the fixture omitted them.
    expect(labels).not.toContain('City');
    expect(labels).not.toContain('Other');
    expect(screen.queryByTestId('etd-group-City')).toBeNull();
    expect(screen.queryByTestId('etd-group-Other')).toBeNull();
  });

  it('★★★ a firm under a RETIRED discipline keeps its row, marked', () => {
    // Geotech is a real consultant trade and is NOT in the mocked Settings list.
    DIR_REF.rows = [
      { id: 'Geotech-GeoCo', discipline: 'Geotech', name: 'GeoCo', active: true,
        created_at: '2026-01-01' },
    ];
    render(<ExternalTeamDirectoryEditor readOnly={false} />);
    const group = screen.getByTestId('etd-group-Geotech');
    expect(group).toBeInTheDocument();
    // ★ it SAYS why it is there …
    expect(within(group).getByText(/Geotech \(not a current option\)/)).toBeInTheDocument();
    // … and the firm is still reachable, never orphaned
    expect(screen.getByTestId('etd-firm-name-Geotech-GeoCo')).toHaveTextContent('GeoCo');
    // ★★ but it is NOT offered for a new assignment
    const add = screen.getByTestId('etd-add-discipline') as HTMLSelectElement;
    expect(Array.from(add.options).map((o) => o.textContent)).not.toContain('Geotech');
  });

  it('★ the common four still hold their slots', () => {
    render(<ExternalTeamDirectoryEditor readOnly={false} />);
    for (const d of ['Civil', 'Surveyor', 'Structural', 'Arborist']) {
      expect(screen.getByTestId(`etd-group-${d}`)).toBeInTheDocument();
    }
  });
});

describe('fix-606 — picker 3: the task template Waiting On select', () => {
  it('★★★ offers an admin-added discipline', () => {
    renderTemplates();
    const sel = screen.getByTestId('task-template-row-t1-waiting-on') as HTMLSelectElement;
    const labels = Array.from(sel.options).map((o) => o.textContent);
    expect(labels).toContain('Acoustics');
  });

  it('★★ and STILL offers City — a task may wait on the jurisdiction', () => {
    // ★★★ THE ASYMMETRY, RENDERED. The firm pickers above exclude City; this one
    //     must not, because fix-364 added it for exactly this field: *"sometimes
    //     a task is waiting on the city for a vendor to respond."*
    renderTemplates();
    const sel = screen.getByTestId('task-template-row-t1-waiting-on') as HTMLSelectElement;
    const labels = Array.from(sel.options).map((o) => o.textContent);
    expect(labels).toContain('City');
    expect(labels).toContain('Other');
  });

  it('★★★ a retired stored value still renders, marked and disabled', () => {
    // Plumbing is in the built-in constant but NOT in the mocked Settings list.
    TPL.rows[0].default_waiting_on = 'Plumbing';
    renderTemplates();
    const sel = screen.getByTestId('task-template-row-t1-waiting-on') as HTMLSelectElement;
    // ★ the select shows the stored value rather than rendering BLANK, which is
    //   how an editable list quietly destroys data
    expect(sel.value).toBe('Plumbing');
    const opt = Array.from(sel.options).find((o) => o.value === 'Plumbing');
    expect(opt?.textContent).toBe('Plumbing (not a current option)');
    // ★★ the row's OWN value stays selectable — disabling it would make the
    //    select unable to display its own state in some browsers
    expect(opt?.disabled).toBe(false);
  });

  it('★★ a retired value that is NOT this row\u2019s cannot be chosen', () => {
    TPL.rows[0].default_waiting_on = 'Civil';
    renderTemplates();
    const sel = screen.getByTestId('task-template-row-t1-waiting-on') as HTMLSelectElement;
    // nothing retired is even in the list when the row holds a current value …
    const labels = Array.from(sel.options).map((o) => o.textContent);
    expect(labels.some((l) => l?.includes('not a current option'))).toBe(false);
    // … and the live ones are all enabled
    for (const o of Array.from(sel.options)) expect(o.disabled).toBe(false);
  });
});

// ===========================================================================
// ★★★ §A.4 — THE IMPORT GUARD
// ===========================================================================
describe('fix-606 §A.4 — WAITING_ON_OPTIONS is a seed, not a vocabulary', () => {
  /** Files allowed to import the raw constant. */
  const ALLOWED = new Set([
    // the seed behind DEFAULT_WAITING_ON_OPTIONS and the only derivation of it
    'lib/waitingOn.ts',
    // where it is declared, and the source of the WaitingOnDiscipline type
    'lib/database.types.ts',
  ]);

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

  /** Files that IMPORT the identifier — not ones that merely name it in prose. */
  function importers(): string[] {
    const out: string[] = [];
    for (const file of walk(SRC)) {
      const src = readFileSync(file, 'utf8');
      // ★★★ MATCHED ON THE IMPORT STATEMENT, NOT THE BARE NAME — fix-479's rule.
      //     Several of these files explain in a comment WHY they no longer read
      //     the constant, and a bare-name assertion would forbid writing that
      //     explanation down, which is the opposite of what is wanted. This is
      //     the gravestone trap from the other side.
      const imports = src.match(/import\s*\{[^}]*\}\s*from\s*'[^']*'/g) ?? [];
      for (const stmt of imports) {
        // the braces only, so `DEFAULT_WAITING_ON_OPTIONS` does not match
        const names = (stmt.match(/\{([^}]*)\}/)?.[1] ?? '')
          .split(',')
          .map((n) => n.replace(/^\s*type\s+/, '').trim());
        if (names.includes('WAITING_ON_OPTIONS')) {
          out.push(relative(SRC, file).replace(/\\/g, '/'));
        }
      }
    }
    return out;
  }

  it('★★★ only waitingOn.ts and database.types.ts import it', () => {
    const offenders = importers().filter((f) => !ALLOWED.has(f));
    // ★ The message names the file, so the fix is obvious: read the Settings
    //   list through `waitingOnOptions` / `firmDisciplineOptions` instead.
    expect(offenders).toEqual([]);
  });

  it('★ the guard actually finds the one legitimate importer', () => {
    // ★★★ A GUARD THAT MATCHES NOTHING PASSES FOR EVER. fix-314 found an
    //     `auth/` clause in App.tsx that had matched nothing since the day it
    //     was written; this asserts the scanner can see a real import before
    //     trusting it to see a bad one.
    expect(importers()).toContain('lib/waitingOn.ts');
  });

  it('★★ the three pickers no longer import it', () => {
    const was = [
      'lib/externalTeam.ts',
      'components/Settings/ExternalTeamDirectoryEditor.tsx',
      'components/Settings/TaskTemplateEditor.tsx',
    ];
    const now = importers();
    for (const f of was) expect(now).not.toContain(f);
  });

  it('★★ …and they read the Settings list instead', () => {
    const reads = (rel: string, needle: string) => {
      const src = readFileSync(join(SRC, rel), 'utf8');
      expect(src, `${rel} should use ${needle}`).toContain(needle);
    };
    // the pure rule takes its vocabulary as an argument
    reads('lib/externalTeam.ts', 'disciplines: readonly string[]');
    // the seam that resolves it from app_config
    reads('hooks/useExternalTeamShowRules.ts', 'firmDisciplineOptions(cfg.map)');
    reads(
      'components/Settings/ExternalTeamDirectoryEditor.tsx',
      'firmDisciplineOptions(cfg.map)',
    );
    reads('components/Settings/TaskTemplateEditor.tsx', 'waitingOnOptions(cfg.map');
  });

  it('★★★ the type and the seed survive — this is not a deletion', () => {
    // §A.4: the constant may remain as the seed and the type's source. Deleting
    // it would retype `permit_tasks.waiting_on` across the app for no gain.
    const types = readFileSync(join(SRC, 'lib/database.types.ts'), 'utf8');
    expect(types).toContain('export const WAITING_ON_OPTIONS = [');
    expect(types).toContain(
      'export type WaitingOnDiscipline = (typeof WAITING_ON_OPTIONS)[number];',
    );
    const w = readFileSync(join(SRC, 'lib/waitingOn.ts'), 'utf8');
    expect(w).toContain("...WAITING_ON_OPTIONS.filter((o) => o !== 'Other')");
  });
});

describe('fix-606 — DISCIPLINES is NOT a vocabulary and was not touched', () => {
  it('★★★ the two internal teams are untouched', async () => {
    // ★★★ THE BRIEF'S OWN CORRECTION, PINNED. Cowork described `DISCIPLINES`
    //     to Bobby as a dropdown vocabulary. It is not: `['ent','arch']` are the
    //     two INTERNAL teams (Permitting / Design), stored on ~1,800 rows and
    //     wired into task routing. Moving them into Settings would have been a
    //     data migration disguised as a dropdown change.
    const labels = await import('../lib/disciplineLabels');
    expect(labels.DISCIPLINES).toEqual(['ent', 'arch']);
    const src = readFileSync(join(SRC, 'lib/disciplineLabels.ts'), 'utf8');
    expect(src).not.toContain('waitingOnOptions');
    expect(src).not.toContain('app_config');
  });
});

describe('fix-606 — the firm directory heading marks a retired discipline', () => {
  it('★★ renders the marker through firmDisciplineLabel', () => {
    // The directory editor's heading is a plain span; the label it shows is
    // derived by `firmDisciplineLabel`, asserted directly above. This pins the
    // WIRING — that the heading reads the label rather than the raw key.
    const src = readFileSync(
      join(SRC, 'components/Settings/ExternalTeamDirectoryEditor.tsx'),
      'utf8',
    );
    expect(src).toContain('label={firmDisciplineLabel(cfg.map, discipline)}');
    expect(src).toContain('{label}');
    // ★ the raw key still drives the test ids and the firm lookup
    expect(src).toContain('data-testid={`etd-group-${discipline}`}');
  });

  it('★ and the slot rule is the shared one, not a local copy', () => {
    const src = readFileSync(
      join(SRC, 'components/Settings/ExternalTeamDirectoryEditor.tsx'),
      'utf8',
    );
    expect(src).toContain('disciplineSlots(');
    // the duplicated filter it used to carry is gone
    expect(src).not.toContain('const shownSet = new Set(shown);');
  });
});
