import { describe, it, expect } from 'vitest';
import {
  resolveExternalFirm,
  asExternalTeamBlob,
  distinctExternalFirms,
  externalTeamShowRules,
  directoryFirmsByDiscipline,
  directoryFirmNamesForDiscipline,
  EXTERNAL_TEAM_COMMON_DISCIPLINES,
} from '../lib/externalTeam';
import {
  WAITING_ON_OPTIONS,
  type ExternalTeamDirectoryFirm,
  type WaitingOnDiscipline,
} from '../lib/database.types';

function mkFirm(over: Partial<ExternalTeamDirectoryFirm> & { discipline: string; name: string }): ExternalTeamDirectoryFirm {
  return {
    id: `${over.discipline}-${over.name}`,
    contact_name: null,
    contact_email: null,
    contact_phone: null,
    notes: null,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

// fix-190d: the single resolver from a project's external_team blob to the firm
// working a discipline — the one source both My Tasks → Waiting and the per-task
// Waiting-On sub-label read. Canonical survey term is "Surveyor".

describe('resolveExternalFirm (fix-190d single source)', () => {
  it('224 2nd Ave N: a Surveyor task resolves to "Emerald"', () => {
    expect(resolveExternalFirm({ Surveyor: 'Emerald' }, 'Surveyor')).toBe('Emerald');
  });

  it('13515 27th Ave NE: a Civil task resolves to "Facet"', () => {
    expect(resolveExternalFirm({ Civil: 'Facet' }, 'Civil')).toBe('Facet');
  });

  it('a discipline with no firm on the project → null (correct "no firm assigned")', () => {
    expect(resolveExternalFirm({ Surveyor: 'Emerald' }, 'Civil')).toBeNull();
    expect(resolveExternalFirm({}, 'Surveyor')).toBeNull();
    expect(resolveExternalFirm(null, 'Surveyor')).toBeNull();
  });

  it('the OLD "Survey" term never matches the canonical "Surveyor" blob key', () => {
    // The migration flips tasks to "Surveyor"; a stray "Survey" must not resolve.
    expect(resolveExternalFirm({ Surveyor: 'Emerald' }, 'Survey')).toBeNull();
  });

  it('null / empty / blank discipline or firm → null', () => {
    expect(resolveExternalFirm({ Surveyor: '' }, 'Surveyor')).toBeNull();
    expect(resolveExternalFirm({ Surveyor: '   ' }, 'Surveyor')).toBeNull();
    expect(resolveExternalFirm({ Surveyor: 'Emerald' }, null)).toBeNull();
    expect(resolveExternalFirm({ Surveyor: 'Emerald' }, '')).toBeNull();
  });
});

describe('asExternalTeamBlob', () => {
  it('passes a plain object through, rejects arrays/null/primitives', () => {
    expect(asExternalTeamBlob({ Civil: 'Facet' })).toEqual({ Civil: 'Facet' });
    expect(asExternalTeamBlob(null)).toBeNull();
    expect(asExternalTeamBlob(undefined)).toBeNull();
    expect(asExternalTeamBlob([])).toBeNull();
    expect(asExternalTeamBlob('x')).toBeNull();
  });
});

describe('distinctExternalFirms (fix-195 datalist source)', () => {
  it('collects the distinct firm names across all projects blobs, sorted + deduped', () => {
    const projects = [
      { external_team: { Civil: 'Facet' } },
      { external_team: { Surveyor: 'Emerald' } },
      { external_team: { Structural: 'SSS', Surveyor: 'Emerald' } }, // dup Emerald
      { external_team: {} },
      { external_team: null },
      {}, // missing
    ];
    expect(distinctExternalFirms(projects)).toEqual(['Emerald', 'Facet', 'SSS']);
  });

  it('trims + case-folds duplicates (keeps first-seen display), skips blanks', () => {
    const projects = [
      { external_team: { Civil: ' Emerald ' } },
      { external_team: { Surveyor: 'emerald' } }, // same firm, different case
      { external_team: { Structural: '   ' } }, // blank → skipped
    ];
    expect(distinctExternalFirms(projects)).toEqual(['Emerald']);
  });

  it('empty input → empty list', () => {
    expect(distinctExternalFirms([])).toEqual([]);
  });
});

describe('externalTeamShowRules (fix-196 shared show-rules)', () => {
  const NONE = new Set<WaitingOnDiscipline>();

  it('the common four are always shown, even on an empty blob', () => {
    const r = externalTeamShowRules({}, NONE);
    expect(r.shownDisciplines).toEqual(['Civil', 'Surveyor', 'Structural', 'Arborist']);
    expect(EXTERNAL_TEAM_COMMON_DISCIPLINES).toEqual([
      'Civil',
      'Surveyor',
      'Structural',
      'Arborist',
    ]);
    expect(r.noneAssigned).toBe(true);
  });

  it('an assigned non-common discipline becomes shown (224 2nd Ave N: only Surveyor set → common four, NOT all 13)', () => {
    const r = externalTeamShowRules({ Surveyor: 'Emerald' }, NONE);
    // Surveyor is common anyway; assert a NON-common assigned one surfaces:
    const r2 = externalTeamShowRules({ Geotech: 'GeoCo' }, NONE);
    expect(r2.shownDisciplines).toContain('Geotech');
    expect(r2.noneAssigned).toBe(false);
    // 224 case: Surveyor set → exactly the common four are shown (not 13).
    expect(r.shownDisciplines).toEqual(['Civil', 'Surveyor', 'Structural', 'Arborist']);
    expect(r.shownDisciplines).toHaveLength(4);
    expect(r.noneAssigned).toBe(false);
  });

  it('a user-added discipline becomes shown + drops out of addable', () => {
    const r = externalTeamShowRules({}, new Set<WaitingOnDiscipline>(['Energy']));
    expect(r.shownDisciplines).toContain('Energy');
    expect(r.addableDisciplines).not.toContain('Energy');
  });

  it('addable = WAITING_ON_OPTIONS minus shown', () => {
    const r = externalTeamShowRules({ Geotech: 'GeoCo' }, NONE);
    const shown = new Set(r.shownDisciplines);
    for (const d of WAITING_ON_OPTIONS) {
      expect(shown.has(d) || r.addableDisciplines.includes(d)).toBe(true);
      expect(shown.has(d) && r.addableDisciplines.includes(d)).toBe(false);
    }
    expect(r.addableDisciplines).not.toContain('Geotech');
    expect(r.addableDisciplines).not.toContain('Civil');
  });

  it('blank / whitespace firm values do not count as assigned', () => {
    const r = externalTeamShowRules({ Geotech: '   ', Energy: '' }, NONE);
    expect(r.assignedDisciplines.has('Geotech')).toBe(false);
    expect(r.shownDisciplines).not.toContain('Geotech');
    expect(r.noneAssigned).toBe(true);
  });
});

describe('canonical vocabulary (fix-190d)', () => {
  it('WAITING_ON_OPTIONS uses "Surveyor", never "Survey"', () => {
    expect(WAITING_ON_OPTIONS).toContain('Surveyor');
    expect(WAITING_ON_OPTIONS).not.toContain('Survey');
  });
});

// fix-227: the central directory helpers that feed the per-project picker.
describe('directoryFirmsByDiscipline (fix-227)', () => {
  const firms = [
    mkFirm({ discipline: 'Surveyor', name: 'Emerald' }),
    mkFirm({ discipline: 'Surveyor', name: 'Bush' }),
    mkFirm({ discipline: 'Surveyor', name: 'OldCo', active: false }),
    mkFirm({ discipline: 'Civil', name: 'Facet' }),
  ];

  it('groups by discipline, active-before-inactive then A→Z by name', () => {
    const m = directoryFirmsByDiscipline(firms);
    expect(m.get('Surveyor')!.map((f) => f.name)).toEqual(['Bush', 'Emerald', 'OldCo']);
    expect(m.get('Civil')!.map((f) => f.name)).toEqual(['Facet']);
  });

  it('activeOnly drops deactivated firms', () => {
    const m = directoryFirmsByDiscipline(firms, { activeOnly: true });
    expect(m.get('Surveyor')!.map((f) => f.name)).toEqual(['Bush', 'Emerald']);
  });

  it('handles null / empty input', () => {
    expect(directoryFirmsByDiscipline(null).size).toBe(0);
    expect(directoryFirmsByDiscipline([]).size).toBe(0);
  });
});

describe('directoryFirmNamesForDiscipline (fix-227 dropdown options)', () => {
  const firms = [
    mkFirm({ discipline: 'Surveyor', name: 'Emerald' }),
    mkFirm({ discipline: 'Surveyor', name: 'Bush' }),
    mkFirm({ discipline: 'Surveyor', name: 'emerald' }), // case-dupe → one
    mkFirm({ discipline: 'Surveyor', name: 'OldCo', active: false }), // inactive → out
    mkFirm({ discipline: 'Civil', name: 'Facet' }), // other discipline → out
  ];

  it('returns the ACTIVE firm names for a discipline, deduped + sorted', () => {
    expect(directoryFirmNamesForDiscipline(firms, 'Surveyor')).toEqual(['Bush', 'Emerald']);
  });

  it('returns [] for a discipline with no active firms', () => {
    expect(directoryFirmNamesForDiscipline(firms, 'Structural')).toEqual([]);
    expect(directoryFirmNamesForDiscipline(null, 'Surveyor')).toEqual([]);
  });
});
