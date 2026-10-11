import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BRIDGE_APP_ORIGIN,
  drain,
  escapeHtml,
  excerpt,
  messageUrl,
  outboxSubject,
  planEmails,
  renderAssignment,
  renderMention,
  skipReason,
  taskUrl,
  type ClaimedRow,
  type Deps,
  type OutboxRow,
} from '../../supabase/functions/notify-send/handler';
import { UNMONITORED_FOOTER } from '../../supabase/functions/_shared/msGraphConfig';
import { OUTLOOK_DRAFT_APP } from '../lib/outlookDraft';
import {
  NOTIFICATION_CATEGORIES,
  preferencesFromRows,
} from '../lib/notificationPreferences';
import { SETTINGS_BLOCKS } from '../lib/settingsBlocks';

// ===========================================================================
// ★★★ fix-634 (P-323) — email people when they're @-mentioned or assigned
// ===========================================================================
//
// ★★ TWO HALVES, TESTED TWO WAYS (the fix-153 pattern — CI has no database):
//
//   · WHO gets an email is decided in SQL (the triggers). Below, a pure-TS
//     MIRROR of those rules is tested case by case, and the migration's text is
//     pinned to contain each clause the mirror assumes.
//   · ★ The SQL itself was run on prod inside a ROLLED-BACK transaction on
//     2026-10-10 (Bobby authoring, real profile ids, a real open task). Queue
//     size after each step, all as expected:
//        mention Lucas+Bobby(self)+Miles          → 2   (author excluded)
//        edit adds Dave                           → 3   (only the added one)
//        assign 'Miles'                           → 4
//        assign 'Bobby' (self)                    → 4
//        assign 'Design Manager' (a role)         → 4
//        assign 'Jeremy' (no email)               → 4
//        co-assign ['Lucas']                      → 5
//        re-save ['Lucas','Entitlements']         → 5   (re-save + role: nothing)
//        Dave opts out, then is mentioned         → 5
//        machine write (no auth.uid) 'Dave'       → 5
//        pg_net nudges for the whole transaction  → 1
//      and bp_notify_claim returned Dave's earlier row with opted_out = true,
//      which the handler skips. pg_net / tables / triggers were confirmed
//      absent again afterwards.
//
//   · HOW it is sent is the Edge Function handler, driven through `Deps`.

const repo = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const MIGRATION = 'migrations/fix_634_mention_assignment_emails.sql';
/** The SQL with `--` comments removed, so a clause in a comment cannot pass. */
const sql = repo(MIGRATION)
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');

// ---------------------------------------------------------------------------
// The mirror of the recipient rules
// ---------------------------------------------------------------------------

interface Profile { id: string; email: string | null; active?: boolean }
interface RosterRow { name: string; email: string | null; active: boolean; former?: boolean }

/** Mirror of bp_trg_notify_mentions + bp_notify_enqueue. */
function mentionRecipients(
  mentions: string[], authorId: string, profiles: Profile[], optedOut: Set<string>,
  previous: string[] = [],
): string[] {
  const author = profiles.find((p) => p.id === authorId);
  const authorEmail = author?.email?.trim().toLowerCase() ?? null;
  const added = [...new Set(mentions)].filter((m) => !previous.includes(m));
  const out = new Set<string>();
  for (const id of added) {
    const p = profiles.find((x) => x.id === id);
    const email = p?.email?.trim().toLowerCase() ?? '';
    if (!p || email === '' || p.active === false) continue;
    if (id === authorId || email === authorEmail) continue;
    if (optedOut.has(id)) continue;
    out.add(email); // ★ the dedupe key is by EMAIL
  }
  return [...out];
}

/** Mirror of bp_notify_person_for_name. */
function personForName(name: string, roster: RosterRow[], profiles: Profile[]): Profile | null {
  const n = name.trim().toLowerCase();
  if (n === '') return null;
  const emails = new Set(
    roster
      .filter((r) => r.active && !r.former && r.name.trim().toLowerCase() === n)
      .map((r) => (r.email ?? '').trim().toLowerCase())
      .filter((e) => e !== ''),
  );
  if (emails.size !== 1) return null;
  const [email] = [...emails];
  return profiles.find((p) => (p.email ?? '').trim().toLowerCase() === email && p.active !== false) ?? null;
}

