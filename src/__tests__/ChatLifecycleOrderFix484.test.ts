import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CHAT_PHASE_ORDER,
  crRoundOf,
  groupIntoPosts,
  sortPostsByLifecycle,
} from '../lib/projectChat';
import type { ProjectMessage } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-484 §C (P-145) — THE CHAT OPENS IN LIFECYCLE ORDER
// ===========================================================================
//
// Ruled 2026-09-02:
//   · Overview PREVIEW — unchanged, newest first.
//   · MODAL — lifecycle: ACQ Questions → Preliminary Assessment → Design Phase
//     → CR 1 → CR 2 → … Oldest phase at the top, newest cycle at the bottom.
//     Replies inside a thread stay chronological.
//
// ★★★ BOTH EXPECTATIONS SIT IN THIS FILE, SIDE BY SIDE, by the brief's
// instruction — because "the two surfaces order the same list differently" is
// the one thing about this that reads as a bug, and the pair of tests is what
// says it is not.
//
// ---------------------------------------------------------------------------
// WHAT THE DATA IS — counted on prod 2026-09-02, read-only, over 444 posts
// ---------------------------------------------------------------------------
//   seeded (bp_seed_project_posts, one per project):
//     ACQ Questions 118 · Design Phase 118 · Preliminary Assessment 118
//   minted (bp_ensure_cr_thread, fix-381): CR 1–5, 69 total
//   free-form: 21 threads across 14 titles ("General" ×4, "Corrections" ×2, …)
//
// **95% carry one of four seeded names**, so this is the brief's HYBRID branch:
// known phases first in a declared order, then CR rounds numerically, then
// everything else by creation.

let seq = 0;
function post(title: string | null, createdAt: string): ProjectMessage {
  seq += 1;
  return {
    id: `m-${seq}`,
    project_id: 'p1',
    author_id: 'u1',
    author_name: 'Bobby',
    body: '',
    title,
    parent_message_id: null,
    created_at: createdAt,
    mentions: [],
    attachments: [],
    revisions: [],
    edited_at: null,
    deleted_at: null,
    reply_count: null,
    last_activity_at: null,
  } as unknown as ProjectMessage;
}

function reply(parentId: string, createdAt: string): ProjectMessage {
  return { ...post(null, createdAt), parent_message_id: parentId };
}

const titles = (ps: ReturnType<typeof groupIntoPosts>) =>
  ps.map((p) => p.post.title);

/** A realistic project: the three seeded phases, three correction rounds, and
 *  two threads somebody typed. Created in an order that is NOT the lifecycle,
 *  because that is the case the sort exists for. */
function realistic(): ProjectMessage[] {
  return [
    post('Design Phase', '2026-08-17T10:00:02Z'),
    post('ACQ Questions', '2026-08-17T10:00:01Z'),
    post('Preliminary Assessment', '2026-08-17T10:00:03Z'),
    post('CR 2', '2026-08-24T09:00:00Z'),
    post('CR 1', '2026-08-22T09:00:00Z'),
    post('CR 10', '2026-09-01T09:00:00Z'),
    post('PAR & WAC', '2026-08-17T12:00:00Z'),
    post('on hold', '2026-08-25T12:00:00Z'),
  ];
}

