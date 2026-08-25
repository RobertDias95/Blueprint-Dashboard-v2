import { describe, it, expect } from 'vitest';
import {
  permitDiscriminator,
  permitLabelSuffix,
  siblingCountOf,
  taskPermitSuffix,
} from '../lib/permitDiscriminator';
import {
  DEFAULT_WAITING_ON_OPTIONS,
  WAITING_ON_CITY,
  WAITING_ON_CONFIG_KEY,
  isRetiredWaitingOn,
  waitingOnOptions,
} from '../lib/waitingOn';
import { AUTO_CLOSED_REASONS } from '../lib/database.types';
import { buildNewItems } from '../lib/boardReads';
import { provenanceLine } from '../lib/taskProvenance';
import type { Permit } from '../lib/database.types';
import renameSql from '../../migrations/fix_364_task_vocabulary.sql?raw';
// ★ fix-395 added two reasons and re-emitted the CHECK; fix-405 added two more
//   and re-emitted it again, so `staleSql` is where the LIVE constraint lives
//   now. Both are imported so "the TS list matches the DB" stays a real
//   assertion, and so the re-emission is checked to have carried fix-395's own
//   pair across rather than quietly dropping them.
import chaseSql from '../../migrations/fix_395_city_target_chase_task.sql?raw';
import staleSql from '../../migrations/fix_405_stale_bot_task_rules.sql?raw';

/** The six this ticket itself established — pinned, so fix-364's own claim
 *  stays checked even as the vocabulary grows past it. */
const FIX_364_REASONS = [
  'permit_issued',
  'superseded_by_intake_acceptance',
  'superseded_next_cycle',
  'superseded_resubmitted',
  'superseded_status_matched',
  'superseded_number_present',
] as const;
import badgeSrc from '../components/shared/AutoClosedBadge.tsx?raw';

// ===========================================================================
// fix-364 — three places a task describes itself badly
// ===========================================================================
//
// Three small things of one kind: a task saying something misleading about
// itself. Bundled because they share a surface and each alone is too small to
// be worth a ticket.

// ---------------------------------------------------------------------------
// ★★ §1 — a reason code that reads like the rule Bobby EXCLUDED
// ---------------------------------------------------------------------------

