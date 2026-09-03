import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import migrationSql from '../../migrations/fix_486_unit_type_vocabulary.sql?raw';
import UnitTypesEditor from '../components/wizard/UnitTypesEditor';
import {
  isOffListUnitLabel,
  parseUnitTypes,
  productTypeRegistry,
  unitLabelOptions,
} from '../lib/unitTypeNaming';
import {
  SPLIT_LABEL,
  UNIT_TYPE_MAPPING,
  WIZARD_PLACEHOLDER_LABELS,
  isWizardPlaceholderLabel,
  mapProductTypeList,
  mapProjectProductType,
  mapUnitLabel,
  mapUnitType,
  unitLabelNeedsType,
} from '../lib/unitTypeVocabulary';

// ===========================================================================
// ★★★ fix-486 (P-143) — Detached · Attached · ADU · DADU · Remodel
// ===========================================================================
//
// Bobby, 2026-09-02/03: *"attached, detached, ADU, DADU, and then remodel. We
// can easily take whatever we have and map it to these types, then update our
// settings."* And the rule: *"a cottage is detached, an SFR is detached, a
// duplex (or triplex or ^plex) is attached."*
//
// ---------------------------------------------------------------------------
// ★★★ THE FIVE ARE NOT A CONSTANT ANYWHERE IN `src/`, AND THAT IS DELIBERATE
// ---------------------------------------------------------------------------
// The registry is DATA — `app_config.productTypeOptions`, written by Settings →
// Lists & Catalogs, read by every picker (fix-232). A constant naming the five
// would be a SECOND answer to "what types exist", and the first ticket to add a
// sixth would be the one that discovered they disagreed. So the five appear
// exactly twice: in the migration that writes the registry row, and in this
// file, which reads that migration and holds it to it.
//
// `lib/unitTypeVocabulary` holds only what is a RULE rather than a catalogue:
// how the OLD vocabulary maps onto the new one, and what the wizard's seed
// letters are.

/** ★ The five, in Bobby's order — parsed OUT of the migration, never retyped.
 *  If the migration writes a different list, every assertion here moves with
 *  it rather than quietly disagreeing with prod. */
const FIVE: string[] = (() => {
  // ★ The `?raw` trap (fix-406): a raw import can come back EMPTY under vitest
  //   depending on the plugin chain, and an empty string parses to an empty
  //   list that then passes every "does not contain" assertion. Assert the file
  //   arrived before trusting anything read out of it.
  expect(migrationSql.length).toBeGreaterThan(2000);
  const m = migrationSql.match(
    /set value = '(\[[^']*\])'::jsonb,\s*\n\s*updated_at = now\(\)\s*\n\s*where key = 'productTypeOptions'/,
  );
  expect(m, 'the migration must write productTypeOptions').toBeTruthy();
  return JSON.parse(m![1]) as string[];
})();

// ---------------------------------------------------------------------------
// §B · WHAT WAS THERE, MEASURED ON PROD 2026-09-03 (the day the remap ran)
// ---------------------------------------------------------------------------

/** `projects.product_types` — 280 values across 202 of 211 projects. */
const BEFORE_PRODUCT_TYPES: ReadonlyArray<readonly [string, number]> = [
  ['SFR', 117],
  ['Duplex', 83],
  ['DADU', 34],
  ['SFR+ADU', 30],
  ['ADU', 6],
  ['Remodel', 6],
  ['Cottages', 4],
];

/** `projects.unit_types[].label` — 245 rows on 106 projects. */
const BEFORE_UNIT_LABELS: ReadonlyArray<readonly [string, number]> = [
  ['SFR', 107],
  ['Duplex', 102],
  ['Cottages', 6],
  ['SFR+ADU', 6],
  ['SFR w/ Accessory Units', 4],
  ['Type A', 4],
  ['Type B', 4],
  ['DADU', 3],
  ['Remodel', 3],
  ['SFR + Attached Units', 2],
  ['Type C', 2],
  ['ADU', 1],
  ['Type D', 1],
];

