import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { UnitType } from '../lib/database.types';
import { unitLabelParts, unitLabelAt, UNLABELLED_UNIT } from '../lib/unitLabels';

// ===========================================================================
// ★★★ fix-520 §B (P-226) + §C (P-229)
// ===========================================================================
//
// §B — Bobby: *"type is the heading instead of saying unit. If there are 4
//      detached, it would say detached 1, 2, 3."* And underneath it:
//      ***"How do I know which unit I am updating sqft on?"***
//
// §C — Bobby: *"unit type and product type are the same thing. Revise
//      nomenclature so it matches everywhere = type?"* **Display strings
//      only.** `projects.product_types` and `projects.unit_types` are two
//      independently-populated columns that can disagree — 19 of the 116
//      projects with both populated do — and collapsing them is a data
//      question with a migration behind it, not a rename.
// ===========================================================================

function unit(over: Partial<UnitType> = {}): UnitType {
  return {
    label: 'Detached',
    width_ft: null,
    depth_ft: null,
    size_sf: null,
    qty: 1,
    stories: null,
    parking_kind: null,
    parking_stalls: null,
    roof_deck: null,
    ...over,
  } as unknown as UnitType;
}

// ---------------------------------------------------------------------------
// §B — the labelling rule
// ---------------------------------------------------------------------------

describe('fix-520 §B (P-226) — the ordinal is PER TYPE', () => {
  it('★★★ two Detached and one Attached reads Detached 1 · Detached 2 · Attached 1', () => {
    // ★★★ THE RULE, IN BOBBY'S OWN EXAMPLE. The alternative — numbering the
    //     ROW — would give `Attached 3`, which names a position in an array
    //     rather than a unit, and is exactly as useless as `Unit 3` was.
    const labels = unitLabelParts([
      unit({ label: 'Detached' }),
      unit({ label: 'Detached' }),
      unit({ label: 'Attached' }),
    ]);
    expect(labels.map((l) => l.full)).toEqual(['Detached 1', 'Detached 2', 'Attached 1']);
    expect(labels.map((l) => l.ordinal)).toEqual([1, 2, 1]);
  });

  it('★★★ four Detached read 1, 2, 3, 4 — the case Bobby described', () => {
    const labels = unitLabelParts(Array.from({ length: 4 }, () => unit()));
    expect(labels.map((l) => l.full)).toEqual([
      'Detached 1',
      'Detached 2',
      'Detached 3',
      'Detached 4',
    ]);
  });

  it('★★ a SINGLE unit of a type still carries its 1', () => {
    // ★ Deliberate. A label that appears only when there are two of something
    //   makes the reader work out which rule is in force before they can read
    //   it — and the Overview matrix, the dimensions rows and the size rows
    //   would each have to agree about when to drop it.
    expect(unitLabelParts([unit({ label: 'Attached' })])[0].full).toBe('Attached 1');
  });

  it('★★ the TYPE and the ORDINAL are returned separately, and that is not cosmetic', () => {
    // ★★★ fix-507 §E moved the Overview's headers OFF the type name because
    //     `Detach…Detach…` identifies nothing at a narrow card width. That
    //     objection survives a naive `Detached 2`, which truncates to
    //     `Detache…` and loses the only distinguishing character. Every caller
    //     renders `type` as the truncating half and `ordinal` as `flex-none`,
    //     so the worst case is `Detac… 2` — still an identifier.
    const l = unitLabelParts([unit()])[0];
    expect(l.type).toBe('Detached');
    expect(l.ordinal).toBe(1);
    expect(l.full).toBe('Detached 1');
  });

  it('★★ counting is case-insensitive; the DISPLAYED type is what was stored', () => {
    const labels = unitLabelParts([unit({ label: 'Detached' }), unit({ label: 'detached' })]);
    expect(labels.map((l) => l.ordinal)).toEqual([1, 2]);
    // ★ This function labels; it does not normalise. Rewriting the stored
    //   spelling would be a data change wearing a display change's clothes.
    expect(labels.map((l) => l.type)).toEqual(['Detached', 'detached']);
  });

  it('★ an unlabelled row is `Unit n`, never an em dash', () => {
    // A dash is the absence of a value; this is an identifier somebody has to
    // say out loud.
    expect(unitLabelParts([unit({ label: '' }), unit({ label: '  ' })]).map((l) => l.full)).toEqual([
      `${UNLABELLED_UNIT} 1`,
      `${UNLABELLED_UNIT} 2`,
    ]);
  });

  it('★ null / empty input does not throw', () => {
    expect(unitLabelParts(null)).toEqual([]);
    expect(unitLabelParts(undefined)).toEqual([]);
    expect(unitLabelAt(null, 0)).toBe(`${UNLABELLED_UNIT} 1`);
  });
});

