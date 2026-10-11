import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  INTAKE_TRACKER_PATH,
  INTAKE_WARNING_PAST_SINCE,
  INTAKE_WARNING_RECIPIENTS_KEY,
  INTAKE_WARNING_WINDOW_DAYS,
  businessDaysBetween,
  dueLabel,
  intakeWarningReadKey,
  isBusinessDay,
  isIntakeWarningDue,
  isIntakeWarningRecipient,
  pacificToday,
  shortDate,
  slotPermitLabel,
  type IntakeSlot,
  type IntakeSlotPermit,
} from '../lib/intakeWarning';
import { intakeIsAccepted } from '../lib/targetApproval';
import {
  BRIDGE_APP_ORIGIN,
  INTAKE_TRACKER_URL,
  drain,
  intakeDueLabel,
  intakePermitLabel,
  intakeSubject,
  planEmails,
  renderIntake,
  skipReason,
  type ClaimedRow,
  type Deps,
  type IntakeItem,
  type OutboxRow,
} from '../../supabase/functions/notify-send/handler';
import { APP_CONFIG_KEY_LABELS } from '../hooks/useSetAppConfigKey';
import { SETTINGS_BLOCKS } from '../lib/settingsBlocks';

// fix-637 (P-180) — Seattle intakes 7 business days out: a daily pop-up and a
// daily email until resolved.
//
// ★★ TESTED TWO WAYS (the fix-153 pattern — CI has no database):
//   · `bp_intake_warning_due` IS the rule (both deliveries read it). Its pure-TS
//     MIRROR is tested case by case below, and the migration's text is pinned
//     to contain each clause the mirror assumes.
//   · The SQL itself was run on prod (read-only functions, created and probed
//     in a ROLLED-BACK transaction before the migration) on the same cases —
//     results in the PR.

const repo = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
/** The migration with `--` comments removed, so a clause in a comment cannot pass. */
const sql = repo('migrations/fix_637_seattle_intake_warning.sql')
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');

const SEATTLE: IntakeSlotPermit = { intake_date: null, juris: 'Seattle' };
const slot = (intake_date: string, over: Partial<IntakeSlot> = {}): IntakeSlot => ({
  intake_date,
  permit_id: 1,
  is_placeholder: false,
  ...over,
});
const placeholder = (intake_date: string): IntakeSlot =>
  slot(intake_date, { permit_id: null, is_placeholder: true });

// Calendar, October 2026: Fri 9 · Sat 10 · Sun 11 · Mon 12 … Fri 16 · Mon 19
// · Tue 20 · Wed 21 · Thu 22.

// ===========================================================================
// §A — business days (weekends skipped)
// ===========================================================================

describe('fix-637 §A: business days skip weekends', () => {
  it('★ Friday → Monday is ONE business day', () => {
    expect(businessDaysBetween('2026-10-09', '2026-10-12')).toBe(1);
  });

  it('the same day is 0; a weekend day after Friday is 0', () => {
    expect(businessDaysBetween('2026-10-09', '2026-10-09')).toBe(0);
    expect(businessDaysBetween('2026-10-09', '2026-10-10')).toBe(0);
    expect(businessDaysBetween('2026-10-09', '2026-10-11')).toBe(0);
  });

  it('a full week is 5, and from a weekend counts from Monday', () => {
    expect(businessDaysBetween('2026-10-12', '2026-10-19')).toBe(5);
    expect(businessDaysBetween('2026-10-10', '2026-10-12')).toBe(1); // Sat → Mon
  });

  it('negative when the date is earlier', () => {
    expect(businessDaysBetween('2026-10-12', '2026-10-09')).toBe(-1);
    expect(businessDaysBetween('2026-10-19', '2026-10-12')).toBe(-5);
  });

  it('isBusinessDay is Monday–Friday', () => {
    expect(isBusinessDay('2026-10-09')).toBe(true);
    expect(isBusinessDay('2026-10-10')).toBe(false);
    expect(isBusinessDay('2026-10-11')).toBe(false);
    expect(isBusinessDay('2026-10-12')).toBe(true);
  });

  it('pacificToday reads Seattle, not the device: 06:30Z on the 12th is still the 11th', () => {
    expect(pacificToday(new Date('2026-10-12T06:30:00Z'))).toBe('2026-10-11');
    expect(pacificToday(new Date('2026-10-12T07:30:00Z'))).toBe('2026-10-12');
  });
});

// ===========================================================================
// §A — the rule
// ===========================================================================

