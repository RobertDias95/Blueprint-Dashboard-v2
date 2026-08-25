import { describe, it, expect, beforeEach } from 'vitest';
import projectDetailSource from '../pages/ProjectDetail.tsx?raw';
import librarySource from '../components/LibraryMatrix.tsx?raw';
import dashboardSource from '../pages/Dashboard.tsx?raw';
import adminTeamSource from '../components/Settings/AdminTeamTab.tsx?raw';
import addrGroupSource from '../components/Dashboard/AddrGroup.tsx?raw';
import { PREVIOUS_ORIGINS, previousTarget } from '../lib/previousOrigin';
import {
  clearFilterState,
  loadFilterState,
  numOrNull,
  oneOf,
  saveFilterState,
  strArray,
} from '../lib/filterPrefs';
import {
  clearLibraryFilters,
  loadLibraryFilters,
  loadPipelineFilters,
  saveLibraryFilters,
  savePipelineFilters,
} from '../lib/surfaceFilterPrefs';
import { ENT_ROLES, dedupeByPerson, isCurrentMember } from '../lib/roster';
import type { LibraryFilters } from '../lib/libraryHelpers';
import type { TeamMember } from '../lib/database.types';

// ===========================================================================
// fix-403 — Previous takes you back to the search you were mid-thought in
// ===========================================================================
//
// Bobby, 2026-08-25:
//
//   "Say I'm in the library and I put in all these filter parameters … and then
//    I click the project and I go into Project Overview and then I realize, ah,
//    I'm going to keep searching. I would like to click the previous button. It
//    takes me back to the library and then it still has all of my saved
//    parameters. Same thing when I'm in Pipeline … maybe I was only looking at
//    a type of permit or a certain person."
//
// ★★★ THE BUTTON IS THE SMALL HALF. A Previous button that returned you to an
// EMPTY Library would be worse than no button — it would look like it worked
// and quietly cost you the search you were in the middle of.

const USER = 'u-1';

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------
// §1 · THE MEMORY — session-scoped, per surface, per user
// ---------------------------------------------------------------------------

const LIB_DEFAULT: LibraryFilters = {
  search: '', lotwTarget: null, lotwBuf: 2, lotdTarget: null, lotdBuf: 2,
  unitwTarget: null, unitwBuf: 2, unitdTarget: null, unitdBuf: 2,
  zone: '', alley: '', productTypes: [], tag: '', juris: '',
  isCornerLot: '', stories: '', parkingKind: '', stalls: '', roofDeck: '',
};

describe('fix-403 §1: the Library round-trips its whole filter shape', () => {
  it('★★★ every field of the fix-402 shape survives — both cards', () => {
    const full: LibraryFilters = {
      search: 'cottage',
      lotwTarget: 50, lotwBuf: 5, lotdTarget: 120, lotdBuf: 10,
      unitwTarget: 20, unitwBuf: 1, unitdTarget: 42, unitdBuf: 3,
      zone: 'NR3', alley: 'Yes', productTypes: ['Townhouse', 'Cottages'],
      tag: 'ECA', juris: 'Seattle',
      isCornerLot: 'Yes', stories: '3',
      parkingKind: 'garage', stalls: '2+', roofDeck: 'No',
    };
    saveLibraryFilters(USER, full);
    // ★ Asserted field by field via toEqual — a partial restore that dropped
    //   one card would otherwise pass a spot check.
    expect(loadLibraryFilters(USER, LIB_DEFAULT)).toEqual(full);
  });

  it('★★ a value outside a closed set falls back, and the REST still restores', () => {
    // A stored blob is untrusted: it can be a shape shipped three tickets ago.
    // Decoding field by field means one bad key costs that field, not the panel.
    saveFilterState('library.filters', USER, {
      ...LIB_DEFAULT,
      search: 'kept',
      parkingKind: 'carport', // retired / never existed
      stories: '9',
      isCornerLot: 'Maybe',
    });
    const out = loadLibraryFilters(USER, LIB_DEFAULT)!;
    expect(out.search).toBe('kept');
    expect(out.parkingKind).toBe('');
    expect(out.stories).toBe('');
    expect(out.isCornerLot).toBe('');
  });

  it('★★ a buffer keeps the panel DEFAULT when unreadable, never 0', () => {
    // 0 would silently narrow every range filter to an exact match.
    saveFilterState('library.filters', USER, { ...LIB_DEFAULT, lotwBuf: 'wide' });
    expect(loadLibraryFilters(USER, LIB_DEFAULT)!.lotwBuf).toBe(2);
  });

  it('★★★ Clear wipes the STORED copy, not just the state', () => {
    saveLibraryFilters(USER, { ...LIB_DEFAULT, search: 'x' });
    expect(loadLibraryFilters(USER, LIB_DEFAULT)).not.toBeNull();
    clearLibraryFilters(USER);
    // ★ Otherwise the filters return the next time you navigate away and back —
    //   a Clear button that un-clears itself.
    expect(loadLibraryFilters(USER, LIB_DEFAULT)).toBeNull();
  });
});

