import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import {
  RETIRED_OPTION_MARKER,
  optionIsRetired,
  retiredOptionLabel,
} from '../lib/retiredOption';
import { UNIT_LABEL_RETIRED_MARKER, unitLabelIsRetired } from '../lib/unitTypeNaming';

// ===========================================================================
// fix-605 — two small corrections
// ===========================================================================

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

// ---------------------------------------------------------------------------
// §A — the permit-type select stops OFFERING a retired type (P-302 part 1)
// ---------------------------------------------------------------------------

describe('fix-605 §A — one retired-option rule, generalised not copied', () => {
  it('★★★ the unit-type names ARE the shared rule (aliases, not a second copy)', () => {
    expect(UNIT_LABEL_RETIRED_MARKER).toBe(RETIRED_OPTION_MARKER);
    expect(RETIRED_OPTION_MARKER).toBe(' (not a current type)');
    const src = read('src/lib/unitTypeNaming.ts');
    expect(src).toContain('return optionIsRetired(option, productTypeOptions);');
    expect(src).not.toMatch(/=\s*' \(not a current type\)'/);
  });

  it('★★ the predicate: off-registry is retired; a registry value and the placeholder are not', () => {
    const reg = ['Building Permit', 'ULS'];
    expect(optionIsRetired('SEPA Old', reg)).toBe(true);
    expect(optionIsRetired('ULS', reg)).toBe(false);
    expect(optionIsRetired('', reg)).toBe(false);
    expect(retiredOptionLabel('SEPA Old', reg)).toBe('SEPA Old (not a current type)');
    expect(retiredOptionLabel('ULS', reg)).toBe('ULS');
    expect(unitLabelIsRetired('SEPA Old', reg)).toBe(true);
  });
});

// The row component is internal to ProjectDetailsForm and is driven by the
// project-details controller hook (src/hooks/ is off limits this ticket), so
// the rendered behaviour is pinned two ways: (1) the select's option rule is
// rendered through a harness that uses the SAME lib functions the select does,
// and (2) the form source is asserted to wire them in exactly that way.

const REGISTRY = ['Building Permit', 'Demolition', 'ULS'];

/** Mirrors `PermitRow`'s list: the row's own stored type is appended ONLY to
 *  its own options, and `SelectInput` disables + marks it via retiredFrom. */
function TypeSelect({ stored, testid }: { stored: string; testid: string }) {
  const [value, setValue] = useState(stored);
  const options =
    value && !REGISTRY.includes(value) ? ['', value, ...REGISTRY] : ['', ...REGISTRY];
  return (
    <select data-testid={testid} value={value} onChange={(e) => setValue(e.target.value)}>
      {options.map((o) =>
        o === '' ? (
          <option key="__empty" value="">— select —</option>
        ) : optionIsRetired(o, REGISTRY) ? (
          <option key={o} value={o} disabled data-retired="true">
            {retiredOptionLabel(o, REGISTRY)}
          </option>
        ) : (
          <option key={o} value={o}>{o}</option>
        ),
      )}
    </select>
  );
}

describe('fix-605 §A — rendered: shows, disabled, marked, never offered to a sibling', () => {
  it('★★★ a retired stored type still DISPLAYS, disabled and marked', () => {
    render(<TypeSelect stored="SEPA Old" testid="row-a" />);
    const sel = screen.getByTestId('row-a') as HTMLSelectElement;
    expect(sel.value).toBe('SEPA Old');
    const opt = [...sel.options].find((o) => o.value === 'SEPA Old')!;
    expect(opt.disabled).toBe(true);
    expect(opt.textContent).toBe('SEPA Old (not a current type)');
    // …and it is the ONLY disabled option
    expect([...sel.options].filter((o) => o.disabled)).toHaveLength(1);
  });

  it('★★★ it is NOT offered to a sibling row', () => {
    render(
      <>
        <TypeSelect stored="SEPA Old" testid="row-a" />
        <TypeSelect stored="ULS" testid="row-b" />
      </>,
    );
    const sibling = screen.getByTestId('row-b') as HTMLSelectElement;
    expect([...sibling.options].map((o) => o.value)).not.toContain('SEPA Old');
  });

  it('★★ a registry value still commits', async () => {
    const { fireEvent } = await import('@testing-library/react');
    render(<TypeSelect stored="SEPA Old" testid="row-a" />);
    const sel = screen.getByTestId('row-a') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: 'Demolition' } });
    expect(sel.value).toBe('Demolition');
    // once replaced, the retired value is gone from this row too
    expect([...sel.options].map((o) => o.value)).not.toContain('SEPA Old');
  });
});

