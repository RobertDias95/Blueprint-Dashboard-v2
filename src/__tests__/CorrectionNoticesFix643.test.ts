import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CR_NOTICE_FRESH_DAYS,
  buildNotice,
  ledgerKey,
  messageMayEmail,
  noticeEligible,
  noticeQueue,
  type NoticeInput,
} from '../lib/crNotice';
import { crNoticeHeadline, crThreadBody, isCrNotice, isSystemPost } from '../lib/projectChat';
import {
  drain,
  isCorrectionNotice,
  renderCorrectionNotice,
  renderMention,
  skipReason,
  type ClaimedRow,
  type Deps,
} from '../../supabase/functions/notify-send/handler';

// ===========================================================================
// ★★★ fix-643 (P-338) — when corrections come out, the Bridge tags the team
// ===========================================================================
//
// ★★ TESTED TWO WAYS (the fix-153 pattern — CI has no database): the rules are
// mirrored in src/lib/crNotice.ts and tested case by case below, and the
// migration's text is pinned to contain each clause the mirror assumes.
//
// ★ The SQL itself ran on prod inside BEGIN … ROLLBACK on 2026-10-11:
//   · BSF26-05168 + BSF26-05170 (11231 NE 67th St, both round 2) set today →
//     ONE `CR 2` thread, TWO replies, 8 mentions each (Derry, Qisheng, Miles +
//     the five in Corrections), 8 queue rows each;
//   · BSF26-05168 re-dated to yesterday → no repost (3 ledger rows in all);
//   · 7110427-CN round 3 dated 40 days ago → nothing;
//   · 7138853-CN round 3 saved UNDER BOBBY'S SESSION → reply author still NULL,
//     Brittani (DM and in the tag) queued once: 7 rows for 7 people;
//   · pg_net nudged once; nothing persisted afterwards.

const repo = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const sql = repo('migrations/fix_643_correction_notices.sql')
  // ★ CRLF-safe: in JS `.` does not match `\r`, so on a Windows checkout the
  //   comment strip below would silently strip nothing.
  .split(/\r?\n/)
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');

const TODAY = '2026-10-11';
const BP = 'Building Permit';

const CORRECTIONS = ['u-brittani', 'u-dave', 'u-gena', 'u-lucas', 'u-bobby'];

function input(over: Partial<NoticeInput> = {}): NoticeInput {
  return {
    permitNum: 'BSF26-05168',
    permitType: BP,
    round: 3,
    corrIssued: TODAY,
    // ★ fix-643b: the project team (ENT · DM · DA) and a SMART Corrections tag.
    team: [
      { role: 'ENT', name: 'Miles', userId: 'u-miles' },
      { role: 'DM', name: 'Derry', userId: 'u-derry' },
      { role: 'DA', name: 'Qisheng', userId: 'u-qisheng' },
    ],
    tag: { name: 'Corrections', memberIds: CORRECTIONS, includeProjectTeam: true },
    ...over,
  };
}

const EMAIL: Record<string, string> = {
  'u-derry': 'derry@blueprintcap.com', 'u-qisheng': 'qisheng@blueprintcap.com',
  'u-miles': 'miles@blueprintcap.com', 'u-brittani': 'brittani@blueprintcap.com',
  'u-dave': 'dave@blueprintcap.com', 'u-gena': 'gena@blueprintcap.com',
  'u-lucas': 'ldeherrera@blueprintcap.com', 'u-bobby': 'robertd@blueprintcap.com',
};
const emailOf = (id: string) => EMAIL[id] ?? null;