// ---------------------------------------------------------------------------
// The modal
// ---------------------------------------------------------------------------
describe('fix-484 §C: the MODAL reads in lifecycle order', () => {
  it('★★★ the whole ruling, in one assertion', () => {
    expect(titles(sortPostsByLifecycle(groupIntoPosts(realistic())))).toEqual([
      'ACQ Questions',
      'Preliminary Assessment',
      'Design Phase',
      'CR 1',
      'CR 2',
      'CR 10',
      // free-form, by creation
      'PAR & WAC',
      'on hold',
    ]);
  });

  it('★★★ CR rounds sort NUMERICALLY — CR 10 after CR 2, not between 1 and 2', () => {
    // ★ The bug a string sort would ship, and prod already has a CR 5.
    const ps = groupIntoPosts([
      post('CR 10', '2026-01-01T00:00:00Z'),
      post('CR 2', '2026-01-02T00:00:00Z'),
      post('CR 1', '2026-01-03T00:00:00Z'),
    ]);
    expect(titles(sortPostsByLifecycle(ps))).toEqual(['CR 1', 'CR 2', 'CR 10']);
  });

  it('★★★ the declared order is the RULING, not the seed\'s insert order', () => {
    // ★★ `bp_seed_project_posts` inserts ACQ (1) → Design Phase (2) →
    //    Preliminary Assessment (3). Bobby's ruling puts Preliminary Assessment
    //    SECOND. The seed's `ord` is a creation order that breaks a
    //    millisecond tie; this list is the statement about the lifecycle, and
    //    it is the one the modal reads.
    expect(CHAT_PHASE_ORDER).toEqual([
      'ACQ Questions',
      'Preliminary Assessment',
      'Design Phase',
    ]);
  });

  it('★★ a phase matches case-insensitively — a hand-typed one lands with the seed', () => {
    const ps = groupIntoPosts([
      post('CR 1', '2026-01-05T00:00:00Z'),
      post('acq questions', '2026-01-01T00:00:00Z'),
    ]);
    expect(titles(sortPostsByLifecycle(ps))).toEqual(['acq questions', 'CR 1']);
  });

  it('★★★ a free-form title is NOT guessed at', () => {
    // ★★★ "Correction Round 1" and "Corrections 1" exist on prod — typed by
    //     people, not minted. Matching them loosely would silently re-order a
    //     thread whose author chose where it sits. Only the exact shape
    //     `bp_ensure_cr_thread` mints (`'CR ' || round`) is a round.
    expect(crRoundOf('CR 3')).toBe(3);
    expect(crRoundOf(' cr 12 ')).toBe(12);
    expect(crRoundOf('Correction Round 1')).toBeNull();
    expect(crRoundOf('Corrections 1')).toBeNull();
    expect(crRoundOf('CR1')).toBeNull();
    expect(crRoundOf('PPR corrections')).toBeNull();
    expect(crRoundOf(null)).toBeNull();
  });

  it('★★ unknown threads keep CREATION order — not last-activity order', () => {
    // ★ The modal is a record of the conversation: a thread does not jump the
    //   queue because somebody replied to it this morning. That is the
    //   preview's job, and the two must not converge.
    const a = post('General', '2026-01-01T00:00:00Z');
    const b = post('Zebra', '2026-01-02T00:00:00Z');
    const ps = groupIntoPosts([a, b, reply(a.id, '2026-06-01T00:00:00Z')]);
    // `groupIntoPosts` puts A first (it has the newest activity)…
    expect(titles(ps)).toEqual(['General', 'Zebra']);
    // …and the lifecycle sort keeps A first for a different reason: it was
    // created first. Same answer here, so assert the case that separates them.
    const c = post('Aardvark', '2026-01-03T00:00:00Z');
    const ps2 = groupIntoPosts([b, c, reply(c.id, '2026-07-01T00:00:00Z')]);
    expect(titles(ps2)).toEqual(['Aardvark', 'Zebra']); // newest activity
    expect(titles(sortPostsByLifecycle(ps2))).toEqual(['Zebra', 'Aardvark']);
  });

  it('★★★ it does NOT mutate its input — both surfaces share the array', () => {
    // ★★★ `groupIntoPosts` returns one array and both surfaces hold the same
    //     reference. An in-place sort would silently re-order the preview too,
    //     which is exactly the separation this ticket exists to keep.
    const ps = groupIntoPosts(realistic());
    const before = titles(ps);
    sortPostsByLifecycle(ps);
    expect(titles(ps)).toEqual(before);
  });

  it('★★ replies inside a thread stay chronological', () => {
    const p = post('CR 1', '2026-01-01T00:00:00Z');
    const ps = sortPostsByLifecycle(
      groupIntoPosts([
        p,
        reply(p.id, '2026-03-01T00:00:00Z'),
        reply(p.id, '2026-02-01T00:00:00Z'),
      ]),
    );
    expect(ps[0]!.replies.map((r) => r.created_at)).toEqual([
      '2026-02-01T00:00:00Z',
      '2026-03-01T00:00:00Z',
    ]);
  });

  it('★★ an empty conversation is an empty list, not a throw', () => {
    expect(sortPostsByLifecycle(groupIntoPosts([]))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The preview — and this is the half that must NOT change
// ---------------------------------------------------------------------------
describe('fix-484 §C: the PREVIEW is unchanged — newest first', () => {
  it('★★★ the same conversation, ordered the OTHER way', () => {
    // ★★★ Side by side with the modal's expectation above, by the brief's
    //     instruction: the two surfaces order one list differently, on purpose.
    const ps = groupIntoPosts(realistic());
    expect(titles(ps)).toEqual([
      'CR 10', // 09-01
      'on hold', // 08-25
      'CR 2', // 08-24
      'CR 1', // 08-22
      'PAR & WAC', // 08-17 12:00
      'Preliminary Assessment', // 08-17 10:00:03
      'Design Phase', // 08-17 10:00:02
      'ACQ Questions', // 08-17 10:00:01
    ]);
  });

  it('★★★ …and a reply this morning still pulls its thread to the top', () => {
    // The preview's whole purpose. If this ever starts failing because somebody
    // "made the two consistent", that is the regression.
    const old = post('ACQ Questions', '2026-01-01T00:00:00Z');
    const recent = post('CR 1', '2026-02-01T00:00:00Z');
    const ps = groupIntoPosts([old, recent, reply(old.id, '2026-09-02T00:00:00Z')]);
    expect(titles(ps)).toEqual(['ACQ Questions', 'CR 1']);
  });
});

// ---------------------------------------------------------------------------
// Wiring — the modal sorts, the section does not
// ---------------------------------------------------------------------------
describe('fix-484 §C: only the modal applies the lifecycle sort', () => {
  const code = (p: string) =>
    readFileSync(resolve(process.cwd(), p), 'utf8')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
      .join('\n');

  it('★★★ the modal wraps groupIntoPosts; the Team-card preview does not', () => {
    const modal = code('src/components/ProjectDetail/ProjectChatModal.tsx');
    const section = code('src/components/ProjectDetail/ProjectChatSection.tsx');
    expect(modal).toContain('sortPostsByLifecycle(byActivity)');
    expect(section).toContain('groupIntoPosts(messages)');
    expect(section).not.toContain('sortPostsByLifecycle');
  });

  it('★★★ …but the modal still LANDS on the newest conversation', () => {
    // ★★★ THE HALF THAT IS NOT THE SORT, and the one this ticket nearly broke.
    //     `posts[0]` is now "ACQ Questions" on every project forever, so a
    //     fallback of `posts[0]` would open the modal on the OLDEST thread and
    //     put whatever just moved a click away. fix-334's decision — *"the
    //     newest conversation is the one you probably came for"* — is untouched
    //     and now reads off its own value rather than off the list's order.
    //
    // ★ Two ChatDialedInFix334 tests caught this; they are unchanged.
    const modal = code('src/components/ProjectDetail/ProjectChatModal.tsx');
    expect(modal).toContain('const byActivity = useMemo(() => groupIntoPosts(messages)');
    expect(modal).toContain('?? byActivity[0] ?? null');
    expect(modal).not.toContain('?? posts[0] ?? null');
  });

  it('★★ and no third surface picked it up by accident', () => {
    // `useProjectMessages` counts posts for the unread badge; a sort there
    // would be work with no reader.
    const hook = code('src/hooks/useProjectMessages.ts');
    expect(hook).not.toContain('sortPostsByLifecycle');
  });
});
