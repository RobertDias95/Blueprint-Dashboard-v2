import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { existsSync } from 'node:fs';
import { LIBRARY_UNIT_COLUMNS } from '../lib/libraryUnitColumns';
import { LIBRARY_SITE_SHARED_FIELDS } from '../lib/librarySiteFields';
import { resolve } from 'node:path';
import {
  PROJECT_DETAILS_SEARCH,
  projectDetailsFormIsDirty,
  initProjectDetailsForm,
  searchEntries,
} from '../lib/projectDetailsForm';
import { PROJECT_DATA_TABS } from '../lib/projectDataTabs';
import { SORTABLE_COLUMNS } from '../lib/libraryHelpers';
import type { Project, PermitWithCycles } from '../lib/database.types';

import modalSrc from '../components/ProjectDetail/ProjectDetailsModal.tsx?raw';
import formSrc from '../components/ProjectDetail/ProjectDetailsForm.tsx?raw';
import controllerSrc from '../hooks/useProjectDetailsForm.ts?raw';
import editorsSrc from '../components/ProjectDetail/ProjectDataEditors.tsx?raw';
import librarySrc from '../components/LibraryMatrix.tsx?raw';
import pageSrc from '../pages/ProjectDetail.tsx?raw';
import consultantHookSrc from '../hooks/useProjectConsultants.ts?raw';
import consultantMigration from '../../migrations/fix_514_remove_project_consultant.sql?raw';

// ===========================================================================
// fix-514 (P-191 · P-181 · P-196 · P-215 · P-216 · P-221) — WHERE DOES EDITING
// HAPPEN? ONE MODAL, ONE ANSWER
// ===========================================================================
//
// All six answer one question, and answering it in six places would produce six
// answers. ★ This is the SECOND HALF of fix-506, which recorded its own
// deviation plainly: *"`ProjectSettingsModal` **survives** — Project Data is
// the button users see; the old modal was not deleted in this ticket."* Bobby
// found the seam it left — **a modal that tells you to open another modal.**

function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

// ---------------------------------------------------------------------------
// §A — Project Settings stops existing
// ---------------------------------------------------------------------------

