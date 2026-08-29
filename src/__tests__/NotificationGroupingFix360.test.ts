import { describe, it, expect } from 'vitest';
import {
  parseFlips,
  flipEventKey,
  flipEventKeyByPermit,
  flipEventTitle,
  flipEventDetail,
  type ActivityRowLike,
} from '../lib/boardFlips';
import {
  buildNewItems,
  unseenItems,
  hasBeenRead,
  keyForFlip,
  type NewItem,
} from '../lib/boardReads';
import {
  buildReactionDigests,
  keyForReactions,
  formatEmojiTally,
  reactionTitle,
  reactionDetail,
  type PostReactionRow,
} from '../lib/postReactions';
import type { PermitWithCycles } from '../lib/database.types';
// ?raw rather than node:fs — the app tsconfig has no @types/node, and Render
// runs a stricter `tsc -b` than vitest does.
import migrationSql from '../../migrations/fix_360_post_reactions_feed.sql?raw';
import hookSource from '../hooks/useMyPostReactions.ts?raw';

// ===========================================================================
// fix-360 — the bell counts fields and forgets people
// ===========================================================================
//
// Two complaints, one root cause: the feed reported MECHANISM, not EVENTS.
//
// ★★★ §1, measured on prod. `SDOTTRLA0002500` (233 31st Ave E, SDOT Tree),
// audit row 20192, ONE write at 2026-08-19 21:03:53:
//
//     { status: "Conceptually Approved",
//       approval_date: "2026-08-19",
//       actual_issue:  "2026-08-19" }
//
// Bobby saw three notifications for it, two of them saying "Approved". What
// happened is "the tree permit came through"; the feed described the columns.
//
// ★★★ §2 is a new SHAPE rather than a new source: ONE ROW THAT MUTATES. Every
// board item before it is one-thing-happened → one row → one read.

const AFTER_EPOCH = '2026-08-19T21:03:53.402Z';

/** The real audit row, verbatim from prod. */
function sdotRow(over: Partial<ActivityRowLike> = {}): ActivityRowLike {
  return {
    id: 20192,
    created_at: AFTER_EPOCH,
    action: 'scrape_change_applied',
    row_id: '10409',
    permit_num: 'SDOTTRLA0002500',
    permit_type: 'SDOT Tree',
    address: '233 31st Ave E',
    ent_lead: 'Bobby',
    project_id: 'proj-1',
    changes: {
      source: 'scraper',
      applied: {
        status: 'Conceptually Approved',
        approval_date: '2026-08-19',
        actual_issue: '2026-08-19',
        extras: { latest_reviewer: 'Adam Kilborn' },
      },
      scraper_run_at: '2026-08-19T20:44:49+00:00',
    },
    ...over,
  };
}

function permit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 10409,
    project_id: 'proj-1',
    num: 'SDOTTRLA0002500',
    type: 'SDOT Tree',
    ent_lead: 'Bobby',
    da: 'Ahmadi',
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  } as unknown as PermitWithCycles;
}

function itemsFor(rows: ActivityRowLike[], me = 'Bobby'): NewItem[] {
  return buildNewItems({
    flips: parseFlips(rows, 3650),
    tasks: [],
    acks: [],
    permits: [permit()],
    viewerName: me,
  }).filter((i) => i.source === 'flip');
}

// ---------------------------------------------------------------------------
// §1 — one item per permit per event
// ---------------------------------------------------------------------------

