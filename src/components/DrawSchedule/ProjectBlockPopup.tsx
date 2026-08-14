import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useUpdateDsRow } from '../../hooks/useUpdateDsRow';
import {
  addWeeksToWeekKey,
  dateToWeekKey,
} from '../../lib/drawScheduleHelpers';
import {
  DS_STATUS_LIST,
  DS_STATUS_COLORS,
  type DsStatus,
} from '../../lib/drawScheduleStatus';
import { pushToast } from '../../stores/toastStore';
import type { DrawScheduleRow, Permit } from '../../lib/database.types';

// Q9.5.g: project-block popup per v1 dsBlockClick at index.html:8571-8602.
// Three actions: pick status (sets manual_status=true), set duration in
// weeks (recomputes end_week from start_week), resync from BP dd_start/
// dd_end (clears manual_status). All three write via the shared
// useUpdateDsRow mutation.

// Mirrors v1's prefer-the-list export order so the popup pills are in the
// same vertical order users learned in v1.
const STATUS_ORDER: readonly DsStatus[] = DS_STATUS_LIST;

interface Props {
  row: DrawScheduleRow;
  address: string;
  /** Project permits — used by the "Resync from project dates" action to
   *  pull the Building Permit's dd_start/dd_end. */
  permits: Permit[];
  /** Stage-derived current status the block renders with (may differ from
   *  row.status when row.manual_status is true). Drives the ✓ pill. */
  displayedStatus: DsStatus;
  /** Auto-vs-manual badge text in the header. */
  isAutoDerived: boolean;
  /** fix-220: non-admins get a read-only popup — status pills, duration and
   *  resync (all draw_schedule writes) are hidden; the "Open Project" link
   *  and status readout remain so the block is still inspectable. */
  readOnly?: boolean;
  onClose: () => void;
}

