import {
  useNotificationPreferences,
  useSetNotificationPreference,
} from '../../hooks/useNotificationPreferences';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_COPY,
} from '../../lib/notificationPreferences';

// ===========================================================================
// ★★ fix-634 (P-323) — Settings → My account → Email notifications
// ===========================================================================
//
// Three toggles (fix-642 added the Weekly Update), on by default. Emails come from bridge@ (not monitored).

export default function EmailNotificationsPanel() {
  const prefs = useNotificationPreferences();
  const setPref = useSetNotificationPreference();

  if (prefs.isLoading) {
    return <p className="text-xs text-muted">Loading…</p>;
  }
  if (prefs.error) {
    return (
      <p className="text-xs text-co" data-testid="email-notifications-error">
        Could not load your email settings: {prefs.error.message}
      </p>
    );
  }

  const current = prefs.data ?? { mention: true, assignment: true, weekly: true };

  return (
    <div className="space-y-3" data-testid="email-notifications">
      {NOTIFICATION_CATEGORIES.map((category) => {
        const copy = NOTIFICATION_CATEGORY_COPY[category];
        const on = current[category];
        return (
          <label
            key={category}
            className="flex items-start gap-2 text-xs cursor-pointer"
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={on}
              disabled={setPref.isPending}
              onChange={(e) => setPref.mutate({ category, enabled: e.target.checked })}
              data-testid={`email-notifications-${category}`}
            />
            <span>
              <span className="font-display font-semibold text-text">{copy.label}</span>
              <span className="block text-muted">{copy.help}</span>
            </span>
          </label>
        );
      })}
      <p className="text-[11px] text-dim">
        Sent from bridge@blueprintcap.com, which isn't monitored.
      </p>
    </div>
  );
}
