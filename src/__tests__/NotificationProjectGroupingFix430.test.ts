import { describe, it, expect } from 'vitest';
import {
  parseFlips,
  flipEventKey,
  flipEventKeyByPermit,
  type ActivityRowLike,
} from '../lib/boardFlips';
import {
  buildNewItems,
  hasBeenRead,
  keyForFlip,
  unseenItems,
  type NewItem,
} from '../lib/boardReads';
import type { PermitWithCycles } from '../lib/database.types';

// ===========================================================================
// fix-430 — the bell groups by permit; group it by project
// ===========================================================================
//
// Bobby, ruled 2026-08-28: **one bulk change is one notification.** A scrape run
// that moved four permits on one project produced four bell items, and a person
// had to read all four to learn one thing.
//
// ---------------------------------------------------------------------------
// ★★★ STEP 0 — MEASURED ON PROD 2026-08-29, READ-ONLY, BEFORE ANYTHING CHANGED
// ---------------------------------------------------------------------------
//
// The key was permit-scoped exactly as the brief claimed —
// `boardFlips.flipEventKey` at :283 read:
//
//     const permit = f.permitId ?? 'audit' + String(f.auditId);
//     const run    = f.runAt    ?? 'audit' + String(f.auditId);
//     return 'flip:' + String(permit) + ':' + run;
//
// so the ticket stands. Read state lives in `board_item_reads(user_id,
// item_key)`, RLS-narrowed, read by `useBoardReads`; `legacyKeys` is consumed
// ONLY by `boardReads.hasBeenRead` (`legacy.every(...)`), and it has been used
// before — fix-360 introduced it for exactly this reason. The six flip kinds
// are as P-084 records them, no difference. `buildNewItems` is called by
// `useBoardNotifications` and `MyBoard`, both of which ALREADY pass `projects`,
// so nothing here adds a subscription anywhere.
//
// ---------------------------------------------------------------------------
// ★★★ AND ONE MEASUREMENT SENT THE BRIEF'S KEY SHAPE BACK
// ---------------------------------------------------------------------------
//
// The brief specified `flip:<projectId>:<eventKind>:<runAt>`. Over 120 days:
//
//     items today          `flip:<permit>:<run>`           1,479
//     shipped              `flip:<project>:<run>`          1,354   −125
//     the brief's shape    `flip:<project>:<kind>:<run>`   1,716   **+237**
//
// **312 of 1,487 permit-writes (21%) carry more than one flip KIND**, up to
// three — a status string and a date meaning different things in one scrape.
// fix-360 §1 exists to merge those into "Approved and issued"; putting the kind
// in the key splits every one back apart. The brief's own measure is items
// removed, and its literal shape would have ADDED 237 while removing 125 — and
// it would have made C1 (single-permit wording byte-identical) impossible. So
// the kind is not in the key, and this file asserts both halves of why.

const AFTER_EPOCH = '2026-08-19T21:03:53.402Z';
const RUN = '2026-08-19T20:44:49+00:00';

/** One permit's scrape write. Defaults to project `proj-1`. */
function row(over: Partial<ActivityRowLike> = {}): ActivityRowLike {
  return {
    id: 1,
    created_at: AFTER_EPOCH,
    action: 'scrape_change_applied',
    row_id: '101',
    permit_num: 'BP-101',
    permit_type: 'Building Permit',
    address: '25 W Cremona',
    ent_lead: 'Bobby',
    project_id: 'proj-1',
    changes: {
      source: 'scraper',
      applied: { corr_issued: '2026-08-19' },
      scraper_run_at: RUN,
    },
    ...over,
  };
}

function permit(over: Record<string, unknown> = {}): PermitWithCycles {
  return {
    id: 101,
    project_id: 'proj-1',
    num: 'BP-101',
    type: 'Building Permit',
    ent_lead: 'Bobby',
    da: 'Ahmadi',
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  } as unknown as PermitWithCycles;
}

function itemsFor(
  rows: ActivityRowLike[],
  permits: PermitWithCycles[] = [permit()],
): NewItem[] {
  return buildNewItems({
    flips: parseFlips(rows, 3650),
    tasks: [],
    acks: [],
    permits,
    viewerName: 'Bobby',
  }).filter((i) => i.source === 'flip');
}