export default function ProjectBlockPopup({
  row,
  address,
  permits,
  displayedStatus,
  isAutoDerived,
  readOnly = false,
  onClose,
}: Props) {
  const mutation = useUpdateDsRow();
  const shortAddr = address.split(',')[0];
  const startWk = row.start_week ?? '';
  const endWk = row.end_week ?? '';
  const durWeeks =
    startWk && endWk
      ? Math.max(
          1,
          Math.round(
            (new Date(`${endWk}T12:00:00Z`).getTime() -
              new Date(`${startWk}T12:00:00Z`).getTime()) /
              (7 * 86400000),
          ) + 1,
        )
      : 1;

  const [durationInput, setDurationInput] = useState<string>(String(durWeeks));

  async function handleStatusClick(s: DsStatus) {
    await mutation.mutateAsync({
      current: row,
      patch: { status: s, manual_status: true },
      fieldLabel: 'status',
    });
    onClose();
  }

  async function handleDurationSet() {
    const weeks = Math.max(1, Math.min(52, Number(durationInput) || 1));
    if (!startWk) {
      pushToast('No start week set — drag the block to place it first', 'warn');
      return;
    }
    const newEndWk = addWeeksToWeekKey(startWk, weeks - 1);
    await mutation.mutateAsync({
      current: row,
      patch: { end_week: newEndWk },
      fieldLabel: `duration (${weeks}w)`,
    });
    onClose();
  }

  async function handleResync() {
    const bp = permits.find((p) => p.type === 'Building Permit') ?? permits[0];
    if (!bp || !bp.dd_start) {
      pushToast(
        'No DD Start date on this project — set it in Project view first.',
        'warn',
      );
      return;
    }
    const startWeek = dateToWeekKey(new Date(`${bp.dd_start}T12:00:00`));
    const endWeek = bp.dd_end
      ? dateToWeekKey(new Date(`${bp.dd_end}T12:00:00`))
      : addWeeksToWeekKey(startWeek, 2);
    await mutation.mutateAsync({
      current: row,
      patch: {
        start_week: startWeek,
        end_week: endWeek,
        manual_status: false,
        manually_placed: true,
      },
      fieldLabel: 'resync from project dates',
    });
    onClose();
  }

  return (
    <>
      {/* Transparent backdrop — click outside to close, matches v1 :8576 */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9998,
          background: 'transparent',
        }}
        data-testid="ds-popup-backdrop"
      />
      <div
        role="dialog"
        aria-label="Project block status"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 9999,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          padding: 10,
          boxShadow: 'var(--shadow-popup, 0 8px 28px rgba(0,0,0,.25))',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          minWidth: 230,
        }}
        data-testid="ds-popup"
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 8,
            paddingBottom: 4,
            marginBottom: 4,
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--color-text)',
            }}
          >
            {shortAddr}
          </span>
          <span
            style={{
              fontSize: 8,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'var(--color-dim)',
            }}
            title={
              isAutoDerived
                ? 'Status auto-derived from current permit data'
                : 'Status set manually from this popup'
            }
          >
            {isAutoDerived ? 'auto' : 'manual'}
          </span>
        </div>

        {readOnly && (
          <div
            data-testid="ds-popup-view-only"
            style={{ fontSize: 11, color: 'var(--color-muted)', padding: '2px 2px 4px' }}
          >
            Status: <strong>{displayedStatus}</strong>
            <div style={{ fontSize: 9, color: 'var(--color-dim)', marginTop: 2 }}>
              👁 View only — draw-schedule editing is admin-only.
            </div>
          </div>
        )}

        {!readOnly &&
          STATUS_ORDER.map((s) => {
          const col = DS_STATUS_COLORS[s];
          const isCur = s === displayedStatus;
          return (
            <button
              key={s}
              type="button"
              onClick={() => void handleStatusClick(s)}
              disabled={mutation.isPending}
              style={{
                padding: '5px 10px',
                borderRadius: 6,
                border: `1px solid ${col.border}`,
                background: col.bg,
                color: col.text,
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: isCur ? 700 : 400,
                textAlign: 'left',
                opacity: mutation.isPending ? 0.5 : 1,
              }}
              data-testid={`ds-popup-status-${s.toLowerCase().replace(/\W+/g, '-')}`}
            >
              {isCur ? '✓ ' : '  '}
              {s}
            </button>
          );
          })}

        {!readOnly && (
        <div
          style={{
            borderTop: '1px solid var(--color-border)',
            marginTop: 4,
            paddingTop: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span style={{ fontSize: 10, color: 'var(--color-dim)' }}>
            Duration (wks):
          </span>
          <input
            type="number"
            min={1}
            max={52}
            value={durationInput}
            onChange={(e) => setDurationInput(e.target.value)}
            style={{
              width: 44,
              fontSize: 11,
              padding: '3px 6px',
              border: '1px solid var(--color-border)',
              borderRadius: 5,
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              textAlign: 'center',
              outline: 'none',
            }}
            data-testid="ds-popup-duration-input"
          />
          <button
            type="button"
            onClick={() => void handleDurationSet()}
            disabled={mutation.isPending}
            style={{
              padding: '3px 10px',
              borderRadius: 5,
              border: '1px solid var(--color-de-border)',
              background: 'var(--color-de-bg)',
              color: 'var(--color-de)',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              opacity: mutation.isPending ? 0.5 : 1,
            }}
            data-testid="ds-popup-duration-set"
          >
            Set
          </button>
        </div>
        )}

        <div
          style={{
            borderTop: '1px solid var(--color-border)',
            marginTop: 4,
            paddingTop: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <Link
            to={`/project/${row.project_id}`}
            onClick={onClose}
            style={{
              padding: '5px 10px',
              borderRadius: 6,
              border: '1px solid var(--color-border)',
              background: 'var(--color-s2)',
              color: 'var(--color-muted)',
              fontSize: 11,
              textDecoration: 'none',
            }}
            data-testid="ds-popup-open-project"
          >
            → Open Project
          </Link>
          {!readOnly && (
          <button
            type="button"
            onClick={() => void handleResync()}
            disabled={mutation.isPending}
            style={{
              width: '100%',
              padding: '5px 10px',
              borderRadius: 6,
              border: '1px solid var(--color-de-border)',
              background: 'var(--color-de-bg)',
              color: 'var(--color-de)',
              cursor: 'pointer',
              fontSize: 10,
              textAlign: 'left',
              opacity: mutation.isPending ? 0.5 : 1,
            }}
            data-testid="ds-popup-resync"
          >
            ↻ Resync from project dates
          </button>
          )}
        </div>
      </div>
    </>
  );
}
