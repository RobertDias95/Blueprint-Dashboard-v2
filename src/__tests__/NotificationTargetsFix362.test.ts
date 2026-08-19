import { describe, it, expect } from 'vitest';
import { buildNewItems, type NewItem } from '../lib/boardReads';
import { targetHref } from '../lib/notificationTargets';
import { parseFlips, type ActivityRowLike } from '../lib/boardFlips';
import type { PermitWithCycles } from '../lib/database.types';
import migrationSql from '../../migrations/fix_362_closure_task_ids.sql?raw';

// ===========================================================================
// fix-362 — the notification knows the PROJECT, not the THING
// ===========================================================================
//
// Bobby: "If I get a notification about something in the chat, if I then click
// that notification, does it take me to that chat, to that post? And same
// thing, if in the task, does it take me automatically… anytime you get a
// notification, you can click it and go to where that item is occurring."
//
// ★★ THE NOTIFICATIONS WERE ALREADY LINKS. `NewItem` carried `permitId` and
// `projectId` and nothing else, so one about a specific chat reply could only
// take you to the project and one about a specific task only to the permit —
// you arrived on a page CONTAINING the thing and then had to find it.

const ME = 'Bobby';
const PROJECT = '11111111-1111-1111-1111-111111111111';
const MESSAGE = '22222222-2222-2222-2222-222222222222';
const TASK = '33333333-3333-3333-3333-333333333333';

function permit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 10409,
    project_id: PROJECT,
    num: 'SDOTTRLA0002500',
    type: 'SDOT Tree',
    ent_lead: ME,
    da: 'Ahmadi',
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  } as unknown as PermitWithCycles;
}

/** The real audit row from fix-360's example — three columns, one write. */
function sdotRow(): ActivityRowLike {
  return {
    id: 20192,
    created_at: '2026-08-19T21:03:53.402Z',
    action: 'scrape_change_applied',
    row_id: '10409',
    permit_num: 'SDOTTRLA0002500',
    permit_type: 'SDOT Tree',
    address: '233 31st Ave E',
    ent_lead: ME,
    project_id: PROJECT,
    changes: {
      applied: {
        status: 'Conceptually Approved',
        approval_date: '2026-08-19',
        actual_issue: '2026-08-19',
      },
      scraper_run_at: '2026-08-19T20:44:49+00:00',
    },
  };
}

function build(
  over: Partial<Parameters<typeof buildNewItems>[0]>,
): NewItem[] {
  return buildNewItems({
    flips: [],
    tasks: [],
    acks: [],
    permits: [permit()],
    viewerName: ME,
    ...over,
  });
}

function only(items: NewItem[], source: NewItem['source']): NewItem {
  const found = items.filter((i) => i.source === source);
  expect(found).toHaveLength(1);
  return found[0];
}

// ---------------------------------------------------------------------------
// §1 — every source gets a destination decided deliberately
// ---------------------------------------------------------------------------

describe('fix-362 §1: a mention lands on the message', () => {
  it('★★★ the target is the message, not merely the project', () => {
    const item = only(
      build({
        flips: [],
        tasks: [],
        acks: [],
        permits: [],
        viewerName: ME,
        viewerUserId: 'me-uuid',
        projects: [{ id: PROJECT, address: '233 31st Ave E' }],
        mentions: [
          {
            id: MESSAGE,
            project_id: PROJECT,
            body: '@Bobby can you look at this',
            created_at: '2026-08-19T10:00:00Z',
            mentions: ['me-uuid'],
          },
        ],
      }),
      'mention',
    );
    expect(item.target).toEqual({
      kind: 'message',
      projectId: PROJECT,
      messageId: MESSAGE,
    });
    // ★ A PASTEABLE URL. Not a router state object, not a store — §2's rule is
    // that the destination has to work from a cold browser load.
    expect(targetHref(item)).toBe(`/project/${PROJECT}?msg=${MESSAGE}`);
  });
});

describe('fix-362 §1: a task lands on the task', () => {
  it('★★★ the target is the task, opened', () => {
    const item = only(
      build({
        flips: [],
        tasks: [
          {
            id: TASK,
            text: 'Send corrections to the consultants',
            assigned_to: ME,
            co_assignees: [],
            created_at: '2026-08-19T10:00:00Z',
            permit_id: 10409,
            project_id: PROJECT,
            project_address: '233 31st Ave E',
            permit_type: 'SDOT Tree',
          } as never,
        ],
        acks: [],
        permits: [permit()],
        viewerName: ME,
      }),
      'task',
    );
    expect(item.target).toEqual({ kind: 'task', taskId: TASK });
    expect(targetHref(item)).toBe(`/board?task=${TASK}`);
  });
});