const P = {
  bobby: { id: 'u-bobby', email: 'robertd@blueprintcap.com' },
  lucas: { id: 'u-lucas', email: 'ldeherrera@blueprintcap.com' },
  lucasAlt: { id: 'u-lucas-2', email: 'LDeHerrera@blueprintcap.com' },
  miles: { id: 'u-miles', email: 'miles@blueprintcap.com' },
  noMail: { id: 'u-nomail', email: null },
};
const profiles: Profile[] = Object.values(P);
const roster: RosterRow[] = [
  { name: 'Lucas', email: 'ldeherrera@blueprintcap.com', active: true },
  { name: 'Lucas', email: 'ldeherrera@blueprintcap.com', active: true }, // ent + viewer rows
  { name: 'Miles', email: 'miles@blueprintcap.com', active: true },
  { name: 'Jeremy', email: null, active: true },
  { name: 'Cam', email: 'cam1@blueprintcap.com', active: true },
  { name: 'Cam', email: 'cam2@blueprintcap.com', active: true },
];

describe('fix-634 — who gets a mention email', () => {
  it('★★★ resolves recipients from the mention UUIDs to profile emails', () => {
    expect(mentionRecipients([P.lucas.id, P.miles.id], P.bobby.id, profiles, new Set()))
      .toEqual(['ldeherrera@blueprintcap.com', 'miles@blueprintcap.com']);
    // ★ and the SQL resolves by profiles.id, never a roster name
    expect(sql).toMatch(/FROM public\.profiles p\s+WHERE p\.id = ANY \(v_new\)/);
    expect(sql).not.toMatch(/bp_trg_notify_mentions[\s\S]*team_members[\s\S]*CREATE TRIGGER project_messages_notify_mentions/);
  });

  it('★★★ never emails the author about their own message (by id AND by email)', () => {
    expect(mentionRecipients([P.bobby.id, P.lucas.id], P.bobby.id, profiles, new Set()))
      .toEqual(['ldeherrera@blueprintcap.com']);
    // a second login sharing the author's address is still the author
    expect(mentionRecipients([P.lucasAlt.id], P.lucas.id, profiles, new Set())).toEqual([]);
    expect(sql).toContain('IF p_actor IS NOT NULL AND p_recipient = p_actor THEN RETURN; END IF;');
    expect(sql).toContain('IF v_actor_email IS NOT NULL AND v_actor_email = v_email THEN RETURN; END IF;');
  });

  it('★★ dedupes by email — two logins, one inbox, one email', () => {
    expect(mentionRecipients([P.lucas.id, P.lucasAlt.id, P.lucas.id], P.bobby.id, profiles, new Set()))
      .toEqual(['ldeherrera@blueprintcap.com']);
    expect(sql).toMatch(/p_kind \|\| ':' \|\| v_email \|\| ':' \|\| COALESCE\(p_message, p_task\)::text/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS notification_email_queue_dedupe\s+ON public\.notification_email_queue \(dedupe_key\)/);
    expect(sql).toContain('ON CONFLICT (dedupe_key) DO NOTHING');
  });

  it('★★ an edit emails only the newly-added mention', () => {
    expect(mentionRecipients([P.lucas.id, P.miles.id], P.bobby.id, profiles, new Set(), [P.lucas.id]))
      .toEqual(['miles@blueprintcap.com']);
    expect(sql).toContain('AFTER INSERT OR UPDATE OF mentions ON public.project_messages');
    expect(sql).toMatch(/EXCEPT\s+SELECT m FROM unnest\(CASE WHEN TG_OP = 'UPDATE'/);
  });

  it('★★★ an opted-out person is not queued (absence = on)', () => {
    expect(mentionRecipients([P.lucas.id, P.miles.id], P.bobby.id, profiles, new Set([P.lucas.id])))
      .toEqual(['miles@blueprintcap.com']);
    expect(sql).toContain('IF NOT public.bp_notify_enabled(p_recipient, v_category) THEN RETURN; END IF;');
    expect(sql).toMatch(/WHERE user_id = p_user AND category = p_category AND enabled = false/);
  });

  it('★ a person with no address, a deleted message, a backfill: nobody', () => {
    expect(mentionRecipients([P.noMail.id], P.bobby.id, profiles, new Set())).toEqual([]);
    expect(sql).toContain('IF NEW.deleted_at IS NOT NULL OR NEW.author_id IS NULL THEN RETURN NULL; END IF;');
    expect(sql).toContain("IF NEW.created_at < now() - interval '1 hour' THEN RETURN NULL; END IF;");
  });
});

describe('fix-634 — who gets an assignment email', () => {
  it('★★★ a ROLE sends nothing — it matches no roster name', () => {
    for (const role of ['Entitlements', 'Design Manager', 'Design Associate', 'Schematic Team']) {
      expect(personForName(role, roster, profiles)).toBeNull();
    }
  });

  it('★★★ Lucas has two roster rows sharing ONE email → one person', () => {
    expect(personForName('Lucas', roster, profiles)?.id).toBe(P.lucas.id);
    expect(personForName(' lucas ', roster, profiles)?.id).toBe(P.lucas.id);
  });

  it('★★ Jeremy has no email → nobody; two different "Cam"s → nobody (no guess)', () => {
    expect(personForName('Jeremy', roster, profiles)).toBeNull();
    expect(personForName('Cam', roster, profiles)).toBeNull();
    expect(sql).toContain('IF v_emails IS NULL OR cardinality(v_emails) <> 1 THEN RETURN; END IF;');
  });

  it('★★★ only a PERSON assigning sends; machine writes and automatic co-assigns do not', () => {
    expect(sql).toMatch(/bp_trg_notify_task_assigned\(\)[\s\S]*?IF auth\.uid\(\) IS NULL THEN RETURN NULL; END IF;/);
    expect(sql).toContain("IF auth.uid() IS NULL OR NEW.source IS DISTINCT FROM 'manual' THEN RETURN NULL; END IF;");
  });

  it('★★★ re-saving an unchanged co-assignee list is not a new assignment', () => {
    // bp_set_task_assignees DELETEs then re-INSERTs the whole set
    expect(sql).toContain("PERFORM set_config('bp.notify_removed',");
    expect(sql).toContain('IF position(v_key IN v_removed) > 0 THEN RETURN NULL; END IF;');
    expect(sql).toContain('AFTER INSERT OR DELETE ON public.permit_task_assignees');
  });

  it('★★ fires on both task tables and on the join table', () => {
    expect(sql).toContain('AFTER INSERT OR UPDATE OF assigned_to ON public.permit_tasks');
    expect(sql).toContain('AFTER INSERT OR UPDATE OF assigned_to ON public.team_tasks');
  });
});

describe('fix-634 — the migration keeps its promises', () => {
  it('★★★ changes no existing row: no UPDATE/DELETE/INSERT outside function bodies', () => {
    const outsideBodies = sql.replace(/\$function\$[\s\S]*?\$function\$/g, '');
    expect(outsideBodies).not.toMatch(/^\s*(UPDATE|DELETE|INSERT)\b/im);
  });

  it('★★★ needs no new secret: the nudge carries no key', () => {
    expect(sql).toContain("url     := 'https://eibnmwthkcuumyclyxoe.supabase.co/functions/v1/notify-send'");
    expect(sql).not.toMatch(/authorization|apikey|service_role_key|vault\./i);
  });

  it('★★★ the claim and the helpers are not callable with a user JWT', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bp_notify_claim(integer) FROM public, anon, authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.bp_notify_claim(integer) TO service_role;');
    expect(sql).toContain('REVOKE ALL ON TABLE public.notification_email_queue FROM public, anon, authenticated;');
  });

  it('★★ preferences: a user reads and writes only their own rows', () => {
    expect(sql).toMatch(/CREATE POLICY notification_preferences_own[\s\S]*?USING \(user_id = auth\.uid\(\)\)\s+WITH CHECK \(user_id = auth\.uid\(\)\)/);
  });

  it('★★ the categories agree with the client (twin)', () => {
    expect(sql).toContain("CHECK (category IN ('mention', 'assignment'))");
    // ★ fix-642 widened the constraint to three; its own test pins that twin.
    expect([...NOTIFICATION_CATEGORIES]).toEqual(['mention', 'assignment', 'weekly']);
  });
});

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