describe('fix-486 §A: the five, and where they come from', () => {
  it('★★★ the migration writes exactly Bobby\'s five, in his order', () => {
    expect(FIVE).toEqual(['Detached', 'Attached', 'ADU', 'DADU', 'Remodel']);
  });

  it('★★★ no module in src/ declares the five as a constant', () => {
    // ★★★ THE POINT OF THE WHOLE REGISTRY PATTERN, asserted rather than
    //     described. A hard-coded list is invisible until Settings and the app
    //     disagree, and the person who adds a sixth type will not think to
    //     grep. This fails the moment somebody writes one down.
    const hits: string[] = [];
    for (const file of sourceFiles()) {
      const body = stripComments(readFileSync(file, 'utf8'));
      if (/\[\s*'Detached'\s*,\s*'Attached'\s*,/.test(body)) hits.push(file);
    }
    expect(hits).toEqual([]);
  });

  it('★★ the vocabulary module holds RULES, not the catalogue', () => {
    const body = readFileSync(
      resolve(process.cwd(), 'src/lib/unitTypeVocabulary.ts'),
      'utf8',
    );
    // The mapping's VALUES are the five (they have to be — that is where old
    // values land), but there is no exported list of them to read as a registry.
    expect(body).not.toMatch(/export const [A-Z_]*TYPES?\b.*=\s*\[/);
    expect(new Set(Object.values(UNIT_TYPE_MAPPING))).toEqual(new Set(FIVE));
  });
});

// ---------------------------------------------------------------------------
// §C · THE MAPPING
// ---------------------------------------------------------------------------

describe('fix-486 §C: every old value, and where it went', () => {
  it('★★★ Bobby\'s rule: a cottage and an SFR are detached, a duplex is attached', () => {
    expect(mapUnitType('SFR')).toBe('Detached');
    expect(mapUnitType('Cottages')).toBe('Detached');
    expect(mapUnitType('SFR w/ Accessory Units')).toBe('Detached');
    expect(mapUnitType('Duplex')).toBe('Attached');
    expect(mapUnitType('Condo')).toBe('Attached');
    expect(mapUnitType('SFR + Attached Units')).toBe('Attached');
    expect(mapUnitType('ADU')).toBe('ADU');
    expect(mapUnitType('DADU')).toBe('DADU');
    expect(mapUnitType('Remodel')).toBe('Remodel');
  });

  it('★★★ EVERY measured prod value is either mapped or a named placeholder', () => {
    // ★★★ THE COVERAGE CLAIM. Not "the examples work" — every distinct value
    //     that existed on prod the day the migration ran, both columns, with
    //     nothing quietly falling through to a default.
    for (const [value] of [...BEFORE_PRODUCT_TYPES, ...BEFORE_UNIT_LABELS]) {
      const handled =
        value === SPLIT_LABEL ||
        mapUnitType(value) !== null ||
        isWizardPlaceholderLabel(value);
      expect(handled, value).toBe(true);
    }
  });

  it('★★★ SFR+ADU is TWO values on a project and ONE on a unit row', () => {
    // ★★★ THE ONE VALUE WHOSE ANSWER DEPENDS ON WHICH COLUMN IT IS IN.
    //     `product_types` is a LIST of what a project contains, so a project
    //     that is both is both — 30 projects. A unit ROW is one unit: splitting
    //     it would invent a second row carrying the first one's dimensions,
    //     which is fabricating data, not migrating it — 6 rows on 5 projects.
    expect(mapProjectProductType('SFR+ADU')).toEqual(['Detached', 'ADU']);
    expect(mapUnitLabel('SFR+ADU')).toBe('Detached');
  });

  it('★★★ Type A–D keep their labels — the mapper REPORTS rather than guesses', () => {
    // ★★★ A fallback to Detached would have declared eleven unanswered rows
    //     answered. `null` is the signal to leave the label alone and mark it.
    for (const label of WIZARD_PLACEHOLDER_LABELS) {
      expect(mapUnitType(label), label).toBeNull();
      expect(mapUnitLabel(label), label).toBeNull();
      expect(mapProjectProductType(label), label).toEqual([]);
      expect(unitLabelNeedsType(label), label).toBe(true);
    }
    // ★ The wizard can mint past D — the predicate, not the list, is what the
    //   app uses. (`UnitTypesEditor` lands "Type A" then "Type B"; nothing caps
    //   it, and a two-letter overflow is reachable on a big enough project.)
    expect(isWizardPlaceholderLabel('Type E')).toBe(true);
    expect(isWizardPlaceholderLabel('Type AA')).toBe(true);
  });

  it('★★★ a deliberate off-list label is NOT a placeholder', () => {
    // ★★ Two different states. Telling somebody who typed "Carriage House"
    //    that they failed to answer a question is as wrong as telling somebody
    //    staring at "Type C" that their deliberate choice is merely unlisted.
    for (const chosen of ['Carriage House', 'Accessory Unit', 'Townhouse']) {
      expect(unitLabelNeedsType(chosen), chosen).toBe(false);
      expect(isOffListUnitLabel(chosen, FIVE), chosen).toBe(true);
    }
    // ★ And a blank is neither — `resolveUnitLabel` already fills a blank from
    //   a lone product type, so marking it here would double up.
    expect(unitLabelNeedsType('')).toBe(false);
    expect(unitLabelNeedsType(null)).toBe(false);
  });

  it('★★★ the list is DEDUPED, in order of first appearance', () => {
    // ★ `[SFR, Cottages]` is one Detached, not two. Order of first appearance
    //   is kept so a project's list reads the way its owner built it.
    expect(mapProductTypeList(['SFR', 'Cottages'])).toEqual(['Detached']);
    expect(mapProductTypeList(['Duplex', 'SFR'])).toEqual(['Attached', 'Detached']);
    expect(mapProductTypeList(['SFR', 'Duplex'])).toEqual(['Detached', 'Attached']);
    // ★★ The shape the seven real prod dedupes had: SFR beside SFR+ADU.
    expect(mapProductTypeList(['SFR', 'SFR+ADU'])).toEqual(['Detached', 'ADU']);
    expect(mapProductTypeList(['SFR', 'ADU', 'SFR+ADU'])).toEqual([
      'Detached',
      'ADU',
    ]);
  });

  it('★★★ RE-RUNNING THE MAP IS A NO-OP — the five map to themselves', () => {
    // ★★ A migration that is not idempotent is one that cannot be re-run after
    //    a partial failure, and this one runs over live rows.
    for (const t of FIVE) {
      expect(mapUnitType(t), t).toBe(t);
      expect(mapProductTypeList([t]), t).toEqual([t]);
    }
    expect(mapProductTypeList(['Detached', 'ADU'])).toEqual(['Detached', 'ADU']);
  });
});

// ---------------------------------------------------------------------------
// ★★★ THE SQL AND THE TS ARE ONE RULE IN TWO PLACES — HELD IN LOCKSTEP
// ---------------------------------------------------------------------------

describe('fix-486: the migration and lib/unitTypeVocabulary agree', () => {
  /** Every `when '<x>' then …` arm of a CASE in the migration, lower-cased key
   *  to the single value it produces (an `array[...]` of one, or a bare
   *  string). Multi-value arms are returned joined so the split can be checked
   *  explicitly rather than silently flattened. */
  function sqlArms(section: string): Map<string, string> {
    const out = new Map<string, string>();
    const re = /when '([^']+)'\s+then\s+(?:array\[([^\]]+)\]|'([^']+)')/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(section)) !== null) {
      const value = m[2]
        ? m[2].split(',').map((v) => v.trim().replace(/^'|'$/g, '')).join('+')
        : m[3]!;
      out.set(m[1], value);
    }
    return out;
  }

  const projectSection = migrationSql.slice(
    migrationSql.indexOf('lateral unnest(p.product_types)') - 2000,
    migrationSql.indexOf('lateral unnest(p.product_types)'),
  );
  const unitSection = migrationSql.slice(
    migrationSql.indexOf("jsonb_build_object('label'"),
    migrationSql.indexOf('as next_units'),
  );

  it('★★★ the PROJECT arms match `mapProjectProductType`, SFR+ADU included', () => {
    const arms = sqlArms(projectSection);
    expect(arms.size).toBeGreaterThan(10);
    for (const [key, sqlValue] of arms) {
      expect(mapProjectProductType(key).join('+'), key).toBe(sqlValue);
    }
  });

  it('★★★ the UNIT arms match `mapUnitLabel` — and SFR+ADU differs from above', () => {
    const arms = sqlArms(unitSection);
    expect(arms.size).toBeGreaterThan(10);
    for (const [key, sqlValue] of arms) {
      expect(mapUnitLabel(key), key).toBe(sqlValue);
    }
    // ★★★ The asymmetry, asserted against the two SQL blocks themselves rather
    //     than against the helpers — this is the pair a future edit is most
    //     likely to "tidy" into one shared CASE.
    expect(sqlArms(projectSection).get('sfr+adu')).toBe('Detached+ADU');
    expect(sqlArms(unitSection).get('sfr+adu')).toBe('Detached');
  });

  it('★★★ every TS mapping rule has an SQL arm, and vice versa', () => {
    const arms = sqlArms(unitSection);
    for (const key of Object.keys(UNIT_TYPE_MAPPING)) {
      expect(arms.has(key), key).toBe(true);
    }
    for (const key of arms.keys()) {
      if (key === SPLIT_LABEL.toLowerCase()) continue;
      expect(Object.keys(UNIT_TYPE_MAPPING), key).toContain(key);
    }
  });

  it('★★★ the SQL compares LOWER(BTRIM(…)), as the TS does', () => {
    // ★ prod holds only the exact strings, but a hand-typed "duplex " must be
    //   the same building on both sides or the two rules diverge on the first
    //   row somebody types by hand.
    expect(migrationSql).toMatch(/case lower\(btrim\(t\.v\)\)/);
    expect(migrationSql).toMatch(/case lower\(btrim\(coalesce\(u\.elem->>'label',''\)\)\)/);
    expect(mapUnitType('  duplex ')).toBe('Attached');
    expect(mapProjectProductType(' SFR+ADU ')).toEqual(['Detached', 'ADU']);
  });
});

