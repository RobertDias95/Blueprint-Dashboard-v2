import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SCRAPE_SILENCE_RECIPIENTS_KEY,
  SCRAPE_SILENT_AFTER_WEEKDAY_HOURS,
  SCRAPE_WORKFLOW_URL,
  isScrapeSilent,
  weekdayHoursBetween,
} from '../lib/scrapeSilence';
import { SETTINGS_BLOCKS } from '../lib/settingsBlocks';
import { APP_CONFIG_KEY_LABELS } from '../hooks/useSetAppConfigKey';
import {
  SCRAPE_WORKFLOW_URL as EMAIL_WORKFLOW_URL,
  drain,
  planEmails,
  renderScrapeSilent,
  skipReason,
  type ClaimedRow,
  type Deps,
  type OutboxRow,
  type ScrapeSilentPayload,
} from '../../supabase/functions/notify-send/handler';

// ===========================================================================
// fix-658 (P-343) — the permit scrape hasn't run for 36 weekday hours.
//
// ★★ TESTED TWO WAYS (the fix-153 pattern — CI has no database):
//   · the TS mirror of the rule, the email and the Settings wiring run here;
//   · the SQL is pinned clause by clause below, and the whole check was
//     driven on prod in a ROLLED-BACK transaction (weekend → nothing;
//     36+ weekday hours → one row + one email; next hour → nothing new;
//     a run lands → resolved) — see the PR.
// ===========================================================================

const repo = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const sql = repo('migrations/fix_658_scrape_silence_alert.sql')
  .split(/\r?\n/)
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const fn = (name: string) => {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf('$function$;', start);
  return sql.slice(start, end);
};

// ===========================================================================
// THE RULE
// ===========================================================================

describe('fix-658: weekday hours, Pacific', () => {
  it('★★★ the brief\'s own check: Fri 14:18 → Mon 12:10 is ~22 weekday hours, quiet', () => {
    const last = new Date('2026-10-09T21:18:00Z'); // Fri 2:18 PM PDT
    const now = new Date('2026-10-12T19:10:00Z');  // Mon 12:10 PM PDT
    expect(weekdayHoursBetween(last, now)).toBeCloseTo(9.7 + 12 + 10 / 60, 1);
    expect(isScrapeSilent(last, now)).toBe(false);
  });

  it('★★★ a whole weekend counts for nothing', () => {
    const satNoon = new Date('2026-10-10T19:00:00Z');
    const monMidnight = new Date('2026-10-12T07:00:00Z');
    expect(weekdayHoursBetween(satNoon, monMidnight)).toBe(0);
  });

  it('★★★ Thu 14:00 → Mon 02:00 is exactly 36: not yet; Mon 03:00 is over', () => {
    const thu = new Date('2026-10-08T21:00:00Z');                       // Thu 2 PM PDT
    expect(weekdayHoursBetween(thu, new Date('2026-10-12T09:00:00Z'))).toBeCloseTo(36, 6);
    expect(isScrapeSilent(thu, new Date('2026-10-12T09:00:00Z'))).toBe(false);
    expect(isScrapeSilent(thu, new Date('2026-10-12T10:00:00Z'))).toBe(true);
  });

  it('★★ across the DST change (Sun Nov 1) a weekday is still 24 hours', () => {
    const friNoonPdt = new Date('2026-10-30T19:00:00Z');
    const monNoonPst = new Date('2026-11-02T20:00:00Z');
    expect(weekdayHoursBetween(friNoonPdt, monNoonPst)).toBeCloseTo(24, 6);
  });

  it('★ holidays are NOT skipped; no run recorded is unknown, not silent', () => {
    // Mon 2026-11-23 → Fri 11-27 (Thanksgiving week) counts every weekday.
    const mon = new Date('2026-11-23T08:00:00Z');
    expect(weekdayHoursBetween(mon, new Date('2026-11-28T08:00:00Z'))).toBeCloseTo(120, 6);
    expect(isScrapeSilent(null, new Date())).toBe(false);
  });
});

// ===========================================================================
// THE SQL — pinned clause by clause
// ===========================================================================