describe('fix-514 §A — Project Data becomes Project Details, and Project Settings is deleted', () => {
  it('★★★ `ProjectSettingsModal` and its three test files are GONE from disk', () => {
    // ★ DELETED, not deprecated. §A: *"A surviving modal is what produced this
    //   ticket."*
    for (const f of [
      'src/components/ProjectDetail/ProjectSettingsModal.tsx',
      'src/__tests__/ProjectSettingsModal.test.tsx',
      'src/__tests__/ProjectSettingsModalAutoseed.test.tsx',
      'src/__tests__/ProjectSettingsModalSave.test.tsx',
    ]) {
      expect(existsSync(resolve(process.cwd(), f)), f).toBe(false);
    }
  });

  it('★★★ nothing in the app still OPENS it, and the page state went too', () => {
    const p = code(pageSrc);
    expect(p).not.toContain('ProjectSettingsModal');
    expect(p).not.toContain('setSettingsOpen');
    expect(p).toContain('ProjectDetailsModal');
  });

  it('★★★ no hand-off survives — the modal that told you to open another modal', () => {
    const m = code(modalSrc);
    expect(m).not.toContain('onOpenSettings');
    expect(m).not.toContain('HandOff');
    // …and no caption still names the retired surface.
    expect(m).not.toContain('in Project Settings');
    expect(m).not.toContain('Project Settings→');
  });

  it('★★★ the surface is called Project Details', () => {
    expect(code(modalSrc)).toContain('Project Details');
    expect(code(modalSrc)).not.toMatch(/>\s*Project Data\s*</);
  });

  it('★★★ §A0 LEFTOVER SET IS ZERO — every field Project Settings owned has a tab', () => {
    // ★★ §A0's enumeration, as a list a test can read. Each entry is a field or
    //    action the deleted modal owned; each names the tab it landed on. "The
    //    leftover count is now zero" means this list has no gaps, not that
    //    somebody looked.
    const leftovers: { label: string; tab: string }[] = [
      { label: 'Address', tab: 'site' },
      { label: 'Jurisdiction', tab: 'site' },
      { label: 'GO date', tab: 'dates' },
      { label: 'Unit count', tab: 'units' },
      // ★ fix-520 §C (P-229): the field is labelled `Types` now — *"unit type
      //   and product type are the same thing"*. The COLUMN it writes
      //   (`projects.product_types`) is untouched, and the old words are still
      //   search terms so it stays findable by the name half the team uses.
      { label: 'Types', tab: 'units' },
      { label: 'Permit type', tab: 'permits' },
      { label: 'Permit number', tab: 'permits' },
      { label: 'Permit portal URL', tab: 'permits' },
      { label: 'Structure address', tab: 'permits' },
      { label: 'Permit PERM lead / DA', tab: 'permits' },
      { label: 'Point of contact', tab: 'builder' },
      { label: 'Contact email', tab: 'builder' },
      { label: 'Acquisitions', tab: 'team' },
      { label: 'Permitting lead', tab: 'team' },
      { label: 'Design manager', tab: 'team' },
      { label: 'Design associate', tab: 'team' },
      { label: 'Construction admin', tab: 'team' },
      { label: 'Schematic designer', tab: 'team' },
      { label: 'Archive', tab: 'actions' },
      { label: 'Backfill', tab: 'actions' },
    ];
    for (const l of leftovers) {
      const hit = PROJECT_DETAILS_SEARCH.find((e) => e.label === l.label);
      expect(hit, `${l.label} has no home`).toBeTruthy();
      expect(hit!.key, l.label).toBe(l.tab);
    }
  });

  it('★★★ …and each of those fields has a real CONTROL, not just an index entry', () => {
    const f = code(formSrc);
    for (const testid of [
      'psm-address',
      'psm-juris',
      'psm-go',
      'psm-units',
      'psm-product-types-select',
      'psm-acq',
      'psm-ent',
      'psm-dm',
      'psm-da',
      'psm-ca',
      'psm-sd',
      'psm-poc-name',
      'psm-poc-email',
      'psm-archived',
      'psm-is-backfill',
      'psm-add-permit',
    ]) {
      expect(f, testid).toContain(testid);
    }
  });

  it('★★ the ninth tab exists, and §A0 proposed it rather than inventing it', () => {
    expect(PROJECT_DATA_TABS.map((t) => t.key)).toContain('permits');
    // ★ The tab list is the single source the strip, the URL parameter and the
    //   Library links all read (fix-506 §G/§H), so adding one is one edit.
    expect(PROJECT_DATA_TABS).toHaveLength(9);
  });

  it('★★ the atomic save is the deleted modal\'s, moved not rewritten', () => {
    const c = code(controllerSrc);
    // ★ The RPC name lives in the hook this calls — the point is that the save
    //   goes through fix-36's atomic path, unchanged, not that the string moved.
    expect(c).toContain('useUpdateProjectWithPermits');
    expect(c).toContain('updateProjectWithPermits.mutateAsync');
    expect(c).toContain('projectExpectedUpdatedAt: project.updated_at');
    // ★★★ fix-520 §A: fix-511 §C's lot-size bound is no longer HERE, because
    //     `lot_size_sf` is no longer in this save. It is enforced on blur by
    //     `LotSizeEditor`, which is the surface that writes the column — see
    //     `LotSizeBoundFix511`, where the claim moved with it. A guard over a
    //     value this function cannot send can only ever pass.
    expect(c).not.toContain('parseLotSizeSf');
    // fix-36's rule survived it too.
    expect(c).toContain('if (saving) return;');
  });
});

// ---------------------------------------------------------------------------
// §B — Save vs Exit
// ---------------------------------------------------------------------------

function project(): Project {
  return {
    id: 'p1',
    address: '100 Apple Way',
    juris: 'Seattle',
    updated_at: '2026-09-10T00:00:00Z',
    go_date: null,
    units: 2,
    zone: null,
    lot_width: null,
    lot_depth: null,
    lot_size_sf: null,
    alley: null,
    product_types: [],
    project_tags: [],
    unit_types: null,
    archived: false,
    is_backfill: null,
  } as unknown as Project;
}
function permit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 1,
    project_id: 'p1',
    type: 'Building Permit',
    da: 'Trevor',
    ent_lead: null,
    num: null,
    portal_url: null,
    struct_address: null,
    expected_issue: '2026-08-01',
    updated_at: '2026-09-10T00:00:00Z',
    permit_cycles: [],
    ...over,
  } as unknown as PermitWithCycles;
}