// ---------------------------------------------------------------------------
// ★★ THE MIGRATION'S SAFETY STRUCTURE
// ---------------------------------------------------------------------------

describe('fix-486: the migration is safe to have run', () => {
  it('★★★ it backs BOTH columns up BEFORE it writes anything', () => {
    const backup = migrationSql.indexOf('_fix486_types_backup_20260903');
    const firstWrite = migrationSql.indexOf('update public.app_config');
    expect(backup).toBeGreaterThan(-1);
    expect(backup).toBeLessThan(firstWrite);
    expect(migrationSql).toMatch(/select id,\s*tenant_id,\s*address,\s*product_types,\s*unit_types/);
  });

  it('★★★ §D: it ASSERTS zero non-null work_scope BEFORE stripping the key', () => {
    // ★★★ THE BRIEF'S RULE, AND THE ONLY THING BETWEEN "retiring a field
    //     nobody used" AND "deleting somebody's answer". The order is the whole
    //     assertion: a check after the strip proves nothing.
    const assertAt = migrationSql.indexOf("u->>'work_scope' is not null");
    const stripAt = migrationSql.indexOf("(u.elem - 'work_scope')");
    expect(assertAt).toBeGreaterThan(-1);
    expect(stripAt).toBeGreaterThan(-1);
    expect(assertAt).toBeLessThan(stripAt);
    expect(migrationSql).toMatch(/raise exception[\s\S]{0,120}work_scope/);
  });

  it('★★★ it VERIFIES after, and raises on any value it did not expect', () => {
    // ★★ A remap that silently leaves an unmapped value behind is worse than
    //    one that fails: the row is still wrong, and nobody is told.
    expect(migrationSql).toMatch(
      /not in \('Detached','Attached','ADU','DADU','Remodel'\)/,
    );
    expect(migrationSql).toMatch(/unmapped values survived the remap/);
    expect(migrationSql).toMatch(/still carry a work_scope key/);
    // ★ …and the placeholders are the ONE exemption, named rather than implied.
    expect(migrationSql).toMatch(/\^Type\( \[A-Z\]\{1,2\}\)\?\$/);
  });

  it('★★ the unit rewrite PRESERVES every key but `label`', () => {
    // ★★★ `elem - 'work_scope' || jsonb_build_object('label', …)` rather than a
    //     rebuild. A rebuild would have been a SECOND whitelist to keep in step
    //     with `parseUnitTypes`, and width/depth/qty/stories/parking/roof_deck
    //     must survive byte-for-byte — fix-486's "must not change" list.
    expect(migrationSql).toMatch(
      /\(u\.elem - 'work_scope'\) \|\|\s*\n\s*jsonb_build_object\('label',/,
    );
    for (const key of [
      'width_ft',
      'depth_ft',
      'qty',
      'stories',
      'parking_kind',
      'parking_stalls',
      'roof_deck',
    ]) {
      expect(migrationSql, key).not.toContain(`'${key}'`);
    }
  });
});

// ---------------------------------------------------------------------------
// §D · `work_scope` IS RETIRED
// ---------------------------------------------------------------------------

describe('fix-486 §D: work_scope is gone from the type, the row and the parse', () => {
  it('★★★ `parseUnitTypes` no longer emits it — the whitelist, inverted', () => {
    const parsed = parseUnitTypes([
      { label: 'Remodel', width_ft: 20, depth_ft: 30, qty: 1, work_scope: 'performed' },
    ]);
    expect('work_scope' in parsed[0]).toBe(false);
  });

  it('★★★ no module in src/ reads or writes it any more', () => {
    // ★ Comment-stripped, because the notes explaining WHY it was removed name
    //   it — the seventh time this exact trap has caught this repo.
    const hits: string[] = [];
    for (const file of sourceFiles()) {
      const body = stripComments(readFileSync(file, 'utf8'));
      if (/work_scope|WorkScope|isNoWorkUnit/.test(body)) hits.push(file);
    }
    expect(hits).toEqual([]);
  });

  it('★★★ `lib/unitWorkScope` is deleted, not merely unused', () => {
    expect(() =>
      statSync(resolve(process.cwd(), 'src/lib/unitWorkScope.ts')),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ★★★ THE READERS
// ---------------------------------------------------------------------------

/**
 * ★ Every surface that offers product types, found 2026-09-03 — and they turn
 *   out to come in TWO shapes, which is worth writing down because a sweep that
 *   assumed one shape would have "fixed" the other into a bug.
 */
const REGISTRY_READERS = [
  'src/components/LibraryMatrix.tsx',
  'src/components/ProjectDetail/ProjectDetailHeader.tsx',
  'src/components/ProjectDetail/ProjectSettingsModal.tsx',
  'src/components/Settings/AdminProjectsTab.tsx',
  'src/components/wizard/Step1ProjectInfo.tsx',
];

/**
 * ★★★ THE SECOND SHAPE: the Reports filter offers the union of what the COHORT
 * actually contains, not the registry (fix-91). That is right for a report — a
 * filter offering a value no row carries is a dead end — and it means the
 * remap reaches it with no code change at all: the rows say Detached, so the
 * picker says Detached. It is listed here so the next person to "make the
 * readers consistent" sees that the difference is deliberate.
 */
const COHORT_READERS = [
  'src/components/Reports/ReportsOverviewTab.tsx',
];

describe('fix-486: every reader offers the five, because none of them own a list', () => {
  it('★★★ each registry reader takes its options from `productTypeOptions`', () => {
    for (const rel of REGISTRY_READERS) {
      const body = stripComments(
        readFileSync(resolve(process.cwd(), rel), 'utf8'),
      );
      expect(body, rel).toMatch(
        /productTypeRegistry\(|readAppConfigStringArray\([^)]*'productTypeOptions'/,
      );
    }
  });

  it('★★★ the Reports filter unions the COHORT instead, and so cannot go stale', () => {
    // ★★ Asserted rather than assumed: if this ever became a fixed list, a
    //    retired value could outlive the data it described.
    for (const rel of COHORT_READERS) {
      const body = stripComments(
        readFileSync(resolve(process.cwd(), rel), 'utf8'),
      );
      expect(body, rel).toMatch(
        /const productTypeOptions = useMemo\([\s\S]{0,400}for \(const e of enriched\) for \(const t of e\.productTypes\) set\.add\(t\);/,
      );
    }
  });

  it('★★★ and none of them contains a hard-coded vocabulary', () => {
    // ★★★ THE ASSERTION THAT ACTUALLY CATCHES A REGRESSION. "It reads the
    //     registry" and "it also has a fallback list" are both true of the code
    //     that breaks this feature; only the second half fails here.
    for (const rel of [
      ...REGISTRY_READERS,
      ...COHORT_READERS,
      'src/components/wizard/UnitTypesEditor.tsx',
    ]) {
      const body = stripComments(
        readFileSync(resolve(process.cwd(), rel), 'utf8'),
      );
      for (const old of ["'SFR'", "'Duplex'", "'Cottages'", "'SFR+ADU'"]) {
        expect(body, `${rel} ${old}`).not.toContain(old);
      }
    }
  });

  it('★★★ the shared option builder yields exactly the five', () => {
    // ★ `unitLabelOptions` is what every unit-label picker renders, and
    //   `productTypeRegistry` is how the map becomes that list.
    const map = new Map<string, unknown>([['productTypeOptions', FIVE]]);
    expect(productTypeRegistry(map)).toEqual(FIVE);
    expect(unitLabelOptions(productTypeRegistry(map))).toEqual(FIVE);
    // ★★ fix-415's append rule survives: a control must display what it holds,
    //    so a stored placeholder is appended rather than dropped.
    expect(unitLabelOptions(FIVE, 'Type A')).toEqual([...FIVE, 'Type A']);
  });

  it('★★★ RENDERED: the wizard\'s unit picker offers the five and nothing else', () => {
    // ★ The one live DOM proof in this file — `UnitTypesEditor` takes the
    //   options as a prop, so it renders whatever the registry hands it.
    //   (`ProjectDetailHeader`'s row select is proved the same way in
    //   ProjectDetailHeaderFix205.test.tsx, against the same five.)
    render(
      <UnitTypesEditor
        value={[{ label: 'Detached', width_ft: 20, depth_ft: 30, qty: 1 }]}
        onChange={vi.fn()}
        productTypeOptions={FIVE}
      />,
    );
    const sel = screen.getByTestId('unit-types-label-0') as HTMLSelectElement;
    // ★ `''` is "Pick type…" and `__other__` is fix-449's deliberate off-list
    //   escape. Everything BETWEEN them is the vocabulary, and it is the five.
    expect(Array.from(sel.options).map((o) => o.value)).toEqual([
      '',
      ...FIVE,
      '__other__',
    ]);
  });
});

// ---------------------------------------------------------------------------
// ★★★ THE OLD VOCABULARY IS OUT OF THE SOURCE
// ---------------------------------------------------------------------------

describe('fix-486: no source file carries the old type literals', () => {
  it('★★★ `SFR`, `Duplex` and `Cottages` appear in no src module', () => {
    // ★★★ SCOPE, STATED: `src/` EXCLUDING `src/__tests__`. Tests must be able
    //     to name the old values — this very file asserts what each of them
    //     became, and could not do so otherwise. The rule being enforced is
    //     "no SHIPPED code speaks the old vocabulary", which is what the app's
    //     behaviour depends on.
    //
    // ★★ COMMENT-STRIPPED, for the seventh time in this repo: the notes
    //    recording WHY a value was retired have to name it, and a grep that
    //    counts its own explanation is a grep that can never pass.
    const hits: string[] = [];
    for (const file of sourceFiles()) {
      const body = stripComments(readFileSync(file, 'utf8'));
      for (const old of ["'SFR'", '"SFR"', "'Duplex'", '"Duplex"', "'Cottages'", '"Cottages"']) {
        if (body.includes(old)) hits.push(`${file} :: ${old}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('★★★ …but the PERMIT type `Condo` is untouched, and that is not an oversight', () => {
    // ★★★ THE NEAR-MISS THIS TICKET CONTAINED. `Condo` is a value in TWO
    //     unrelated vocabularies: it was a product type (in the registry,
    //     though on no project), and it is a real Seattle PERMIT type with its
    //     own target-submit anchor. A sweep that "finished the job" by deleting
    //     the `case 'Condo':` arms in targetSubmitPolicy/Learner would have
    //     silently re-anchored a live permit type onto the default mirror.
    for (const rel of ['src/lib/targetSubmitPolicy.ts', 'src/lib/targetSubmitLearner.ts']) {
      const body = stripComments(readFileSync(resolve(process.cwd(), rel), 'utf8'));
      expect(body, rel).toContain("'Condo'");
      // ★ It sits beside the other PERMIT types, which is what identifies it.
      expect(body, rel).toContain("'Demolition'");
    }
  });

  it('★★ `SFR+ADU` survives ONLY as the mapping rule that explains it', () => {
    const hits: string[] = [];
    for (const file of sourceFiles()) {
      const body = stripComments(readFileSync(file, 'utf8'));
      if (body.includes("'SFR+ADU'")) hits.push(file);
    }
    expect(hits).toEqual([resolve(process.cwd(), 'src/lib/unitTypeVocabulary.ts')]);
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Every shipped `.ts`/`.tsx` under `src/`, excluding tests. */
function sourceFiles(): string[] {
  const root = resolve(process.cwd(), 'src');
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === '__tests__') continue;
        walk(full);
      } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        out.push(full);
      }
    }
  };
  walk(root);
  expect(out.length).toBeGreaterThan(100);
  return out;
}

/** ★ Line and block comments removed, string literals kept. Crude on purpose —
 *  it only has to stop a `//` note about a retired value from counting as a
 *  live use of it. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const at = line.indexOf('//');
      if (at < 0) return line;
      // Leave a `//` that is inside a string (a URL, mostly) alone.
      const before = line.slice(0, at);
      const quotes = (before.match(/['"`]/g) ?? []).length;
      return quotes % 2 === 0 ? before : line;
    })
    .join('\n');
}
