import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  RESUBMIT_TIERS,
  RESUBMIT_WARNING_RECIPIENTS_KEY,
  addBusinessDays,
  businessDaysPast,
  monDay,
  openRoundOf,
  pastLabel,
  planResubmitDigests,
  resubmitBasis,
  resubmitBusinessDays,
  resubmitByDate,
  resubmitByLabel,
  type WarnLedgerRow,
  type WarnPerson,
  type WarnRound,
} from '../lib/resubmitBy';
import { SNAPSHOT_SECTIONS } from '../lib/weeklySnapshot';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_COPY,
  preferencesFromRows,
} from '../lib/notificationPreferences';
import { SETTINGS_BLOCKS } from '../lib/settingsBlocks';
import { APP_CONFIG_KEY_LABELS } from '../hooks/useSetAppConfigKey';
import {
  WEEKLY_SECTIONS,
  drain,
  monDay as emailMonDay,
  planEmails,
  renderResubmit,
  resubmitSubject,
  skipReason,
  type ClaimedRow,
  type Deps,
  type OutboxRow,
  type ResubmitItem,
} from '../../supabase/functions/notify-send/handler';

// ===========================================================================
// fix-646 (P-066 + P-011) — a smart "Resubmit by" date, and a warning when it
// passes.
//
// ★★ TESTED TWO WAYS (the fix-153 pattern — CI has no database):
//   · the TS mirrors (formula, open round, digest plan), the email and the
//     Settings wiring run here;
//   · the SQL is pinned clause by clause below, and the whole migration was
//     probed on prod in a ROLLED-BACK transaction (see the PR).
// ===========================================================================

const repo = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
/** The migration with `--` comments removed. ★ CRLF-safe: a Windows checkout
 *  ends lines with \r, and `.` does not match it (the fix-643 trap). */
const sql = repo('migrations/fix_646_smart_resubmit_by.sql')
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
// THE FORMULA
// ===========================================================================

describe('fix-646: the formula (Bobby 10-11)', () => {
  it.each([
    // CR1: ≤10 / 11–25 / 26–50 / 51+ → 10 / 15 / 20 / 25
    [1, 0, 10], [1, 1, 10], [1, 10, 10], [1, 11, 15], [1, 25, 15],
    [1, 26, 20], [1, 50, 20], [1, 51, 25], [1, 400, 25],
    // CR2+: ≤10 / 11–25 / 26+ → 5 / 8 / 10
    [2, 0, 5], [2, 10, 5], [2, 11, 8], [2, 25, 8], [2, 26, 10], [2, 51, 10],
    [3, 10, 5], [7, 26, 10],
  ])('★★★ CR%i with %i items → %i business days', (cycle, items, days) => {
    expect(resubmitBusinessDays(cycle, items)).toBe(days);
  });

  it('★★ letter not indexed yet (0 items) → the base: 10 for CR1, 5 after', () => {
    expect(resubmitBusinessDays(1, 0)).toBe(10);
    expect(resubmitBusinessDays(2, 0)).toBe(5);
    expect(resubmitBusinessDays(1, null)).toBe(10);
  });

  it('★ the design cycle has no round', () => {
    expect(resubmitBusinessDays(0, 5)).toBeNull();
    expect(resubmitBusinessDays(null, 5)).toBeNull();
  });

  it('★★★ twin: the SQL table is the same table', () => {
    const f = fn('bp_resubmit_business_days');
    const cr1 = f.slice(f.indexOf('WHEN p_cycle_index = 1 THEN'), f.indexOf('ELSE\n'));
    const later = f.slice(f.indexOf('ELSE\n'));
    const tiers = (s: string) => {
      const out: { max: number | null; days: number }[] = [];
      for (const m of s.matchAll(/(?:<= (\d+) THEN (\d+))|(?:ELSE (\d+) END)/g)) {
        out.push(m[3] ? { max: null, days: Number(m[3]) } : { max: Number(m[1]), days: Number(m[2]) });
      }
      return out;
    };
    expect(tiers(cr1)).toEqual(RESUBMIT_TIERS.first);
    expect(tiers(later)).toEqual(RESUBMIT_TIERS.later);
    // 0 items falls into the first tier, in both
    expect(f).toContain('COALESCE(p_items, 0) <= 10');
  });

  it('★★ items = correction_items for the permit + cycle, is_correction IS NOT FALSE', () => {
    const f = fn('bp_correction_item_count');
    expect(f).toContain('ci.permit_id = p_permit_id');
    expect(f).toContain('ci.cycle = p_cycle_index');
    expect(f).toContain('ci.is_correction IS NOT FALSE');
  });
});