describe('fix-637 §A: which slots are due', () => {
  const TODAY = '2026-10-12'; // Monday

  it('★★ day 7 is IN, day 8 is OUT (business days)', () => {
    expect(INTAKE_WARNING_WINDOW_DAYS).toBe(7);
    // Mon 12 + 7 business days = Wed 21; + 8 = Thu 22.
    expect(businessDaysBetween(TODAY, '2026-10-21')).toBe(7);
    expect(isIntakeWarningDue(slot('2026-10-21'), SEATTLE, TODAY)).toBe(true);
    expect(isIntakeWarningDue(slot('2026-10-22'), SEATTLE, TODAY)).toBe(false);
  });

  it('★★ from a Friday, the window reaches across the weekend (Fri → Tue week after)', () => {
    const FRI = '2026-10-09';
    // Fri 9 + 7 business days = Tue 20; Wed 21 is day 8.
    expect(isIntakeWarningDue(slot('2026-10-20'), SEATTLE, FRI)).toBe(true);
    expect(isIntakeWarningDue(slot('2026-10-21'), SEATTLE, FRI)).toBe(false);
    // Monday is day 1, not day 3.
    expect(businessDaysBetween(FRI, '2026-10-12')).toBe(1);
  });

  it('★ an ACCEPTED intake drops out (fix-513 date-only: the permit date has arrived)', () => {
    const permitAccepted: IntakeSlotPermit = { intake_date: '2026-10-01', juris: 'Seattle' };
    expect(intakeIsAccepted(permitAccepted, TODAY)).toBe(true);
    expect(isIntakeWarningDue(slot('2026-10-15'), permitAccepted, TODAY)).toBe(false);
  });

  it('★ a MOVED date drops out — the slot leaves the window', () => {
    expect(isIntakeWarningDue(slot('2026-10-15'), SEATTLE, TODAY)).toBe(true);
    expect(isIntakeWarningDue(slot('2026-12-01'), SEATTLE, TODAY)).toBe(false);
  });

  it('★ a PLACEHOLDER is included (no permit, nothing to accept)', () => {
    expect(isIntakeWarningDue(placeholder('2026-10-14'), null, TODAY)).toBe(true);
  });

  it('★★ a PAST date that is still unresolved stays due ("Past date")', () => {
    expect(isIntakeWarningDue(placeholder('2026-10-13'), null, '2026-10-15')).toBe(true);
    expect(dueLabel({ past_date: true, business_days_left: -2 })).toBe('Past date');
  });

  it('★★★ …from go-live on: the pre-existing backlog of dead past slots is NOT listed', () => {
    expect(INTAKE_WARNING_PAST_SINCE).toBe('2026-10-12');
    expect(isIntakeWarningDue(placeholder('2026-01-04'), null, TODAY)).toBe(false);
    expect(isIntakeWarningDue(placeholder('2026-10-09'), null, TODAY)).toBe(false);
    expect(isIntakeWarningDue(placeholder('2026-10-12'), null, '2026-10-13')).toBe(true);
  });

  it('a permit-linked slot leaves on its intake day — date-only accepted', () => {
    const p: IntakeSlotPermit = { intake_date: TODAY, juris: 'Seattle' };
    expect(isIntakeWarningDue(slot(TODAY), p, TODAY)).toBe(false);
    // …but a placeholder on today is still due.
    expect(isIntakeWarningDue(placeholder(TODAY), null, TODAY)).toBe(true);
  });

  it('a non-Seattle permit is never due; a slot with no date is never due', () => {
    expect(isIntakeWarningDue(slot('2026-10-14'), { intake_date: null, juris: 'Kirkland' }, TODAY)).toBe(false);
    expect(isIntakeWarningDue({ intake_date: null, permit_id: null }, null, TODAY)).toBe(false);
  });
});

describe('fix-637: display helpers', () => {
  it('permit label: Placeholder, or number · type', () => {
    expect(slotPermitLabel({ is_placeholder: true, permit_num: '6358597-CN', permit_type: 'Building Permit' })).toBe('Placeholder');
    expect(slotPermitLabel({ is_placeholder: false, permit_num: '7150289-CN', permit_type: 'Building Permit' })).toBe('7150289-CN · Building Permit');
    expect(slotPermitLabel({ is_placeholder: false, permit_num: null, permit_type: null })).toBe('No permit linked');
  });

  it('left label', () => {
    expect(dueLabel({ past_date: false, business_days_left: 0 })).toBe('Today');
    expect(dueLabel({ past_date: false, business_days_left: 1 })).toBe('1 business day left');
    expect(dueLabel({ past_date: false, business_days_left: 6 })).toBe('6 business days left');
  });

  it('M/D/YYYY dates and the exact read key', () => {
    expect(shortDate('2026-10-05')).toBe('10/5/2026');
    expect(intakeWarningReadKey('2026-10-12')).toBe('intake-warning:2026-10-12');
  });

  it('recipient match is by roster name, case-insensitive', () => {
    expect(isIntakeWarningRecipient(['Miles', 'Briana'], 'briana')).toBe(true);
    expect(isIntakeWarningRecipient(['Miles', 'Briana'], 'Bobby')).toBe(false);
    expect(isIntakeWarningRecipient(['Miles'], null)).toBe(false);
  });
});

