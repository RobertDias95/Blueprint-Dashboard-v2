/// <reference types="node" />
// ★ Node types for this file only — see the fix-406 suite's note; this one also
//   reads `index.css` and the committed audit off disk.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CHIP_INK_HUE_PCT,
  STAGE_CHIP,
  STAGE_CHIP_MIX,
} from '../lib/planOfRecord';
import { LIBRARY_GROUP_MIX } from '../lib/libraryGroupPalette';
import {
  formerMemberNames,
  isAssignableMember,
  isCurrentMember,
} from '../lib/roster';
import { activeMemberNamesOf } from '../hooks/useTeamMembers';
import type { TeamMember } from '../lib/database.types';

// ===========================================================================
// fix-407 — inactive people, and every surface that still believes them
// ===========================================================================
//
// Bobby, 2026-08-26, on the Team Structure screen: *"why are these DA's under
// jade? they arent active anymore? and they arent on the drawschedule anymore.
// this is what i meant by a wholistic clean, organization, and revamp of the
// settings to ensure our ecosystem is update to date and aligned. can you
// review in more depth."*
//
// ---------------------------------------------------------------------------
// ★★★ THE MEASUREMENT (prod, 2026-08-25) — five inactive people
// ---------------------------------------------------------------------------
//
//     Alex     da         active=false  former=true
//     Chad     da         active=false  former=true
//     Nidhi    da         active=false  former=true
//     Caleb    acq_lead   active=false  former=FALSE
//     George   da         active=false  former=FALSE
//
// ★★★ fix-321 WROTE "EITHER FLAG ALONE RETIRES THEM" AND NOTED AT THE TIME
// THAT IT WAS NOT LOAD-BEARING — all three retired rows then agreed on both
// columns. IT IS LOAD-BEARING NOW: Caleb and George are retired by `active`
// alone, and Caleb is the single largest live holding in the whole audit
// (20 projects). A predicate testing `former` would have missed both.
//
// ★★ WHAT THEY STILL HOLD, LIVE:
//
//     Caleb   20  projects.acq_lead
//     Nidhi    2  permits.da (7106889-CN, 7123520-CN)  + 1 dm_da_groups row
//     Alex     1  dm_da_groups row (under Jade)
//     Chad     0
//     George   0
//
// ★★ AND THE BRIEF SAID THREE LIVE PERMITS. It is TWO. The third,
// 7120425-CN (Alex), is unissued — but its project is CANCELLED, and fix-262 /
// fix-264 put cancelled work off live work. Reported as its own scope rather
// than folded into either bucket.
//
// ★★★ NOTHING IN THIS TICKET MOVES A ROW. Who inherits what is a people
// decision; the deliverable is the report.

// ---------------------------------------------------------------------------
// Shared colour maths — the fix-406 discipline, reused rather than re-derived
// ---------------------------------------------------------------------------