function row(over: Partial<ClaimedRow> = {}): ClaimedRow {
  return {
    id: 'q1',
    kind: 'notify:mention',
    to_email: 'ldeherrera@blueprintcap.com',
    recipient_user_id: 'u-lucas',
    project_id: 'proj-1',
    message_id: 'msg-1',
    task_id: null,
    task_source: null,
    opted_out: false,
    actor_name: 'Dave',
    project_address: '7708 131st Ave NE',
    post_title: 'Marketing set',
    message_body: 'Can you look at this?',
    message_deleted: false,
    task_text: null,
    task_done: false,
    task_due: null,
    ...over,
  };
}

function assignRow(over: Partial<ClaimedRow> = {}): ClaimedRow {
  return row({
    kind: 'notify:assignment', message_id: null, task_id: 'task-1',
    task_source: 'permit_tasks', post_title: null, message_body: null,
    task_text: 'Submit the street-tree plan', ...over,
  });
}

function fakeDeps(ok = true) {
  const outbox: OutboxRow[] = [];
  const marks: { ids: string[]; outcome: string; outboxId: string | null; note: string | null }[] = [];
  const sent: Parameters<Deps['sendMail']>[0][] = [];
  const deps: Deps = {
    sendMail: vi.fn(async (input) => {
      sent.push(input);
      return ok
        ? { ok: true as const, requestId: 'req-1' }
        : { ok: false as const, error: 'Microsoft Graph refused the send with 403.', requestId: 'req-2' };
    }),
    recordOutbox: vi.fn(async (r: OutboxRow) => { outbox.push(r); return `ob-${outbox.length}`; }),
    markQueue: vi.fn(async (ids, outcome, outboxId, note) => { marks.push({ ids, outcome, outboxId, note }); }),
  };
  return { deps, outbox, marks, sent };
}