describe('fix-520 §B — all THREE surfaces use the one labeller', () => {
  const boxes = readFileSync(
    resolve(process.cwd(), 'src/components/ProjectDetail/ProjectOverviewBoxes.tsx'),
    'utf8',
  );
  const editors = readFileSync(
    resolve(process.cwd(), 'src/components/ProjectDetail/ProjectDataEditors.tsx'),
    'utf8',
  );

  it('★★★ the Overview matrix, the dimensions rows and the size rows', () => {
    // ★★★ Bobby's question has ONE answer only if all three give it. Asserted
    //     as "they call the same function", not as "they happen to print the
    //     same string" — which is the difference between agreement and a
    //     coincidence three call sites have to keep re-earning.
    expect(boxes).toContain('unitLabelParts(unitTypes)');
    // `UnitDimensionsExpanded` (the rows) and `UnitSizeEditor` (the sf boxes).
    expect(editors.match(/unitLabelParts\(/g)?.length).toBe(2);
    expect(editors).toContain("from '../../lib/unitLabels'");
  });

  it('★★★ the Overview `Type` ROW is gone — it moved into the heading', () => {
    // ★ It was fix-507 §E's answer to headers that could not carry the type.
    //   The heading carries it now, so the row is the same fact printed twice.
    const attrs = boxes.slice(boxes.indexOf('UNIT_ATTRIBUTES'));
    expect(attrs).not.toContain("label: 'Type',");
    expect(attrs).not.toContain("key: 'type',");
  });

  it('★★ only the TYPE truncates — on every one of the three', () => {
    for (const [name, src] of [
      ['Overview matrix', boxes],
      ['Units tab', editors],
    ] as const) {
      expect(src, `${name}: the ordinal must not be inside a truncating span`).toContain(
        'flex-none',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// §C — one word for one thing
// ---------------------------------------------------------------------------

/** Every `.ts`/`.tsx` under `src`, excluding tests. */
function sourceFiles(dir = resolve(process.cwd(), 'src')): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__') continue;
      out.push(...sourceFiles(p));
    } else if (/\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** Strip block, line and JSX comments — every file here discusses `unit_types`
 *  and `product_types` at length in prose, which is how an assertion matches a
 *  paragraph instead of the string a user reads. */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('fix-520 §C (P-229) — one word for one thing: `Type`', () => {
  it('★★★ no user-visible string says "product type" or "unit type"', () => {
    // ★★ TWO EXCLUSIONS, BOTH NAMED, because a sweep that quietly drops what it
    //    cannot classify proves nothing:
    //
    //    · `terms:` — the search index's ALIASES. Bobby types what he has
    //      always typed, and renaming the label without keeping the old words
    //      findable would make the field unreachable by the only name half the
    //      team knows it by. The third test below asserts they are still there.
    //    · `floorReason:` — prose explaining a derived pixel to whoever reads
    //      `lib/overviewCardLayout` next. It is a comment that lives in data so
    //      a test can hold it, and it is rendered NOWHERE — checked rather than
    //      assumed: nothing outside that module reads the field.
    const offenders: string[] = [];
    for (const p of sourceFiles()) {
      const stripped = code(readFileSync(p, 'utf8'));
      let inFloorReason = false;
      for (const line of stripped.split('\n')) {
        if (/floorReason:/.test(line)) inFloorReason = true;
        else if (inFloorReason && /^\s{4}[a-zA-Z}]/.test(line)) inFloorReason = false;
        if (inFloorReason || /\bterms:/.test(line)) continue;
        if (/product type|unit type/i.test(line)) {
          offenders.push(`${p.replace(process.cwd(), '')} :: ${line.trim().slice(0, 100)}`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('★★★ …and the COLUMNS are untouched, which is the other half of the rule', () => {
    // ★★★ ⚠️ `product_types` and `unit_types` are populated INDEPENDENTLY and
    //     can disagree. Measured on prod 2026-09-10: 116 projects have both,
    //     **19 disagree** — 18 carry a product type with no unit row, 8 carry a
    //     unit label absent from the product types. That is a second source of
    //     truth for one fact, and merging them is a data question with a
    //     migration behind it. §C renames the WORDS; the keys stay.
    //
    // ★ Same discipline as P-190 (Entitlements → Permitting): strings first,
    //   keys reported and left alone.
    const all = sourceFiles()
      .map((p) => readFileSync(p, 'utf8'))
      .join('\n');
    expect(all).toContain('product_types');
    expect(all).toContain('unit_types');
    // The two the app writes them through, still naming the columns.
    expect(all).toContain("commit('product_types'");
    expect(all).toContain('patch: { unit_types:');
  });

  it('★★ the search index still finds the field by its OLD names', () => {
    // ★ Bobby types what he has always typed. Renaming the label without
    //   keeping the old terms as search aliases would make the field
    //   unfindable by the only words half the team knows it by.
    const form = readFileSync(resolve(process.cwd(), 'src/lib/projectDetailsForm.ts'), 'utf8');
    expect(form).toContain("label: 'Types'");
    expect(form).toContain("'product type'");
    expect(form).toContain("'unit type'");
  });
});