describe('fix-403 §1b: the Pipeline round-trips search, holds and the Sets', () => {
  it('★★★ the four filter SETS survive — stored as arrays, rehydrated', () => {
    // ★★ JSON.stringify turns a Set into {} SILENTLY, restoring as an empty
    // filter that looks like it worked. This is the whole reason the Pipeline
    // needs an encoder rather than a straight round-trip.
    savePipelineFilters(USER, {
      search: '4137', holdMode: 'exclude',
      ent: ['Miles'], da: ['Cam', 'Nicky'], dm: ['Derry'], type: ['ULS'],
    });
    const out = loadPipelineFilters(USER)!;
    expect(out.search).toBe('4137');
    expect(out.holdMode).toBe('exclude');
    expect(out.da).toEqual(['Cam', 'Nicky']);
    expect(out.type).toEqual(['ULS']);
    // ...and they rebuild into real Sets at the call site.
    expect(new Set(out.da).has('Cam')).toBe(true);
  });

  it('★★ a naked Set really does vanish through JSON — the trap, demonstrated', () => {
    expect(JSON.parse(JSON.stringify({ da: new Set(['Cam']) }))).toEqual({ da: {} });
  });

  it('★★ an unknown hold mode falls back to all', () => {
    saveFilterState('pipeline.filters', USER, { holdMode: 'sideways' });
    expect(loadPipelineFilters(USER)!.holdMode).toBe('all');
  });
});