describe('fix-514 §B — Save vs Exit is a dirty-state contract, not a label', () => {
  it('★★★ an untouched form is CLEAN', () => {
    const f = initProjectDetailsForm(project(), [permit()]);
    expect(projectDetailsFormIsDirty(f, f)).toBe(false);
  });

  it('★★★ SUPERSEDED by fix-520 §A — a changed PERMIT is dirty; a scalar cannot be', () => {
    // ★★★ fix-514 §B made the footer read Save/Exit off a comparison against
    //     what loaded, which was right while this button wrote every field.
    //     **fix-520 §A moved every project scalar to a blur commit**, so there
    //     is no such thing as an unsaved address: by the time the box loses
    //     focus it is in the database or it was refused. The button — and
    //     therefore the flag — is about permit rows now.
    const a = initProjectDetailsForm(project(), [permit()]);
    expect(projectDetailsFormIsDirty(a, { ...a, address: '200 Pear St' })).toBe(false);
    expect(
      projectDetailsFormIsDirty(a, {
        ...a,
        permits: a.permits.map((p) => ({ ...p, num: 'BP-CHANGED' })),
      }),
    ).toBe(true);
  });

  it('★★★ …including a PERMIT row, and including its ACQ date', () => {
    const a = initProjectDetailsForm(project(), [permit()]);
    const b = {
      ...a,
      permits: a.permits.map((p) => ({ ...p, expected_issue: '2026-09-15' })),
    };
    expect(projectDetailsFormIsDirty(a, b)).toBe(true);
  });

  it('★★ adding or removing a permit row is dirty before a character is typed', () => {
    const a = initProjectDetailsForm(project(), [permit()]);
    expect(
      projectDetailsFormIsDirty(a, {
        ...a,
        permits: a.permits.map((p) => ({ ...p, isDeleted: true })),
      }),
    ).toBe(true);
    expect(
      projectDetailsFormIsDirty(a, { ...a, permits: [...a.permits, a.permits[0]] }),
    ).toBe(true);
  });

  it('★★★ CHANGED BACK reads as clean — it is a comparison, not a touched-flag', () => {
    // ★ Typing a character and deleting it again is exactly the state the
    //   button is supposed to distinguish, so `onChange → dirty = true` would
    //   answer the wrong question.
    // ★ fix-520 §A: stated on a PERMIT field, which is the only thing this
    //   flag still watches. The rule — a value typed and undone reads clean —
    //   is fix-514 §B's and is unchanged.
    const a = initProjectDetailsForm(project(), [permit()]);
    const b = { ...a, permits: a.permits.map((p) => ({ ...p, num: 'BP-2' })) };
    const c = { ...b, permits: a.permits };
    expect(projectDetailsFormIsDirty(a, b)).toBe(true);
    expect(projectDetailsFormIsDirty(a, c)).toBe(false);
  });

  it('★★★ ONE flag for the modal, not one per tab', () => {
    // ★ §B says so, and the reason is that a per-tab flag shows `Exit` while an
    //   unsaved edit sits on the tab you are not looking at. The comparison is
    //   over the WHOLE form, and the modal reads `ctl.dirty` — one value.
    const m = code(modalSrc);
    expect(m).toContain('ctl.dirty');
    expect(m).not.toMatch(/dirtyByTab|tabDirty/);
    const perTab = (m.match(/ctl\.dirty/g) ?? []).length;
    expect(perTab).toBeGreaterThan(0);
  });

  it('★★★ the button reads Exit when clean and Save when dirty', () => {
    const m = code(modalSrc);
    expect(m).toMatch(/ctl\.dirty \? 'Save' : 'Exit'/);
    expect(m).not.toContain(">Done<");
  });
});

// ---------------------------------------------------------------------------
// §C — search
// ---------------------------------------------------------------------------

