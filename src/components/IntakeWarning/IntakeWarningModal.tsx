import { Link } from 'react-router-dom';
import OriginLink from '../OriginLink';
import { useIntakeWarning } from '../../hooks/useIntakeWarning';
import {
  INTAKE_TRACKER_PATH,
  dueLabel,
  shortDate,
  slotPermitLabel,
} from '../../lib/intakeWarning';

// ===========================================================================
// ★★★ fix-637 §B (P-180) — "SEATTLE INTAKES TO RESCHEDULE", OVER THE BRIDGE
// ===========================================================================
//
// Bobby: *"so Miles and Brianna know to reschedule them."* Mounted in the shell
// beside the Weekly Update modal, in its shape: a list, and one Close that
// dismisses it for TODAY only. The list is `bp_intake_warning_due` — the same
// rows the 7 AM email carries.
//
// ★ It sits one layer UNDER the Weekly Update (z 9490 vs 9500): on a Wednesday
//   the meeting reminder comes first, and this is waiting behind it.
// ★ Following a link closes it for the day too — the modal covers the screen,
//   so navigating underneath it would land you nowhere you could see.

export default function IntakeWarningModal() {
  const { day, rows, shouldShow, acknowledge } = useIntakeWarning();
  if (!shouldShow) return null;

  return (
    <div
      className="fixed inset-0 z-[9490] flex items-start justify-center pt-10 pb-10 px-4 bg-black/40 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Seattle intakes to reschedule"
      data-testid="intake-warning-modal"
    >
      <div
        className="w-full max-w-[760px] rounded-lg border shadow-lg"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <header
          className="px-4 py-2.5 border-b flex flex-wrap items-baseline gap-2 sticky top-0 rounded-t-lg"
          style={{ borderBottomColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <h1 className="text-[15px] font-display font-bold text-text">
            Seattle intakes to reschedule
          </h1>
          <span className="text-[11px] text-muted" data-testid="intake-warning-count">
            {rows.length} due · {shortDate(day)}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={acknowledge}
            className="text-[11px] px-2.5 py-1 rounded border font-bold"
            style={{ borderColor: 'var(--color-de)', color: 'var(--color-de)' }}
            data-testid="intake-warning-close"
          >
            Close
          </button>
        </header>

        <div className="p-4 flex flex-col gap-3">
          <p className="text-[12px] text-text">
            These intake slots are within 7 business days (weekends skipped), or
            past their date and still open. Reschedule, swap or release each one in
            the Intake Tracker.
          </p>

          <table className="w-full text-[12px]" data-testid="intake-warning-table">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-dim">
                <th className="py-1 pr-3 font-bold">Address</th>
                <th className="py-1 pr-3 font-bold">Permit</th>
                <th className="py-1 pr-3 font-bold">Intake</th>
                <th className="py-1 font-bold">Left</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.slot_id}
                  className="border-t"
                  style={{ borderTopColor: 'var(--color-border)' }}
                  data-testid={`intake-warning-row-${r.slot_id}`}
                >
                  <td className="py-1.5 pr-3 font-bold text-text">
                    {r.project_id ? (
                      // ★ fix-408: into a project through OriginLink, so its
                      //   Previous button can bring you back.
                      <OriginLink
                        to={`/project/${r.project_id}`}
                        onClick={acknowledge}
                        className="underline text-de"
                        data-testid={`intake-warning-project-${r.slot_id}`}
                      >
                        {r.address}
                      </OriginLink>
                    ) : (
                      r.address
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-text">{slotPermitLabel(r)}</td>
                  <td className="py-1.5 pr-3 text-text tabular-nums">{shortDate(r.intake_date)}</td>
                  <td
                    className="py-1.5 font-bold"
                    style={{ color: r.past_date ? 'var(--color-er)' : 'var(--color-co)' }}
                    data-testid={`intake-warning-left-${r.slot_id}`}
                  >
                    {dueLabel(r)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex items-center gap-3 pt-1">
            <Link
              to={INTAKE_TRACKER_PATH}
              onClick={acknowledge}
              className="text-[12px] font-bold rounded px-3 py-1.5 bg-de text-white hover:opacity-90"
              data-testid="intake-warning-open-tracker"
            >
              Open the Intake Tracker
            </Link>
            <span className="text-[10.5px] text-muted">
              Closing hides this until tomorrow. It comes back each business day
              while anything is due — and you get the same list by email at 7 AM.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
