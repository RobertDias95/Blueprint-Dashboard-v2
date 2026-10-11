// ===========================================================================
// ★★ fix-634 (P-323) — the email-notification categories
// ★★ fix-642 (P-017) — …and a third, the Weekly Update
// ===========================================================================
//
// ★★★ MUST AGREE WITH THE DATABASE: `notification_preferences_category_known`
//     (latest in migrations/fix_642_weekly_update_email.sql) allows exactly
//     these three. A test reads the migration and pins the list.

export type NotificationCategory = 'mention' | 'assignment' | 'weekly';

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  'mention',
  'assignment',
  'weekly',
];

export type NotificationPreferences = Record<NotificationCategory, boolean>;

/** What each toggle is called and the one line under it. */
export const NOTIFICATION_CATEGORY_COPY: Record<
  NotificationCategory,
  { label: string; help: string }
> = {
  mention: {
    label: 'Mentions',
    help: 'Email me when someone @-mentions me in a project chat.',
  },
  assignment: {
    label: 'Task assignments',
    help: 'Email me when someone assigns me a task.',
  },
  weekly: {
    label: 'Weekly Update',
    help: 'Email me the Weekly Update on Wednesday morning (agenda members only).',
  },
};

/**
 * ★★★ ABSENCE MEANS ON. Only an explicit `enabled = false` row turns a category
 *     off; an unknown category in the rows is ignored rather than trusted.
 */
export function preferencesFromRows(
  rows: readonly { category: string; enabled: boolean }[],
): NotificationPreferences {
  const out: NotificationPreferences = { mention: true, assignment: true, weekly: true };
  for (const r of rows) {
    if ((NOTIFICATION_CATEGORIES as readonly string[]).includes(r.category)) {
      out[r.category as NotificationCategory] = r.enabled !== false;
    }
  }
  return out;
}
