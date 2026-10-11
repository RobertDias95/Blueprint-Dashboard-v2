import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import {
  BRIDGE_APP_ORIGIN,
  SETTINGS_URL,
  WEEKLY_SECTIONS,
  WEEKLY_TOP_N,
  WEEKLY_UPDATE_URL,
  drain,
  editionLabel,
  planEmails,
  renderWeekly,
  skipReason,
  weeklyBuckets,
  weeklySortRows,
  weeklySubject,
  type ClaimedRow,
  type Deps,
  type OutboxRow,
  type WeeklyAgendaItem,
  type WeeklyRow,
} from '../../supabase/functions/notify-send/handler';
import { SNAPSHOT_SECTIONS, sortRows, type SnapshotRow } from '../lib/weeklySnapshot';
import { currentEdition, shiftDayKey } from '../lib/weeklyEdition';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_COPY,
  preferencesFromRows,
} from '../lib/notificationPreferences';

vi.mock('../hooks/useNotificationPreferences', () => ({
  useNotificationPreferences: () => ({
    isLoading: false,
    error: null,
    data: { mention: true, assignment: true, weekly: true },
  }),
  useSetNotificationPreference: () => ({ isPending: false, mutate: vi.fn() }),
}));
import EmailNotificationsPanel from '../components/Settings/EmailNotificationsPanel';

// fix-642 (P-017 #44) — the Weekly Update also arrives by email.
//
// ★★ TESTED TWO WAYS (the fix-153 pattern — CI has no database):
//   · the renderer, the sort, the drain and the Settings switch run here;
//   · the SQL (who, when, once per edition, opt-out) is pinned clause by clause
//     below, and was probed on prod in a ROLLED-BACK transaction (see the PR).

const repo = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
/** The migration with `--` comments removed, so a clause in a comment cannot pass. */
const sql = repo('migrations/fix_642_weekly_update_email.sql')
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const fn = (name: string) => {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  const end = sql.indexOf('$function$;', start);
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, end);
};

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

let pid = 0;
const row = (bucket: WeeklyRow['bucket'], age: number | null, over: Partial<WeeklyRow> = {}): WeeklyRow => ({
  bucket,
  permit_id: ++pid,
  project_id: `proj-${pid}`,
  address: `${pid} Test St`,
  num: `70${pid}-CN`,
  type: 'Building',
  ent_lead: 'Miles',
  da: 'Gena',
  status: 'Open',
  on_date: '2026-09-01',
  age_days: age,
  ...over,
});

const AGENDA: WeeklyAgendaItem[] = [
  { id: 't1', text: 'IPR / ULS / Project Management Revisions', assigned_to: 'Brittani', priority: false, created_at: '2026-09-15T17:11:04Z', days_on_agenda: 26 },
];

function weeklyRow(rows: WeeklyRow[], over: Partial<ClaimedRow> = {}, agenda = AGENDA): ClaimedRow {
  return {
    id: 'q-weekly', kind: 'notify:weekly', to_email: 'bobby@x.com', recipient_user_id: 'u-bobby',
    project_id: null, message_id: null, task_id: null, task_source: null, opted_out: false,
    actor_name: null, project_address: null, post_title: null, message_body: null,
    message_deleted: false, task_text: null, task_done: false, task_due: null,
    payload: { edition: '2026-10-14', snapshot: { today: '2026-10-14', rows }, agenda },
    ...over,
  };
}

function fakeDeps(ok = true) {
  const outbox: OutboxRow[] = [];
  const sent: Parameters<Deps['sendMail']>[0][] = [];
  const marks: { ids: string[]; outcome: string; outboxId: string | null; note: string | null }[] = [];
  const deps: Deps = {
    sendMail: vi.fn(async (input) => {
      sent.push(input);
      return ok
        ? { ok: true as const, requestId: 'r1' }
        : { ok: false as const, error: 'Graph said no', requestId: 'r2' };
    }),
    recordOutbox: vi.fn(async (r: OutboxRow) => { outbox.push(r); return `ob-${outbox.length}`; }),
    markQueue: vi.fn(async (ids, outcome, outboxId, note) => { marks.push({ ids, outcome, outboxId, note }); }),
  };
  return { deps, outbox, sent, marks };
}