// ===========================================================================
// The SQL twin — every clause the mirror assumes is in the migration
// ===========================================================================

describe('fix-637: the SQL is the rule, and says what the mirror says', () => {
  it('★★★ accepted = fix-513 date-only, as a one-line twin', () => {
    expect(sql).toContain('SELECT p_intake_date IS NOT NULL AND p_intake_date <= p_today;');
    expect(sql).toContain('NOT public.bp_intake_is_accepted(p.intake_date, k.today)');
  });

  it('weekends skipped: the weekdays in (from, to]', () => {
    expect(sql).toContain('generate_series(p_from + 1, p_to, interval');
    expect(sql).toContain('WHERE extract(isodow FROM d) < 6');
  });

  it('★ the window and the go-live gate are the same numbers as the mirror', () => {
    expect(sql).toContain(`DATE '${INTAKE_WARNING_PAST_SINCE}' AS past_since`);
    expect(sql).toContain(`${INTAKE_WARNING_WINDOW_DAYS} AS window_days`);
    expect(sql).toContain('<= k.window_days');
    expect(sql).toContain('ir.intake_date >= k.past_since');
  });

  it('a Seattle slot: no permit, or a permit in a Seattle project', () => {
    expect(sql).toContain("AND (ir.permit_id IS NULL OR pj.juris = 'Seattle')");
  });

  it('Pacific clock, both in the rule and in the 7 AM gate', () => {
    expect(sql).toContain("SELECT (now() AT TIME ZONE 'America/Los_Angeles')::date;");
    expect(sql).toContain('IF extract(isodow FROM v_local) >= 6 THEN RETURN 0; END IF;');
    expect(sql).toContain('IF extract(hour FROM v_local) < 7 THEN RETURN 0; END IF;');
    expect(sql).toContain("'0 14,15 * * 1-5'");
  });

  it('★★ one email per person per day (dedupe), and only when something is due', () => {
    expect(sql).toContain("'notify:intake:' || lower(btrim(r.email)) || ':' || v_today::text");
    expect(sql).toContain('IF jsonb_array_length(v_items) = 0 THEN CONTINUE; END IF;');
  });

  it('★★ a work alert: the email toggles do not apply to it', () => {
    expect(sql).toContain("CASE WHEN c.kind = 'notify:intake' THEN false");
    // The enqueue never consults notification_preferences.
    const enqueue = sql.slice(sql.indexOf('FUNCTION public.bp_intake_warning_enqueue'), sql.indexOf('DROP FUNCTION IF EXISTS public.bp_notify_claim'));
    expect(enqueue).not.toContain('bp_notify_enabled');
  });

  it('recipients: the Settings key, resolved by fix-634’s one-person-or-nobody helper', () => {
    expect(sql).toContain(`c.key = '${INTAKE_WARNING_RECIPIENTS_KEY}'`);
    expect(sql).toContain('public.bp_notify_person_for_name(p_tenant, v_name)');
  });

  it('★★★ the ONE data write is the seed, with its tenant, only if absent', () => {
    const inserts = sql.match(/INSERT INTO public\.\w+/g) ?? [];
    expect(inserts).toEqual([
      'INSERT INTO public.notification_email_queue',
      'INSERT INTO public.app_config',
    ]);
    expect(sql).toContain(`SELECT tm.tenant_id, '${INTAKE_WARNING_RECIPIENTS_KEY}', '["Miles","Briana"]'::jsonb`);
    expect(sql).toContain('ON CONFLICT (key) DO NOTHING;');
    expect(sql).not.toMatch(/\bUPDATE public\.(?!notification_email_queue)/);
    expect(sql).not.toMatch(/\bDELETE FROM\b/);
  });

  it('grants: the rule is readable by signed-in users; queueing is not', () => {
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.bp_intake_warning_due(date, uuid) TO authenticated, service_role;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bp_intake_warning_enqueue(boolean) FROM public, anon, authenticated;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bp_intake_warning_recipients(uuid) FROM public, anon, authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.bp_notify_claim(integer) TO service_role;');
  });

  it('the email links to the same tracker path the pop-up does', () => {
    expect(INTAKE_TRACKER_URL).toBe(`${BRIDGE_APP_ORIGIN}${INTAKE_TRACKER_PATH}`);
  });
});

// ===========================================================================
// §C — the email
// ===========================================================================