describe('fix-634 — rendering', () => {
  it('★★★ subject: "Dave mentioned you · 7708 131st Ave NE"', () => {
    expect(renderMention(row()).subject).toBe('Dave mentioned you · 7708 131st Ave NE');
    expect(renderAssignment([assignRow()]).subject).toBe('New task for you · 7708 131st Ave NE');
  });

  it('★★★ the message text is HTML-escaped (never injected)', () => {
    const r = renderMention(row({
      message_body: '<script>alert(1)</script> & "quotes"',
      post_title: '<img src=x onerror=alert(1)>',
      actor_name: '<b>Eve</b>',
    }));
    expect(r.html).not.toContain('<script>');
    expect(r.html).not.toContain('<img src=x');
    expect(r.html).not.toContain('<b>Eve</b>');
    expect(r.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;');
    expect(escapeHtml(`<a href='x'>`)).toBe('&lt;a href=&#39;x&#39;&gt;');
  });

  it('★★ the message is truncated around 500 characters, at a word', () => {
    const long = 'word '.repeat(300);
    const e = excerpt(long);
    expect(e.length).toBeLessThanOrEqual(501);
    expect(e.endsWith('…')).toBe(true);
    expect(excerpt('short')).toBe('short');
    expect(renderMention(row({ message_body: long })).text).toContain('…');
  });

  it('★★★ "Open in the Bridge" lands on the post / the task', () => {
    const m = renderMention(row());
    expect(m.html).toContain(`href="${BRIDGE_APP_ORIGIN}/project/proj-1?msg=msg-1"`);
    expect(m.html).toContain('Open in the Bridge');
    expect(messageUrl('p', 'm')).toBe(`${BRIDGE_APP_ORIGIN}/project/p?msg=m`);
    expect(taskUrl('t')).toBe(`${BRIDGE_APP_ORIGIN}/board?task=t`);
    expect(renderAssignment([assignRow()]).html).toContain(`href="${BRIDGE_APP_ORIGIN}/board?task=task-1"`);
  });

  it('★★ the origin is the one the app is served from (twin of outlookDraft)', () => {
    expect(BRIDGE_APP_ORIGIN).toBe(OUTLOOK_DRAFT_APP.redirectUri);
  });

  it('★★ branded, with the "not monitored" footer and the opt-out link', () => {
    const m = renderMention(row());
    expect(m.html).toContain(UNMONITORED_FOOTER);
    expect(m.text).toContain(UNMONITORED_FOOTER);
    expect(m.inlineImages).toHaveLength(2);
    expect(m.html).toContain('/settings/account#email-notifications');
  });

  it('★★ a burst of assignments for one person is ONE email listing them', () => {
    const rows = [
      assignRow({ id: 'a', task_id: 't1', task_text: 'One' }),
      assignRow({ id: 'b', task_id: 't2', task_text: 'Two' }),
    ];
    const plan = planEmails(rows);
    expect(plan).toHaveLength(1);
    const r = renderAssignment(plan[0]!);
    expect(r.subject).toBe('2 new tasks for you · 7708 131st Ave NE');
    expect(r.html).toContain('/board?task=t1');
    expect(r.html).toContain('/board?task=t2');
    // mentions are never merged
    expect(planEmails([row({ id: 'm1' }), row({ id: 'm2' })])).toHaveLength(2);
  });

  it('★ the outbox subject masks a 6-digit run (fix-628 CHECK), not house numbers', () => {
    expect(outboxSubject('Dave mentioned you · 7708 131st Ave NE')).toBe('Dave mentioned you · 7708 131st Ave NE');
    expect(outboxSubject('New task for you · 123456 NE 8th')).toBe('New task for you · •••••• NE 8th');
  });
});

describe('fix-634 — the drain and the outbox', () => {
  it('★★★ a successful send writes ONE sent outbox row and marks the queue with it', async () => {
    const { deps, outbox, marks, sent } = fakeDeps(true);
    const s = await drain(deps, [row()]);
    expect(s).toEqual({ emails: 1, sent: 1, failed: 0, skipped: 0 });
    expect(sent[0]!.to).toBe('ldeherrera@blueprintcap.com');
    expect(sent[0]!.replyTo).toBeUndefined(); // ★ no Reply-To on alerts
    expect(sent[0]!.cc).toBeUndefined();
    expect(outbox).toEqual([{
      kind: 'notify:mention', to_email: 'ldeherrera@blueprintcap.com',
      subject: 'Dave mentioned you · 7708 131st Ave NE', status: 'sent',
      error: null, graph_request_id: 'req-1', attempts: 1,
    }]);
    expect(marks).toEqual([{ ids: ['q1'], outcome: 'sent', outboxId: 'ob-1', note: null }]);
  });

  it('★★★ a FAILED send is visible: failed outbox row with the reason, queue marked failed', async () => {
    const { deps, outbox, marks } = fakeDeps(false);
    const s = await drain(deps, [assignRow()]);
    expect(s.failed).toBe(1);
    expect(outbox[0]).toMatchObject({
      kind: 'notify:assignment', status: 'failed',
      error: 'Microsoft Graph refused the send with 403.', graph_request_id: 'req-2',
    });
    expect(marks[0]).toMatchObject({ outcome: 'failed', outboxId: 'ob-1' });
  });

  it('★★★ opted out between queueing and sending: skipped, nothing sent', async () => {
    const { deps, outbox, marks, sent } = fakeDeps(true);
    const s = await drain(deps, [row({ opted_out: true })]);
    expect(s).toEqual({ emails: 0, sent: 0, failed: 0, skipped: 1 });
    expect(sent).toHaveLength(0);
    expect(outbox).toHaveLength(0);
    expect(marks[0]).toMatchObject({ outcome: 'skipped', note: 'recipient opted out' });
  });

  it('★★ a message deleted / a task finished before the send: skipped', () => {
    expect(skipReason(row({ message_deleted: true }))).toBe('message deleted before send');
    expect(skipReason(assignRow({ task_done: true }))).toBe('task done before send');
    expect(skipReason(row())).toBeNull();
  });
});

describe('fix-634 — the Settings panel is registered', () => {
  it('★★ an "Email notifications" block on My account, and absence means ON', () => {
    const block = SETTINGS_BLOCKS.find((b) => b.id === 'email-notifications');
    expect(block?.category).toBe('account');
    expect(block?.title).toBe('Email notifications');
    expect(preferencesFromRows([])).toEqual({ mention: true, assignment: true, weekly: true });
    expect(preferencesFromRows([{ category: 'mention', enabled: false }]))
      .toEqual({ mention: false, assignment: true, weekly: true });
    expect(preferencesFromRows([{ category: 'bogus', enabled: false }]))
      .toEqual({ mention: true, assignment: true, weekly: true });
  });
});