describe('fix-360 §1: a scrape write is ONE event, not three', () => {
  it('★★★ the real SDOTTRLA0002500 shape produces ONE item', () => {
    // Three applied keys, three flips, and — before this — three notifications.
    expect(parseFlips([sdotRow()], 3650)).toHaveLength(3);
    const items = itemsFor([sdotRow()]);
    expect(items).toHaveLength(1);
  });

  it('★★★ …and no two notifications say "Approved"', () => {
    // THE assertion the brief asks for, read as the complaint it came from:
    // Bobby's feed had two rows both headed "Approved". Now there is one row,
    // headed once.
    const items = itemsFor([sdotRow()]);
    expect(items.filter((i) => /approved/i.test(i.title))).toHaveLength(1);
    expect(items.map((i) => i.title)).toEqual(['Approved and issued']);
    // ★ And the headline names each KIND once, though two flips carried it.
    expect(items[0].title.match(/approved/gi) ?? []).toHaveLength(1);
  });

  it('★★ the body may still quote the city — that is not the duplication', () => {
    // A stricter reading of "the word Approved does not appear twice" would
    // also ban "Conceptually Approved" from the body, and that is the wrong
    // trade: the headline is OUR summary and the body is the CITY's own words
    // for what happened, plus the date column that moved with it. Deleting
    // either loses a fact, which §1 forbids in the same breath. What was
    // removed is the second NOTIFICATION, which is what he was counting.
    const [item] = itemsFor([sdotRow()]);
    expect(item.subtitle).toContain('Conceptually Approved');
    expect(item.subtitle).toContain('Approval date 2026-08-19');
    expect(item.subtitle).toContain('Issue date 2026-08-19');
  });

  it('★★ nothing is lost — every column that moved is still in the body', () => {
    // "Collapse the NOTIFICATIONS, not the facts."
    const [item] = itemsFor([sdotRow()]);
    expect(item.subtitle).toBe(
      'Conceptually Approved · Approval date 2026-08-19 · Issue date 2026-08-19',
    );
    // ★ "Approval date" is not the word "Approved", deliberately: the status
    // string already says approved in the city's own words, and labelling the
    // date would print it twice — the complaint, moved down a row.
    expect(item.subtitle).toContain('2026-08-19');
  });

  it('★ it still says which permit, in the same words as before', () => {
    const [item] = itemsFor([sdotRow()]);
    expect(item.where).toBe('233 31st Ave E · SDOT Tree');
    expect(item.permitId).toBe(10409);
    expect(item.projectId).toBe('proj-1');
  });

  it('★★ a single-flip event reads EXACTLY as it did before fix-360', () => {
    // Most items are this, and regrouping must not reword them.
    const row = sdotRow({
      id: 999,
      changes: {
        applied: { corr_issued: '2026-08-19' },
        scraper_run_at: '2026-08-19T20:44:49+00:00',
      },
    });
    const [item] = itemsFor([row]);
    expect(item.title).toBe('Corrections Required');
    expect(item.subtitle).toBe('Corrections issued 2026-08-19');
  });
});

describe('fix-360 §1: the over-merge guard', () => {
  it('★★★ two genuinely separate scrapes on ONE permit stay TWO items', () => {
    // The one most likely to be got wrong. Same permit, same day, two runs —
    // and these are the permit's real audit rows: 20042 at 16:55 (Initiated)
    // and 20192 at 21:03 (Conceptually Approved + the two dates).
    const first = sdotRow({
      id: 20042,
      created_at: '2026-08-19T17:13:57.594Z',
      changes: {
        applied: { corr_issued: '2026-08-19' },
        scraper_run_at: '2026-08-19T16:55:50+00:00',
      },
    });
    const items = itemsFor([first, sdotRow()]);
    expect(items).toHaveLength(2);
    expect(new Set(items.map((i) => i.key)).size).toBe(2);
  });

  it('★★ …because the RUN is what groups them, not a clock', () => {
    // Two writes seconds apart in DIFFERENT runs are two events; two writes
    // minutes apart in the SAME run are one. A time window gets both wrong.
    const a = sdotRow({
      id: 1,
      created_at: '2026-08-19T21:03:53.000Z',
      changes: { applied: { approval_date: '2026-08-19' }, scraper_run_at: 'R1' },
    });
    const b = sdotRow({
      id: 2,
      created_at: '2026-08-19T21:03:54.000Z',
      changes: { applied: { actual_issue: '2026-08-19' }, scraper_run_at: 'R2' },
    });
    expect(itemsFor([a, b])).toHaveLength(2);

    const c = sdotRow({
      id: 3,
      created_at: '2026-08-19T22:40:00.000Z',
      changes: { applied: { actual_issue: '2026-08-19' }, scraper_run_at: 'R1' },
    });
    // 96 minutes apart, one run, one item — well outside any window anybody
    // would have picked.
    expect(itemsFor([a, c])).toHaveLength(1);
  });

  // ★★★ SUPERSEDED BY fix-430, BY BOBBY'S RULING OF 2026-08-28: *"one bulk
  //     change is one notification."* fix-360's guard was that a shared run
  //     stamp must not merge two permits; the scope it guarded was the PERMIT.
  //     fix-430 moves the scope to the PROJECT, so two permits on ONE project
  //     in one run are now deliberately one item — that IS the ticket.
  //
  // ★★ THE GUARD ITSELF IS NOT REPEALED, it is re-aimed: a shared run stamp
  //    still cannot merge across projects, which is the case fix-360 measured
  //    (permits 10456 and 10521 both carrying scraper_run_at 21:04:06). Both
  //    halves are asserted below, so neither direction can regress silently.
  it('★★ one run stamp merges within a project and NEVER across projects', () => {
    const a = sdotRow({ id: 1, row_id: '10456', changes: { applied: { approval_date: '2026-08-19' }, scraper_run_at: 'R' } });
    const b = sdotRow({ id: 2, row_id: '10521', changes: { applied: { approval_date: '2026-08-19' }, scraper_run_at: 'R' } });
    const sameProject = buildNewItems({
      flips: parseFlips([a, b], 3650),
      tasks: [],
      acks: [],
      permits: [permit({ id: 10456 }), permit({ id: 10521 })],
      viewerName: 'Bobby',
    }).filter((i) => i.source === 'flip');
    // fix-430: one project, one run → ONE item.
    expect(sameProject).toHaveLength(1);

    // fix-360's guard, intact: a different project is a different event.
    const c = sdotRow({ id: 2, row_id: '10521', project_id: 'proj-2', changes: { applied: { approval_date: '2026-08-19' }, scraper_run_at: 'R' } });
    const twoProjects = buildNewItems({
      flips: parseFlips([a, c], 3650),
      tasks: [],
      acks: [],
      permits: [permit({ id: 10456 }), permit({ id: 10521, project_id: 'proj-2' })],
      viewerName: 'Bobby',
    }).filter((i) => i.source === 'flip');
    expect(twoProjects).toHaveLength(2);
  });

  it('★ a row with no run stamp falls back to its audit id, never to a guess', () => {
    const a = sdotRow({ id: 77, changes: { applied: { approval_date: '2026-08-19' } } });
    const b = sdotRow({ id: 78, changes: { applied: { actual_issue: '2026-08-19' } } });
    const items = itemsFor([a, b]);
    expect(items).toHaveLength(2);
    // ★ fix-430: the scope segment is the project; the RUN segment is still the
    //   audit id, which is the fallback this test is about and is unchanged.
    expect(items.map((i) => i.key).sort()).toEqual([
      'flip:proj-1:audit77',
      'flip:proj-1:audit78',
    ]);
  });
});