describe('fix-364 §1: one concept, one term', () => {
  it('★★★ `superseded_intake_accepted` survives nowhere in the code', () => {
    // fix-355 named the rule for its EVIDENCE — the city accepted intake. But
    // the instruction for that ticket was "build it, minus intake_accepted",
    // which excluded a DIFFERENT rule: one that would have closed tasks whose
    // own job IS intake_accepted (measured then: 0 of 17). Two things,
    // near-identical names, side by side in one feed.
    const modules = import.meta.glob('../**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;

    // ★ Comments are stripped first, both forms. Two files name the old value
    // in PROSE — "renamed from superseded_intake_accepted" — and that
    // explanation is the most useful sentence either of them contains. A
    // comment is not a value in circulation; a string literal is.
    const strip = (src: string) =>
      src
        .split(NEWLINE)
        .map((l) => (l.includes('//') ? l.slice(0, l.indexOf('//')) : l))
        // ★ …and so are NEGATIVE assertions. fix-355's suite says
        // `expect(RULES).not.toContain('superseded_intake_accepted')`, which is
        // this same guard written from the other side — forbidding a value is
        // not circulating it. A name-list exemption would rot; this is a rule.
        .filter((l) => !/not\.(toContain|toMatch)/.test(l))
        .join(NEWLINE)
        .replace(/\/\*[\s\S]*?\*\//g, '');

    const offenders: string[] = [];
    for (const [path, src] of Object.entries(modules)) {
      // This file names the old value in order to forbid it.
      if (path.includes('TaskVocabularyFix364')) continue;
      if (/superseded_intake_accepted/.test(strip(src))) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  it('★★ …and the migration renames the rows rather than leaving two spellings', () => {
    // "Leaving both in circulation is worse than either." MEASURED: exactly 13
    // rows carried the old value.
    expect(renameSql).toMatch(
      /UPDATE public\.permit_tasks\s+SET auto_closed_reason = 'superseded_by_intake_acceptance'\s+WHERE auto_closed_reason = 'superseded_intake_accepted'/,
    );
    // ★ And the CHECK is replaced, so the old spelling is no longer legal —
    // a widened constraint would let both back in tomorrow.
    expect(renameSql).toMatch(/DROP CONSTRAINT IF EXISTS permit_tasks_auto_closed_reason_check/);
    const check = renameSql.slice(renameSql.indexOf('ADD CONSTRAINT permit_tasks_auto_closed_reason_check'));
    expect(check.slice(0, 600)).toMatch(/'superseded_by_intake_acceptance'/);
    expect(check.slice(0, 600)).not.toMatch(/'superseded_intake_accepted'/);
  });

  it('★★★ EVERY reader of the reason code handles the new value', () => {
    // The failure this guards is a blank badge in production, which is how a
    // missed reader gets noticed there instead of here.
    for (const reason of AUTO_CLOSED_REASONS) {
      // Reader 1 — the badge's tooltip.
      expect(badgeSrc).toContain(`${reason}:`);

      // Reader 2 — fix-363's provenance line. Never blank, never a person.
      const line = provenanceLine({
        kind: 'completed',
        at: '2026-08-19T09:00:00Z',
        actor_uid: null,
        actor_name: null,
        detail: 'Resolved',
        auto_mark: reason,
      });
      expect(line.state).toBe('machine');
      expect(line.actor).toBeNull();
      expect(line.text.length).toBeGreaterThan(20);
      expect(line.text).toMatch(/^Closed automatically/);
    }
  });

  it('★★ reader 3 — fix-354\'s notification title, for every reason', () => {
    for (const reason of AUTO_CLOSED_REASONS) {
      const [item] = buildNewItems({
        flips: [],
        tasks: [],
        acks: [],
        permits: [],
        viewerName: 'Bobby',
        autoClosures: [
          {
            id: 'c1',
            permit_id: 1,
            project_id: 'p1',
            address: '11231 NE 67th St',
            permit_label: 'Building Permit',
            reason,
            detail: null,
            recipient: 'Bobby',
            task_count: 1,
            task_ids: null,
            closed_at: '2026-08-19T09:00:00Z',
          },
        ],
      }).filter((i) => i.source === 'auto_closed');
      expect(item).toBeDefined();
      expect(item.title).toMatch(/^1 task closed — the permit/);
      expect(item.title).not.toMatch(/undefined|null/);
    }
  });

  it('★ reader 4 — the TYPE, which had been wrong since fix-355', () => {
    // `auto_closed_reason?: 'permit_issued' | null` was a latent reader: a
    // narrower type never fails at runtime, so nothing caught it for nine
    // tickets. The set must match the DB CHECK exactly.
    //
    // ★★ fix-395 grew the vocabulary by two, so the pin moved to the CHECK that
    // is now live rather than to fix-364's own. THE INTENT IS UNCHANGED — "the
    // TS list and the DB CHECK say the same thing" — and it is now checked
    // against the newest constraint instead of a frozen count, so the next
    // ticket to add a reason is caught here rather than in production.
    //
    // ★★ AND fix-405 GREW IT BY TWO MORE, so the pin follows the constraint
    // again — `staleSql`, not `chaseSql`. THIS IS THE MECHANISM WORKING: the
    // paragraph above predicted that the next ticket to add a reason would be
    // caught here, and it was. The assertion is deliberately re-pointed rather
    // than relaxed; pointing it at "whichever migration is newest" would make
    // it pass forever and check nothing.
    expect(FIX_364_REASONS).toHaveLength(6);
    for (const r of FIX_364_REASONS) {
      expect(renameSql).toContain(`'${r}'`);
      expect(AUTO_CLOSED_REASONS).toContain(r);
    }

    const liveCheck = staleSql.slice(
      staleSql.indexOf('ADD CONSTRAINT permit_tasks_auto_closed_reason_check'),
    );
    // ★ Bounded by the constraint's own closing `));` rather than a character
    //   count. The old 800-char window was one added reason away from running
    //   into the next statement's `SET search_path TO 'public', 'pg_temp'` and
    //   reporting two phantom reasons the CHECK does not contain.
    const constrained = new Set(
      [...liveCheck.slice(0, liveCheck.indexOf('));')).matchAll(/'(\w+)'/g)].map(
        (m) => m[1]!,
      ),
    );
    expect([...AUTO_CLOSED_REASONS].filter((r) => !constrained.has(r))).toEqual([]);
    expect([...constrained].filter((r) => !AUTO_CLOSED_REASONS.includes(r as never)))
      .toEqual([]);

    // ★★ ...and the re-emission carried fix-395's pair across. A re-emitted
    // CHECK is a whole-list rewrite: forgetting a value would not error, it
    // would silently make every row holding it unwritable.
    for (const r of ['superseded_city_responded', 'superseded_target_changed']) {
      expect(chaseSql, `${r} was fix-395's`).toContain(`'${r}'`);
      expect(constrained.has(r), `${r} survived fix-405's re-emission`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// ★★ §2 — four identical rows on one address
// ---------------------------------------------------------------------------

/** The four cottages at 11231 NE 67th St, verbatim from prod. */
function cottages(): Permit[] {
  return [10254, 10257, 10258, 10259].map(
    (id, i) =>
      ({
        id,
        project_id: 'p-11231',
        type: 'Building Permit',
        num: null,
        nickname: null,
        struct_address: `Cottage ${i + 1}`,
      }) as unknown as Permit,
  );
}

describe('fix-364 §2: four siblings, four distinguishable rows', () => {
  it('★★★ the real 11231 NE 67th St shape produces four DIFFERENT labels', () => {
    const permits = cottages();
    const labels = permits.map((p) => taskPermitSuffix(p.id, permits));
    expect(labels).toEqual([
      ' · Cottage 1',
      ' · Cottage 2',
      ' · Cottage 3',
      ' · Cottage 4',
    ]);
    // The point of the ticket: no two rows read the same.
    expect(new Set(labels).size).toBe(4);
  });

  it('★★ …and a permit with no same-type sibling gets NO suffix', () => {
    // 484 of 542 permits are the only one of their type on their project. A
    // discriminator on those is noise on hundreds of rows to serve the 58 that
    // need it.
    const solo = [
      { id: 1, project_id: 'p1', type: 'PPR', num: 'X', nickname: null, struct_address: null },
    ] as unknown as Permit[];
    expect(taskPermitSuffix(1, solo)).toBe('');
  });

  it('★★ a sibling of a DIFFERENT type is not a sibling', () => {
    // The Demolition at this address is already told apart by the type the row
    // prints; only the four Building Permits are ambiguous.
    const mixed = [
      ...cottages(),
      { id: 10255, project_id: 'p-11231', type: 'Demolition', num: 'DEM26-01856', nickname: null, struct_address: null },
    ] as unknown as Permit[];
    expect(taskPermitSuffix(10255, mixed)).toBe('');
    expect(taskPermitSuffix(10254, mixed)).toBe(' · Cottage 1');
  });

  it('★★★ the discriminator is STABLE — nothing is derived from position', () => {
    // "The 2nd of 4" renumbers the moment a sibling is deleted, and a label
    // that changes under a person is worse than a duplicate.
    const permits = cottages();
    const before = taskPermitSuffix(10259, permits);
    // Reorder, and delete an earlier sibling: the label does not move.
    const reordered = [...permits].reverse();
    expect(taskPermitSuffix(10259, reordered)).toBe(before);
    const fewer = permits.filter((p) => p.id !== 10254);
    expect(taskPermitSuffix(10259, fewer)).toBe(before);
    // ★ And re-deriving from the same input twice is identical.
    expect(taskPermitSuffix(10259, permits)).toBe(before);
  });

  it('★ the fallback order is stored-field-first, id last', () => {
    // MEASURED across the 58 permits that need a discriminator: 54 carry
    // struct_address, 51 a number, and NONE of the 542 permits in the portfolio
    // carries a nickname — it is unused today but outranks everything, because
    // if somebody sets one they meant it.
    const base = { id: 7, project_id: 'p', type: 't' };
    expect(permitDiscriminator({ ...base, nickname: 'The Barn', struct_address: 'Cottage 1', num: 'B-1' })).toBe('The Barn');
    expect(permitDiscriminator({ ...base, nickname: null, struct_address: 'Cottage 1', num: 'B-1' })).toBe('Cottage 1');
    expect(permitDiscriminator({ ...base, nickname: null, struct_address: null, num: 'B-1' })).toBe('B-1');
    // ★ The honest last resort — and it is the id in the URL fix-362 made a
    // real destination, so a person can match the label to the address bar.
    expect(permitDiscriminator({ ...base, nickname: null, struct_address: null, num: null })).toBe('Permit #7');
    // Blank strings are not values.
    expect(permitDiscriminator({ id: null, nickname: '  ', struct_address: '', num: '   ' })).toBeNull();
  });

  it('★ the board line carries it, and only where it is needed', () => {
    const permits = cottages();
    const items = buildNewItems({
      flips: [],
      tasks: [
        {
          id: 't1',
          text: 'Enter permit number',
          assigned_to: 'Bobby',
          co_assignees: [],
          created_at: '2026-08-19T10:00:00Z',
          permit_id: 10257,
          project_id: 'p-11231',
          project_address: '11231 NE 67th St',
          permit_type: 'Building Permit',
        } as never,
      ],
      acks: [],
      permits: permits as never,
      viewerName: 'Bobby',
    }).filter((i) => i.source === 'task');
    expect(items[0].where).toBe('11231 NE 67th St · Building Permit · Cottage 2');
  });

  it('★ helpers behave at the edges rather than throwing', () => {
    expect(permitDiscriminator(null)).toBeNull();
    expect(permitLabelSuffix({ id: 1, struct_address: 'A' }, 1)).toBe('');
    expect(permitLabelSuffix({ id: 1, struct_address: 'A' }, 2)).toBe(' · A');
    expect(siblingCountOf(null, [])).toBe(0);
    expect(taskPermitSuffix(null, cottages())).toBe('');
    expect(taskPermitSuffix(999, cottages())).toBe('');
  });

  it('★★ the SQL generator and its TS mirror agree, and no row is rewritten', () => {
    // ★ NO EXISTING TASK TEXT IS TOUCHED — the rule for this ticket is that
    // only §1's rename writes to a row. Today's rows are fixed by the display;
    // the generator stops new ones being born ambiguous.
    expect(renameSql).toMatch(/v_discriminator := COALESCE\(/);
    expect(renameSql).toMatch(/NULLIF\(btrim\(v_permit\.struct_address\), ''\)/);
    expect(renameSql).toMatch(/'Permit #' \|\| v_permit\.id::text/);
    expect(renameSql).not.toMatch(/UPDATE public\.permit_tasks\s+SET text/);
  });
});

// ---------------------------------------------------------------------------
// ★★★ §3 — Waiting on: editable, and the city is missing
// ---------------------------------------------------------------------------

const NEWLINE = String.fromCharCode(10);

const EMPTY = new Map<string, unknown>();

describe('fix-364 §3: the list moves to app_config', () => {
  it('★★ options come from app_config when it has them', () => {
    const cfg = new Map<string, unknown>([
      [WAITING_ON_CONFIG_KEY, ['Structural', 'Surveyor', 'City']],
    ]);
    expect(waitingOnOptions(cfg)).toEqual(['Structural', 'Surveyor', 'City']);
  });

  it('★★ …and from the built-in list until an admin edits it', () => {
    // ★ NO SEED ROW IS WRITTEN — the standing rule is that only §1 touches
    // data. An absent key reads as [], and the default IS the list until the
    // first edit writes the whole array.
    expect(waitingOnOptions(EMPTY)).toEqual([...DEFAULT_WAITING_ON_OPTIONS]);
    expect(waitingOnOptions(new Map([[WAITING_ON_CONFIG_KEY, []]]))).toEqual([
      ...DEFAULT_WAITING_ON_OPTIONS,
    ]);
  });

  it('★ City is present, selectable, and not the escape hatch', () => {
    const opts = waitingOnOptions(EMPTY);
    expect(opts).toContain(WAITING_ON_CITY);
    // ★★ It is a DIFFERENT KIND of answer — every other value is a consultant
    // we hired, the city is the jurisdiction we are waiting on. The question
    // the field asks is "who is this task waiting on", and the city is a
    // legitimate answer to it.
    expect(opts.indexOf(WAITING_ON_CITY)).toBeLessThan(opts.indexOf('Other'));
    // ★ 'Other' stays LAST. An escape hatch in the middle gets picked by
    // accident — and it is the second-most-used OPEN value today (11 tasks),
    // which is the measurement that motivated adding City at all.
    expect(opts[opts.length - 1]).toBe('Other');
  });

  it('★★★ EXISTING VALUES SURVIVE — a deleted option does not blank a task', () => {
    // The one hard question an editable list creates. A <select> whose value is
    // not among its options renders BLANK in every browser, which is precisely
    // how an editable list quietly destroys data.
    const cfg = new Map<string, unknown>([
      [WAITING_ON_CONFIG_KEY, ['Civil', 'City']],
    ]);
    // An admin has removed "Structural"; a task is still set to it.
    const opts = waitingOnOptions(cfg, 'Structural');
    expect(opts).toContain('Structural');
    // ★ Appended, not inserted: a retired value belongs at the end, where it
    // reads as "this is what it is" rather than as a live choice.
    expect(opts[opts.length - 1]).toBe('Structural');
    expect(isRetiredWaitingOn(cfg, 'Structural')).toBe(true);
    // …and a live value is not marked retired.
    expect(isRetiredWaitingOn(cfg, 'Civil')).toBe(false);
    expect(isRetiredWaitingOn(cfg, null)).toBe(false);
  });

  it('★★ a task set to Structural still reads Structural, list or no list', () => {
    for (const cfg of [
      EMPTY,
      new Map<string, unknown>([[WAITING_ON_CONFIG_KEY, ['City']]]),
      new Map<string, unknown>([[WAITING_ON_CONFIG_KEY, []]]),
    ]) {
      expect(waitingOnOptions(cfg, 'Structural')).toContain('Structural');
    }
  });

  it('★ a value already on the list is not duplicated into it', () => {
    const opts = waitingOnOptions(EMPTY, 'Civil');
    expect(opts.filter((o) => o === 'Civil')).toHaveLength(1);
  });

  it('★★ the consultant vocabulary does NOT gain City', () => {
    // WAITING_ON_OPTIONS is also the external-team discipline list — the keys
    // of projects.external_team and the `discipline` on the firm directory. A
    // firm directory with a "City" entry is nonsense: we do not hire the city.
    // So the lists split here rather than one growing a value the other cannot
    // use.
    const modules = import.meta.glob('../lib/database.types.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const types = Object.values(modules)[0];
    const block = types.slice(
      types.indexOf('export const WAITING_ON_OPTIONS = ['),
      types.indexOf('] as const;', types.indexOf('export const WAITING_ON_OPTIONS = [')),
    );
    expect(block).not.toContain(WAITING_ON_CITY);
    expect(block).toContain('Structural');
  });
});