describe('fix-605 §A — the form wires the rule into the permit-type select', () => {
  const FORM = read('src/components/ProjectDetail/ProjectDetailsForm.tsx');

  it('★★★ SelectInput disables + marks a retired option through the shared lib', () => {
    expect(FORM).toContain("import { optionIsRetired, retiredOptionLabel } from '../../lib/retiredOption';");
    expect(FORM).toMatch(
      /retiredFrom && optionIsRetired\(o, retiredFrom\) \? \(\s*<option key=\{o\} value=\{o\} disabled data-retired="true">\s*\{retiredOptionLabel\(o, retiredFrom\)\}/,
    );
  });

  it('★★★ the permit-type select passes the registry it must match', () => {
    expect(FORM).toMatch(/options=\{typeOptionsWithLegacy\}\s*retiredFrom=\{typeOptions\}/);
    // the legacy value is appended to THIS row's list only (row.type), never shared
    expect(FORM).toMatch(/if \(row\.type && !typeOptions\.includes\(row\.type\)\) return \['', row\.type, \.\.\.typeOptions\];/);
  });

  it('★ no other select is touched — retiredFrom appears exactly once at a call site', () => {
    expect(FORM.match(/retiredFrom=\{/g)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// §B — no E'-continuation in any migration
// ---------------------------------------------------------------------------
//
// Postgres concatenates adjacent string literals separated by a newline, and
// the continuation segments inherit the FIRST segment's escape processing. A
// continuation that starts with `E'` is a syntax error (42601) — fix-585's
// `r2` had one, and Cowork had to drop the `E` to apply it.

/** Lines (1-based) where an `E'` starts a line straight after a line ending in
 *  a string literal with no `;` or `,` — i.e. an E'-continuation. */
function eContinuations(sql: string): number[] {
  const lines = sql.split(/\r?\n/);
  const hits: number[] = [];
  let prev: string | null = null;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' ) return;
    if (line.startsWith('--')) {
      prev = null;
      return;
    }
    if (prev !== null && /^E'/.test(line) && /'$/.test(prev)) hits.push(i + 1);
    prev = line;
  });
  return hits;
}

describe("fix-605 §B — no E' continuation in migrations/", () => {
  const files = readdirSync(resolve(process.cwd(), 'migrations')).filter((f) => f.endsWith('.sql'));

  it("★★★ every migration is free of an E'-continuation", () => {
    const bad = files
      .map((f) => ({ f, lines: eContinuations(read(`migrations/${f}`)) }))
      .filter((x) => x.lines.length > 0)
      .map((x) => `${x.f}:${x.lines.join(',')}`);
    expect(bad).toEqual([]);
  });

  it("★★★ RED on fix-585's old text: the r2 continuation is caught", () => {
    const OLD = [
      '  r2 constant text :=',
      "    E'    IF COALESCE(v_permit.target_submit_is_manual, false) THEN CONTINUE; END IF;\\n'",
      "    '    -- fix-585: done is done. An approved or issued permit''s target is history.\\n'",
      "    E'    IF v_permit.approval_date IS NOT NULL OR v_permit.actual_issue IS NOT NULL THEN CONTINUE; END IF;\\n'",
      "    '    IF v_permit.c0_submitted IS NOT NULL THEN';",
    ].join('\n');
    expect(eContinuations(OLD)).toEqual([4]);
  });

  it("★★ a FIRST segment starting with E' is fine, as are separate statements", () => {
    expect(eContinuations("  a2 constant text :=\n    E'x\\n'\n    'y';")).toEqual([]);
    expect(eContinuations("  x := 'a';\n  y := E'b';")).toEqual([]);
    expect(eContinuations("  f('a',\n    E'b')")).toEqual([]);
  });

  it('★★ fix-585 records that it was applied with this correction', () => {
    const sql = read('migrations/fix_585_one_learner.sql');
    expect(sql).toContain('Applied 2026-09-30 from Cowork with this correction (provenance 20261001013011).');
    expect(sql).toContain(
      "    '    IF v_permit.approval_date IS NOT NULL OR v_permit.actual_issue IS NOT NULL THEN CONTINUE; END IF;\\n'",
    );
  });
});