describe('fix-362 §1: where the permit IS the thing', () => {
  it('★★ a flip lands on the permit — declared, not defaulted', () => {
    const item = only(
      build({ flips: parseFlips([sdotRow()], 3650), permits: [permit()] } as never),
      'flip',
    );
    expect(item.target).toEqual({
      kind: 'permit',
      projectId: PROJECT,
      permitId: 10409,
    });
  });

  it('★★★ §4: the GROUPED flip event is ONE link, not three', () => {
    // fix-360 collapsed three notifications into one for this permit. Giving
    // each of its three underlying flips its own link would undo that ticket
    // one ticket later, and it is the obvious shortcut.
    const items = build({
      flips: parseFlips([sdotRow()], 3650),
      permits: [permit()],
    } as never).filter((i) => i.source === 'flip');
    expect(items).toHaveLength(1);
    expect(items.map((i) => targetHref(i))).toEqual([
      `/project/${PROJECT}?permit=10409`,
    ]);
  });

  it('★ a permit newly naming you lands on that permit', () => {
    const item = only(
      build({
        permits: [permit({ created_at: '2026-08-19T09:00:00Z' })],
      } as never),
      'permit',
    );
    expect(targetHref(item)).toBe(`/project/${PROJECT}?permit=10409`);
  });

  it('★★ a handoff lands on the permit, and that is the answer not a fallback', () => {
    // A milestone ack has no page of its own: it is a mark on the permit's
    // milestone strip, beside the task bar holding the filing work it has just
    // unblocked. Everything "ready to file" means is on the permit.
    const item = only(
      build({
        acks: [
          {
            id: 'ack-1',
            permit_id: 10409,
            milestone: 'design_complete',
            acked_at: '2026-08-19T10:00:00Z',
            acked_by_name: 'Derry',
          } as never,
        ],
        permits: [permit()],
      } as never),
      'handoff',
    );
    expect(item.target).toEqual({
      kind: 'permit',
      projectId: PROJECT,
      permitId: 10409,
    });
  });
});

describe('fix-362 §1: chat sources with no finer target', () => {
  const request = {
    id: 'req-1',
    project_id: PROJECT,
    project_address: '233 31st Ave E',
    title: 'Foundation RFI',
    reason: 'The structural set changed',
    requester_name: 'Gena',
    resolver_name: null,
    created_post_id: null,
    created_at: '2026-08-19T10:00:00Z',
    resolved_at: null,
  };

  it('★★ an OPEN post request lands on the chat — the post does not exist yet', () => {
    // Said out loud rather than defaulted: a request is an ask for a post that
    // has not been written. There is nothing to focus.
    const item = only(
      build({
        postRequests: [{ ...request, status: 'open', is_recipient: true }] as never,
      } as never),
      'post_request',
    );
    expect(item.target).toEqual({ kind: 'chat', projectId: PROJECT });
    expect(targetHref(item)).toBe(`/project/${PROJECT}?chat=1`);
  });

  it('★★★ …and the OUTCOME lands on the post that satisfied it', () => {
    // fix-339 already records created_post_id in the transaction that resolves
    // the request, precisely so "the requester is taken to the thread rather
    // than told it is somewhere". This is that sentence finally being true
    // from the notification too.
    const item = only(
      build({
        postRequests: [
          {
            ...request,
            status: 'created',
            is_recipient: false,
            created_post_id: MESSAGE,
            resolved_at: '2026-08-19T11:00:00Z',
            resolver_name: 'Bobby',
          },
        ] as never,
      } as never),
      'post_request_outcome',
    );
    expect(targetHref(item)).toBe(`/project/${PROJECT}?msg=${MESSAGE}`);
  });

  it('★ a DECLINED outcome has no post, so it lands on the chat', () => {
    const item = only(
      build({
        postRequests: [
          {
            ...request,
            status: 'declined',
            is_recipient: false,
            resolved_at: '2026-08-19T11:00:00Z',
          },
        ] as never,
      } as never),
      'post_request_outcome',
    );
    expect(item.target).toEqual({ kind: 'chat', projectId: PROJECT });
  });
});

describe('fix-362 §4: a reaction digest lands on the POST', () => {
  const reaction = (emoji: string, at: string) => ({
    message_id: MESSAGE,
    project_id: PROJECT,
    post_title: 'Bellevue submittal is out',
    post_excerpt: 'Bellevue submittal is out the door.',
    emoji,
    reacted_at: at,
  });

  it('★★★ fifteen reactions, one link, and it points at your own post', () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      reaction(i < 8 ? '👍' : '❤️', `2026-08-19T10:${String(i).padStart(2, '0')}:00Z`),
    );
    const items = build({
      permits: [],
      projects: [{ id: PROJECT, address: '233 31st Ave E' }],
      reactions: rows,
    } as never).filter((i) => i.source === 'reaction');

    expect(items).toHaveLength(1);
    // ★ Never one reactor, and never fifteen links — that would undo fix-360.
    expect(targetHref(items[0])).toBe(`/project/${PROJECT}?msg=${MESSAGE}`);
  });
});