describe('fix-360 §1: the key survives re-derivation', () => {
  it('★★ deriving the same feed twice produces the same keys', () => {
    const a = itemsFor([sdotRow()]).map((i) => i.key);
    const b = itemsFor([sdotRow()]).map((i) => i.key);
    expect(a).toEqual(b);
  });

  it('★★★ …so a second derivation yields NO new unread items', () => {
    const first = itemsFor([sdotRow()]);
    const read = new Set(first.map((i) => i.key));
    const second = itemsFor([sdotRow()]);
    expect(unseenItems(second, read)).toEqual([]);
  });

  // ★★★ SUPERSEDED BY fix-430: the scope segment is the PROJECT now. The RULE
  //     this test carries is untouched and still asserted — the key is built
  //     only from things that cannot move under a row, so re-deriving it never
  //     re-notifies. A project id is as immutable as a permit id.
  //
  // ★★ AND THE KIND IS STILL NOT IN IT, which fix-430's brief asked for and the
  //    measurement refused: 21% of writes (312 of 1,487 over 120 days) carry
  //    more than one flip kind, and keying by kind splits every one of them
  //    back into the separate items fix-360 §1 exists to merge — 1,716 items
  //    against today's 1,479, where this key gives 1,354.
  it('★ the key is a project and a run — never a kind, a field list or a count', () => {
    const [flip] = parseFlips([sdotRow()], 3650);
    expect(flipEventKey(flip)).toBe('flip:proj-1:2026-08-19T20:44:49+00:00');
    expect(flipEventKey(flip)).not.toMatch(/approved|issued|status|3/);
    // ★ The pre-fix-430 form stays computable — read state depends on it.
    expect(flipEventKeyByPermit(flip)).toBe('flip:10409:2026-08-19T20:44:49+00:00');
  });

  it('★★ a permit with no project keeps a permit-scoped key', () => {
    // fix-430 A2: not dropped, and no project invented for it.
    const [flip] = parseFlips([sdotRow({ project_id: null })], 3650);
    expect(flipEventKey(flip)).toBe('flip:permit10409:2026-08-19T20:44:49+00:00');
  });

  it('★★ a grouped item still answers to the keys its parts used to have', () => {
    // 54 flip read rows exist on prod under the OLD per-field keys. Without
    // this, every one re-opens on deploy day — fix-307's three-figure badge,
    // arriving by a different door.
    //
    // ★★ fix-430 ADDED A SECOND GENERATION rather than replacing this one.
    //    Measured 2026-08-29: 205 flip read rows across 8 people — 131 in
    //    fix-360's `flip:<permit>:<run>` form and 74 in this older
    //    `flip:<auditId>:<kind>` form, every one read inside 30 days. A person
    //    has one or the other, never both, so `legacyKeys` now carries BOTH and
    //    `hasBeenRead` evaluates them per absorbed permit as an OR — see
    //    NewItem.absorbed. The behaviour this test asserts is unchanged.
    const [item] = itemsFor([sdotRow()]);
    const old = new Set([
      keyForFlip(20192, 'approved'),
      keyForFlip(20192, 'issued'),
    ]);
    for (const k of old) expect(item.legacyKeys).toContain(k);
    expect(hasBeenRead(item, old)).toBe(true);
    expect(unseenItems([item], old)).toEqual([]);
  });

  it('★ …and is NOT read when only some of them were', () => {
    const [item] = itemsFor([sdotRow()]);
    const partial = new Set([keyForFlip(20192, 'approved')]);
    expect(hasBeenRead(item, partial)).toBe(false);
    expect(unseenItems([item], partial)).toHaveLength(1);
  });
});

