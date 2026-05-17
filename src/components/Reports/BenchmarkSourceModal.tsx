import { Link } from 'react-router-dom';
import type { BenchmarkSourcePermit } from '../../lib/scheduleBenchmarks';

// Q9.5.f-fix-3 4.B: modal listing the permits that fed a benchmark card's
// learned averages. Each row shows address (project link), submitted /
// approval dates, cycle count, and the per-cycle CR/CO days that
// contributed to this combo's averages. Recent permits (within the
// learning window) get a green "recent" chip; older ones are silent.

interface Props {
  type: string;
  juris: string;
  sources: BenchmarkSourcePermit[];
  onClose: () => void;
}

export default function BenchmarkSourceModal({
  type,
  juris,
  sources,
  onClose,
}: Props) {
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          zIndex: 9998,
        }}
        data-testid="benchmark-source-backdrop"
      />
      <div
        role="dialog"
        aria-label={`${type} · ${juris} — source permits`}
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 9999,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-modal, 0 16px 48px rgba(0,0,0,.35))',
          width: 'min(92vw, 760px)',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        data-testid="benchmark-source-modal"
      >
        <header
          className="px-4 py-3 border-b flex items-center justify-between gap-3"
          style={{
            background: 'var(--color-s2)',
            borderBottomColor: 'var(--color-border)',
          }}
        >
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-sm font-display font-bold text-text">
              {type} · {juris}
            </span>
            <span className="text-[10px] text-dim">
              Source permits — fed the learned averages
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] font-display text-muted hover:text-text border border-border rounded-md px-3 py-1 cursor-pointer"
            data-testid="benchmark-source-close"
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto" data-testid="benchmark-source-body">
          {sources.length === 0 ? (
            <div className="text-[11px] text-dim italic px-4 py-6 text-center">
              No contributing permits — this combo has no approved/issued
              lifecycles yet.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {sources.map((s) => (
                <SourceRow key={s.permitId} source={s} />
              ))}
            </ul>
          )}
        </div>

        <footer
          className="px-4 py-2 border-t flex items-center justify-between"
          style={{ borderTopColor: 'var(--color-border)' }}
        >
          <span
            className="text-[10px] text-dim font-mono"
            data-testid="benchmark-source-count"
          >
            {sources.length} permit{sources.length === 1 ? '' : 's'} contributing
          </span>
          <span className="text-[10px] text-dim italic">
            Green chip = within learning window
          </span>
        </footer>
      </div>
    </>
  );
}

function SourceRow({ source }: { source: BenchmarkSourcePermit }) {
  return (
    <li className="px-4 py-2.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <Link
          to={`/project/${source.projectId}`}
          className="text-[12px] font-bold text-de underline truncate"
          data-testid={`benchmark-source-row-${source.permitId}`}
        >
          {source.address}
        </Link>
        {source.inRecentWindow && (
          <span
            className="text-[8px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0"
            style={{
              background: 'rgba(16,185,129,.1)',
              color: 'var(--color-pm)',
              borderColor: 'rgba(16,185,129,.3)',
            }}
          >
            ↑ RECENT
          </span>
        )}
        {source.num && (
          <span className="text-[10px] text-muted font-mono flex-shrink-0">
            {source.num}
          </span>
        )}
        <span className="text-[10px] text-dim font-mono ml-auto flex-shrink-0">
          {source.cycleCount} cycle{source.cycleCount === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex items-center gap-3 text-[10px] flex-wrap">
        <span className="text-dim">
          Submitted{' '}
          <span className="font-mono text-text">{source.submitted ?? '—'}</span>
        </span>
        <span className="text-dim">→</span>
        {/* fix-25-feat-U: raw c0.intake_accepted. Null when learner
            fell back to c0.submitted per fix-25-feat-g — title surfaces
            the reason on hover. Subtitle "+Nd" shows team↔city
            variance when both anchors are populated and intake > submit. */}
        <span
          className="text-dim"
          title={
            source.intakeAccepted === null
              ? 'Anchored on submission date (no intake_accepted recorded)'
              : undefined
          }
          data-testid={`benchmark-source-intake-${source.permitId}`}
        >
          Intake{' '}
          <span
            className={`font-mono ${
              source.intakeAccepted === null ? 'text-dim italic' : 'text-text'
            }`}
          >
            {source.intakeAccepted ?? '—'}
          </span>
          {(() => {
            if (!source.submitted || !source.intakeAccepted) return null;
            const subMs = new Date(`${source.submitted}T12:00:00Z`).getTime();
            const intMs = new Date(
              `${source.intakeAccepted}T12:00:00Z`,
            ).getTime();
            const days = Math.round((intMs - subMs) / 86400000);
            if (days <= 0) return null;
            return (
              <span
                className="ml-1 text-[9px] text-muted font-mono"
                data-testid={`benchmark-source-variance-${source.permitId}`}
                title="Days between team submission and city intake acceptance"
              >
                (+{days}d)
              </span>
            );
          })()}
        </span>
        <span className="text-dim">→</span>
        <span className="text-dim">
          Approved{' '}
          <span className="font-mono text-pm font-bold">
            {source.approval ?? '—'}
          </span>
        </span>
      </div>

      {source.cycles.length > 0 && (
        <div
          className="grid gap-1 text-[9px] mt-0.5 pl-3 border-l-2"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
            borderLeftColor: 'var(--color-border)',
          }}
        >
          {source.cycles.map((c) => (
            <div key={c.index} className="flex flex-col">
              <span className="text-dim uppercase tracking-wide">
                Cycle {c.index}
              </span>
              <span className="font-mono">
                <span
                  style={{
                    color: c.cr !== null ? 'var(--color-de)' : 'var(--color-dim)',
                  }}
                >
                  CR {c.cr !== null ? `${c.cr}d` : '—'}
                </span>
                {' · '}
                <span
                  style={{
                    color: c.co !== null ? 'var(--color-co)' : 'var(--color-dim)',
                  }}
                >
                  CO {c.co !== null ? `${c.co}d` : '—'}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