describe('fix-646: business days, from the day AFTER corr_issued', () => {
  it('★★★ a weekend is skipped', () => {
    // Fri 2026-10-09 + 1 → Mon 10-12
    expect(addBusinessDays('2026-10-09', 1)).toBe('2026-10-12');
    // Sat + 1 → Mon too
    expect(addBusinessDays('2026-10-10', 1)).toBe('2026-10-12');
    // CR2, 0 items: 5 business days from Fri 10-09 → Fri 10-16
    expect(resubmitByDate('2026-10-09', 2, 0)).toBe('2026-10-16');
    // CR1, 0 items: 10 business days from Mon 10-05 → Mon 10-19
    expect(resubmitByDate('2026-10-05', 1, 0)).toBe('2026-10-19');
  });

  it('★★★ the date moves LATER when the letter is indexed (0 → 14 items)', () => {
    const before = resubmitByDate('2026-10-05', 1, 0);
    const after = resubmitByDate('2026-10-05', 1, 14);
    expect(before).toBe('2026-10-19');
    expect(after).toBe('2026-10-26');
    expect(after! > before!).toBe(true);
  });

  it('★★ twin: bp_add_business_days counts weekdays after p_from', () => {
    const f = fn('bp_add_business_days');
    expect(f).toContain('generate_series(p_from + 1,');
    expect(f).toContain('extract(isodow FROM d) < 6');
    expect(f).toContain('OFFSET p_n - 1 LIMIT 1');
  });

  it('★★ past = at least one business day after the date (Sat after a Friday is not past)', () => {
    expect(businessDaysPast('2026-10-09', '2026-10-10')).toBe(0);
    expect(businessDaysPast('2026-10-09', '2026-10-12')).toBe(1);
    expect(businessDaysPast('2026-10-09', '2026-10-08')).toBe(0);
    const f = fn('bp_resubmit_rounds_for');
    expect(f).toContain('public.bp_business_days_between(d.resubmit_by, k.today) >= 1 AS is_past');
    expect(f).toContain('GREATEST(0, public.bp_business_days_between(d.resubmit_by, k.today)) AS days_past');
  });
});

// ===========================================================================
// THE OPEN ROUND
// ===========================================================================