describe('fix-360 §1: the composition rules', () => {
  const flip = (kind: string, field: string, applied: string) =>
    ({
      key: 'k', auditId: 1, kind, field, applied, permitId: 1, projectId: null,
      permitNum: null, permitType: null, address: null, entLead: null,
      at: AFTER_EPOCH, runAt: 'R',
    }) as never;

  it('one kind keeps its heading; two are joined; three are listed', () => {
    expect(flipEventTitle([flip('approved', 'approval_date', 'x')])).toBe('Approved');
    expect(
      flipEventTitle([
        flip('approved', 'approval_date', 'x'),
        flip('issued', 'actual_issue', 'y'),
      ]),
    ).toBe('Approved and issued');
    expect(
      flipEventTitle([
        flip('cycle_opened', 'submitted', 'a'),
        flip('corrections_required', 'corr_issued', 'b'),
        flip('approved', 'approval_date', 'c'),
      ]),
    ).toBe('A new cycle opened, corrections required and approved');
  });

  it('★ the order is the permit\'s life, not the order the columns were written', () => {
    const built = flipEventTitle([
      flip('issued', 'actual_issue', 'y'),
      flip('approved', 'approval_date', 'x'),
    ]);
    expect(built).toBe('Approved and issued');
  });

  it('★ the body dedupes identical text rather than repeating a write', () => {
    const detail = flipEventDetail([
      flip('approved', 'approval_date', '2026-08-19'),
      flip('approved', 'approval_date', '2026-08-19'),
    ]);
    expect(detail).toBe('Approval date 2026-08-19');
  });
});

// ---------------------------------------------------------------------------
// §2 — one row per post, and it keeps counting
// ---------------------------------------------------------------------------

const POST = 'msg-1';

function reaction(
  emoji: string,
  reacted_at: string,
  over: Partial<PostReactionRow> = {},
): PostReactionRow {
  return {
    message_id: POST,
    project_id: 'proj-1',
    post_title: 'Bellevue submittal is out',
    post_excerpt: 'Bellevue submittal is out the door, thanks all.',
    emoji,
    reacted_at,
    ...over,
  };
}

/** ★★ Bobby's own example — "eight thumbs up and six smiley faces" — in the
 *  emoji this app actually has. MEASURED: `message_reactions_emoji_check` on
 *  prod pins the palette to SIX, and neither a smiley nor a party popper is
 *  among them:
 *
 *      👍  ❤️  😂  😮  ✅  👀
 *
 *  So a tally can have at most six groups, and a fixture reacting with 😊 would
 *  be testing a row the database will not accept. */
function fourteen(): PostReactionRow[] {
  const rows: PostReactionRow[] = [];
  for (let i = 0; i < 8; i += 1) {
    rows.push(reaction('👍', `2026-08-19T10:${String(i).padStart(2, '0')}:00Z`));
  }
  for (let i = 0; i < 6; i += 1) {
    rows.push(reaction('❤️', `2026-08-19T11:${String(i).padStart(2, '0')}:00Z`));
  }
  return rows;
}

function reactionItems(rows: PostReactionRow[]): NewItem[] {
  return buildNewItems({
    flips: [],
    tasks: [],
    acks: [],
    permits: [],
    viewerName: 'Bobby',
    projects: [{ id: 'proj-1', address: '233 31st Ave E' }],
    reactions: rows,
  }).filter((i) => i.source === 'reaction');
}