describe('fix-643: which corrections writes post a notice', () => {
  it('★★★ a Building Permit\'s cycle 3 gets corr_issued today: one reply, the right mentions, one email each', () => {
    const w = { permitId: 1, permitType: BP, cycleIndex: 3, corrIssued: TODAY };
    expect(noticeEligible(w, TODAY)).toBe(true);
    const n = buildNotice(input());
    expect(n.body).toBe(
      // ★ fix-643b: one @Corrections chip — the smart tag carries the team.
      'Corrections are out — BSF26-05168 (Building Permit), round 3. The city issued them Oct 11.\n' +
      '@Corrections',
    );
    expect(n.mentions.sort()).toEqual(
      ['u-bobby', 'u-brittani', 'u-dave', 'u-derry', 'u-gena', 'u-lucas', 'u-miles', 'u-qisheng'],
    );
    expect(noticeQueue(n.mentions, emailOf, new Set())).toHaveLength(8);
  });

  it('a non-Building-Permit: nothing', () => {
    expect(noticeEligible({ permitId: 1, permitType: 'Demolition', cycleIndex: 3, corrIssued: TODAY }, TODAY)).toBe(false);
  });

  it('cycle 0: nothing', () => {
    expect(noticeEligible({ permitId: 1, permitType: BP, cycleIndex: 0, corrIssued: TODAY }, TODAY)).toBe(false);
  });

  it('★★★ corr_issued 40 days ago: nothing (a backfill is history, not news)', () => {
    expect(noticeEligible({ permitId: 1, permitType: BP, cycleIndex: 3, corrIssued: '2026-09-01' }, TODAY)).toBe(false);
    expect(noticeEligible({ permitId: 1, permitType: BP, cycleIndex: 3, corrIssued: '2026-09-27' }, TODAY)).toBe(true);
    expect(noticeEligible({ permitId: 1, permitType: BP, cycleIndex: 3, corrIssued: '2026-09-26' }, TODAY)).toBe(false);
    expect(CR_NOTICE_FRESH_DAYS).toBe(14);
  });

  it('a future date is a typo, not news: nothing', () => {
    expect(noticeEligible({ permitId: 1, permitType: BP, cycleIndex: 3, corrIssued: '2026-10-12' }, TODAY)).toBe(false);
  });

  it('★★ a second building permit, same project and round: its own reply (its own ledger key)', () => {
    expect(ledgerKey({ permitId: 10257, cycleIndex: 2 })).not.toBe(ledgerKey({ permitId: 10259, cycleIndex: 2 }));
    // …in the one thread: the reply looks the thread up, it does not make one.
    expect(sql).toMatch(/AND m\.title = 'CR ' \|\| p_cycle_index/);
  });

  it('★★★ re-scrape or date change: no repost — the ledger key ignores the date', () => {
    expect(ledgerKey({ permitId: 1, cycleIndex: 3 })).toBe(ledgerKey({ permitId: 1, cycleIndex: 3 }));
    expect(sql).toMatch(/PRIMARY KEY \(permit_id, cycle_index\)/);
    expect(sql).toMatch(/ON CONFLICT \(permit_id, cycle_index\) DO NOTHING\s+RETURNING message_id INTO v_got;\s+IF v_got IS NULL THEN\s+RETURN NULL;/);
  });

  it('★★ someone who is both DM and in the tag gets one mention and one email', () => {
    const n = buildNotice(input({ team: [{ role: 'DM', name: 'Brittani', userId: 'u-brittani' }] }));
    expect(n.mentions.filter((id) => id === 'u-brittani')).toHaveLength(1);
    expect(noticeQueue(n.mentions, emailOf, new Set()).filter((e) => e.startsWith('brittani'))).toHaveLength(1);
  });

  it('★★ opt-out: no email for that person (the MENTION switch)', () => {
    const n = buildNotice(input());
    const q = noticeQueue(n.mentions, emailOf, new Set(['u-dave']));
    expect(q).not.toContain('dave@blueprintcap.com');
    expect(q).toHaveLength(7);
    expect(sql).toMatch(/IF public\.bp_notify_enabled\(r\.id, 'mention'\) THEN/);
  });

  it('★★ an unresolvable DA is skipped and reported, and the notice still posts', () => {
    const n = buildNotice(input({ team: [{ role: 'DA', name: 'Alex', userId: null }] }));
    expect(n.missing).toEqual(['DA Alex']);
    expect(n.body).toContain('@Corrections');
    expect(n.body).not.toContain('@Alex');
    expect(sql).toMatch(/RAISE WARNING 'fix-643: corrections notice for permit % round % could not tag: %'/);
  });

  it('★★ no Corrections tag: the project team is still tagged, and it is reported', () => {
    const n = buildNotice(input({ tag: null }));
    expect(n.missing).toEqual(['the Corrections tag']);
    expect(n.mentions.sort()).toEqual(['u-derry', 'u-miles', 'u-qisheng']);
  });
});

