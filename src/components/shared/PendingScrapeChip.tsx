import type { Permit } from '../../lib/database.types';
import { readPendingScrapeChange } from '../../lib/pendingScrapeChange';

// fix-159: surfaces extras.pending_scrape_change — "the dashboard status may be
// stale because the scraper's manual-edit guard keeps blocking a known portal
// change". Strictly READ-ONLY; the scraper (part 2) writes and clears the key.

export default function PendingScrapeChip({
  extras,
  permitId,
}: {
  extras: Permit['extras'];
  permitId?: number;
}) {
  const pending = readPendingScrapeChange(extras);
  if (!pending) return null;

  const runs = pending.runs_skipped;
  const tooltip =
    `Portal shows "${pending.observed_status}"; dashboard shows ` +
    `"${pending.db_status || '—'}". The scraper's manual-edit guard has skipped ` +
    `this change` +
    (runs != null ? ` ${runs} run${runs === 1 ? '' : 's'}` : '') +
    (pending.first_seen ? ` since ${pending.first_seen}` : '') +
    `. A reconcile task verifies it.`;

  return (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded font-bold inline-flex items-center gap-0.5 flex-shrink-0"
      style={{
        background: 'var(--color-co-bg)',
        color: 'var(--color-co)',
        border: '1px solid var(--color-co-border)',
      }}
      title={tooltip}
      data-testid={
        permitId != null ? `pending-scrape-chip-${permitId}` : 'pending-scrape-chip'
      }
    >
      ⚠ Portal: {pending.observed_status}
    </span>
  );
}