describe('fix-360 §2: fifteen reactions are ONE row', () => {
  it('★★★ fifteen reactions on one post produce exactly one item', () => {
    const rows = [...fourteen(), reaction('✅', '2026-08-19T12:00:00Z')];
    expect(rows).toHaveLength(15);
    expect(reactionItems(rows)).toHaveLength(1);
  });

  it('★★★ whose body is an aggregate BY EMOJI, not a list of events', () => {
    const [item] = reactionItems(fourteen());
    expect(item.title).toBe('14 reactions to your post');
    expect(item.subtitle).toContain('8 👍 · 6 ❤️');
    // Bobby's words: "eight thumbs up and six smiley faces, versus breaking it
    // down one by one".
    expect(item.subtitle).not.toMatch(/reacted|added a reaction/i);
  });

  it('★ biggest group first, ties broken so the body never reshuffles', () => {
    const rows = [
      reaction('❤️', '2026-08-19T10:00:00Z'),
      reaction('👍', '2026-08-19T10:01:00Z'),
      reaction('👍', '2026-08-19T10:02:00Z'),
      reaction('✅', '2026-08-19T10:03:00Z'),
    ];
    const [d] = buildReactionDigests(rows);
    expect(formatEmojiTally(d.byEmoji).startsWith('2 👍')).toBe(true);
    // Same input, same output — a body that reshuffles reads as new news.
    expect(formatEmojiTally(buildReactionDigests([...rows].reverse())[0].byEmoji)).toBe(
      formatEmojiTally(d.byEmoji),
    );
  });

  it('★ it says WHICH post, because a person may have several in one project', () => {
    const [item] = reactionItems(fourteen());
    expect(item.subtitle).toContain('Bellevue submittal is out');
    expect(item.where).toBe('233 31st Ave E');
  });

  it('★ two posts are two rows — the grouping is per POST, not per person', () => {
    const rows = [
      ...fourteen(),
      reaction('👍', '2026-08-19T13:00:00Z', { message_id: 'msg-2' }),
    ];
    expect(reactionItems(rows)).toHaveLength(2);
  });

  it('★★ the tally can never have more than six groups', () => {
    // The palette is a CHECK constraint on prod, not a client convention:
    //   emoji = ANY (ARRAY['👍','❤️','😂','😮','✅','👀'])
    // So "8 👍 · 6 ❤️ · 1 ✅" is near the widest this line can ever get, which
    // is why the body is a tally rather than something that needs truncating.
    const palette = ['👍', '❤️', '😂', '😮', '✅', '👀'];
    const rows = palette.map((e, i) =>
      reaction(e, `2026-08-19T10:0${i}:00Z`),
    );
    const [d] = buildReactionDigests(rows);
    expect(d.byEmoji).toHaveLength(6);
    expect(formatEmojiTally(d.byEmoji)).toBe(
      '1 ✅ · 1 ❤️ · 1 👀 · 1 👍 · 1 😂 · 1 😮',
    );
  });

  it('★ one reaction says "1 reaction", not "1 reactions"', () => {
    expect(reactionTitle(1)).toBe('1 reaction to your post');
    expect(reactionTitle(2)).toBe('2 reactions to your post');
  });
});