describe('fix-643: which authorless messages may email', () => {
  it('★★★ an imported NULL-author message with mentions: still no email', () => {
    expect(messageMayEmail({ authorId: null, isLedgeredNotice: false })).toBe(false);
    expect(messageMayEmail({ authorId: null, isLedgeredNotice: true })).toBe(true);
    expect(messageMayEmail({ authorId: 'u-1', isLedgeredNotice: false })).toBe(true);
    expect(sql).toMatch(
      /IF NEW\.author_id IS NULL THEN\s+v_notice := public\.bp_cr_notice_payload\(NEW\.id\);\s+IF v_notice IS NULL THEN RETURN NULL; END IF;/,
    );
  });

  it('★★ a person\'s message still goes through bp_notify_enqueue, unchanged', () => {
    expect(sql).toMatch(/IF v_notice IS NULL THEN\s+PERFORM public\.bp_notify_enqueue\('notify:mention', r\.id, r\.email,\s+NEW\.author_id/);
  });

  it('★★ the author trigger leaves a ledgered notice authorless', () => {
    expect(sql).toMatch(/IF NEW\.author_id IS NULL AND NOT public\.bp_is_cr_notice\(NEW\.id\) THEN/);
    // authenticated keeps EXECUTE: the author trigger runs as the person posting.
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.bp_is_cr_notice\(uuid\) TO authenticated, service_role;/);
  });
});

describe('fix-643: the SQL says what the mirror assumes', () => {
  it('the gates', () => {
    expect(sql).toMatch(/p_cycle_index < 1/);
    expect(sql).toMatch(/IF p_corr_issued < v_today - 14 OR p_corr_issued > v_today THEN/);
    expect(sql).toMatch(/v_today\s+date := \(now\(\) AT TIME ZONE 'America\/Los_Angeles'\)::date;/);
    expect(sql).toMatch(/IF v_type IS DISTINCT FROM 'Building Permit' THEN/);
  });

  it('★★★ a notice problem never blocks the scraper\'s write', () => {
    expect(sql).toMatch(
      /BEGIN\s+PERFORM public\.bp_post_cr_notice\(NEW\.permit_id, NEW\.cycle_index, NEW\.corr_issued\);\s+EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/,
    );
  });

  it('★★★ the fixed half is the Corrections TAG — no names in the code', () => {
    expect(sql).toMatch(/lower\(btrim\(t\.name\)\) = 'corrections'/);
    for (const name of ['Dave', 'Lucas', 'Gena', 'Brit', 'Bobby', 'ldeherrera', 'robertd']) {
      expect(sql).not.toContain(name);
    }
  });

  it('★★ the permit\'s people resolve the fix-634 way (exactly one active login)', () => {
    expect(sql).toMatch(/public\.bp_notify_person_for_name\(v_tenant, v_role\.name\)/);
  });

  it('★★★ the CR 1 project-creation seed is untouched', () => {
    expect(sql).not.toMatch(/FUNCTION public\.bp_seed_project_posts/);
    expect(sql).not.toMatch(/FUNCTION public\.bp_ensure_cr_thread/);
  });

  it('the body matches the client\'s headline', () => {
    expect(sql).toMatch(/'Corrections are out — '/);
    expect(sql).toMatch(/'\. The city issued them ' \|\| to_char\(p_corr_issued, 'FMMon FMDD'\) \|\| '\.'/);
    expect(crNoticeHeadline('26 110231 BS', BP, 3, '2026-09-10')).toBe(
      'Corrections are out — 26 110231 BS (Building Permit), round 3. The city issued them Sep 10.',
    );
    expect(crNoticeHeadline(null, BP, 1, '2026-10-01')).toBe(
      'Corrections are out — this permit (Building Permit), round 1. The city issued them Oct 1.',
    );
  });

  it('★ it changes no existing row', () => {
    expect(sql).not.toMatch(/^\s*(UPDATE|DELETE)\s/im);
    expect(sql).not.toMatch(/INSERT INTO public\.(?!cr_notices|project_messages|notification_email_queue)/);
  });
});

