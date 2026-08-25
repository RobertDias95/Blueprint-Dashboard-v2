import { useMemo, useState } from 'react';
import OriginLink from '../OriginLink';
import { useCorrectionMissingWorklist } from '../../hooks/useCorrectionMissingWorklist';
import { SkeletonRows } from '../Skeleton';
import ExportCsvButton from '../shared/ExportCsvButton';
import { rowsToCsv, reportCsvFilename } from '../../lib/reportCsv';
import IndexerFreshness from './IndexerFreshness';
import {
  AGE_WINDOWS,
  DEFAULT_AGE_WINDOW_DAYS,
  windowCounts,
  windowSummary,
  withinWindow,
} from '../../lib/indexerRun';

// fix-279: the missing-letter worklist, as a view on the Corrections report
// rather than a separate report.
//
// WHY HERE. It is the same question turned around: every other view answers
// "what did the city tell us", this one answers "what did the city tell us that
// we cannot find". Behind its own route it would be a second thing to remember
// to open, and the fix-267 lesson in this repo is that a report nobody
// stumbles across is a report nobody reads. It carries no dependency on the
// correction_items filter bar — you cannot filter absent letters by their
// discipline — so it deliberately ignores those filters and says so.
//
// ★ "NO LETTER FOUND", NEVER "NOT FILED". The reconciliation cannot tell a
// letter that was never saved to the share from one saved under a filename the
// indexer's parser does not recognise. Telling someone their colleague failed
// to file a document that is sitting right there is the specific harm this
// wording exists to prevent, so it is repeated in the heading, the note and
// every row's own status column.

