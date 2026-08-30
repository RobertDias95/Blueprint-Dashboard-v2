import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { chipStyle } from '../lib/chipStyle';
import {
  DECORATION_QUERY_KEYS,
  isDecorationQuery,
  queryFailureLevel,
  shouldLogQueryFailure,
} from '../lib/errorLogger';
import { queryKeys } from '../lib/queryKeys';

// ===========================================================================
// fix-441 — four small ruled items, one PR
// ===========================================================================
//
// P-002 (the amber that never existed), P-019 (Builder/Owner may be shorter),
// P-014's thumbnail half, and P-091 (one chipStyle). No data writes.

// `?raw` on a .css file reads EMPTY under vitest (fix-406's trap), so the
// stylesheet is read off disk — the same way LibraryContrastFix406 does it.
const indexCss = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
const tailwindConfig = readFileSync(
  resolve(process.cwd(), 'tailwind.config.js'),
  'utf8',
);

/** Only literal hex declarations — an alias (`var(...)`) is deliberately not
 *  one, and the tests below say which is which. */
const TOKENS: Record<string, string> = Object.fromEntries(
  [...indexCss.matchAll(/(--color-[\w-]+):\s*(#[0-9a-fA-F]{6});/g)].map((m) => [
    m[1]!,
    m[2]!.toLowerCase(),
  ]),
);

// ---------------------------------------------------------------------------
// Contrast, replayed from the tokens rather than trusted
// ---------------------------------------------------------------------------

function channel(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
}
function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
/** fix-407's ink recipe: 65% hue + 35% `--color-text`, in sRGB. */
function ink(hue: string, text: string, huePct = 65): string {
  const h = hue.replace('#', '');
  const t = text.replace('#', '');
  let out = '#';
  for (const i of [0, 2, 4]) {
    const hv = parseInt(h.slice(i, i + 2), 16);
    const tv = parseInt(t.slice(i, i + 2), 16);
    out += Math.round((hv * huePct + tv * (100 - huePct)) / 100)
      .toString(16)
      .padStart(2, '0');
  }
  return out;
}

// ---------------------------------------------------------------------------
// §A — the amber that never existed (P-002)
// ---------------------------------------------------------------------------

/** ★★★ EVERY SITE, counted rather than taken from the brief. The queue item
 *  said "six plus the parking chip"; the brief named three. There are EIGHT,
 *  across five files, and two of them are `ok` rather than `wa` — including one
 *  that is a sibling branch of a `wa` ternary. */
// ★★★ fix-447 REMOVED THE LIBRARY'S `wa` SITE, AND THE LIST SHRINKS WITH IT.
//
// It was the parking rollup's "partial" chip — amber for *"some units have no
// recorded parking"*. fix-447 §B2 moved the whole rollup off the SITE table by
// ruling (Bobby, P-055: SITE reformats to *"address + site information"*, and a
// summary of unit parking is not site information), so the class no longer
// appears in that file.
//
// ★★ THE TOKEN IS NOT ORPHANED — four other sites still read it, asserted
// below, and the §A contrast tests above measure the token itself rather than
// any one use of it. Deleting the row is the honest update: the alternative is
// a test that fails forever on a chip nobody decided to remove twice.
const WA_SITES: Array<[string, string]> = [
  ['src/components/ProjectDetail/PlanOfRecordCard.tsx', 'text-wa'],
  ['src/components/Settings/AdminReportingTab.tsx', 'var(--color-wa)'],
  ['src/pages/MyBoard.tsx', "'text-wa'"],
  ['src/pages/WhatsNew.tsx', 'bg-wa-bg text-wa'],
];
const OK_SITES: Array<[string, string]> = [
  ['src/pages/MyBoard.tsx', "'text-ok'"],
  ['src/pages/MyBoard.tsx', 'border-ok bg-ok-bg text-ok'],
  ['src/pages/WhatsNew.tsx', 'bg-ok-bg text-ok'],
];

describe('fix-441 §A (P-002) — wa and ok are real colours now', () => {
  it('the stylesheet really loaded (fix-406’s own trap)', () => {
    expect(Object.keys(TOKENS).length).toBeGreaterThan(20);
    expect(TOKENS['--color-co']).toBe('#d97706');
    expect(TOKENS['--color-pm']).toBe('#059669');
  });

  it('★★★ the INK is defined, and it is fix-407’s recipe on the app’s own hue', () => {
    // ★ Replayed from the live tokens rather than trusting the two hexes: if
    //   somebody edits --color-co, this fails rather than drifting quietly.
    expect(TOKENS['--color-wa']).toBe(ink(TOKENS['--color-co']!, TOKENS['--color-text']!));
    expect(TOKENS['--color-ok']).toBe(ink(TOKENS['--color-pm']!, TOKENS['--color-text']!));
  });

  it('★★★ the TINT and BORDER are ALIASES, so they cannot drift from co / pm', () => {
    // Bobby: "wa = the EXISTING Corrections amber, not a new colour." Bound by
    // reference, so a future edit to Corrections carries wa with it.
    expect(indexCss).toContain('--color-wa-bg:     var(--color-co-bg);');
    expect(indexCss).toContain('--color-wa-border: var(--color-co-border);');
    expect(indexCss).toContain('--color-ok-bg:     var(--color-pm-bg);');
    expect(indexCss).toContain('--color-ok-border: var(--color-pm-border);');
    // ★ …and they are therefore NOT hexes in :root, on purpose.
    expect(TOKENS['--color-wa-bg']).toBeUndefined();
    expect(TOKENS['--color-ok-bg']).toBeUndefined();
  });

  it('★★★ A2 — the ink clears 4.5:1 on its own tint, MEASURED, and the raw token did not', () => {
    const waTint = TOKENS['--color-co-bg']!;
    const okTint = TOKENS['--color-pm-bg']!;
    // What the raw palette would have given — the reason the ink is darkened.
    expect(contrast(TOKENS['--color-co']!, waTint)).toBeLessThan(4.5);
    expect(contrast(TOKENS['--color-pm']!, okTint)).toBeLessThan(4.5);
    // …and what it gives now.
    expect(contrast(TOKENS['--color-wa']!, waTint)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(TOKENS['--color-ok']!, okTint)).toBeGreaterThanOrEqual(4.5);
    // The numbers the index.css note quotes, so the prose cannot drift.
    expect(contrast(TOKENS['--color-wa']!, waTint)).toBeCloseTo(5.0, 1);
    expect(contrast(TOKENS['--color-ok']!, okTint)).toBeCloseTo(5.45, 1);
  });

  it('★★ …and on every OTHER surface `text-wa` / `text-ok` actually land on', () => {
    // These are not only chip inks: the caveat line, the board counters and the
    // What's New warning all sit on plain surfaces.
    for (const t of ['--color-surface', '--color-bg', '--color-s2'] as const) {
      expect(contrast(TOKENS['--color-wa']!, TOKENS[t]!), `wa on ${t}`)
        .toBeGreaterThanOrEqual(4.5);
      expect(contrast(TOKENS['--color-ok']!, TOKENS[t]!), `ok on ${t}`)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it('★★★ the Tailwind utilities exist and point at the variables, not a third copy', () => {
    // ★ A second copy of the hex is exactly how `wa` and `co` would come apart
    //   the day somebody edits one of them.
    expect(tailwindConfig).toContain("DEFAULT: 'var(--color-wa)'");
    expect(tailwindConfig).toContain("bg: 'var(--color-wa-bg)'");
    expect(tailwindConfig).toContain("border: 'var(--color-wa-border)'");
    expect(tailwindConfig).toContain("DEFAULT: 'var(--color-ok)'");
    expect(tailwindConfig).toContain("bg: 'var(--color-ok-bg)'");
    expect(tailwindConfig).toContain("border: 'var(--color-ok-border)'");
  });

  it('★★★ EVERY site still reads a name that now resolves — all seven', () => {
    for (const [file, needle] of [...WA_SITES, ...OK_SITES]) {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(src, `${file} :: ${needle}`).toContain(needle);
    }
    // ★★ The token families they read are the ones defined above. Before this
    //    ticket every one of these declarations was invalid at computed-value
    //    time — no background, inherited ink.
    for (const name of [
      '--color-wa',
      '--color-wa-bg',
      '--color-wa-border',
      '--color-ok',
      '--color-ok-bg',
      '--color-ok-border',
    ]) {
      expect(indexCss, name).toContain(`${name}:`);
    }
  });

  it('★★ MyBoard line 191 is why `ok` came too: all THREE branches of one ternary', () => {
    // `daysLate > 0 ? text-co : daysLate === 0 ? text-wa : text-ok`. Fixing only
    // `wa` would have left one branch of one expression painting nothing —
    // fix-407's own reason for fixing both of its chips rather than the one it
    // was asked about.
    const src = readFileSync(resolve(process.cwd(), 'src/pages/MyBoard.tsx'), 'utf8');
    expect(src).toMatch(/'text-co'[\s\S]{0,80}'text-wa'[\s\S]{0,40}'text-ok'/);
  });
});

// ---------------------------------------------------------------------------
// §B — Builder/Owner may be shorter (P-019)
// ---------------------------------------------------------------------------

const headerSrc = readFileSync(
  resolve(process.cwd(), 'src/components/ProjectDetail/ProjectDetailHeader.tsx'),
  'utf8',
);

/** Strip block + line comments; this file explains grid behaviour at length. */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('fix-441 §B (P-019) — the Builder/Owner card stops stretching', () => {
  it('★★★ the builder cell alone drops height:100% and takes align-self:start', () => {
    const src = code(headerSrc);
    expect(src).toMatch(
      /\[OVERVIEW_CELL_ATTR\]: 'builder'[\s\S]{0,120}alignSelf: 'start'/,
    );
    // ★★ BOTH halves, and either alone is a no-op: with the grid's default
    //    `stretch` the height is imposed whatever the inline style says, and
    //    with `start` but `height: 100%` the percentage resolves against the
    //    row box and stretches it back.
    const builderCell = /\[OVERVIEW_CELL_ATTR\]: 'builder'[\s\S]{0,200}?>/.exec(src)?.[0] ?? '';
    expect(builderCell).not.toContain("height: '100%'");
  });

  it('★★★ NOTHING ELSE MOVES — the other four cells keep height:100%', () => {
    const src = code(headerSrc);
    for (const cell of ['dd', 'proj', 'team', 'por']) {
      const re = new RegExp(
        `\\[OVERVIEW_CELL_ATTR\\]: '${cell}'[\\s\\S]{0,200}?height: '100%'`,
      );
      expect(src, cell).toMatch(re);
    }
  });

  it('★ fix-417/423’s row proportions are untouched', () => {
    // The grid template and its floors live in lib/overviewCardLayout; this
    // ticket changes one cell's alignment and no track.
    const src = code(headerSrc);
    expect(src).toContain('OVERVIEW_ROW_RESPONSIVE_CSS');
    expect(src).toContain('containerType');
  });
});

// ---------------------------------------------------------------------------
// §C — a thumbnail miss is not an error (P-014)
// ---------------------------------------------------------------------------

const T = 'tenant-1';

describe('fix-441 §C (P-014) — a decoration failure logs at warning', () => {
  it('★★★ a plan_of_record_thumb failure USED to be an error, and now is not', () => {
    const key = queryKeys.planOfRecordThumb(T, `${T}/marketing.jpg`);
    const err = new TypeError('Failed to fetch');
    // ★ It was never skipped — none of fix-341's buckets caught it (not
    //   auth-keyed, not a validation rejection, not a cancellation, not the log
    //   RPC), so it fell through to "everything else logs" at level 'error'.
    //   Prod 2026-08-26: one error-level report for 220 N 58th St whose object
    //   was present and healthy.
    expect(shouldLogQueryFailure(err, key, 1)).toBe(true);
    // ★★★ …and the level is what changed. Still logged — a bucket failing for
    //     every project is real — but not beside "permission denied".
    expect(queryFailureLevel(err, key, 1)).toBe('warning');
  });

  it('★★★ classified by the query KEY, never by the message (fix-341’s rule)', () => {
    const thumb = queryKeys.planOfRecordThumb(T, 'x.jpg');
    // The same three words on a real query still log at error — matching on
    // wording would silence a genuine outage.
    const permits = queryKeys.permits(T);
    expect(queryFailureLevel(new TypeError('Failed to fetch'), permits, 1)).toBe('error');
    // …and a thumbnail failure with a completely different message is still a
    // warning, because the cause is the key.
    expect(queryFailureLevel(new Error('403 Forbidden'), thumb, 1)).toBe('warning');
  });

  it('★★ C2 — no OTHER classification moved', () => {
    const permits = queryKeys.permits(T);
    // Cancelled → still not logged.
    const cancelled = Object.assign(new Error('cancelled'), { name: 'CancelledError' });
    expect(queryFailureLevel(cancelled, permits, 1)).toBeNull();
    // No observers → still not logged.
    expect(queryFailureLevel(new Error('boom'), permits, 0)).toBeNull();
    // auth-keyed → still not logged.
    expect(queryFailureLevel(new Error('boom'), ['auth/session'], 1)).toBeNull();
    // the log RPC itself → still not logged.
    expect(queryFailureLevel(new Error('bp_log_error failed'), permits, 1)).toBeNull();
    // ★ Everything else is unchanged and still an error.
    expect(queryFailureLevel(new Error('boom'), permits, 1)).toBe('error');
  });

  it('★ the decoration list is exactly one key, and it is the thumbnail', () => {
    expect([...DECORATION_QUERY_KEYS]).toEqual(['plan_of_record_thumb']);
    expect(isDecorationQuery(queryKeys.planOfRecordThumb(T, 'a.jpg'))).toBe(true);
    expect(isDecorationQuery(queryKeys.permits(T))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §D — one chipStyle (P-091)
// ---------------------------------------------------------------------------

/** ★★★ THE FOUR ORIGINALS, snapshotted verbatim from origin/main before they
 *  were deleted. They are TWO implementations, not one repeated — see
 *  lib/chipStyle for the diff and for why the surface became an argument. */
function originalHoldFilterAndScopeToggle(active: boolean) {
  return active
    ? {
        background: 'var(--color-de)',
        borderColor: 'var(--color-de)',
        color: 'white',
      }
    : {
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
        color: 'var(--color-text)',
      };
}
function originalMyTasksAndProjectList(active: boolean) {
  return {
    borderColor: active ? 'var(--color-de)' : 'var(--color-border)',
    background: active ? 'var(--color-de)' : 'var(--color-bg)',
    color: active ? '#fff' : 'var(--color-text)',
  };
}

/** ★ `'white'` and `'#fff'` are the same colour spelled two ways. Normalised
 *  for the object comparison, and proven identical as a COMPUTED colour by the
 *  render test below — which is the assertion that actually means "no visual
 *  change". */
function norm(o: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(o).map(([k, v]) => [k, v === 'white' ? '#fff' : v]),
  );
}

describe('fix-441 §D (P-091) — one chipStyle, no visual change', () => {
  it('★★★ the four were NOT the same function — the inactive tint differs', () => {
    // Reported before unifying, per the brief. This is the whole reason
    // chipStyle takes a surface instead of picking a winner: #ffffff vs
    // #f0f4f8 is a real difference, and collapsing them would restyle two of
    // the four sites.
    expect(originalHoldFilterAndScopeToggle(false).background).toBe(
      'var(--color-surface)',
    );
    expect(originalMyTasksAndProjectList(false).background).toBe('var(--color-bg)');
  });

  it('★★★ deep-equal to the originals, both states, both surfaces', () => {
    for (const active of [true, false]) {
      expect(norm(chipStyle(active, 'surface') as Record<string, string>)).toEqual(
        norm(originalHoldFilterAndScopeToggle(active)),
      );
      expect(norm(chipStyle(active, 'bg') as Record<string, string>)).toEqual(
        norm(originalMyTasksAndProjectList(active)),
      );
    }
  });

  it('★★★ …and identical as a COMPUTED colour, which is what "no visual change" means', () => {
    // ★ jsdom resolves both spellings of white to `rgb(255, 255, 255)`, so this
    //   is the assertion the string comparison above is only a proxy for.
    render(
      <>
        <div data-testid="was" style={originalHoldFilterAndScopeToggle(true)} />
        <div data-testid="is" style={chipStyle(true, 'surface')} />
      </>,
    );
    const was = getComputedStyle(screen.getByTestId('was'));
    const is = getComputedStyle(screen.getByTestId('is'));
    expect(is.color).toBe(was.color);
    expect(is.backgroundColor).toBe(was.backgroundColor);
    expect(is.borderColor).toBe(was.borderColor);
  });

  it('★★ the four files import it and declare none of their own', () => {
    const FILES = [
      ['src/components/shared/HoldFilter.tsx', 'surface'],
      ['src/components/shared/ScopeToggle.tsx', 'surface'],
      ['src/pages/MyTasks.tsx', 'bg'],
      ['src/pages/ProjectList.tsx', 'bg'],
    ] as const;
    for (const [file, surface] of FILES) {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8');
      // ★ Depth differs — `components/shared/` is two levels down, `pages/`
      //   is one — so match the module, not the relative prefix.
      expect(src, file).toMatch(/from '\.\.?\/(\.\.\/)?lib\/chipStyle'/);
      expect(code(src), file).not.toMatch(/function chipStyle\s*\(/);
      // Every call site carries this file's own surface.
      const calls = [...code(src).matchAll(/chipStyle\(([^()]*)\)/g)];
      expect(calls.length, file).toBeGreaterThan(0);
      for (const c of calls) {
        expect(c[1], `${file} :: ${c[0]}`).toContain(`'${surface}'`);
      }
    }
  });

  it('★★★ D2 — libraryGroupPalette.chipStyle is a DIFFERENT function, untouched', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/lib/libraryGroupPalette.ts'),
      'utf8',
    );
    // It takes a palette and returns a chip's colours from it; it has nothing
    // to do with an active/inactive filter pill. Same name, different job — a
    // rename would be churn on a working thing.
    expect(src).toMatch(/export function chipStyle\(/);
    expect(src).not.toContain("from './chipStyle'");
  });
});
