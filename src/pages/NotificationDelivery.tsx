import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNotificationDeliveryReport } from '../hooks/useNotificationDeliveryReport';
import {
  formatMinutes,
  gapItemHref,
  ofTotal,
  reportTotals,
  type DeliveryReportRow,
} from '../lib/notificationDelivery';

// ===========================================================================
// ★★★ fix-650 §D (P-203) — "Notification delivery", beside Error triage
// ===========================================================================
//
// Bobby: *"we need to know and ensure peoples notifications are reaching
// them."* One row per person, last 30 days, for the two kinds the server can
// check by itself (chat mentions and task assignments): how many were sent,
// how many reached the bell and how fast, how many were read and how fast,
// and the gaps — items that never reached the bell although the person was in
// the Bridge. A gap is also filed once in Error triage.
//
// ★ Admin only: the route is wrapped in AdminRoute and the RPC refuses
//   anybody else.

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function NotificationDeliveryPage() {
  const q = useNotificationDeliveryReport(30);
  const report = q.data;
  const rows = report?.rows ?? [];
  const totals = reportTotals(rows);

  return (
    <div className="space-y-3" data-testid="notification-delivery-page">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-base font-display font-extrabold text-text m-0">
            Notification delivery
          </h1>
          <p className="text-[11px] text-dim m-0 mt-0.5 max-w-[720px]">
            Did each chat mention and task assignment reach the person&apos;s bell,
            and when? A <strong>gap</strong> is one that never reached the bell even
            though the person was in the Bridge afterwards and has not read it — each
            gap is also filed once in Error triage. Time to bell includes time the
            person simply wasn&apos;t in the app.
          </p>
        </div>
        <Link
          to="/settings/errors"
          className="text-[11px] font-display font-semibold text-de hover:underline"
          data-testid="notification-delivery-to-triage"
        >
          ← Error triage
        </Link>
      </header>

      {q.isLoading ? (
        <div className="text-[11px] text-dim italic">Loading…</div>
      ) : q.isError ? (
        <div
          className="text-[11px] text-co italic py-4 text-center bg-surface border border-border rounded-lg"
          data-testid="notification-delivery-error"
        >
          Could not load the report.
        </div>
      ) : (
        <>
          <p className="text-[11px] text-muted m-0" data-testid="notification-delivery-window">
            {report?.delivery_epoch
              ? `Since ${fmtDate(report.from)} — ${ofTotal(totals.reached_bell, totals.notified)} reached the bell, ${ofTotal(totals.read, totals.notified)} read, ${totals.gaps} gap${totals.gaps === 1 ? '' : 's'}.`
              : 'Nothing recorded yet — receipts start the first time someone opens the Bridge on this version.'}
            {report?.delivery_epoch && report.from === report.delivery_epoch
              ? ' (Counting starts at the first receipt, not 30 days back.)'
              : ''}
          </p>
          {rows.length === 0 ? (
            <div
              className="text-[11px] text-dim italic py-4 text-center bg-surface border border-border rounded-lg"
              data-testid="notification-delivery-empty"
            >
              No notifications in this window.
            </div>
          ) : (
            <div className="overflow-x-auto bg-surface border border-border rounded-lg">
              <table className="w-full text-[11px]" data-testid="notification-delivery-table">
                <thead>
                  <tr className="text-left text-dim border-b border-border">
                    <th className="px-3 py-2 font-semibold">Person</th>
                    <th className="px-3 py-2 font-semibold text-right">Notified</th>
                    <th className="px-3 py-2 font-semibold text-right">Reached the bell</th>
                    <th className="px-3 py-2 font-semibold text-right">Median to bell</th>
                    <th className="px-3 py-2 font-semibold text-right">Read</th>
                    <th className="px-3 py-2 font-semibold text-right">Median to read</th>
                    <th className="px-3 py-2 font-semibold text-right">Gaps</th>
                    <th className="px-3 py-2 font-semibold">Last in the Bridge</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <PersonRow key={r.user_id} row={r} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PersonRow({ row }: { row: DeliveryReportRow }) {
  const [open, setOpen] = useState(false);
  return (
    <Fragment>
      <tr className="border-b border-border last:border-0" data-testid={`nd-row-${row.user_id}`}>
        <td className="px-3 py-1.5 text-text font-semibold">{row.person}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{row.notified}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">
          {ofTotal(row.reached_bell, row.notified)}
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums">
          {formatMinutes(row.median_bell_min)}
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums">{ofTotal(row.read, row.notified)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">
          {formatMinutes(row.median_read_min)}
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums">
          {row.gaps > 0 ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="font-semibold"
              style={{ color: 'var(--color-er)' }}
              data-testid={`nd-gaps-${row.user_id}`}
            >
              {row.gaps} {open ? '▴' : '▾'}
            </button>
          ) : (
            <span className="text-dim">0</span>
          )}
        </td>
        <td className="px-3 py-1.5 text-muted">{fmtDate(row.last_active_at)}</td>
      </tr>
      {open && row.gap_items.length > 0 && (
        <tr className="border-b border-border bg-s2" data-testid={`nd-gap-items-${row.user_id}`}>
          <td colSpan={8} className="px-3 py-2">
            <ul className="m-0 p-0 list-none flex flex-col gap-1">
              {row.gap_items.map((g) => {
                const href = gapItemHref(g);
                return (
                  <li key={g.id} className="flex items-baseline gap-2">
                    <span className="text-dim tabular-nums">{fmtDate(g.created_at)}</span>
                    <span className="text-text">
                      {g.kind === 'mention' ? 'Mention' : 'Task'}
                      {g.address ? ` · ${g.address}` : ''}
                    </span>
                    <span className="text-dim">· triage: {g.status}</span>
                    {href && (
                      <Link to={href} className="text-de hover:underline">
                        open
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