describe('fix-643: the chat signs the reply "The Bridge"', () => {
  const reply = (over: Record<string, unknown> = {}) => ({
    parent_message_id: 'post-1',
    title: null,
    author_id: null,
    body: `${crNoticeHeadline('7138853-CN', BP, 3, TODAY)}\n@Brittani @Fisk @Briana @Corrections`,
    ...over,
  });

  it('★★ an authorless reply whose first line is the headline is the Bridge\'s', () => {
    expect(isCrNotice(reply())).toBe(true);
    expect(isSystemPost(reply())).toBe(true);
  });

  it('★★ a person who types the same sentence stays themselves', () => {
    expect(isSystemPost(reply({ author_id: 'u-miles' }))).toBe(false);
  });

  it('an imported authorless reply stays "Not recorded"', () => {
    expect(isSystemPost(reply({ body: 'Called the city.' }))).toBe(false);
    expect(isSystemPost(reply({ body: crThreadBody(3) }))).toBe(false);
  });
});

describe('fix-643: the email', () => {
  function noticeRow(over: Partial<ClaimedRow> = {}): ClaimedRow {
    return {
      id: 'q1',
      kind: 'notify:mention',
      to_email: 'dave@blueprintcap.com',
      recipient_user_id: 'u-dave',
      project_id: 'proj-1',
      message_id: 'msg-1',
      task_id: null,
      task_source: null,
      opted_out: false,
      actor_name: 'Someone',
      project_address: '4000 SW Concord St',
      post_title: 'CR 3',
      message_body: `${crNoticeHeadline('7138853-CN', BP, 3, TODAY)}\n@Brittani @Fisk @Briana @Corrections`,
      message_deleted: false,
      task_text: null,
      task_done: false,
      task_due: null,
      payload: { notice: 'corrections', round: 3, permit_num: '7138853-CN', permit_type: BP, corr_issued: TODAY },
      ...over,
    };
  }

  it('★★★ subject "Corrections are out · <address> · CR N", signed The Bridge, deep-linked to the reply', () => {
    const r = renderCorrectionNotice(noticeRow());
    expect(r.subject).toBe('Corrections are out · 4000 SW Concord St · CR 3');
    expect(r.html).toContain('<strong>The Bridge</strong> posted in <strong>CR 3</strong>');
    expect(r.text).toContain('The Bridge posted in CR 3 for 4000 SW Concord St and tagged you.');
    expect(r.text).toContain('https://blueprint-dashboard-v2.onrender.com/project/proj-1?msg=msg-1');
    expect(r.html).not.toContain('Someone');
  });

  it('★★ an ordinary mention is unchanged', () => {
    expect(isCorrectionNotice(null)).toBe(false);
    expect(renderMention(noticeRow({ payload: null, actor_name: 'Dave' })).subject).toBe('Dave mentioned you · 4000 SW Concord St');
  });

  it('★★ the drain picks the notice wording, and the mention opt-out still skips it', async () => {
    const sent: string[] = [];
    const deps: Deps = {
      sendMail: vi.fn(async (m) => { sent.push(m.subject); return { ok: true, requestId: 'r', error: null } as never; }),
      recordOutbox: vi.fn(async () => 'ob-1'),
      markQueue: vi.fn(async () => undefined),
    };
    await drain(deps, [noticeRow(), noticeRow({ id: 'q2', opted_out: true })]);
    expect(sent).toEqual(['Corrections are out · 4000 SW Concord St · CR 3']);
    expect(skipReason(noticeRow({ opted_out: true }))).toBe('recipient opted out');
  });
});