export default function CorrectionsMissingWorklist() {
  const q = useCorrectionMissingWorklist();
  const [jurisFilter, setJurisFilter] = useState('');
  const [hideParked, setHideParked] = useState(false);
  // *** fix-376 section 3: DEFAULT AWAY FROM THE BACKLOG, NEVER HIDE IT.
  //
  // Measured on the live view 2026-08-21, 152 rows across 70 projects:
  // 13 with no date at all, 13 within 30 days, 14 in 31-90, 78 in 91-365, and
  // 34 over a year - the oldest 1,424 days, nearly four years. A page that
  // opens showing all 152 is noise, and a list Gena stops opening is worth
  // nothing. See lib/indexerRun for why the default is 90 rather than 30.
  const [windowDays, setWindowDays] = useState<number | null>(DEFAULT_AGE_WINDOW_DAYS);

  const all = useMemo(() => q.data ?? [], [q.data]);
  const jurisdictions = useMemo(
    () =>
      [...new Set(all.map((r) => (r.juris ?? '').trim()).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [all],
  );
  // ** The age window is applied to the SAME population the counts describe, so
  // the summary line below cannot drift from the table above it.
  const inScope = useMemo(
    () =>
      all.filter((r) => {
        if (jurisFilter && (r.juris ?? '') !== jurisFilter) return false;
        if (hideParked && r.project_parked) return false;
        return true;
      }),
    [all, jurisFilter, hideParked],
  );
  const rows = useMemo(
    () => inScope.filter((r) => withinWindow(r, windowDays)),
    [inScope, windowDays],
  );
  const counts = useMemo(
    () => windowCounts(inScope, windowDays),
    [inScope, windowDays],
  );

  const projects = useMemo(
    () => new Set(rows.map((r) => r.project_id)).size,
    [rows],
  );

  if (q.error) {
    return (
      <div
        className="py-6 text-center text-dim italic text-xs"
        data-testid="missing-worklist-error"
      >
        The worklist could not be loaded.{' '}
        <button
          type="button"
          onClick={() => void q.refetch()}
          className="underline text-de not-italic font-bold"
          data-testid="missing-worklist-retry"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="corrections-missing-worklist">
      {/* *** fix-376: the run behind the list. The indexer needs the UNC share
          so it cannot run in CI - it runs when Bobby types the command - and
          without this a person reading "20 with no letter" cannot tell whether
          that was true an hour ago or nine days ago. */}
      <IndexerFreshness />

      <div
        className="text-[11px] text-muted bg-s2 border border-border rounded-md px-3 py-2"
        data-testid="missing-worklist-note"
      >
        <strong className="text-text">No letter found</strong> — for each of
        these, the tool records that the city issued corrections, and the indexer
        did not find a letter for it on the file server. That means one of two
        things and it{' '}
        <strong className="text-text">cannot tell which</strong>: the letter was
        never saved to the share, <em>or</em> it was saved under a filename the
        parser does not recognise.{' '}
        <strong className="text-text">Look before you ask anyone about it.</strong>
        <span className="block mt-1 text-dim">
          The filters above do not apply here — you cannot filter a letter that
          is missing by its discipline or its text.
        </span>
      </div>

      <div className="flex flex-wrap gap-3 items-end justify-between">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Jurisdiction
            </span>
            <select
              value={jurisFilter}
              onChange={(e) => setJurisFilter(e.target.value)}
              className="bg-bg border border-border rounded px-2 py-1 text-xs font-display text-text focus:outline-none focus:border-de"
              data-testid="missing-worklist-juris"
            >
              <option value="">All jurisdictions</option>
              {jurisdictions.map((j) => (
                <option key={j} value={j}>{j}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Issued within
            </span>
            <select
              value={windowDays == null ? 'all' : String(windowDays)}
              onChange={(e) =>
                setWindowDays(e.target.value === 'all' ? null : Number(e.target.value))
              }
              className="bg-bg border border-border rounded px-2 py-1 text-xs font-display text-text focus:outline-none focus:border-de"
              title="Rounds issued longer ago than this are a records question rather than this fortnight's work. Nothing is deleted - the total is always stated and All time is one click away."
              data-testid="missing-worklist-window"
            >
              {AGE_WINDOWS.map((w) => (
                <option key={w.label} value={w.days == null ? 'all' : String(w.days)}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-muted pb-1">
            <input
              type="checkbox"
              checked={hideParked}
              onChange={(e) => setHideParked(e.target.checked)}
              data-testid="missing-worklist-hide-parked"
            />
            Hide projects on hold
          </label>
        </div>
        {/* ** fix-376: THE WINDOW TRAVELS WITH THE FILE. The export is what is
            on screen, and a file called "no-letter-found" that silently held 40
            of 152 rows would be the same dishonesty the summary line above
            exists to prevent - only harder to spot, because a spreadsheet has
            no filter control on it. */}
        <ExportCsvButton
          filename={reportCsvFilename(
            windowDays == null
              ? 'corrections-no-letter-found-all-time'
              : `corrections-no-letter-found-last-${windowDays}-days`,
          )}
          onExport={() =>
            rowsToCsv(
              [
                { key: 'address', label: 'Project' },
                { key: 'juris', label: 'Jurisdiction' },
                { key: 'permit_num', label: 'Permit #' },
                { key: 'permit_type', label: 'Permit type' },
                { key: 'cycle', label: 'Cycle' },
                { key: 'disciplines_expected', label: 'Disciplines expected' },
                { key: 'corr_issued', label: 'Corrections issued' },
                { key: 'days_since_corr_issued', label: 'Days outstanding' },
                { key: 'project_parked', label: 'Project on hold' },
                { key: 'status_note', label: 'Status' },
              ],
              rows.map((r) => ({
                address: r.address,
                juris: r.juris ?? '',
                permit_num: r.permit_num ?? '',
                permit_type: r.permit_type ?? '',
                cycle: r.cycle,
                disciplines_expected: r.disciplines_expected ?? '',
                corr_issued: r.corr_issued ?? '',
                days_since_corr_issued: r.days_since_corr_issued ?? '',
                project_parked: r.project_parked ? 'yes' : 'no',
                // The wording travels with the file.
                status: r.status_note,
                status_note: r.status_note,
              })),
            )
          }
          disabled={rows.length === 0}
          testId="missing-worklist-export"
        />
      </div>

      {q.isLoading ? (
        <SkeletonRows count={6} rowClassName="h-8" />
      ) : rows.length === 0 ? (
        <div
          className="py-6 text-center text-dim italic text-xs"
          data-testid="missing-worklist-empty"
        >
          {counts.total === 0
            ? 'Every correction the tool knows about has a letter on file.'
            : `None issued in that window. ${counts.total} older ${counts.total === 1 ? 'round has' : 'rounds have'} no letter found — widen the window to see them.`}
        </div>
      ) : (
        <>
          <div className="text-[11px] text-muted" data-testid="missing-worklist-summary">
            <strong className="text-text text-[13px]">{rows.length}</strong>{' '}
            {rows.length === 1 ? 'correction' : 'corrections'} with no letter
            found, across{' '}
            <strong className="text-text text-[13px]">{projects}</strong>{' '}
            {projects === 1 ? 'project' : 'projects'}. Longest outstanding first.
            {/* *** THE TOTAL IS STATED WHATEVER IS FILTERED. A filtered list
                that looks complete is the fix-370 mistake repeated, and this is
                the sentence that prevents it - including the count of rows with
                no issue date, which are in EVERY window and would otherwise
                vanish behind a control labelled by age. */}
            <span className="block text-dim mt-0.5" data-testid="missing-worklist-window-summary">
              {windowSummary(counts, windowDays)}
              {counts.hidden > 0 && (
                <>
                  {' · '}
                  <button
                    type="button"
                    onClick={() => setWindowDays(null)}
                    className="underline text-de bg-transparent border-none p-0 font-bold"
                    data-testid="missing-worklist-show-all"
                  >
                    show all
                  </button>
                </>
              )}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[780px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-dim border-b border-border">
                  <th className="text-left py-1.5 font-display font-bold">Project</th>
                  <th className="text-left py-1.5 font-display font-bold">Permit</th>
                  <th className="text-center py-1.5 font-display font-bold">Cycle</th>
                  <th className="text-left py-1.5 font-display font-bold">
                    Disciplines expected
                  </th>
                  <th className="text-left py-1.5 font-display font-bold">
                    Corrections issued
                  </th>
                  <th className="text-right py-1.5 font-display font-bold">
                    Outstanding
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={`${r.permit_id}-${r.cycle}`}
                    className="border-b border-border/40"
                    data-testid={`missing-row-${r.permit_id}-${r.cycle}`}
                  >
                    <td className="py-1.5">
                      <OriginLink
                        to={`/project/${r.project_id}`}
                        className="text-de hover:underline"
                      >
                        {r.address}
                      </OriginLink>
                      <span className="text-dim"> · {r.juris ?? '—'}</span>
                      {r.project_parked && (
                        <span
                          className="ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border align-middle"
                          style={{
                            background: 'var(--color-hold-bg)',
                            color: 'var(--color-hold-text)',
                            borderColor: 'var(--color-hold-border)',
                          }}
                          title="This project is on hold — probably not worth chasing"
                          data-testid={`missing-parked-${r.permit_id}-${r.cycle}`}
                        >
                          on hold
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-muted font-mono">
                      {r.permit_num ?? '—'}
                      {r.permit_type && (
                        <span className="text-dim font-sans"> · {r.permit_type}</span>
                      )}
                    </td>
                    <td className="py-1.5 text-center text-muted">{r.cycle}</td>
                    <td className="py-1.5 text-muted">
                      {r.disciplines_expected ?? (
                        <span className="text-dim italic">not recorded</span>
                      )}
                    </td>
                    <td className="py-1.5 text-muted">{r.corr_issued ?? '—'}</td>
                    <td className="py-1.5 text-right">
                      {r.days_since_corr_issued == null ? (
                        <span className="text-dim">—</span>
                      ) : (
                        <span
                          className={
                            r.days_since_corr_issued >= 180
                              ? 'text-co font-semibold'
                              : 'text-text'
                          }
                        >
                          {r.days_since_corr_issued}d
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