const ITEMS: IntakeItem[] = [
  { slot_id: 1, project_id: 'proj-1', address: '6605 57th Ave NE', permit_num: '7150289-CN', permit_type: 'Building Permit', is_placeholder: false, intake_date: '2026-10-15', business_days_left: 3, past_date: false },
  { slot_id: 2, project_id: null, address: 'OPEN', permit_num: '6358597-CN', permit_type: 'Building Permit', is_placeholder: true, intake_date: '2026-10-13', business_days_left: -1, past_date: true },
];

function intakeRow(items: IntakeItem[] = ITEMS, over: Partial<ClaimedRow> = {}): ClaimedRow {
  return {
    id: 'q-intake', kind: 'notify:intake', to_email: 'miles@x.com', recipient_user_id: 'u-miles',
    project_id: null, message_id: null, task_id: null, task_source: null, opted_out: false,
    actor_name: null, project_address: null, post_title: null, message_body: null,
    message_deleted: false, task_text: null, task_done: false, task_due: null,
    payload: { date: '2026-10-14', items },
    ...over,
  };
}

function fakeDeps() {
  const outbox: OutboxRow[] = [];
  const sent: Parameters<Deps['sendMail']>[0][] = [];
  const marks: { ids: string[]; outcome: string; note: string | null }[] = [];
  const deps: Deps = {
    sendMail: vi.fn(async (input) => { sent.push(input); return { ok: true as const, requestId: 'r1' }; }),
    recordOutbox: vi.fn(async (r: OutboxRow) => { outbox.push(r); return `ob-${outbox.length}`; }),
    markQueue: vi.fn(async (ids, outcome, _o, note) => { marks.push({ ids, outcome, note }); }),
  };
  return { deps, outbox, sent, marks };
}

describe('fix-637 §C: the daily email', () => {
  it('★★★ subject: "Seattle intakes to reschedule · N due"', () => {
    expect(intakeSubject(2)).toBe('Seattle intakes to reschedule · 2 due');
    expect(renderIntake(intakeRow()).subject).toBe('Seattle intakes to reschedule · 2 due');
  });

  it('★ lists each slot: address, permit or Placeholder, date, days left or Past date', () => {
    const r = renderIntake(intakeRow());
    for (const s of ['6605 57th Ave NE', '7150289-CN · Building Permit', '10/15/2026', '3 business days left', 'Placeholder', '10/13/2026', 'Past date']) {
      expect(r.text).toContain(s);
      expect(r.html).toContain(s);
    }
    expect(intakePermitLabel(ITEMS[1]!)).toBe('Placeholder');
    expect(intakeDueLabel(ITEMS[0]!)).toBe('3 business days left');
  });

  it('★ "Open in the Bridge" goes to the Intake Tracker; a project row links to its project', () => {
    const r = renderIntake(intakeRow());
    expect(r.html).toContain('Open in the Bridge');
    expect(r.html).toContain(INTAKE_TRACKER_URL);
    expect(r.html).toContain(`${BRIDGE_APP_ORIGIN}/project/proj-1`);
    expect(r.text).toContain(`Open in the Bridge: ${INTAKE_TRACKER_URL}`);
  });

  it('★★ says it is a work alert, not one of the mention/assignment switches', () => {
    const r = renderIntake(intakeRow());
    expect(r.text).toContain('Seattle intake warning list');
    expect(r.text).toContain('not affected by the mention/assignment email switches');
    expect(r.text).not.toContain('Turn these emails off');
  });

  it('★★★ one send → one email_outbox row, kind notify:intake; the queue row is marked sent', async () => {
    const { deps, outbox, sent, marks } = fakeDeps();
    const s = await drain(deps, [intakeRow()]);
    expect(s).toEqual({ emails: 1, sent: 1, failed: 0, skipped: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('miles@x.com');
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ kind: 'notify:intake', status: 'sent', subject: 'Seattle intakes to reschedule · 2 due' });
    expect(marks).toEqual([{ ids: ['q-intake'], outcome: 'sent', note: null }]);
  });

  it('two recipients → two emails (never merged like an assignment burst)', () => {
    const plan = planEmails([intakeRow(), intakeRow(ITEMS, { id: 'q2', to_email: 'briana@x.com' })]);
    expect(plan.map((g) => g.map((r) => r.id))).toEqual([['q-intake'], ['q2']]);
  });

  it('an empty payload is skipped, never sent', () => {
    expect(skipReason(intakeRow([]))).toBe('nothing due');
  });
});

describe('fix-637: Settings', () => {
  it('the recipients block exists under Teams, with a save-toast word', () => {
    const b = SETTINGS_BLOCKS.find((x) => x.id === 'seattle-intake-warning');
    expect(b?.category).toBe('teams');
    expect(b?.title).toBe('Seattle intake warning goes to');
    expect(APP_CONFIG_KEY_LABELS[INTAKE_WARNING_RECIPIENTS_KEY]).toBeTruthy();
  });
});