// ===========================================================================
// WHO — the same people as the pop-up
// ===========================================================================

describe('fix-642: the recipients are the pop-up audience', () => {
  it('★★★ agenda members (the flag useIsAgendaMember reads), current people only', () => {
    const f = fn('bp_weekly_update_recipients');
    expect(f).toContain('tm.agenda_member IS TRUE');
    expect(f).toContain('AND tm.active');
    expect(f).toContain('NOT COALESCE(tm.former, false)');
    // the pop-up's own test of membership is the same flag
    expect(repo('src/hooks/useAgendaMember.ts')).toContain('m.agenda_member === true');
  });

  it('★★ each name resolves to ONE login or nobody (fix-634 helper); nobody is never guessed', () => {
    const f = fn('bp_weekly_update_recipients');
    expect(f).toContain('public.bp_notify_person_for_name(p_tenant, v_name)');
    expect(f).toContain('user_id := NULL; email := NULL;');
    const enq = fn('bp_weekly_update_enqueue');
    expect(enq).toContain('WHERE user_id IS NOT NULL AND email IS NOT NULL');
  });
});

// ===========================================================================
// WHEN — once per edition, the Wednesday morning it goes live
// ===========================================================================

describe('fix-642: once per edition, Wednesday from 7 AM Pacific', () => {
  it('★★★ one row per recipient per edition: the dedupe key is email + edition', () => {
    const enq = fn('bp_weekly_update_enqueue');
    expect(enq).toContain("'notify:weekly:' || lower(btrim(r.email)) || ':' || v_edition::text");
    expect(enq).toContain('ON CONFLICT (dedupe_key) DO NOTHING');
  });

  it('★★ the SQL edition is the pop-up’s edition on every day of the week', () => {
    const enq = fn('bp_weekly_update_enqueue');
    expect(enq).toContain('v_edition := v_today - ((extract(isodow FROM v_today)::int + 4) % 7);');
    // Mirror the SQL formula (isodow: Mon=1 … Sun=7) against currentEdition.
    for (let d = 12; d <= 25; d += 1) {
      const day = `2026-10-${String(d).padStart(2, '0')}`;
      const js = new Date(`${day}T12:00:00Z`).getUTCDay(); // Sun=0
      const isodow = js === 0 ? 7 : js;
      const sqlEdition = shiftDayKey(day, -((isodow + 4) % 7));
      // 19:00Z is noon Pacific on that same day.
      expect(sqlEdition).toBe(currentEdition(new Date(`${day}T19:00:00Z`)));
    }
  });

  it('★★ unforced it only acts on Wednesday from 7 AM Pacific; cron fires 14Z and 15Z Wednesday', () => {
    const enq = fn('bp_weekly_update_enqueue');
    expect(enq).toContain("v_local   timestamp := now() AT TIME ZONE 'America/Los_Angeles';");
    expect(enq).toContain('IF extract(isodow FROM v_local) <> 3 THEN RETURN 0; END IF;');
    expect(enq).toContain('IF extract(hour FROM v_local) < 7 THEN RETURN 0; END IF;');
    expect(sql).toMatch(/cron\.schedule\(\s*'bp-weekly-update-email',\s*'0 14,15 \* \* 3',\s*\$\$SELECT public\.bp_weekly_update_enqueue\(\)\$\$/);
  });

  it('★★ a re-run sends nothing: the queue dedupes, and each claimed row is ONE email', () => {
    const plan = planEmails([weeklyRow([]), weeklyRow([], { id: 'q2', to_email: 'miles@x.com' })]);
    expect(plan.map((g) => g.map((r) => r.id))).toEqual([['q-weekly'], ['q2']]);
  });
});

// ===========================================================================
// THE OPT-OUT
// ===========================================================================

describe('fix-642: the "Weekly Update" switch', () => {
  it('★★★ an opted-out person is not queued, and is skipped if they opt out after queueing', async () => {
    expect(fn('bp_weekly_update_enqueue')).toContain("AND public.bp_notify_enabled(user_id, 'weekly')");
    expect(fn('bp_notify_claim')).toContain(
      "WHEN c.kind = 'notify:weekly' THEN NOT public.bp_notify_enabled(c.recipient_user_id, 'weekly')",
    );
    const { deps, sent, outbox, marks } = fakeDeps();
    const s = await drain(deps, [weeklyRow([], { opted_out: true })]);
    expect(s).toEqual({ emails: 0, sent: 0, failed: 0, skipped: 1 });
    expect(sent).toHaveLength(0);
    expect(outbox).toHaveLength(0);
    expect(marks).toEqual([{ ids: ['q-weekly'], outcome: 'skipped', outboxId: null, note: 'recipient opted out' }]);
  });

  it('★★ the category twin: database and client both allow exactly three', () => {
    expect(sql).toContain("CHECK (category IN ('mention', 'assignment', 'weekly'))");
    expect([...NOTIFICATION_CATEGORIES]).toEqual(['mention', 'assignment', 'weekly']);
    expect(sql).toContain("CHECK (kind IN ('notify:mention', 'notify:assignment', 'notify:intake', 'notify:weekly'))");
    expect(sql).toContain("OR (kind = 'notify:weekly' AND payload IS NOT NULL)");
  });

  it('★★ ON by default: absence means on, and only enabled=false turns it off', () => {
    expect(preferencesFromRows([]).weekly).toBe(true);
    expect(preferencesFromRows([{ category: 'weekly', enabled: false }]))
      .toEqual({ mention: true, assignment: true, weekly: false });
  });

  it('★ Settings → My account → Email notifications shows a third switch, "Weekly Update", on', () => {
    render(<EmailNotificationsPanel />);
    const box = screen.getByTestId('email-notifications-weekly') as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(screen.getByText('Weekly Update')).toBeTruthy();
    expect(screen.getByTestId('email-notifications-mention')).toBeTruthy();
    expect(screen.getByTestId('email-notifications-assignment')).toBeTruthy();
    expect(NOTIFICATION_CATEGORY_COPY.weekly.label).toBe('Weekly Update');
  });
});

// ===========================================================================
// WHAT — the pop-up's content
// ===========================================================================

describe('fix-642: the email carries what the pop-up shows', () => {
  it('★★ the five sections are the pop-up’s (twin)', () => {
    expect(WEEKLY_SECTIONS.map((s) => ({ ...s }))).toEqual(SNAPSHOT_SECTIONS.map((s) => ({ ...s })));
  });

  it('★★★ each bucket is sorted the way the pop-up opens (age desc, nulls last, ties in server order)', () => {
    const rows = [row('b', 12), row('b', null), row('b', 400), row('b', 12), row('b', 90)];
    const ours = weeklySortRows(rows).map((r) => r.permit_id);
    const popup = sortRows(rows as unknown as SnapshotRow[], { key: 'age_days', dir: 'desc' }).map((r) => r.permit_id);
    expect(ours).toEqual(popup);
    expect(weeklySortRows(rows).map((r) => r.age_days)).toEqual([400, 90, 12, 12, null]);
  });

  it('★★★ counts, the top 5, and "+ N more"', () => {
    const rows = [
      ...[3, 40, 7, 200, 15, 1, 66].map((a) => row('b', a)),
      row('e', 5),
    ];
    const views = weeklyBuckets(rows);
    const b = views.find((v) => v.key === 'b')!;
    expect(WEEKLY_TOP_N).toBe(5);
    expect(b.count).toBe(7);
    expect(b.top.map((r) => r.age_days)).toEqual([200, 66, 40, 15, 7]);
    expect(b.more).toBe(2);
    expect(views.find((v) => v.key === 'e')).toMatchObject({ count: 1, more: 0 });
    expect(views.find((v) => v.key === 'a')).toMatchObject({ count: 0, more: 0 });

    const r = renderWeekly(weeklyRow(rows));
    expect(r.html).toContain('Intake past due, still not submitted <span style="color:#666666;font-weight:400">· 7</span>');
    expect(r.html).toContain('+ 2 more');
    expect(r.text).toContain('INTAKE PAST DUE, STILL NOT SUBMITTED · 7');
    expect(r.text).toContain('+ 2 more');
    // the two youngest are NOT in the email
    const young = rows.filter((x) => x.bucket === 'b' && (x.age_days === 1 || x.age_days === 3));
    for (const y of young) expect(r.text).not.toContain(y.address!);
    // an empty section says so rather than vanishing
    expect(r.text).toContain('INTAKE DUE IN THE NEXT 14 DAYS · 0\nNone this week.');
  });

  it('★ each row: address (linking to its permit), permit, the section’s date and age', () => {
    const x = row('d', 23, { address: '6605 57th Ave NE', num: '7150289-CN', on_date: '2026-09-21', project_id: 'proj-x', permit_id: 77 });
    const r = renderWeekly(weeklyRow([x]));
    expect(r.text).toContain('- 6605 57th Ave NE · 7150289-CN · Corrections issued 9/21/2026 · Days out 23');
    expect(r.html).toContain(`${BRIDGE_APP_ORIGIN}/project/proj-x?permit=77`);
    expect(r.html).toContain('>Corrections issued</th>');
    expect(r.html).toContain('>Days out</th>');
  });

  it('★ the agenda: title, who it is assigned to, days on the agenda', () => {
    const r = renderWeekly(weeklyRow([]));
    expect(r.text).toContain('- IPR / ULS / Project Management Revisions · Brittani · 26 days on the agenda');
    expect(r.html).toContain('Brittani · 26 days on the agenda');
    const empty = renderWeekly(weeklyRow([], {}, []));
    expect(empty.text).toContain('AGENDA\nNothing on the agenda yet.');
  });

  it('★★ subject "Weekly Update · Wed, Oct 14" and an "Open the Weekly Update" button', () => {
    expect(editionLabel('2026-10-14')).toBe('Wed, Oct 14');
    expect(weeklySubject('2026-10-21')).toBe('Weekly Update · Wed, Oct 21');
    const r = renderWeekly(weeklyRow([]));
    expect(r.subject).toBe('Weekly Update · Wed, Oct 14');
    expect(r.html).toContain('Open the Weekly Update');
    expect(r.html).toContain(`href="${WEEKLY_UPDATE_URL}"`);
    expect(WEEKLY_UPDATE_URL).toBe(`${BRIDGE_APP_ORIGIN}/agenda`);
    expect(repo('src/router.tsx')).toContain("{ path: 'agenda', element: <Agenda /> }");
    expect(r.html).toContain(SETTINGS_URL);
    expect(r.inlineImages.length).toBeGreaterThan(0); // the branded template
    expect(r.html).not.toMatch(/<img[^>]+src="http/); // no remote images, no attachments
  });

  it('★★★ every value from the database is HTML-escaped', () => {
    const evil = row('a', 4, { address: '<script>alert(1)</script> & Co', num: '"7"<b>' });
    const r = renderWeekly(weeklyRow([evil], {}, [
      { id: 't', text: 'Fix <img src=x onerror=1> & go', assigned_to: '<i>Dave</i>', priority: true, created_at: null, days_on_agenda: 1 },
    ]));
    expect(r.html).not.toContain('<script>');
    expect(r.html).not.toContain('<img src=x');
    expect(r.html).not.toContain('<i>Dave</i>');
    expect(r.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; Co');
    expect(r.html).toContain('&quot;7&quot;&lt;b&gt;');
    expect(r.html).toContain('Fix &lt;img src=x onerror=1&gt; &amp; go');
    expect(r.text).toContain('1 day on the agenda');
  });
});

// ===========================================================================
// THE OUTBOX
// ===========================================================================

describe('fix-642: one email_outbox row per send, success or failure', () => {
  it('★★★ success → one outbox row (notify:weekly, sent) and the queue row marked sent with it', async () => {
    const { deps, outbox, sent, marks } = fakeDeps(true);
    const s = await drain(deps, [weeklyRow([row('c', 9)])]);
    expect(s).toEqual({ emails: 1, sent: 1, failed: 0, skipped: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('bobby@x.com');
    expect(outbox).toEqual([expect.objectContaining({
      kind: 'notify:weekly', to_email: 'bobby@x.com', subject: 'Weekly Update · Wed, Oct 14',
      status: 'sent', error: null, graph_request_id: 'r1',
    })]);
    expect(marks).toEqual([{ ids: ['q-weekly'], outcome: 'sent', outboxId: 'ob-1', note: null }]);
  });

  it('★★★ failure → one outbox row (failed, with the error) and the queue row marked failed', async () => {
    const { deps, outbox, marks } = fakeDeps(false);
    const s = await drain(deps, [weeklyRow([])]);
    expect(s).toEqual({ emails: 1, sent: 0, failed: 1, skipped: 0 });
    expect(outbox).toEqual([expect.objectContaining({
      kind: 'notify:weekly', status: 'failed', error: 'Graph said no', graph_request_id: 'r2',
    })]);
    expect(marks).toEqual([{ ids: ['q-weekly'], outcome: 'failed', outboxId: 'ob-1', note: 'Graph said no' }]);
  });

  it('a row without a payload is skipped, never sent; an EMPTY week still sends', () => {
    expect(skipReason(weeklyRow([], { payload: null }))).toBe('no weekly payload');
    expect(skipReason(weeklyRow([], {}, []))).toBeNull();
  });
});

// ===========================================================================
// THE SQL — one snapshot definition, and nothing new readable by a user
// ===========================================================================

describe('fix-642: the pop-up and the email read ONE snapshot definition', () => {
  it('★★★ bp_weekly_snapshot() delegates to bp_weekly_snapshot_for with the caller’s tenants', () => {
    expect(fn('bp_weekly_snapshot')).toContain('RETURN public.bp_weekly_snapshot_for(public.auth_tenant_ids());');
    expect(fn('bp_weekly_update_payload')).toContain("'snapshot', public.bp_weekly_snapshot_for(ARRAY[p_tenant])");
  });

  it('★★ the agenda is the OPEN agenda items, in the pop-up’s order (priority, then oldest)', () => {
    const p = fn('bp_weekly_update_payload');
    expect(p).toContain('t.agenda IS TRUE');
    expect(p).toContain("COALESCE(t.completion_status, 'Open') NOT IN ('Resolved', 'Cancelled')");
    expect(p).toContain('ORDER BY COALESCE(t.priority, false) DESC, t.created_at, t.id');
  });

  it('★★★ the tenant-taking functions are service-role only; the pop-up RPC keeps its grant', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bp_weekly_snapshot_for(uuid[]) FROM public, anon, authenticated;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bp_weekly_update_payload(uuid, date) FROM public, anon, authenticated;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bp_weekly_update_recipients(uuid) FROM public, anon, authenticated;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bp_weekly_update_enqueue(boolean) FROM public, anon, authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.bp_weekly_snapshot() TO authenticated, service_role;');
  });

  it('★★★ no existing rows change: no UPDATE, DELETE or INSERT except the queue insert', () => {
    expect(sql).not.toMatch(/\bUPDATE public\.(?!notification_email_queue q)/);
    expect(sql).not.toMatch(/\bDELETE FROM\b/);
    expect(sql.match(/INSERT INTO/g)).toHaveLength(1);
    expect(sql).toContain('INSERT INTO public.notification_email_queue');
  });
});