/** The four permits of one project moving in one run — the case Bobby named. */
const FOUR_ON_ONE_PROJECT = [
  row({ id: 1, row_id: '101', permit_num: 'BP-101', permit_type: 'Building Permit' }),
  row({ id: 2, row_id: '102', permit_num: 'BP-102', permit_type: 'Demolition' }),
  row({ id: 3, row_id: '103', permit_num: 'BP-103', permit_type: 'ULS' }),
  row({ id: 4, row_id: '104', permit_num: 'BP-104', permit_type: 'Grading / Clearing' }),
];
const FOUR_PERMITS = [
  permit({ id: 101 }),
  permit({ id: 102 }),
  permit({ id: 103 }),
  permit({ id: 104 }),
];

// ---------------------------------------------------------------------------
// §A · the regrouping
// ---------------------------------------------------------------------------

describe('fix-430 §A: one project, one run, one item', () => {
  it('★★★ four permits on one project in one run become ONE item', () => {
    // The measured maximum in 120 days is 4 — there is no 5-permit case on
    // record — so this fixture is the worst real case, not an invented one.
    const items = itemsFor(FOUR_ON_ONE_PROJECT, FOUR_PERMITS);
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe(`flip:proj-1:${RUN}`);
  });

  it('★★★ two projects in one run stay TWO items', () => {
    const items = itemsFor(
      [
        row({ id: 1, row_id: '101' }),
        row({ id: 2, row_id: '201', project_id: 'proj-2', address: '4000 SW Concord' }),
      ],
      [permit({ id: 101 }), permit({ id: 201, project_id: 'proj-2' })],
    );
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.key).sort()).toEqual(
      [`flip:proj-1:${RUN}`, `flip:proj-2:${RUN}`].sort(),
    );
  });

  it('★★ two runs on one project stay TWO items', () => {
    // fix-360's rule, untouched: the RUN is what groups, and a different run is
    // a different event however close together it landed.
    const items = itemsFor(
      [
        row({ id: 1, row_id: '101' }),
        row({
          id: 2,
          row_id: '102',
          changes: { applied: { corr_issued: '2026-08-19' }, scraper_run_at: 'R2' },
        }),
      ],
      [permit({ id: 101 }), permit({ id: 102 })],
    );
    expect(items).toHaveLength(2);
  });

  it('★★★ a permit with NO project keeps its own permit-scoped item', () => {
    // A2: not dropped, and no project invented for it. Two orphans do not
    // collapse into each other either.
    const items = itemsFor(
      [
        row({ id: 1, row_id: '101', project_id: null }),
        row({ id: 2, row_id: '102', project_id: null }),
      ],
      [permit({ id: 101, project_id: null }), permit({ id: 102, project_id: null })],
    );
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.key).sort()).toEqual(
      [`flip:permit101:${RUN}`, `flip:permit102:${RUN}`].sort(),
    );
  });

  it('★ a projectless permit does not merge into a project group', () => {
    const items = itemsFor(
      [row({ id: 1, row_id: '101' }), row({ id: 2, row_id: '102', project_id: null })],
      [permit({ id: 101 }), permit({ id: 102, project_id: null })],
    );
    expect(items).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// §B · read state — the load-bearing part
// ---------------------------------------------------------------------------

describe('fix-430 §B: nobody wakes up to a re-opened bell', () => {
  it('★★★ a group is READ when every permit it absorbed was read', () => {
    // ★★★ THE REASON THE TICKET EXISTS. Change the key without this and every
    //     already-read notification comes back unread for all 29 logins, on the
    //     same morning. Seeded with the keys the CURRENT scheme wrote — the 131
    //     rows measured on prod — and the regrouped item must read as read.
    const items = itemsFor(FOUR_ON_ONE_PROJECT, FOUR_PERMITS);
    const flips = parseFlips(FOUR_ON_ONE_PROJECT, 3650);
    const seeded = new Set(flips.map((f) => flipEventKeyByPermit(f)));
    expect(seeded.size).toBe(4);
    expect(hasBeenRead(items[0], seeded)).toBe(true);
    expect(unseenItems(items, seeded)).toEqual([]);
  });

  it('★★★ …and it is UNREAD while any one of them is unread', () => {
    // The other half: absorbing four items must not let three reads hide the
    // fourth's news.
    const items = itemsFor(FOUR_ON_ONE_PROJECT, FOUR_PERMITS);
    const flips = parseFlips(FOUR_ON_ONE_PROJECT, 3650);
    const partial = new Set(
      flips.filter((f) => f.permitId !== 104).map((f) => flipEventKeyByPermit(f)),
    );
    expect(hasBeenRead(items[0], partial)).toBe(false);
    expect(unseenItems(items, partial)).toHaveLength(1);
  });

  it('★★★ the OLDER fix-360 generation still counts, per permit', () => {
    // ★★ MEASURED 2026-08-29: 205 flip read rows across 8 people — 131 in the
    //    `flip:<permit>:<run>` form and 74 in fix-360's older
    //    `flip:<auditId>:<kind>` form, every one read inside 30 days. BOTH are
    //    live, and a person has one or the other, never both. So the two are
    //    alternatives per absorbed permit, not one flat `every` — which is what
    //    NewItem.absorbed exists to express.
    const items = itemsFor(FOUR_ON_ONE_PROJECT, FOUR_PERMITS);
    const flips = parseFlips(FOUR_ON_ONE_PROJECT, 3650);
    const oldGeneration = new Set(
      flips.map((f) => keyForFlip(f.auditId, f.kind)),
    );
    expect(hasBeenRead(items[0], oldGeneration)).toBe(true);
  });

  it('★★★ a MIXTURE of generations still reads as read', () => {
    // The realistic case on deploy morning: some permits acknowledged under the
    // current scheme, others under fix-360's. A flat `every` over the union of
    // both would fail here — which is precisely the bug this shape prevents.
    const items = itemsFor(FOUR_ON_ONE_PROJECT, FOUR_PERMITS);
    const flips = parseFlips(FOUR_ON_ONE_PROJECT, 3650);
    const mixed = new Set<string>();
    for (const f of flips) {
      if (f.permitId === 101 || f.permitId === 102) {
        mixed.add(flipEventKeyByPermit(f)); // current generation
      } else {
        mixed.add(keyForFlip(f.auditId, f.kind)); // fix-360 generation
      }
    }
    expect(hasBeenRead(items[0], mixed)).toBe(true);
  });

  it('★★ legacyKeys carries every permit-level key the group absorbed', () => {
    // B1, asserted on the field itself — it is the flat view a person reads
    // when debugging, and it is DERIVED from `absorbed` so the two cannot
    // disagree about which keys an item answers to.
    const items = itemsFor(FOUR_ON_ONE_PROJECT, FOUR_PERMITS);
    const flips = parseFlips(FOUR_ON_ONE_PROJECT, 3650);
    for (const f of flips) {
      expect(items[0].legacyKeys).toContain(flipEventKeyByPermit(f));
      expect(items[0].legacyKeys).toContain(keyForFlip(f.auditId, f.kind));
    }
    expect(items[0].absorbed).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// §C · wording
// ---------------------------------------------------------------------------

describe('fix-430 §C: the common case does not change one character', () => {
  it('★★★ a single-permit group renders EXACTLY what it renders today', () => {
    // 97% of groups are a single permit (1,794 of 1,847 over 120 days) and
    // nobody should see a wording change for the common case. The single-permit
    // path is not "the same words rebuilt" — it delegates to the untouched
    // flipEventTitle / flipEventDetail.
    const [item] = itemsFor([row()]);
    expect(item.title).toBe('Corrections Required');
    expect(item.subtitle).toBe('Corrections issued 2026-08-19');
    expect(item.where).toBe('25 W Cremona · Building Permit');
  });

  it('★★★ multi-kind on ONE permit still merges — the brief\'s key would have split it', () => {
    // 21% of writes carry more than one kind. This is fix-360 §1's own case and
    // it must survive: one item, one composed headline, every fact kept.
    const [item] = itemsFor([
      row({
        changes: {
          applied: { status: 'Conceptually Approved', approval_date: '2026-08-19', actual_issue: '2026-08-19' },
          scraper_run_at: RUN,
        },
      }),
    ]);
    expect(item.title).toBe('Approved and issued');
    expect(item.subtitle).toContain('Approval date 2026-08-19');
    expect(item.subtitle).toContain('Issue date 2026-08-19');
  });

  it('★★ a multi-permit group names the count, the event and the project', () => {
    // Bobby's sentence: "5 permits updated on 25 W Cremona". Every permit here
    // moved for the same reason, so the event is named exactly.
    const [item] = itemsFor(FOUR_ON_ONE_PROJECT, FOUR_PERMITS);
    expect(item.title).toBe('4 permits corrections required on 25 W Cremona');
  });

  it('★ …and "updated" when they moved for different reasons', () => {
    // The honest word rather than a list nobody asked for.
    const [item] = itemsFor(
      [
        row({ id: 1, row_id: '101' }),
        row({
          id: 2,
          row_id: '102',
          changes: { applied: { actual_issue: '2026-08-19' }, scraper_run_at: RUN },
        }),
      ],
      [permit({ id: 101 }), permit({ id: 102 })],
    );
    expect(item.title).toBe('2 permits updated on 25 W Cremona');
  });

  it('★★ the detail says WHICH permits, without leaving the bell', () => {
    // C3. The permits by type and number, then fix-360's enumeration of what
    // moved — collapsing the notifications must not collapse the facts.
    const [item] = itemsFor(FOUR_ON_ONE_PROJECT, FOUR_PERMITS);
    expect(item.subtitle).toContain('Building Permit BP-101');
    expect(item.subtitle).toContain('Demolition BP-102');
    expect(item.subtitle).toContain('ULS BP-103');
    expect(item.subtitle).toContain('Grading / Clearing BP-104');
    expect(item.subtitle).toContain('Corrections issued 2026-08-19');
  });

  it('★ the location line counts the permits rather than naming one of four', () => {
    const [item] = itemsFor(FOUR_ON_ONE_PROJECT, FOUR_PERMITS);
    expect(item.where).toBe('25 W Cremona · 4 permits');
  });
});

// ---------------------------------------------------------------------------
// §D · what must not have changed
// ---------------------------------------------------------------------------

describe('fix-430 §D: the guards', () => {
  it('★★ the key is built only from things that cannot move under a row', () => {
    // fix-360's one rule for this key scheme, inherited whole: a project id and
    // a scraper run stamp are both history, so re-deriving never re-notifies.
    const [flip] = parseFlips([row()], 3650);
    expect(flipEventKey(flip)).toBe(`flip:proj-1:${RUN}`);
    expect(flipEventKey(flip)).not.toMatch(
      /corrections_required|approved|issued|Corrections/,
    );
  });

  it('★★ non-flip items are untouched — no absorbed, no new keys', () => {
    const items = buildNewItems({
      flips: [],
      tasks: [
        {
          id: 't1',
          text: 'Chase the survey',
          assigned_to: 'Bobby',
          co_assignees: [],
          created_at: AFTER_EPOCH,
          permit_id: 101,
          project_id: 'proj-1',
        } as never,
      ],
      acks: [],
      permits: [permit()],
      viewerName: 'Bobby',
    });
    const task = items.find((i) => i.source === 'task');
    expect(task).toBeTruthy();
    expect(task?.absorbed).toBeUndefined();
    expect(task?.key.startsWith('flip:')).toBe(false);
  });

  it('★ the group lands on a permit, and on the project it belongs to', () => {
    // No `project` target kind exists and this ticket does not invent one —
    // "nothing else about the bell changes". The target keeps fix-362's shape.
    const [item] = itemsFor(FOUR_ON_ONE_PROJECT, FOUR_PERMITS);
    expect(item.target).toEqual({
      kind: 'permit',
      projectId: 'proj-1',
      permitId: 101,
    });
  });
});
