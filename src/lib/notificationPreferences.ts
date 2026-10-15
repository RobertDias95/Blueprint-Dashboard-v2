// ===========================================================================
// ★★ fix-634 (P-323) — the email-notification categories
// ★★ fix-642 (P-017) — …and a third, the Weekly Update
// ★★ fix-646 (P-011) — …and a fourth, the Resubmit-by warnings
// ★★★ fix-648 (P-339) — mentions and assignments are OPT-IN
// ===========================================================================
//
// ★★★ MUST AGREE WITH THE DATABASE: `notification_preferences_category_known`
//     (latest in migrations/fix_646_smart_resubmit_by.sql) allows exactly
//     these four. A test reads the migration and pins the list.

export type NotificationCategory = 'mention' | 'assignment' | 'weekly' | 'resubmit';

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  'mention',
  'assignment',
  'weekly',
  'resubmit',
];

export type NotificationPreferences = Record<NotificationCategory, boolean>;

/**
 * ★★★ fix-648 (P-339): OFF UNLESS A ROW SAYS `enabled = true`.
 *     Bobby, 2026-10-15: "email settings should be off by standard … the weekly
 *     updates and resubmit emails should keep coming, i am more talking about
 *     mentions and task assignments." So these two are opt-in and the other two
 *     stay opt-out. MUST AGREE WITH `bp_notify_enabled`
 *     (migrations/fix_648_email_opt_in.sql) — a test pins both lists.
 */
export const OPT_IN_CATEGORIES: readonly NotificationCategory[] = ['mention', 'assignment'];

export function isOptIn(category: NotificationCategory): boolean {
  return OPT_IN_CATEGORIES.includes(category);
}

/**
 * ★★ The TS twin of `bp_notify_enabled(user, category)` over one person's rows:
 *    an opt-in category is on only with an `enabled = true` row; an opt-out
 *    category is on unless a row says `enabled = false`.
 */
export function emailEnabled(
  rows: readonly { category: string; enabled: boolean }[],
  category: NotificationCategory,
): boolean {
  const row = rows.find((r) => r.category === category);
  return isOptIn(category) ? row?.enabled === true : row?.enabled !== false;
}

/** What a person with no rows at all gets. */
export const DEFAULT_PREFERENCES: NotificationPreferences = {
  mention: false,
  assignment: false,
  weekly: true,
  resubmit: true,
};

/** What each toggle is called and the one line under it. */
export const NOTIFICATION_CATEGORY_COPY: Record<
  NotificationCategory,
  { label: string; help: string }
> = {
  mention: {
    label: 'Mentions',
    help: 'Email me when someone @-mentions me in a project chat. Off unless you turn it on.',
  },
  assignment: {
    label: 'Task assignments',
    help: 'Email me when someone assigns me a task. Off unless you turn it on.',
  },
  weekly: {
    label: 'Weekly Update',
    help: 'Email me the Weekly Update on Wednesday morning (agenda members only).',
  },
  resubmit: {
    label: 'Resubmit-by warnings',
    help: 'Email me at 7 AM when a correction round I lead (ENT or DM) passes its Resubmit-by date.',
  },
};

/**
 * ★★★ fix-648: ABSENCE MEANS OFF for mentions and assignments, ON for the
 *     Weekly Update and Resubmit-by warnings (see `emailEnabled`). An unknown
 *     category in the rows is ignored rather than trusted.
 */
export function preferencesFromRows(
  rows: readonly { category: string; enabled: boolean }[],
): NotificationPreferences {
  const out = { ...DEFAULT_PREFERENCES };
  for (const c of NOTIFICATION_CATEGORIES) out[c] = emailEnabled(rows, c);
  return out;
}