describe('fix-362 §4: an auto-closure has ONE destination, and the count picks it', () => {
  const closure = (over: Record<string, unknown> = {}) => ({
    id: 'clo-1',
    permit_id: 10409,
    project_id: PROJECT,
    address: '233 31st Ave E',
    permit_label: 'SDOTTRLA0002500 · SDOT Tree',
    reason: 'permit_issued',
    detail: null,
    recipient: ME,
    task_count: 1,
    task_ids: [TASK],
    closed_at: '2026-08-19T10:00:00Z',
    ...over,
  });

  it('★★★ one task closed → the task', () => {
    // MEASURED: 48 of the 55 closures on prod covered exactly one task, so this
    // is the common case and not the corner.
    const item = only(build({ autoClosures: [closure()] } as never), 'auto_closed');
    expect(targetHref(item)).toBe(`/board?task=${TASK}`);
  });

  it('★★★ four tasks closed → the PERMIT, never four links', () => {
    // The item's own subtitle says "Reopen any of THEM", plural. Picking one of
    // four to land on answers a question nobody asked; re-fanning it into four
    // links undoes fix-360.
    const item = only(
      build({
        autoClosures: [
          closure({ task_count: 4, task_ids: [TASK, 'b', 'c', 'd'] }),
        ] as never,
      } as never),
      'auto_closed',
    );
    expect(targetHref(item)).toBe(`/project/${PROJECT}?permit=10409`);
  });

  it('★★ a pre-fix-362 row has no ids and degrades to exactly its old target', () => {
    const item = only(
      build({ autoClosures: [closure({ task_ids: null })] as never } as never),
      'auto_closed',
    );
    expect(targetHref(item)).toBe(`/project/${PROJECT}?permit=10409`);
  });
});

// ---------------------------------------------------------------------------
// The fallback floor, and the migration's promises
// ---------------------------------------------------------------------------

describe('fix-362: nothing becomes a dead link', () => {
  it('★ an item with no target still navigates somewhere sensible', () => {
    expect(
      targetHref({ permitId: 7, projectId: PROJECT }),
    ).toBe(`/project/${PROJECT}?permit=7`);
    expect(targetHref({ permitId: null, projectId: PROJECT })).toBe(
      `/project/${PROJECT}`,
    );
    // ★ Nothing at all still goes to the board rather than to a 404.
    expect(targetHref({ permitId: null, projectId: null })).toBe('/board');
  });

  it('★ a permit target with no project falls back rather than building /project/null', () => {
    expect(
      targetHref({
        target: { kind: 'permit', projectId: null, permitId: 5 },
        permitId: 5,
        projectId: null,
      }),
    ).toBe('/board');
  });

  it('★ ids are encoded, so a target can never break the URL', () => {
    expect(
      targetHref({
        target: { kind: 'task', taskId: 'a b/c?d' },
        permitId: null,
        projectId: null,
      }),
    ).toBe('/board?task=a%20b%2Fc%3Fd');
  });
});

describe('fix-362: the ledger records which tasks', () => {
  it('★★ the column is added nullable and no row is edited', () => {
    expect(migrationSql).toMatch(/ADD COLUMN IF NOT EXISTS task_ids uuid\[\]/);
    expect(migrationSql).not.toMatch(/UPDATE public\.permit_task_auto_closures/);
    expect(migrationSql).not.toMatch(/DELETE FROM/);
  });

  it('★★ both writers record the ids IN the closing transaction', () => {
    // Not a later query from a permit and a count, which would sweep up
    // anything else closed since for any other reason.
    expect(migrationSql).toMatch(/array_agg\(id\) AS task_ids/);
    const writers = migrationSql.match(/array_agg\(id\) AS task_ids/g) ?? [];
    expect(writers).toHaveLength(2);
    expect(migrationSql).toMatch(/bp_clear_tasks_for_issued_permit/);
    expect(migrationSql).toMatch(/bp_supersede_stale_bot_tasks/);
  });

  it('★ and their closure predicates are untouched', () => {
    // The whole risk of this migration is rewriting two SECURITY DEFINER
    // functions on the issuance path. Every rule fix-354 and fix-355 wrote is
    // still in the text.
    for (const clause of [
      /auto_event IS DISTINCT FROM 'results_ready'/,
      /NOT public\.bp_task_touched_by_person\(t\.id\)/,
      /superseded_resubmitted/,
      /superseded_intake_accepted/,
      /superseded_number_present/,
      /WHERE recipient IS NOT NULL/,
    ]) {
      expect(migrationSql).toMatch(clause);
    }
    expect(migrationSql).toMatch(/SECURITY DEFINER/);
    expect(migrationSql).toMatch(/SET search_path TO 'public', 'pg_temp'/);
  });
});
