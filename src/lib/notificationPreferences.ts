// ===========================================================================
// ★★ fix-634 (P-323) — the two email-notification categories
// ===========================================================================
//
// ★★★ MUST AGREE WITH THE DATABASE: `notification_preferences_category_known`
//     in migrations/fix_634_mention_assignment_emails.sql allows exactly these
//     two. A test reads the migration and pins the pair.

export type NotificationCategory = 'mention' | 'assignment';

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  'mention',
  'assignment',
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
};

/**
 * ★★★ ABSENCE MEANS ON. Only an explicit `enabled = false` row turns a category
 *     off; an unknown category in the rows is ignored rather than trusted.
 */
export function preferencesFromRows(
  rows: readonly { category: string; enabled: boolean }[],
): NotificationPreferences {
  const out: NotificationPreferences = { mention: true, assignment: true };
  for (const r of rows) {
    if ((NOTIFICATION_CATEGORIES as readonly string[]).includes(r.category)) {
      out[r.category as NotificationCategory] = r.enabled !== false;
    }
  }
  return out;
}