describe('fix-646: an open round', () => {
  const live = { actual_issue: null, approval_date: null, status: 'Corrections Required' };

  it('★★★ the latest cycle, corrections out, not resubmitted', () => {
    const r = openRoundOf(live, [
      { cycle_index: 0, corr_issued: null, resubmitted: null },
      { cycle_index: 1, corr_issued: '2026-09-01', resubmitted: '2026-09-20' },
      { cycle_index: 2, corr_issued: '2026-10-05', resubmitted: null },
    ]);
    expect(r?.cycle_index).toBe(2);
  });

  it('★★★ a round resubmitted → gone', () => {
    expect(openRoundOf(live, [
      { cycle_index: 1, corr_issued: '2026-09-01', resubmitted: '2026-09-20' },
    ])).toBeNull();
    // and an earlier open-looking cycle under a later one does not count
    expect(openRoundOf(live, [
      { cycle_index: 1, corr_issued: '2026-09-01', resubmitted: null },
      { cycle_index: 2, corr_issued: null, resubmitted: null },
    ])).toBeNull();
  });

  it('★★ issued, approved (fix-221), withdrawn or archived → no round', () => {
    const cycles = [{ cycle_index: 1, corr_issued: '2026-09-01', resubmitted: null }];
    expect(openRoundOf({ ...live, actual_issue: '2026-10-01' }, cycles)).toBeNull();
    expect(openRoundOf({ ...live, approval_date: '2026-10-01' }, cycles)).toBeNull();
    expect(openRoundOf({ ...live, status: 'Withdrawn' }, cycles)).toBeNull();
    expect(openRoundOf({ ...live, project_archived: true }, cycles)).toBeNull();
  });

  it('★★★ twin: the SQL WHERE says the same', () => {
    const f = fn('bp_resubmit_rounds_for');
    expect(f).toContain('ORDER BY c.permit_id, c.cycle_index DESC');
    expect(f).toContain('WHERE c.cycle_index >= 1');
    expect(f).toContain('COALESCE(pj.archived, false) = false');
    expect(f).toContain('p.actual_issue IS NULL');
    expect(f).toContain('p.approval_date IS NULL');
    expect(f).toContain("COALESCE(p.status, '') NOT ILIKE '%withdraw%'");
    expect(f).toContain("COALESCE(p.status, '') NOT ILIKE '%cancel%'");
    expect(f).toContain('x.corr_issued IS NOT NULL');
    expect(f).toContain('x.resubmitted IS NULL');
  });

  it('★★ parked = an open project hold/cancel OR an open permit hold', () => {
    const f = fn('bp_resubmit_rounds_for');
    expect(f).toMatch(/FROM public\.project_holds h\s+WHERE h\.project_id = p\.project_id AND h\.hold_end IS NULL/);
    expect(f).toMatch(/FROM public\.permit_holds h\s+WHERE h\.permit_id = p\.id AND h\.hold_end IS NULL/);
  });

  it('★★ the screens read the caller\'s own tenants; the rule itself is service-only', () => {
    expect(fn('bp_resubmit_rounds')).toContain('bp_resubmit_rounds_for(public.auth_tenant_ids(), NULL)');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.bp_resubmit_rounds() TO authenticated, service_role;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bp_resubmit_rounds_for(uuid[], date) FROM public, anon, authenticated;');
    expect(fn('bp_resubmit_by')).toContain('auth.uid() IS NULL OR p.tenant_id = ANY (public.auth_tenant_ids())');
  });
});

// ===========================================================================
// THE WORDS
// ===========================================================================

describe('fix-646: what the screens say', () => {
  const round = {
    cycle_index: 1, items: 14, business_days: 15, resubmit_by: '2026-10-22',
    days_past: 3, is_past: true,
  };
  it('★★ "Resubmit by Oct 22" · "3 days past" · the basis', () => {
    expect(resubmitByLabel(round)).toBe('Resubmit by Oct 22');
    expect(pastLabel(round)).toBe('3 days past');
    expect(pastLabel({ days_past: 1, is_past: true })).toBe('1 day past');
    expect(pastLabel({ days_past: 0, is_past: false })).toBeNull();
    expect(resubmitBasis(round)).toBe('CR1 · 14 items → 15 business days');
    expect(resubmitBasis({ cycle_index: 2, items: 0, business_days: 5 }))
      .toBe('CR2 · letter not indexed yet → 5 business days');
  });

  it('★ the email\'s date words are the same', () => {
    for (const d of ['2026-01-05', '2026-10-22', '2026-12-31']) {
      expect(emailMonDay(d)).toBe(monDay(d));
    }
  });
});

// ===========================================================================
// THE WARNING — who, and only once
// ===========================================================================

const people: Record<string, WarnPerson> = {
  Miles: { userId: 'u-miles', email: 'miles@x.test' },
  Brittani: { userId: 'u-brittani', email: 'brittani@x.test' },
  Dave: { userId: 'u-dave', email: 'dave@x.test' },
  Bobby: { userId: 'u-bobby', email: 'bobby@x.test' },
};
const resolveName = (n: string) => people[n] ?? null;
const LIST = ['Dave', 'Brittani', 'Bobby'];
const wr = (over: Partial<WarnRound>): WarnRound => ({
  permit_id: 1, cycle_index: 1, resubmit_by: '2026-10-01', is_past: true,
  parked: false, ent_lead: 'Miles', dm: 'Brittani', ...over,
});