describe('fix-658: the migration', () => {
  it('★★★ the threshold is 36 on both sides', () => {
    expect(SCRAPE_SILENT_AFTER_WEEKDAY_HOURS).toBe(36);
    expect(fn('bp_scrape_silence_check')).toMatch(/c_threshold constant numeric := 36;/);
    expect(fn('bp_scrape_silence_check')).toMatch(/IF v_hours > c_threshold THEN/);
  });

  it('★★★ weekdays only, Pacific', () => {
    const f = fn('bp_weekday_hours_between');
    expect(f).toMatch(/extract\(isodow FROM g\.d\) < 6/);
    expect(f).toMatch(/AT TIME ZONE 'America\/Los_Angeles'/);
  });

  it('★★★ the last run is the newest REAL scraper_run', () => {
    expect(fn('bp_scrape_silence_check')).toMatch(
      /max\(s\.started_at\)[\s\S]*FROM public\.scraper_run s[\s\S]*NOT s\.dry_run/);
  });

  it('★★★ one row per outage — the row is the ledger, in any status', () => {
    const f = fn('bp_scrape_silence_check');
    expect(f).toMatch(/v_fp := 'scrape_silence:' \|\| v_tenant::text/);
    expect(f).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM public\.error_reports e\s+WHERE e\.tenant_id = v_tenant AND e\.fingerprint = v_fp\)/);
    // ★ and the email rides on the row being filed now
    expect(f).toMatch(/IF v_err_id IS NOT NULL THEN[\s\S]*notify:scrape_silent/);
  });

  it('★★★ a run landing resolves the open row, with a note', () => {
    const f = fn('bp_scrape_silence_check');
    expect(f).toMatch(/SET status = 'resolved'/);
    expect(f).toMatch(/'scrape resumed '/);
    expect(f).toMatch(/\(e\.context->>'last_run_at'\)::timestamptz < v_last/);
  });

  it('★★★ the message and level the brief names; a source Error triage LISTS', () => {
    const f = fn('bp_scrape_silence_check');
    expect(f).toMatch(/'scrape_silence', 'error'/);
    expect(f).toMatch(/The permit scrape hasn''t run for %s weekday hours — last run %s\./);
    expect(sql).toMatch(/CHECK \(source IN \('frontend_toast', 'frontend_exception', 'backend_rpc', 'scraper',\s+'notification_delivery', 'scrape_silence'\)\)/);
  });

  it('★★ the queue knows the kind; the claim never calls it opted out', () => {
    expect(sql).toMatch(/'notify:resubmit', 'notify:scrape_silent'\)\)/);
    expect(sql).toMatch(/kind = 'notify:scrape_silent' AND payload IS NOT NULL/);
    expect(fn('bp_notify_claim')).toMatch(/WHEN c\.kind IN \('notify:intake', 'notify:scrape_silent'\) THEN false/);
  });

  it('★★ recipients come from Settings; seeded Bobby; hourly cron', () => {
    expect(fn('bp_scrape_silence_recipients')).toMatch(new RegExp(`c\\.key = '${SCRAPE_SILENCE_RECIPIENTS_KEY}'`));
    expect(sql).toMatch(/'scrapeSilenceAlertRecipients', '\["Bobby"\]'::jsonb/);
    expect(sql).toMatch(/ON CONFLICT \(key\) DO NOTHING/);
    expect(sql).toMatch(/cron\.schedule\(\s+'bp-scrape-silence-check',\s+'25 \* \* \* \*',/);
  });
});

// ===========================================================================
// THE EMAIL
// ===========================================================================

const payload = (over: Partial<ScrapeSilentPayload> = {}): ScrapeSilentPayload => ({
  last_run_at: '2026-10-09T21:18:08+00:00',
  last_run_label: 'Fri Oct 9 2:18 PM PT',
  last_run_day: 'Fri Oct 9',
  weekday_hours: 37,
  threshold_hours: 36,
  ...over,
});

const qrow = (over: Partial<ClaimedRow> = {}): ClaimedRow => ({
  id: 'q1', kind: 'notify:scrape_silent', to_email: 'robertd@blueprintcap.com',
  recipient_user_id: 'u1', project_id: null, message_id: null, task_id: null,
  task_source: null, opted_out: false, actor_name: null, project_address: null,
  post_title: null, message_body: null, message_deleted: false, task_text: null,
  task_done: false, task_due: null, payload: payload(), ...over,
});

describe('fix-658: the email', () => {
  it('★★★ subject, plain words, and the Run workflow fix', () => {
    const r = renderScrapeSilent(qrow());
    expect(r.subject).toBe('The Bridge: permit scrape hasn’t run since Fri Oct 9');
    expect(r.text).toContain('hasn’t run for 37 weekday hours');
    expect(r.text).toContain('Fri Oct 9 2:18 PM PT');
    expect(r.text).toContain('“Run workflow”');
    expect(r.text).toContain(SCRAPE_WORKFLOW_URL);
    expect(r.html).toContain(SCRAPE_WORKFLOW_URL);
  });

  it('★★ the workflow link is the same on both sides', () => {
    expect(EMAIL_WORKFLOW_URL).toBe(SCRAPE_WORKFLOW_URL);
    expect(SCRAPE_WORKFLOW_URL).toBe(
      'https://github.com/RobertDias95/Blueprint-Dashboard-/actions/workflows/scrape-prod.yml');
  });

  it('★★ one email per row; a row without a payload is skipped', async () => {
    expect(skipReason(qrow())).toBeNull();
    expect(skipReason(qrow({ payload: null }))).toBe('no scrape-silent payload');
    expect(planEmails([qrow(), qrow({ id: 'q2' })])).toHaveLength(2);

    const outbox: OutboxRow[] = [];
    const deps: Deps = {
      sendMail: vi.fn(async () => ({ ok: true as const, requestId: 'r1' })),
      recordOutbox: vi.fn(async (o: OutboxRow) => { outbox.push(o); return 'ob-1'; }),
      markQueue: vi.fn(async () => {}),
    };
    const s = await drain(deps, [qrow()]);
    expect(s).toEqual({ emails: 1, sent: 1, failed: 0, skipped: 0 });
    expect(outbox[0]!.kind).toBe('notify:scrape_silent');
  });
});

// ===========================================================================
// SETTINGS + ERROR TRIAGE
// ===========================================================================

describe('fix-658: Settings and Error triage', () => {
  it('★★ "Scraper-down alert goes to" is a Settings block with a save word', () => {
    const b = SETTINGS_BLOCKS.find((x) => x.id === 'scrape-silence-alert');
    expect(b?.category).toBe('teams');
    expect(b?.title).toBe('Scraper-down alert goes to');
    expect(APP_CONFIG_KEY_LABELS[SCRAPE_SILENCE_RECIPIENTS_KEY]).toBe('Scraper-down alert recipients');
    const tab = repo('src/components/Settings/AdminTeamTab.tsx');
    expect(tab).toContain('<SettingsBlock id="scrape-silence-alert">');
    expect(repo('src/components/Settings/ScrapeSilenceRecipientsEditor.tsx')).toContain('<RecipientNamesEditor');
  });

  it('★★ Error triage has a label for the new source', () => {
    expect(repo('src/pages/Errors.tsx')).toMatch(/scrape_silence: 'Scrape',/);
  });
});