describe('fix-403 §1c: the mechanism', () => {
  it('★★★ SESSION scope — sessionStorage, never localStorage', () => {
    // A PREFERENCE is remembered forever; a TRAIN OF THOUGHT is not. Finding
    // yesterday's half-finished filter still applied is a bug, not a feature.
    saveFilterState('ns', USER, { a: 1 });
    expect(window.sessionStorage.getItem(`ns.${USER}`)).toBeTruthy();
    expect(window.localStorage.getItem(`ns.${USER}`)).toBeNull();
  });

  it('★★★ a fresh tab starts clean', () => {
    saveFilterState('ns', USER, { a: 1 });
    window.sessionStorage.clear(); // what a new tab sees
    expect(loadFilterState('ns', USER, (r) => r)).toBeNull();
  });

  it('★★ per USER — one login never inherits another on a shared machine', () => {
    saveFilterState('ns', USER, { a: 1 });
    expect(loadFilterState('ns', 'u-2', (r) => r)).toBeNull();
    // ★ ...and an anonymous caller stores nothing rather than sharing a key.
    saveFilterState('ns', null, { a: 1 });
    expect(loadFilterState('ns', null, (r) => r)).toBeNull();
  });

  it('★★ corrupt storage reads as "never stored" — never throws mid-render', () => {
    window.sessionStorage.setItem(`ns.${USER}`, '{not json');
    expect(loadFilterState('ns', USER, (r) => r)).toBeNull();
    // ...and a decoder that throws is caught too.
    saveFilterState('ns', USER, { a: 1 });
    expect(
      loadFilterState('ns', USER, () => {
        throw new Error('bad shape');
      }),
    ).toBeNull();
  });

  it('★ the coercions: 0 survives, arrays filter, enums fall back', () => {
    expect(numOrNull(0)).toBe(0);
    expect(numOrNull('5')).toBeNull();
    expect(strArray(['a', 2, 'b'])).toEqual(['a', 'b']);
    expect(oneOf('x', ['a', 'b'] as const, 'a')).toBe('a');
    expect(oneOf('b', ['a', 'b'] as const, 'a')).toBe('b');
  });

  it('★ clearing is best-effort and idempotent', () => {
    expect(() => clearFilterState('ns', USER)).not.toThrow();
    expect(() => clearFilterState('ns', null)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §2 · THE BUTTON
// ---------------------------------------------------------------------------

describe('fix-403 §2: Previous goes back where you came from', () => {
  it('★★★ from the Library, back to the Library', () => {
    expect(previousTarget({ from: PREVIOUS_ORIGINS.library })).toEqual({
      to: '/library',
      label: '← Library',
    });
  });

  it('★★★ from the Pipeline, back to the Pipeline', () => {
    expect(previousTarget({ from: PREVIOUS_ORIGINS.pipeline })).toEqual({
      to: '/dashboard',
      label: '← Pipeline',
    });
  });

  it('★★★ NO ORIGIN → exactly the button it replaced', () => {
    // A deep link, a refresh, a link pasted into Slack. The brief offered
    // "hidden or default to Pipeline"; this does neither. Hiding removes the
    // only way back from a page somebody arrived at cold, and defaulting to
    // Pipeline guesses wrong for anyone whose link came out of the Library.
    //
    // ★★ So with no origin it IS the old "← Search" to /projects: the
    // pre-fix-403 behaviour is the floor, and an origin is the only thing that
    // ever changes it. Nobody loses a destination they had yesterday.
    for (const raw of [null, undefined, {}, { from: 42 }, { from: '/evil' }, 'nonsense']) {
      expect(previousTarget(raw)).toEqual({ to: '/projects', label: '← Search' });
    }
  });

  it('★★ the origin is a CLOSED set — an unknown value cannot navigate anywhere', () => {
    expect(Object.values(PREVIOUS_ORIGINS).sort()).toEqual(['/dashboard', '/library']);
    expect(previousTarget({ from: '/settings' }).to).toBe('/projects');
  });

  it('★★ both lists tag their project links with their origin', () => {
    expect(librarySource).toContain('PREVIOUS_ORIGINS.library');
    expect(addrGroupSource).toContain('PREVIOUS_ORIGINS.pipeline');
  });

  it('★★ the chrome renders the resolved target, not a hardcoded /projects', () => {
    const src = projectDetailSource;
    expect(src).toContain('previousTarget(useLocation().state)');
    expect(src).toContain('to={previous.to}');
    expect(src).toContain('{previous.label}');
    // ★ The testid is UNCHANGED, so every existing navigation test still finds
    //   the control it has always found.
    expect(src).toContain('data-testid="project-search-back"');
  });

  it('★★★ the FILTERS do not travel in router state — only the origin does', () => {
    // Router state would restore them for this button alone and forget them for
    // the browser back button and the ribbon. The memory lives in
    // sessionStorage precisely so every route back works.
    const stripped = librarySource.replace(/^\s*\/\/.*$/gm, '');
    expect(stripped).toMatch(/state=\{\{ from: PREVIOUS_ORIGINS\.library \}\}/);
    expect(stripped).not.toMatch(/state=\{\{[^}]*filters/);
  });
});


// ---------------------------------------------------------------------------
// §3 · fix-178's SUPERSESSION, ON THE RECORD
// ---------------------------------------------------------------------------

const prose = (s: string) =>
  s.replace(/^\s*(\/\*+|\*+\/|\*|\/\/)/gm, ' ').replace(/\s+/g, ' ');

describe('fix-403 §3: fix-178 is superseded for the session scope, and says so', () => {
  it('★ fix-178\'s own words are quoted where they are overridden', () => {
    expect(prose(dashboardSource)).toContain(
      "Default 'all'; no persistence (resets each load).",
    );
    expect(prose(dashboardSource)).toContain('supersedes it for the SESSION scope only');
  });

  it('★★ ...and fix-178\'s real concern is preserved — a fresh tab opens on All', () => {
    savePipelineFilters(USER, {
      search: '', holdMode: 'only', ent: [], da: [], dm: [], type: [],
    });
    window.sessionStorage.clear(); // a fresh tab
    expect(loadPipelineFilters(USER)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §4 · THE ENT LIST — widened AND deduped
// ---------------------------------------------------------------------------

function member(over: Partial<TeamMember>): TeamMember {
  return {
    id: 'm', name: 'Someone', role: 'ent', active: true, former: false,
    email: null, notes: null, updated_at: '',
    ...over,
  } as unknown as TeamMember;
}

/** The exact selector `useTeamMembers` now applies to build `ents`. */
const entsOf = (all: TeamMember[]) =>
  dedupeByPerson(all.filter((m) => ENT_ROLES.has(m.role) && isCurrentMember(m)));

describe('fix-403 §4: three people, once each', () => {
  it('★★★ THE PROD SHAPE — dual-role people render ONCE, not twice', () => {
    // Measured 2026-08-25: `ent` and `ent_lead` are the SAME three people.
    // This is why fix-401 called it not-a-copy-paste-fix and reported instead.
    const roster = [
      member({ id: '1', name: 'Bobby', role: 'ent' }),
      member({ id: '2', name: 'Bobby', role: 'ent_lead' }),
      member({ id: '3', name: 'Briana', role: 'ent' }),
      member({ id: '4', name: 'Briana', role: 'ent_lead' }),
      member({ id: '5', name: 'Miles', role: 'ent' }),
      member({ id: '6', name: 'Miles', role: 'ent_lead' }),
    ];
    expect(entsOf(roster).map((m) => m.name)).toEqual(['Bobby', 'Briana', 'Miles']);
  });

  it('★★★ ...and an ent_lead-ONLY person appears, which is the latent bug fixed', () => {
    // Anyone added as ent_lead alone would have vanished from Settings exactly
    // the way Dom did from Acquisitions.
    const roster = [
      member({ id: '1', name: 'Bobby', role: 'ent' }),
      member({ id: '9', name: 'New Lead', role: 'ent_lead' }),
    ];
    expect(entsOf(roster).map((m) => m.name)).toEqual(['Bobby', 'New Lead']);
  });

  it('★★ inactive people stay out — fix-321\'s one membership rule', () => {
    const roster = [
      member({ id: '1', name: 'Bobby', role: 'ent' }),
      member({ id: '2', name: 'Gone', role: 'ent_lead', active: false }),
      member({ id: '3', name: 'Left', role: 'ent', former: true }),
    ];
    expect(entsOf(roster).map((m) => m.name)).toEqual(['Bobby']);
  });

  it('★★ dedupe keeps the FIRST row and is case/whitespace tolerant', () => {
    const rows = [
      { name: 'Bobby', id: 'a' },
      { name: ' bobby ', id: 'b' },
      { name: 'Briana', id: 'c' },
    ];
    expect(dedupeByPerson(rows).map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('★★★ removing a dual-role person removes BOTH rows', () => {
    // The decision, stated: deleting one row would leave the pill on screen
    // (the other row still backs it), so the × would look broken. The Settings
    // list is a list of PEOPLE.
    expect(adminTeamSource).toContain('function findAllByName');
    expect(adminTeamSource).toMatch(
      /function hardDelete[\s\S]{0,200}for \(const m of findAllByName/,
    );
    expect(adminTeamSource).toMatch(
      /function renameSimple[\s\S]{0,200}for \(const m of findAllByName/,
    );
    // ★ Each row carries its OWN OCC token into the delete.
    expect(adminTeamSource).toContain('remove.mutate({ id: m.id, updated_at: m.updated_at })');
  });

  it('★★ the ENT family is a named set beside the ACQ one', () => {
    expect([...ENT_ROLES].sort()).toEqual(['ent', 'ent_lead']);
    expect(adminTeamSource).toContain('ENT_ROLES.has(role)');
  });

  it('★ the ACQUISITIONS list is unaffected — fix-401 still holds', () => {
    // Its two role strings are DISJOINT people, so dedupe changes nothing
    // there; the shared write path is what both lists now use.
    const acqLike = [
      member({ id: '1', name: 'Jessie', role: 'acq' }),
      member({ id: '2', name: 'Dom', role: 'acq_lead' }),
    ];
    expect(dedupeByPerson(acqLike).map((m) => m.name)).toEqual(['Jessie', 'Dom']);
  });
});
