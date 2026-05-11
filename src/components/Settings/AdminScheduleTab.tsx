import { useJurisdictions } from '../../hooks/useJurisdictions';
import { useUpsertJurisdiction } from '../../hooks/useUpsertJurisdiction';
import { useIsTenantAdmin } from '../../hooks/useIsTenantAdmin';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';

// Q7.3.d: Schedule tab — per-juris learning windows in a table view.
// Mirrors v1's renderLearnThresholdsAdmin (index.html 6732-6750).
// The same data is also editable inline on the Projects tab's
// Jurisdictions pill list (Q7.3.a) — this tab gives a cleaner table
// view for batch review when planning new juris onboarding.

const DEFAULT_WINDOW = 180;
const MIN_WINDOW = 30;
const MAX_WINDOW = 730;

export default function AdminScheduleTab() {
  const jurisQ = useJurisdictions();
  const upsert = useUpsertJurisdiction();
  const isAdmin = useIsTenantAdmin();

  if (jurisQ.error) {
    return (
      <QueryError
        title="Schedule failed to load"
        error={jurisQ.error}
        onRetry={() => jurisQ.refetch()}
      />
    );
  }
  if (jurisQ.isLoading) {
    return <SkeletonRows count={5} rowClassName="h-8" />;
  }

  const rows = jurisQ.data ?? [];

  return (
    <div className="space-y-3" data-testid="admin-schedule-tab">
      {!isAdmin && (
        <div className="bg-surface-2 border border-border rounded-lg px-4 py-2 text-xs text-muted">
          Read-only — you need tenant admin to edit learning windows.
        </div>
      )}
      <div className="bg-surface border border-border rounded-lg p-4">
        <h2 className="text-sm font-display font-bold text-text mb-1">
          Schedule Benchmarks — Learning Windows
        </h2>
        <p className="text-[11px] text-muted mb-3">
          How many days back to look for approved permits when building the
          learned-schedule baseline (Q7.2 Reports → Schedule Benchmarks). If no
          approved permits exist within the window, falls back to all-time data.
          Default {DEFAULT_WINDOW} days; range {MIN_WINDOW}–{MAX_WINDOW}.
        </p>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-dim border-b border-border">
              <th className="text-left py-1.5 font-display font-bold">
                Jurisdiction
              </th>
              <th className="text-right py-1.5 font-display font-bold pr-2">
                Window (days)
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={2} className="py-4 text-center text-dim italic">
                  No jurisdictions yet. Add some in Settings → Projects first.
                </td>
              </tr>
            )}
            {rows.map((j) => (
              <tr
                key={j.name}
                className="border-b border-border/40"
                data-testid={`schedule-row-${j.name}`}
              >
                <td className="py-1.5 text-text">{j.name}</td>
                <td className="py-1.5 text-right">
                  <input
                    type="number"
                    min={MIN_WINDOW}
                    max={MAX_WINDOW}
                    defaultValue={j.learn_window_days ?? DEFAULT_WINDOW}
                    disabled={!isAdmin}
                    onBlur={(e) => {
                      const n = Math.max(
                        MIN_WINDOW,
                        Math.min(
                          MAX_WINDOW,
                          parseInt(e.target.value, 10) || DEFAULT_WINDOW,
                        ),
                      );
                      if (n !== j.learn_window_days) {
                        upsert.mutate({
                          name: j.name,
                          learn_window_days: n,
                          notes: j.notes,
                        });
                        e.target.value = String(n);
                      }
                    }}
                    className="w-16 px-1 py-0.5 text-xs border border-border rounded bg-bg text-text text-center outline-none focus:border-de disabled:opacity-60"
                    data-testid={`schedule-window-${j.name}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