describe('fix-360 §2: reading it clears ALL of it, in one action', () => {
  it('★★★ one key, one insert — not fifteen check-offs', () => {
    const rows = [...fourteen(), reaction('✅', '2026-08-19T12:00:00Z')];
    const [item] = reactionItems(rows);
    // THE assertion. Bobby stated it twice: "you can easily just click that one
    // notification and mark it all as read instantly versus having to check off
    // 15 separate notifications."
    const marked = new Set([item.key]);
    expect(marked.size).toBe(1);
    expect(unseenItems(reactionItems(rows), marked)).toEqual([]);
  });

  it('★★ a reaction arriving AFTER the read re-opens it, with the new total', () => {
    const before = fourteen();
    const [first] = reactionItems(before);
    const read = new Set([first.key]);
    expect(unseenItems(reactionItems(before), read)).toEqual([]);

    const after = [...before, reaction('✅', '2026-08-19T12:00:00Z')];
    const reopened = unseenItems(reactionItems(after), read);
    expect(reopened).toHaveLength(1);
    // ★ Carrying the NEW total — a read receipt that stops receipting is worse
    // than none.
    expect(reopened[0].title).toBe('15 reactions to your post');
    expect(reopened[0].subtitle).toContain('8 👍 · 6 ❤️ · 1 ✅');
  });

  it('★★ …and reading THAT clears all fifteen, again in one action', () => {
    const after = [...fourteen(), reaction('✅', '2026-08-19T12:00:00Z')];
    const [item] = reactionItems(after);
    expect(unseenItems(reactionItems(after), new Set([item.key]))).toEqual([]);
  });

  it('★★ nothing new means nothing re-opens, however often it is re-derived', () => {
    const rows = fourteen();
    const read = new Set([reactionItems(rows)[0].key]);
    for (let i = 0; i < 5; i += 1) {
      expect(unseenItems(reactionItems(rows), read)).toEqual([]);
    }
  });

  it('★ the watermark is the newest reaction, so the key moves only forward', () => {
    const rows = fourteen();
    const [d] = buildReactionDigests(rows);
    expect(d.newestAt).toBe('2026-08-19T11:05:00Z');
    expect(keyForReactions(POST, d.newestAt)).toBe(
      'reaction:msg-1:2026-08-19T11:05:00Z',
    );
  });

  it('★ removing the newest reaction settles the row rather than announcing it', () => {
    const rows = fourteen();
    const read = new Set([reactionItems(rows)[0].key]);
    // Someone takes their ❤️ back: the watermark walks back to a key that was
    // already read, so the item quietly settles. Re-adding it later produces a
    // new instant and therefore new news.
    const fewer = rows.filter((r) => r.reacted_at !== '2026-08-19T11:05:00Z');
    const still = reactionItems(fewer);
    expect(still[0].title).toBe('13 reactions to your post');
    expect(unseenItems(still, read)).toHaveLength(1);
    // …and once seen at 13, it stays seen at 13.
    const read13 = new Set([...read, still[0].key]);
    expect(unseenItems(reactionItems(fewer), read13)).toEqual([]);
  });
});

describe('fix-360 §2: whose news it is', () => {
  it('★ a post with no reactions produces no item at all', () => {
    expect(reactionItems([])).toEqual([]);
  });

  it('★★★ a person is never notified about their own reaction', () => {
    // ★ Enforced in SQL, not in the client: the rule should be a property of
    // the query rather than a convention somebody can forget to restate. There
    // is no live database in CI (fix-153's rule), so the guarantee is asserted
    // on the migration text that carries it.
    expect(migrationSql).toMatch(/mr\.user_id\s*<>\s*auth\.uid\(\)/);
    // …and the audience is the post's AUTHOR, also decided server-side.
    expect(migrationSql).toMatch(/m\.author_id\s*=\s*auth\.uid\(\)/);
    // ★ A deleted post keeps its reaction rows (fix-334 made deletion soft);
    // applause for something that is no longer there is noise.
    expect(migrationSql).toMatch(/m\.deleted_at IS NULL/);
    // ★ And nothing in the CLIENT re-derives any of it — no author check, no
    // self-filter, which is what would put a second opinion beside the first.
    expect(hookSource).not.toMatch(/author_id|user_id\s*!==/);
  });

  it('★ the feed is a READ — the hook cannot write', () => {
    expect(hookSource).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    expect(hookSource).toMatch(/bp_my_post_reactions/);
  });

  it('★ …and the function is tenant-scoped and never granted to anon', () => {
    expect(migrationSql).toMatch(/mr\.tenant_id = ANY \(public\.auth_tenant_ids\(\)\)/);
    expect(migrationSql).toMatch(/REVOKE ALL ON FUNCTION public\.bp_my_post_reactions\(integer\) FROM PUBLIC, anon/);
    expect(migrationSql).toMatch(/SET search_path TO 'public'/);
  });

  it('★ the item is personal, so one viewer reading it cannot clear another\'s', () => {
    const rows = fourteen();
    const [item] = reactionItems(rows);
    expect(item.audience).toBeUndefined(); // the 'personal' default
    const bobbyRead = new Set([item.key]);
    const genaRead = new Set<string>();
    expect(unseenItems(reactionItems(rows), bobbyRead)).toEqual([]);
    expect(unseenItems(reactionItems(rows), genaRead)).toHaveLength(1);
  });

  it('★ the digest identifies the post by title, falling back to the body', () => {
    const untitled = fourteen().map((r) => ({ ...r, post_title: null }));
    const [d] = buildReactionDigests(untitled);
    expect(reactionDetail(d)).toContain('Bellevue submittal is out the door');
  });
});