const indexCss = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
const TOKENS: Record<string, string> = Object.fromEntries(
  [...indexCss.matchAll(/(--color-[\w-]+):\s*(#[0-9a-fA-F]{6});/g)].map((m) => [
    m[1]!,
    m[2]!.toLowerCase(),
  ]),
);

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
function mix(a: string, b: string, pctA: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const f = pctA / 100;
  const ch = (x: number, y: number) =>
    Math.round(x * f + y * (1 - f))
      .toString(16)
      .padStart(2, '0');
  return `#${ch(ar, br)}${ch(ag, bg)}${ch(ab, bb)}`;
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------
// §1 · THE MEMBERSHIP RULE, NOW LOAD-BEARING
// ---------------------------------------------------------------------------

function member(over: Partial<TeamMember>): TeamMember {
  return {
    id: over.name ?? 'x',
    name: 'X',
    role: 'da',
    active: true,
    former: false,
    ...over,
  } as TeamMember;
}

describe('fix-407 §1: either flag alone retires somebody', () => {
  it('★★★ `active=false, former=false` is RETIRED — Caleb and George', () => {
    // fix-321 wrote this rule and recorded that no row exercised it. Two do
    // now, and one of them (Caleb) holds 20 live projects. A predicate reading
    // `former` alone — the shape fix-321 replaced — would call him current.
    const caleb = member({ name: 'Caleb', role: 'acq_lead', active: false, former: false });
    const george = member({ name: 'George', role: 'da', active: false, former: false });
    expect(isCurrentMember(caleb)).toBe(false);
    expect(isCurrentMember(george)).toBe(false);
    // ★ The naive test that would have missed them.
    expect(caleb.former).toBe(false);
    expect(george.former).toBe(false);
  });

  it('★★ `active=true, former=true` is retired too — the mirror case', () => {
    expect(isCurrentMember(member({ active: true, former: true }))).toBe(false);
  });

  it('★★ a retired person is never OFFERED work, whatever their role', () => {
    for (const role of ['da', 'dm', 'ent', 'acq_lead', 'schematic'] as const) {
      expect(isAssignableMember(member({ role, active: false })), role).toBe(false);
    }
  });

  it('★★★ `formerMemberNames` flags only what the roster SAYS is retired', () => {
    // ★★ The chips call this, and the distinction is load-bearing: a mapping
    // row can name somebody the roster has never heard of (a legacy value, a
    // person never added). UNKNOWN IS NOT DEPARTED — flagging them would put a
    // "no longer with us" label on somebody who never had a roster row.
    const roster = [
      member({ name: 'Erick' }),
      member({ name: 'Alex', active: false, former: true }),
      member({ name: 'Caleb', role: 'acq_lead', active: false, former: false }),
    ];
    const retired = formerMemberNames(roster);
    expect(retired.has('Alex')).toBe(true);
    expect(retired.has('Caleb')).toBe(true);
    expect(retired.has('Erick')).toBe(false);
    expect(retired.has('Somebody Not On The Roster')).toBe(false);
  });

  it('★★ one live role is enough — a dual-role person is not retired', () => {
    // The roster has one row per (person, role), so this is reachable: Bobby,
    // Briana and Miles each hold two. Retiring one row must not retire them.
    const roster = [
      member({ id: '1', name: 'Miles', role: 'ent', active: false, former: true }),
      member({ id: '2', name: 'Miles', role: 'ent_lead' }),
    ];
    expect(formerMemberNames(roster).has('Miles')).toBe(false);
    expect(activeMemberNamesOf(roster)).toContain('Miles');
  });
});

// ---------------------------------------------------------------------------
// §2 · THE HOOK — the last two buckets that did not ask
// ---------------------------------------------------------------------------

describe('fix-407 §2: every role bucket applies the membership rule', () => {
  it('★★★ dms and schematics filter to current members', async () => {
    // fix-321 established the rule, fix-401 wired `acqs`, fix-403 wired `ents`.
    // `dms` and `schematics` were still bare `ofRole()` calls, so every picker
    // sourcing them would offer a retired manager for a NEW assignment.
    const src = readFileSync(
      resolve(process.cwd(), 'src/hooks/useTeamMembers.ts'),
      'utf8',
    );
    const code = src
      .split(/\r?\n/)
      .map((l) => (l.trim().startsWith('//') ? '' : l))
      .join('\n');
    expect(code).toMatch(/dms:\s*ofRole\('dm'\)\.filter\(isCurrentMember\)/);
    expect(code).toMatch(
      /schematics:\s*ofRole\('schematic'\)\.filter\(isCurrentMember\)/,
    );
    // ★★ ZERO DMs AND ZERO SCHEMATIC DESIGNERS ARE INACTIVE TODAY, so this
    //    changes nothing anybody can see. It is fixed anyway because the
    //    alternative is discovering it the first time a manager leaves —
    //    exactly how Alex and Nidhi came to sit under Jade looking current.
    expect(code).not.toMatch(/dms:\s*ofRole\('dm'\),/);
  });

  it('★★★ `inactive` covers EVERY role — the Caleb hole', () => {
    // `formerDas` is role='da' only. Caleb is an inactive `acq_lead`, so
    // fix-401's filter correctly kept him out of the Acquisitions picker and
    // the alumni list never covered him: he appeared on NO Settings surface
    // while being named on 20 live projects. You cannot clean up what the
    // screen will not show you.
    const src = readFileSync(
      resolve(process.cwd(), 'src/hooks/useTeamMembers.ts'),
      'utf8',
    );
    expect(src).toMatch(/inactive:\s*dedupeByPerson\(/);
    expect(src).toMatch(/all\.filter\(\(m\) => !isCurrentMember\(m\)\)/);
  });
});

// ---------------------------------------------------------------------------
// §3 · THE TEAM STRUCTURE EDITOR — Bobby's actual screenshot
// ---------------------------------------------------------------------------

const groupRows = vi.hoisted(() => ({
  rows: [
    { id: 'r1', dm_name: 'Jade', da_name: 'Erick', da_order: 0, dm_order: 0, updated_at: 't' },
    { id: 'r2', dm_name: 'Jade', da_name: 'Alex', da_order: 1, dm_order: 0, updated_at: 't' },
    { id: 'r3', dm_name: 'Jade', da_name: 'Nidhi', da_order: 2, dm_order: 0, updated_at: 't' },
  ],
}));

vi.mock('../hooks/useDmDaGroups', () => ({
  useDmDaGroups: () => ({ rows: groupRows.rows, isLoading: false, error: null }),
}));
vi.mock('../hooks/useUpsertDmDaGroup', () => ({
  useUpsertDmDaGroup: () => ({ mutate: vi.fn() }),
}));
vi.mock('../hooks/useDeleteDmDaGroup', () => ({
  useDeleteDmDaGroup: () => ({ mutate: vi.fn() }),
}));
vi.mock('../hooks/useOpenTaskCounts', () => ({
  useOpenTaskCounts: () => ({ data: {} }),
}));

import TeamStructureEditor from '../components/Settings/TeamStructureEditor';

const JADE = member({ id: 'dm1', name: 'Jade', role: 'dm' });
const DERRY = member({ id: 'dm2', name: 'Derry', role: 'dm' });
const ERICK = member({ id: 'da1', name: 'Erick' });
// ★ An unmapped current DA, so the "Add DA to Jade" picker actually renders —
//   it is hidden when there is nobody left to add. Without him the offer tests
//   below would pass by finding no select at all.
const CAM = member({ id: 'da2', name: 'Cam' });

function renderStructure(retired: ReadonlySet<string>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TeamStructureEditor
        // ★ Two DMs, because the move-to dropdown only renders when there is
        //   somewhere to move to.
        dms={[JADE, DERRY]}
        activeDas={[ERICK, CAM]}
        retiredNames={retired}
      />
    </QueryClientProvider>,
  );
}

describe('fix-407 §3: inactive DAs render AS inactive', () => {
  const RETIRED = new Set(['Alex', 'Nidhi']);

  it('★★★ the retired chips are visually distinct from the live one', () => {
    renderStructure(RETIRED);
    const erick = screen.getByTestId('team-da-chip-Erick');
    const alex = screen.getByTestId('team-da-chip-Alex');
    const nidhi = screen.getByTestId('team-da-chip-Nidhi');

    // The live chip keeps its amber; the retired ones take the alumni pill's
    // neutral treatment, lifted from the "Former DAs" section rather than
    // invented as a third state.
    expect(erick.className).toContain('bg-co-bg');
    expect(alex.className).toContain('bg-surface');
    expect(alex.className).not.toContain('bg-co-bg');
    expect(nidhi.className).not.toContain('bg-co-bg');
    // ★ Structural, not only colour — a test that reads a class name is one
    //   restyle away from passing on a chip that looks identical.
    expect(alex.getAttribute('data-inactive')).toBe('true');
    expect(erick.getAttribute('data-inactive')).toBeNull();
  });

  it('★★★ ...and they SAY "Inactive" — colour alone is a guess', () => {
    // A greyed pill reads as "disabled" or "not selected" as easily as "left
    // the company". The word removes the guess.
    renderStructure(RETIRED);
    expect(screen.getByTestId('team-da-chip-inactive-Alex')).toBeInTheDocument();
    expect(screen.getByTestId('team-da-chip-inactive-Nidhi')).toBeInTheDocument();
    expect(screen.queryByTestId('team-da-chip-inactive-Erick')).toBeNull();
  });

  it('★★★ THE MAPPING IS FLAGGED, NEVER HIDDEN', () => {
    // Dropping the chip would make the mapping look absent while
    // `bp_trg_task_coassign_dm` still routes off it — and it would never get
    // cleaned up, because nobody could see it. fix-321's rule: CHOOSING is
    // current-only, SHOWING is whatever is recorded.
    renderStructure(RETIRED);
    expect(screen.getByTestId('team-da-chip-Alex')).toBeInTheDocument();
    expect(screen.getByTestId('team-da-chip-Nidhi')).toBeInTheDocument();
    expect(screen.getByTestId('team-dm-card-Jade').textContent).toContain('Alex');
  });

  it('★★ the card counts them and says what the row still costs', () => {
    renderStructure(RETIRED);
    expect(
      screen.getByTestId('team-dm-card-retired-count-Jade').textContent,
    ).toContain('2 inactive');
    const note = screen.getByTestId('team-dm-card-retired-note-Jade').textContent ?? '';
    expect(note).toContain('Alex');
    expect(note).toContain('Nidhi');
    // ★ A chip that only looks different is a curiosity. Naming what the row
    //   still drives is what gets it acted on.
    expect(note).toMatch(/draw-schedule grouping/);
    expect(note).toMatch(/co-assignee/);
  });

  it('★★★ the "Add DA to Jade" picker offers NO retired person', () => {
    renderStructure(RETIRED);
    const select = screen.getByTestId('team-add-da-select-Jade') as HTMLSelectElement;
    const offered = [...select.options].map((o) => o.value).filter(Boolean);
    // ★ It offers the unmapped current DA, and nobody who has left.
    expect(offered).toContain('Cam');
    expect(offered).not.toContain('Alex');
    expect(offered).not.toContain('Nidhi');
  });

  it('★★★ the move-to dropdown offers only CURRENT DMs', () => {
    renderStructure(RETIRED);
    const move = screen.getByTestId('team-da-move-Erick') as HTMLSelectElement;
    const enabled = [...move.options].filter((o) => !o.disabled).map((o) => o.value);
    expect(enabled).toEqual(['Jade', 'Derry']);
  });

  it('★★ an UNKNOWN name is not flagged as departed', () => {
    // The roster is the only thing allowed to say somebody has left. Passing an
    // empty retired set must leave every chip live — which is also what happens
    // for a mapping naming somebody who was never added to the roster.
    renderStructure(new Set());
    expect(screen.getByTestId('team-da-chip-Alex').className).toContain('bg-co-bg');
    expect(screen.queryByTestId('team-da-chip-inactive-Alex')).toBeNull();
    expect(screen.queryByTestId('team-dm-card-retired-note-Jade')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §4 · planOfRecord — two dead chips, fixed and measured
// ---------------------------------------------------------------------------

describe('fix-407 §4: the plan-of-record chips actually paint', () => {
  it('★★★ TWO tokens were dead, not the one fix-406 reported', () => {
    // ★★★ fix-441 §A INVERTS THIS. Both tokens are real now — fix-407 fixed
    //     the two chips that READ them, and fix-441 found eight more sites and
    //     defined the tokens instead. The ink is fix-407's own 65/35 recipe,
    //     which is why `--color-wa` is the same value this file's own
    //     `marketing` chip already used.
    expect(TOKENS['--color-ok']).toBe('#0c6e5b'); // schematic hue, darkened
    expect(TOKENS['--color-wa']).toBe('#965a1a'); // === STAGE_CHIP.marketing.fg
    // ★ Sanity: the stylesheet really loaded (fix-406's own trap).
    expect(Object.keys(TOKENS).length).toBeGreaterThan(20);
  });

  it('★★★ every chip has a real, opaque colour now', () => {
    for (const [stage, chip] of Object.entries(STAGE_CHIP)) {
      expect(chip.fg, stage).toMatch(/^#[0-9a-f]{6}$/);
      expect(chip.bg, stage).toMatch(/^#[0-9a-f]{6}$/);
      // ★★ No `var()` and no `transparent`: an undefined variable is what
      //    caused this, and a transparent tint makes the contrast a different
      //    number on every parent surface.
      expect(chip.fg, stage).not.toContain('var(');
      expect(chip.bg, stage).not.toContain('transparent');
    }
  });

  it('★★★ derived from the real tokens — replayed, not trusted', () => {
    // The fix-406 discipline: state the resolved value so it can be measured,
    // and prove it is a mix of the app's own palette rather than an invented
    // hex. If somebody hand-tweaks one, this fails.
    for (const [stage, { token, tintPct }] of Object.entries(STAGE_CHIP_MIX)) {
      const hue = TOKENS[token];
      expect(hue, `${token} must exist`).toBeDefined();
      const chip = STAGE_CHIP[stage as keyof typeof STAGE_CHIP];
      expect(chip.bg, stage).toBe(mix(hue!, TOKENS['--color-surface']!, tintPct));
      expect(chip.fg, stage).toBe(mix(hue!, TOKENS['--color-text']!, CHIP_INK_HUE_PCT));
    }
  });

  it('★★★ THE MEASUREMENT: every chip clears 4.5:1 on its own tint', () => {
    for (const [stage, chip] of Object.entries(STAGE_CHIP)) {
      expect(contrast(chip.fg, chip.bg), stage).toBeGreaterThan(4.5);
    }
  });

  it('★★★ ...and the ONE chip that used to render did NOT clear it', () => {
    // `design_guidance` read `--color-de`, a real token, so it was the only one
    // painting at all — at 4.37:1 on white and 3.75:1 on `--color-s2`. Simply
    // substituting live tokens for the two dead ones would have shipped two
    // more chips in the same under-contrast state. This is why the ink is
    // darkened rather than swapped.
    const de = TOKENS['--color-de']!;
    const oldTintOnWhite = mix(de, TOKENS['--color-surface']!, 12);
    const oldTintOnCard = mix(de, TOKENS['--color-s2']!, 12);
    expect(contrast(de, oldTintOnWhite)).toBeLessThan(4.5);
    expect(contrast(de, oldTintOnCard)).toBeLessThan(4.5);
    expect(contrast(STAGE_CHIP.design_guidance.fg, STAGE_CHIP.design_guidance.bg))
      .toBeGreaterThan(contrast(de, oldTintOnWhite));
  });

  it('★★ the shared contract is the THRESHOLD, not the percentage', () => {
    // fix-406 darkens by 70% on fixed `-bg` tokens; this darkens by 65% on a
    // computed tint, because amber is the lightest of the three hues. Pinning
    // the two constants equal would be a false contract — both are pinned
    // against 4.5:1 instead, which is the thing that actually matters.
    expect(CHIP_INK_HUE_PCT).toBeGreaterThan(0);
    expect(CHIP_INK_HUE_PCT).toBeLessThanOrEqual(LIBRARY_GROUP_MIX.chipTextHuePct);
  });

  it('★★ the three stages stay visually DISTINCT — blue / green / amber', () => {
    const inks = Object.values(STAGE_CHIP).map((c) => c.fg);
    expect(new Set(inks).size).toBe(3);
    const dg = rgb(STAGE_CHIP.design_guidance.fg);
    const sch = rgb(STAGE_CHIP.schematic.fg);
    const mkt = rgb(STAGE_CHIP.marketing.fg);
    expect(dg[2]).toBeGreaterThan(dg[0]); // blue: more blue than red
    expect(sch[1]).toBeGreaterThan(sch[2]); // green: more green than blue
    expect(mkt[0]).toBeGreaterThan(mkt[2]); // amber: more red than blue
  });
});

// ---------------------------------------------------------------------------
// §5 · THE COMMITTED AUDIT
// ---------------------------------------------------------------------------

describe('fix-407 §5: the next audit is a run, not a rebuild', () => {
  const audit = readFileSync(
    resolve(process.cwd(), 'docs/audits/fix_407_people_audit.sql'),
    'utf8',
  );
  const code = audit
    .split(/\r?\n/)
    .map((l) => (l.trim().startsWith('--') ? '' : l))
    .join('\n');

  it('★★★ IT IS READ-ONLY BY CONSTRUCTION', () => {
    // The standing rule for this ticket is that no row naming a person is
    // rewritten. An audit file that could write is one careless paste away
    // from being the thing that does it.
    expect(code).not.toMatch(/\bUPDATE\s+public\./i);
    expect(code).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(code).not.toMatch(/\bTRUNCATE\b/i);
    expect(code).not.toMatch(/\bDROP\b/i);
    expect(code).not.toMatch(/\bALTER\b/i);
  });

  it('★★★ it uses the fix-321 membership rule, both flags', () => {
    expect(code).toMatch(/active IS FALSE OR former IS TRUE/);
    // ★ Never `former` alone — that is the predicate that misses Caleb.
    expect(code).not.toMatch(/WHERE\s+former IS TRUE\s*$/im);
  });

  it('★★★ it separates LIVE from HISTORICAL from CANCELLED', () => {
    for (const scope of ["'LIVE'", "'HISTORICAL'", "'CANCELLED'"]) {
      expect(code, scope).toContain(scope);
    }
    // fix-401's rule: an issued permit records who managed it at the time.
    expect(code).toMatch(/actual_issue IS NOT NULL THEN 'HISTORICAL'/);
    // fix-262/264: cancelled work is off live work.
    expect(code).toMatch(/kind = 'cancelled' AND hold_end IS NULL/);
  });

  it('★★★ the current quarter is DERIVED, so the file cannot go stale', () => {
    // A typed '2026-Q3' would silently mark the live quarter historical the
    // moment the quarter turned — the audit would keep running and keep
    // reporting nothing actionable.
    expect(code).toMatch(/extract\(month FROM current_date\)/);
    expect(code).not.toMatch(/'20\d\d-Q\d'/);
  });

  it('★★ it covers every store the enumeration found to be a real reference', () => {
    for (const store of [
      'dm_da_groups',
      'da_team_routing',
      'permits.da',
      'permits.dual_da',
      'permits.dm',
      'permits.ent_lead',
      'projects.acq_lead',
      'projects.entitlement_lead',
      'projects.design_manager',
      'schematic_designer',
      'permit_tasks.assigned_to',
      'permit_task_assignees',
      'co_assignees',
      'default_co_assignees',
      'draw_schedule_quarter_layout',
      'da_time_blocks',
      'draw_schedule.da_assigned',
    ]) {
      expect(code, store).toContain(store);
    }
  });

  it('★★★ the COLLISION TRAP is written down, with the numbers', () => {
    // A name-match sweep finds rows that have nothing to do with the person:
    // `correction_items.builder = 'Caleb'` (24) is a BUILDER, and
    // `correction_items.architect = 'George'` (14) is an outside architect.
    // "Clean up every row naming an inactive person" would rewrite 38 rows
    // belonging to two people who never worked here.
    const prose = audit
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith('--'))
      .join(' ')
      .replace(/\s+/g, ' ');
    expect(prose).toMatch(/NAME COLLISIONS/);
    expect(prose).toMatch(/a BUILDER named Caleb/);
    expect(prose).toMatch(/an ARCHITECT named George/);
    // ★ ...and the excluded list exists, so the next audit does not
    //   rediscover them one at a time.
    expect(prose).toMatch(/CONSIDERED AND EXCLUDED/);
  });

  it('★★ Bobby\'s words are on the file', () => {
    // ★★ NORMALISE THE COMMENT LEADERS FIRST. The quote wraps across three
    //    `-- ` lines, so a raw search for a sentence fragment fails on the
    //    prefix rather than on the content — the trap fix-400 wrote down and
    //    fix-405 hit again. Strip the leaders, collapse whitespace, then match.
    const prose = audit
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*--\s?/, ''))
      .join(' ')
      .replace(/\s+/g, ' ');
    expect(prose).toContain("why are these DA's under jade? they arent active anymore?");
    expect(prose).toContain('wholistic clean, organization, and revamp of the settings');
  });
});