describe('fix-514 §C — type a field name, land on its tab', () => {
  it('★★★ a field name resolves to its tab', () => {
    expect(searchEntries(PROJECT_DETAILS_SEARCH, 'jurisdiction')[0]?.key).toBe('site');
    expect(searchEntries(PROJECT_DETAILS_SEARCH, 'backfill')[0]?.key).toBe('actions');
    expect(searchEntries(PROJECT_DETAILS_SEARCH, 'portal')[0]?.key).toBe('permits');
    expect(searchEntries(PROJECT_DETAILS_SEARCH, 'square footage')[0]?.key).toBe('units');
    expect(searchEntries(PROJECT_DETAILS_SEARCH, 'tags')[0]?.key).toBe('site');
  });

  it('★★ a prefix match outranks a substring one', () => {
    const hits = searchEntries(PROJECT_DETAILS_SEARCH, 'lot');
    expect(hits[0]?.label.toLowerCase().startsWith('lot')).toBe(true);
  });

  it('★★ an empty query offers nothing rather than everything', () => {
    expect(searchEntries(PROJECT_DETAILS_SEARCH, '')).toEqual([]);
    expect(searchEntries(PROJECT_DETAILS_SEARCH, '   ')).toEqual([]);
  });

  it('★★★ the matcher is GENERIC, so P-166 inherits it rather than re-implementing', () => {
    // ★ §C: *"same mechanism, smaller tree. Build it here and P-166 inherits a
    //   working pattern."* It knows nothing about projects.
    const settingsLike = [
      { key: 'notifications', label: 'Notifications', terms: ['notification', 'alerts'] },
      { key: 'roster', label: 'Roster', terms: ['roster', 'people', 'team'] },
    ] as const;
    expect(searchEntries(settingsLike, 'people')[0]?.key).toBe('roster');
  });

  it('★★ every entry points at a REAL tab', () => {
    const keys = new Set(PROJECT_DATA_TABS.map((t) => t.key));
    for (const e of PROJECT_DETAILS_SEARCH) {
      expect(keys.has(e.key), e.label).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// §D — remove a consultant
// ---------------------------------------------------------------------------

describe('fix-514 §D — remove goes through an RPC, and nothing is hard-deleted', () => {
  it('★★★ there is an RPC, and the hook calls it', () => {
    expect(code(consultantHookSrc)).toContain("supabase.rpc('bp_remove_project_consultant'");
    expect(consultantMigration).toContain(
      'CREATE OR REPLACE FUNCTION public.bp_remove_project_consultant',
    );
  });

  it('★★★ a removed consultant\'s rounds are VOIDED, never deleted', () => {
    const sql = consultantMigration;
    expect(sql).toContain('SET voided_at = v_now');
    expect(sql).toContain('SET removed_at = v_now');
    // ★★★ THE ASSERTION THAT MATTERS: no DELETE anywhere. The rounds FK is
    //     ON DELETE CASCADE, so a DELETE on the consultant destroys history.
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.project_consultant/i);
  });

  it('★★ the view is where the removal takes effect — one clause, every reader', () => {
    expect(consultantMigration).toContain('WHERE c.removed_at IS NULL');
  });

  it('★★ it keeps the same OCC contract as every other consultant write', () => {
    expect(consultantMigration).toContain('v_actual IS DISTINCT FROM p_expected_updated_at');
    expect(code(consultantHookSrc)).toContain('p_expected_updated_at: input.expectedUpdatedAt');
  });
});

// ---------------------------------------------------------------------------
// §E — a unit's square footage
// ---------------------------------------------------------------------------

describe('fix-514 §E — unit size is TYPED and never computed', () => {
  it('★★★ there is an editor, writing size_sf through the unit_types path', () => {
    const e = code(editorsSrc);
    expect(e).toContain('export function UnitSizeEditor');
    expect(e).toContain('size_sf: size');
    expect(e).toContain("patch: { unit_types: resolveUnitTypesForSave(next, productTypes) }");
  });

  it('★★★ SIZE IS NEVER COMPUTED FROM WIDTH × DEPTH — the failure mode, asserted', () => {
    // ★★★ §E: *"The dash is correct. Do NOT make this a derivation."* A unit's
    //     footprint is not its bounding box, and P-161 reopened on 2026-09-09
    //     when two "regular" lots turned out to record MORE area than their own
    //     box holds. 20 × 35 is not the answer.
    const e = code(editorsSrc);
    const start = e.indexOf('export function UnitSizeEditor');
    const body = e.slice(start, start + 4000);
    expect(body).not.toMatch(/width_ft\s*\*\s*depth_ft/);
    expect(body).not.toMatch(/depth_ft\s*\*\s*width_ft/);
    expect(body).not.toContain('lotSizeView');
  });

  it('★★ it is not a ninth matrix column — that costs the Overview 76px', () => {
    // fix-488 §B measured it and reverted: `UNIT_ROW_COLUMNS` drives
    // `UNIT_MATRIX_GRID` AND `overviewCardLayout`'s PROJECT card floor.
    expect(code(modalSrc)).toContain('<UnitSizeEditor project={project} />');
  });

  it('★★ blank clears — "not recorded" is a real answer', () => {
    expect(code(editorsSrc)).toMatch(/n !== null && Number\.isFinite\(n\) && n > 0 \? n : null/);
  });
});

// ---------------------------------------------------------------------------
// §F — project tags
// ---------------------------------------------------------------------------

describe('fix-514 §F — the tag editor reads its registry', () => {
  it('★★★ it offers ONLY registry values — never a free-text box', () => {
    const e = code(editorsSrc);
    expect(e).toContain('export function ProjectTagsEditor');
    expect(e).toContain("readAppConfigStringArray(appConfigQ.map, 'projectTagOptions')");
    const start = e.indexOf('export function ProjectTagsEditor');
    const body = e.slice(start, start + 4000);
    // A <select> over the registry, not an <input type="text">.
    expect(body).toContain('<select');
    expect(body).not.toMatch(/<input[^>]*type="text"/);
  });

  it('★★★ Schematic, Construction Admin and Acquisitions are not offerable', () => {
    // ★★★ P-163 ruled all three OUT of the tag set. The editor cannot put them
    //     back because it cannot offer anything the registry does not hold —
    //     which is why the ruling is enforced where it was made.
    //     ★ VERIFIED ON PROD 2026-09-10: `projectTagOptions` =
    //       ECA · SIP · TRAO · LBA · Short Plat · Through Lot · Trolley Lines.
    const e = code(editorsSrc);
    const start = e.indexOf('export function ProjectTagsEditor');
    const body = e.slice(start, start + 4000);
    for (const banned of ['Schematic', 'Construction Admin', 'Acquisitions']) {
      expect(body, banned).not.toContain(banned);
    }
    // …and there is no hard-coded vocabulary of any kind.
    expect(body).not.toMatch(/=\s*\[\s*'[A-Z]{2,}'/);
  });

  it('★★ a stored tag no longer in the registry still renders and is still removable', () => {
    // fix-93's rule: pruning the option list must never strand historical data.
    const e = code(editorsSrc);
    const start = e.indexOf('export function ProjectTagsEditor');
    const body = e.slice(start, start + 4000);
    // Chips render from `chosen` (what is stored), not from `options`.
    expect(body).toContain('chosen.map((t)');
    expect(body).toContain('pd-tag-remove-');
  });
});

// ---------------------------------------------------------------------------
// §H — the Library
// ---------------------------------------------------------------------------

describe('fix-514 §H — the Library reads left-to-right like its filters', () => {
  const l = code(librarySrc);

  it('★★★ the Site tab reads address · lot W · lot D · lot SF · juris · zone · alley · corner', () => {
    // ★ Scoped to the SITE table — the UNIT table above it has its own
    //   `col="juris"`, and an unscoped scan reads the wrong header row.
    // ★★★ fix-519 §C: `juris · zone · alley` are no longer three literals in
    //     this markup — they render from `LIBRARY_SITE_SHARED_FIELDS`, because
    //     the FILTER BOX has to read them in the same order and a comment was
    //     not keeping the two honest. The run is expanded back in here so this
    //     test keeps asserting the SAME claim about the SAME table.
    const site = l
      .slice(l.indexOf('data-testid="library-table"'))
      .replace(
        /\{LIBRARY_SITE_SHARED_FIELDS\.map[\s\S]*?\)\)\}/,
        LIBRARY_SITE_SHARED_FIELDS.map((f) => `col="${f.key}"`).join(' '),
      );
    const order = [...site.matchAll(/col="(\w+)"/g)]
      .map((m) => m[1])
      .filter((c, i, a) => a.indexOf(c) === i);
    const idx = (c: string) => order.indexOf(c);
    for (const [a, b] of [
      ['address', 'lotWidth'],
      ['lotWidth', 'lotDepth'],
      ['lotDepth', 'lotSizeSf'],
      ['lotSizeSf', 'juris'],
      ['juris', 'zone'],
      ['zone', 'alley'],
      ['alley', 'isCornerLot'],
      ['isCornerLot', 'stage'],
    ] as const) {
      expect(idx(a), `${a} before ${b}`).toBeLessThan(idx(b));
    }
  });

  it('★★★ `Lot W×D` split into two, and depth got a sort key AND an arm', () => {
    // fix-410's warning: a name in SORTABLE_COLUMNS without a handler falls
    // through to `localeCompare` on a number and throws during render.
    expect(SORTABLE_COLUMNS).toContain('lotDepth');
    expect(l).toContain('library-lot-w-');
    expect(l).toContain('library-lot-d-');
    expect(l).not.toContain('Lot W×D');
  });

  it('★★★ the `Shape` column is gone from the Site tab', () => {
    expect(l).not.toContain('isRegularShape');
    expect(l).not.toContain('library-regular-shape-');
  });

  it('★★★ no `Edit in Project Data` string survives anywhere in the app', () => {
    expect(l).not.toContain('Edit in Project Data');
    expect(l).not.toContain('library-unit-edit-');
  });

  it('★★ the Unit tab reads width · depth · size · parking · stalls · roof deck', () => {
    // ★★★ fix-519 §A (P-230) — THE ORDER IS DATA NOW, AND THAT IS THE FIX.
    //     This test used to scan the markup for `col="…"` because the order
    //     lived in the markup — in TWO copies of it, the `<thead>` here and
    //     `LibraryUnitRow`'s cells 500 lines below. **§H reordered one of
    //     them**, so `roof_deck` printed under STORIES and `parking_kind`
    //     under ROOF DECK on every project for two tickets. Both readers now
    //     render from `LIBRARY_UNIT_COLUMNS`, so the claim is asserted where
    //     the order actually lives.
    const order: string[] = LIBRARY_UNIT_COLUMNS.map((c) => String(c.col));
    const idx = (c: string) => order.indexOf(c);
    for (const [a, b] of [
      ['width', 'depth'],
      ['depth', 'size'],
      ['size', 'parking'],
      ['parking', 'stalls'],
      ['stalls', 'roofDeck'],
    ] as const) {
      expect(idx(a), `${a} before ${b}`).toBeLessThan(idx(b));
    }
    // ★ `stage` is a PROJECT cell and is not in the list; it still trails the
    //   unit run in the markup, which is the half the list does not own.
    const u = l.slice(l.indexOf('library-table-unit'));
    expect(u.indexOf('LIBRARY_UNIT_COLUMNS.map')).toBeLessThan(
      u.indexOf('col="stage"'),
    );
  });

  it('★★ `projectDataHref` stays — the deep link is not the signpost', () => {
    // ★ fix-362 §2's rule (a link you cannot paste is not a link) is
    //   unaffected: `?data=units` still opens the modal on a tab.
    expect(existsSync(resolve(process.cwd(), 'src/lib/projectDataTabs.ts'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The rendered modal — one smoke test that the tabs actually mount
// ---------------------------------------------------------------------------

vi.mock('../hooks/useUpdateProjectWithPermits', () => ({
  useUpdateProjectWithPermits: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { renderProjectData } from '../test/renderProjectData';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fix-514 — the modal, rendered', () => {
  it('★★★ the Permits tab shows one ACQ box per permit', () => {
    renderProjectData(project(), [permit(), permit({ id: 2, type: 'ULS', expected_issue: '2027-01-01' })], 'permits');
    expect(screen.getByTestId('psm-permit-acq-1')).toBeInTheDocument();
    expect((screen.getByTestId('psm-permit-acq-2') as HTMLInputElement).value).toBe('2027-01-01');
  });

  it('★★★ the header search moves the modal to a tab', () => {
    renderProjectData(project(), [permit()], 'site');
    fireEvent.change(screen.getByTestId('project-details-search'), {
      target: { value: 'backfill' },
    });
    fireEvent.click(screen.getByTestId('project-details-search-hit-actions'));
    expect(screen.getByTestId('project-data-modal').getAttribute('data-tab')).toBe('actions');
  });

  it('★★★ SUPERSEDED by fix-520 §A — Exit becomes Save on a PERMIT edit', () => {
    // ★★★ It used to flip on any field, because the button wrote any field.
    //     Every scalar commits on blur now, so typing an address leaves the
    //     button on `Exit` — correctly: there is nothing unsaved to save.
    //     The Permits tab is the one place a change can still be pending.
    renderProjectData(project(), [permit()], 'permits');
    expect(screen.getByTestId('project-data-done').textContent).toContain('Exit');
    fireEvent.click(screen.getByTestId('psm-add-permit'));
    expect(screen.getByTestId('project-data-done').textContent).toContain('Save');
  });
});