describe('fix-646: the digest', () => {
  it('★★★ recipients = ENT + DM + the Settings list, deduped (Brittani is DM AND listed)', () => {
    const plan = planResubmitDigests({
      rounds: [wr({})], ledger: [], listNames: LIST, resolve: resolveName,
      optedOut: new Set(), today: '2026-10-12',
    });
    expect([...plan.digests.keys()].sort()).toEqual(
      ['bobby@x.test', 'brittani@x.test', 'dave@x.test', 'miles@x.test'],
    );
    expect(plan.digests.get('brittani@x.test')!.rounds).toHaveLength(1);
  });

  it('★★★ the opt-out is respected', () => {
    const plan = planResubmitDigests({
      rounds: [wr({})], ledger: [], listNames: LIST, resolve: resolveName,
      optedOut: new Set(['u-dave']), today: '2026-10-12',
    });
    expect(plan.digests.has('dave@x.test')).toBe(false);
    expect(plan.digests.has('miles@x.test')).toBe(true);
  });

  it('★★★ parked → no warning (and not ledgered, so it is warned when the hold lifts)', () => {
    const plan = planResubmitDigests({
      rounds: [wr({ parked: true })], ledger: [], listNames: LIST, resolve: resolveName,
      optedOut: new Set(), today: '2026-10-12',
    });
    expect(plan.digests.size).toBe(0);
    expect(plan.ledgered).toHaveLength(0);
  });

  it('★★★ only newly-past rounds; a re-run sends nothing', () => {
    const rounds = [
      wr({ permit_id: 1 }),
      wr({ permit_id: 2, is_past: false, resubmit_by: '2026-10-20' }),
    ];
    const first = planResubmitDigests({
      rounds, ledger: [], listNames: LIST, resolve: resolveName,
      optedOut: new Set(), today: '2026-10-12',
    });
    expect(first.ledgered.map((r) => r.permit_id)).toEqual([1]);
    const ledger: WarnLedgerRow[] = first.ledgered.map((r) => ({
      permit_id: r.permit_id, cycle_index: r.cycle_index, resubmit_by: r.resubmit_by,
      warned_on: '2026-10-12',
    }));
    // the second cron hour, same day
    const again = planResubmitDigests({
      rounds, ledger, listNames: LIST, resolve: resolveName,
      optedOut: new Set(), today: '2026-10-12',
    });
    expect(again.digests.size).toBe(0);
    // tomorrow: round 1 is still past but already told; round 2 has just passed
    const tomorrow = planResubmitDigests({
      rounds: [rounds[0]!, { ...rounds[1]!, is_past: true }],
      ledger, listNames: LIST, resolve: resolveName,
      optedOut: new Set(), today: '2026-10-13',
    });
    expect(tomorrow.ledgered.map((r) => r.permit_id)).toEqual([2]);
    expect(tomorrow.launch).toBe(false);
  });

  it('★★ a date that moved later (letter indexed) and passed AGAIN is warned again', () => {
    const ledger: WarnLedgerRow[] = [
      { permit_id: 1, cycle_index: 1, resubmit_by: '2026-10-01', warned_on: '2026-10-02' },
    ];
    const plan = planResubmitDigests({
      rounds: [wr({ resubmit_by: '2026-10-08' })], ledger, listNames: LIST,
      resolve: resolveName, optedOut: new Set(), today: '2026-10-12',
    });
    expect(plan.ledgered).toHaveLength(1);
  });

  it('★★★ the launch digest is sent once — everything already past, then never again', () => {
    const rounds = [wr({ permit_id: 1 }), wr({ permit_id: 2 }), wr({ permit_id: 3, ent_lead: null })];
    const day1 = planResubmitDigests({
      rounds, ledger: [], listNames: LIST, resolve: resolveName,
      optedOut: new Set(), today: '2026-10-12',
    });
    expect(day1.launch).toBe(true);
    expect(day1.digests.get('dave@x.test')!.rounds).toHaveLength(3);
    expect(day1.digests.get('miles@x.test')!.rounds).toHaveLength(2);
    const ledger = day1.ledgered.map((r) => ({
      permit_id: r.permit_id, cycle_index: r.cycle_index, resubmit_by: r.resubmit_by,
      warned_on: '2026-10-12',
    }));
    const day2 = planResubmitDigests({
      rounds, ledger, listNames: LIST, resolve: resolveName,
      optedOut: new Set(), today: '2026-10-13',
    });
    expect(day2.launch).toBe(false);
    expect(day2.digests.size).toBe(0);
  });

  it('★★★ twin: the enqueue SQL implements the same plan', () => {
    const f = fn('bp_resubmit_warning_enqueue');
    // one digest a day
    expect(f).toMatch(/w\.tenant_id = v_tenant AND w\.warned_on = v_today\) THEN\s+CONTINUE;/);
    // launch = the ledger was empty
    expect(f).toMatch(/v_launch := NOT EXISTS \(SELECT 1 FROM public\.resubmit_warnings w\s+WHERE w\.tenant_id = v_tenant\);/);
    // newly past
    expect(f).toContain('WHERE o.is_past');
    expect(f).toContain('AND NOT o.parked');
    expect(f).toContain('AND (w.permit_id IS NULL OR w.resubmit_by < o.resubmit_by)');
    // opt-out, one row per person per day
    expect(f).toContain("IF NOT public.bp_notify_enabled(r.user_id, 'resubmit') THEN CONTINUE; END IF;");
    expect(f).toContain("'notify:resubmit:' || r.email || ':' || v_today::text");
    expect(f).toContain('GROUP BY pr.email');
    // every new round is ledgered
    expect(f).toContain('INSERT INTO public.resubmit_warnings');
    expect(f).toContain('ON CONFLICT (permit_id, cycle_index) DO UPDATE');
    // fix-637's clock
    expect(f).toContain('IF extract(isodow FROM v_local) >= 6 THEN RETURN 0; END IF;');
    expect(f).toContain('IF extract(hour FROM v_local) < 7 THEN RETURN 0; END IF;');
    expect(sql).toMatch(/cron\.schedule\(\s+'bp-resubmit-warning',\s+'0 14,15 \* \* 1-5',/);
  });

  it('★★★ twin: recipients = ENT, DM, the list — resolved one-login-or-nobody — NOT the DA', () => {
    const f = fn('bp_resubmit_warning_recipients');
    expect(f).toContain("'ENT'::text AS why, btrim(p_ent)");
    expect(f).toContain("SELECT 2, 'DM', btrim(p_dm)");
    expect(f).toContain(`c.key = '${RESUBMIT_WARNING_RECIPIENTS_KEY}'`);
    expect(f).toContain('public.bp_notify_person_for_name(p_tenant, n.name)');
    expect(f).toContain('SELECT DISTINCT ON (email) user_id, email, why');
    expect(f).not.toMatch(/\bda\b/i);
    // the enqueue passes the ENT and DM, never the DA
    expect(fn('bp_resubmit_warning_enqueue')).toContain(
      'bp_resubmit_warning_recipients(v_tenant, n.ent_lead, n.dm)',
    );
  });

  it('★★★ no names in code: the fixed three live only in the seed', () => {
    const outsideSeed = sql.slice(0, sql.indexOf('INSERT INTO public.app_config'));
    for (const name of ['Dave', 'Brittani', 'Bobby']) {
      expect(outsideSeed).not.toContain(`'${name}'`);
      expect(outsideSeed).not.toContain(`"${name}"`);
      expect(repo('src/components/Settings/ResubmitWarningRecipientsEditor.tsx')
        .split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n')).not.toContain(name);
    }
  });
});

// ===========================================================================
// NO EXISTING ROWS CHANGED
// ===========================================================================

describe('fix-646: the migration writes one seed row and nothing else', () => {
  /** Top-level statements only: function bodies stripped. */
  const topLevel = sql.replace(/\$function\$[\s\S]*?\$function\$/g, '$function$$function$');

  it('★★★ the only data write is the recipients seed, inserted if absent', () => {
    const inserts = topLevel.match(/INSERT INTO [a-z_.]+/g) ?? [];
    expect(inserts).toEqual(['INSERT INTO public.app_config']);
    expect(topLevel).toContain(`'${RESUBMIT_WARNING_RECIPIENTS_KEY}', '["Dave","Brittani","Bobby"]'::jsonb`);
    expect(topLevel).toContain('ON CONFLICT (key) DO NOTHING;');
    expect(topLevel).not.toMatch(/\bUPDATE\s+public\./);
    expect(topLevel).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(topLevel).not.toMatch(/\bTRUNCATE\b/);
  });

  it('★★ the ledger is service-only', () => {
    expect(topLevel).toContain('ALTER TABLE public.resubmit_warnings ENABLE ROW LEVEL SECURITY;');
    expect(topLevel).toContain('REVOKE ALL ON TABLE public.resubmit_warnings FROM public, anon, authenticated;');
  });

  it('★★ one queue kind and one preference category, the others kept', () => {
    expect(topLevel).toContain(
      "CHECK (kind IN ('notify:mention', 'notify:assignment', 'notify:intake', 'notify:weekly',\n                  'notify:resubmit'))",
    );
    expect(topLevel).toContain("OR (kind = 'notify:resubmit' AND payload IS NOT NULL)");
    expect(topLevel).toContain("CHECK (category IN ('mention', 'assignment', 'weekly', 'resubmit'))");
  });

  it('★★ bp_notify_claim reads the new switch; every other branch is unchanged', () => {
    const f = fn('bp_notify_claim');
    expect(f).toContain("WHEN c.kind = 'notify:resubmit' THEN NOT public.bp_notify_enabled(c.recipient_user_id, 'resubmit')");
    expect(f).toContain("CASE WHEN c.kind = 'notify:intake' THEN false");
    expect(f).toContain("WHEN c.kind = 'notify:weekly' THEN NOT public.bp_notify_enabled(c.recipient_user_id, 'weekly')");
  });
});

// ===========================================================================
// THE WEEKLY UPDATE — bucket f beside d (d stays)
// ===========================================================================

describe('fix-646: the Weekly Update gains "Past resubmit-by"', () => {
  it('★★★ bucket f sits right after d, and d is kept', () => {
    const keys = SNAPSHOT_SECTIONS.map((s) => s.key);
    expect(keys).toEqual(['a', 'b', 'c', 'd', 'f', 'e']);
    expect(SNAPSHOT_SECTIONS.find((s) => s.key === 'f')).toEqual({
      key: 'f', title: 'Past resubmit-by', dateLabel: 'Resubmit by', ageLabel: 'Days past',
    });
    expect(SNAPSHOT_SECTIONS.find((s) => s.key === 'd')!.title).toBe('In corrections more than 7 days');
  });

  it('★★ twin: the email\'s section list is the same', () => {
    expect(WEEKLY_SECTIONS).toEqual(SNAPSHOT_SECTIONS);
  });

  it('★★★ the SQL bucket f reads THE rule — past and not parked', () => {
    const f = fn('bp_weekly_snapshot_for');
    expect(f).toMatch(/SELECT 'f', o\.permit_id, o\.project_id, o\.address, o\.num, o\.type, o\.ent_lead, o\.da,\s+o\.status, o\.resubmit_by, o\.days_past\s+FROM public\.bp_resubmit_rounds_for\(v_tenants, v_today\) o\s+WHERE o\.is_past AND NOT o\.parked/);
    // bucket d is still there, unchanged
    expect(f).toContain('AND x.corr_issued < v_today - 7');
  });
});

// ===========================================================================
// THE EMAIL
// ===========================================================================

const item = (over: Partial<ResubmitItem> = {}): ResubmitItem => ({
  permit_id: 42, project_id: 'proj-1', address: '10431 SE 19th St', num: '7113300-CN',
  type: 'Building Permit', cycle_index: 1, corr_issued: '2026-09-01', items: 14,
  business_days: 15, resubmit_by: '2026-09-22', days_past: 14, ent_lead: 'Miles', ...over,
});
const qrow = (items: ResubmitItem[], over: Partial<ClaimedRow> = {}): ClaimedRow => ({
  id: 'q-resubmit', kind: 'notify:resubmit', to_email: 'dave@x.test', recipient_user_id: 'u-dave',
  project_id: null, message_id: null, task_id: null, task_source: null, opted_out: false,
  actor_name: null, project_address: null, post_title: null, message_body: null,
  message_deleted: false, task_text: null, task_done: false, task_due: null,
  payload: { date: '2026-10-12', launch: false, items }, ...over,
});

describe('fix-646: the "Past resubmit-by" email', () => {
  it('★★★ subject: "Past resubmit-by · N permits"', () => {
    expect(resubmitSubject(29)).toBe('Past resubmit-by · 29 permits');
    expect(resubmitSubject(1)).toBe('Past resubmit-by · 1 permit');
    expect(renderResubmit(qrow([item(), item({ permit_id: 43 })])).subject)
      .toBe('Past resubmit-by · 2 permits');
  });

  it('★★★ each row: address (linked to the permit) · permit · round · date · days past · items · ENT', () => {
    const r = renderResubmit(qrow([item()]));
    expect(r.html).toContain('/project/proj-1?permit=42');
    expect(r.html).toContain('10431 SE 19th St');
    expect(r.html).toContain('7113300-CN · Building Permit');
    expect(r.html).toContain('CR1');
    expect(r.html).toContain('Sep 22');
    expect(r.html).toContain('14 days past');
    expect(r.html).toContain('14 items');
    expect(r.html).toContain('Miles');
    expect(r.text).toContain('10431 SE 19th St · 7113300-CN · Building Permit · CR1 · resubmit by Sep 22 · 14 days past · 14 items · ENT Miles');
    expect(r.text).toContain('Resubmit-by warnings');
  });

  it('★★ an unindexed letter says so', () => {
    expect(renderResubmit(qrow([item({ items: 0 })])).text).toContain('letter not indexed');
  });

  it('★★ the launch digest explains itself', () => {
    const r = renderResubmit(qrow([item()], { payload: { date: '2026-10-12', launch: true, items: [item()] } }));
    expect(r.text).toContain('This first email lists every round already past it');
    expect(renderResubmit(qrow([item()])).text).not.toContain('This first email');
  });

  it('★★ one email per row; empty or opted-out rows are skipped', async () => {
    expect(planEmails([qrow([item()]), qrow([item()], { id: 'q2' })])).toHaveLength(2);
    expect(skipReason(qrow([]))).toBe('nothing past');
    expect(skipReason(qrow([item()], { opted_out: true }))).toBe('recipient opted out');

    const outbox: OutboxRow[] = [];
    const sent: unknown[] = [];
    const deps: Deps = {
      sendMail: vi.fn(async (i) => { sent.push(i); return { ok: true as const, requestId: 'r1' }; }),
      recordOutbox: vi.fn(async (o: OutboxRow) => { outbox.push(o); return 'ob-1'; }),
      markQueue: vi.fn(async () => {}),
    };
    const s = await drain(deps, [qrow([item()])]);
    expect(s).toEqual({ emails: 1, sent: 1, failed: 0, skipped: 0 });
    expect(outbox[0]!.kind).toBe('notify:resubmit');
    expect(outbox[0]!.subject).toBe('Past resubmit-by · 1 permit');
  });
});

// ===========================================================================
// SETTINGS
// ===========================================================================

describe('fix-646: Settings', () => {
  it('★★★ a fourth email switch, "Resubmit-by warnings", absence = on', () => {
    expect([...NOTIFICATION_CATEGORIES]).toEqual(['mention', 'assignment', 'weekly', 'resubmit']);
    expect(NOTIFICATION_CATEGORY_COPY.resubmit.label).toBe('Resubmit-by warnings');
    expect(preferencesFromRows([]).resubmit).toBe(true);
    expect(preferencesFromRows([{ category: 'resubmit', enabled: false }]).resubmit).toBe(false);
  });

  it('★★ the recipients list is a Settings block, and its save toast has a word', () => {
    const b = SETTINGS_BLOCKS.find((x) => x.id === 'resubmit-warning');
    expect(b?.category).toBe('teams');
    expect(b?.title).toBe('Resubmit-by warning goes to');
    expect(APP_CONFIG_KEY_LABELS[RESUBMIT_WARNING_RECIPIENTS_KEY]).toBe('Resubmit-by warning recipients');
    expect(repo('src/components/Settings/AdminTeamTab.tsx')).toContain('<SettingsBlock id="resubmit-warning">');
  });
});
