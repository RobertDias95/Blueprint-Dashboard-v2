import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  useCorrectionClusterDisciplines,
  useCorrectionClusterRanking,
} from '../../hooks/useCorrectionClusters';
import { useAllCorrectionItems } from '../../hooks/useAllCorrectionItems';
import { clusterName, isSingleProject } from '../../lib/correctionClusters';
import {
  breakdownSummary,
  clusterDiscipline,
  groupByDiscipline,
  NOT_RECORDED,
  SEVERAL,
  type ClusterDiscipline,
} from '../../lib/correctionDisciplines';
import {
  likelySameReviewer,
  reviewerCount,
  reviewerDisciplineOutliers,
} from '../../lib/correctionReviewers';

// ===========================================================================
// ★★★ fix-374 — what the corrections report greets you with
// ===========================================================================
//
// Bobby: *"can we make this drill down more relevant on the main screen? seems
// complicated to find… I have to go by theme/discipline to get the drill down
// option."*
//
// ★★★ ONE CLICK. This is the landing view, every row is a door, and the door
// opens THAT pattern on the patterns page (`?open=<cluster_key>`) rather than
// dropping you at the top of a list to find it again.
//
// ★★ It is not a second page. `/reports/corrections/patterns` is still the
// destination and still owns levels two and three; this is the greeting.

/** Enough to be a ranked list, short enough to read without scrolling. */
const TOP_N = 12;

export default function RecurringCorrections() {
  // Ranked across every jurisdiction: the landing view answers "what keeps
  // coming back", and slicing that by juris is what the patterns page is for.
  const rankingQ = useCorrectionClusterRanking(null, 'subject', false);
  const disciplineQ = useCorrectionClusterDisciplines(null, 'subject');
  const itemsQ = useAllCorrectionItems();

  const disciplineByKey = useMemo(() => {
    const byKey = new Map<string, Array<{ discipline: string; items: number }>>();
    for (const row of disciplineQ.data ?? []) {
      const bucket = byKey.get(row.cluster_key) ?? [];
      bucket.push({ discipline: row.discipline, items: row.items });
      byKey.set(row.cluster_key, bucket);
    }
    const out = new Map<string, ClusterDiscipline>();
    for (const [key, slices] of byKey) out.set(key, clusterDiscipline(slices));
    return out;
  }, [disciplineQ.data]);

  const top = useMemo(
    () => (rankingQ.data ?? []).filter((c) => !c.hidden).slice(0, TOP_N),
    [rankingQ.data],
  );

  // ★★★ Grouped by the discipline the comments are ABOUT, not by the city's
  // subject line. All 476 `General` items carry a discipline; it was simply
  // never the thing organising the view.
  const groups = useMemo(
    () => groupByDiscipline(top, (c) =>
      disciplineByKey.get(c.cluster_key)?.label ?? NOT_RECORDED),
    [top, disciplineByKey],
  );

  const items = useMemo(() => itemsQ.data ?? [], [itemsQ.data]);
  const reviewers = useMemo(() => reviewerCount(items), [items]);
  const duplicates = useMemo(() => likelySameReviewer(items).slice(0, 3), [items]);
  const outliers = useMemo(() => reviewerDisciplineOutliers(items).slice(0, 5), [items]);

  return (
    <div className="space-y-3" data-testid="recurring-corrections">
      <p className="text-[11px] text-muted max-w-3xl">
        The corrections we get again and again, ranked by how many projects they
        hit. Open one to see every project it landed on and exactly what the city
        wrote.
      </p>

      {rankingQ.isLoading ? (
        <div className="text-[11px] text-muted" data-testid="recurring-loading">
          Loading…
        </div>
      ) : top.length === 0 ? (
        <div
          className="rounded-lg border border-border bg-surface px-4 py-8 text-center"
          data-testid="recurring-empty"
        >
          <div className="text-xs text-muted mb-2">
            The recurring corrections are built from the indexed letters, and
            have not been built yet.
          </div>
          <Link
            to="/reports/corrections/patterns"
            className="text-[11px] font-bold text-de hover:underline no-underline"
            data-testid="recurring-build-link"
          >
            Build them →
          </Link>
        </div>
      ) : (
        <div className="space-y-3" data-testid="recurring-list">
          {groups.map((group) => (
            <div key={group.discipline}>
              <div
                className="flex items-baseline gap-2 px-1 pb-1"
                data-testid={`recurring-group-${group.discipline}`}
              >
                <h2 className="text-[11px] font-display font-bold text-text">
                  {group.discipline}
                </h2>
                {group.discipline === SEVERAL && (
                  <span className="text-[10px] text-muted">
                    — no one discipline owns these
                  </span>
                )}
              </div>
              <div className="rounded-md border border-border overflow-hidden">
                {group.rows.map((c) => {
                  const d = disciplineByKey.get(c.cluster_key) ?? null;
                  return (
                    <Link
                      key={c.cluster_key}
                      to={`/reports/corrections/patterns?open=${encodeURIComponent(c.cluster_key)}`}
                      className="flex items-baseline gap-2 flex-wrap px-3 py-2 border-b border-border last:border-b-0 hover:bg-s2 transition no-underline"
                      data-testid={`recurring-row-${c.cluster_key}`}
                    >
                      <span className="text-[12px] font-bold text-text">
                        {clusterName(c)}
                      </span>
                      {d && d.mixed && (
                        <span
                          className="text-[9px] px-1 rounded bg-s2 text-muted"
                          data-testid={`recurring-discipline-${c.cluster_key}`}
                        >
                          {breakdownSummary(d)}
                        </span>
                      )}
                      {isSingleProject(c) && (
                        <span className="text-[9px] px-1 rounded bg-s2 text-dim">
                          one project
                        </span>
                      )}
                      <span className="ml-auto text-[12px] font-extrabold text-de tabular-nums">
                        {c.project_share}%
                      </span>
                      <span className="text-[10.5px] text-muted tabular-nums w-20 text-right">
                        {c.project_count} project{c.project_count === 1 ? '' : 's'}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
          <Link
            to="/reports/corrections/patterns"
            className="inline-block text-[11px] font-bold text-de hover:underline no-underline"
            data-testid="recurring-see-all"
          >
            See all recurring corrections, and rename or merge them →
          </Link>
        </div>
      )}

      {/* ★★★ fix-374 · §5 — THE REVIEWER COUNT IS NOT A FACT, AND SAYS SO. */}
      {reviewers.distinct > 0 && (
        <div
          className="rounded-md border border-border bg-surface px-3 py-2 space-y-1"
          data-testid="reviewer-caveat"
        >
          <div className="text-[11px] text-text">
            <span className="font-bold">
              At most {reviewers.distinct} reviewers
            </span>{' '}
            <span className="text-muted">
              — the real number is smaller, and this page cannot tell you how
              much smaller.
            </span>
          </div>
          <div className="text-[10.5px] text-muted">
            {reviewers.suspect > 0 && (
              <>
                {reviewers.suspect} of them are body text the letter parser
                mistook for a name ({reviewers.suspectItems} comments)
                {duplicates.length > 0 ? '; ' : '. '}
              </>
            )}
            {duplicates.length > 0 && (
              <>
                and one person can appear under several spellings — e.g.{' '}
                {duplicates[0].values.slice(0, 2).map((v) => `“${v}”`).join(' and ')}
                . {' '}
              </>
            )}
            Both are parser defects and are being fixed upstream (fix-375); no
            count here is corrected for them.
          </div>
          {reviewers.noReviewer > 0 && (
            <div className="text-[10.5px] text-dim" data-testid="reviewer-none">
              {reviewers.noReviewer} comments carry no reviewer at all. They are
              counted in every total on this page and are absent only from
              per-reviewer views.
            </div>
          )}
        </div>
      )}

      {/* ★★ fix-374 · §4 — REVIEWER → DISCIPLINE, AS A FLAG AND NOTHING MORE. */}
      {outliers.length > 0 && (
        <div
          className="rounded-md border border-border bg-surface px-3 py-2"
          data-testid="reviewer-outliers"
        >
          <div className="text-[11px] font-bold text-text mb-0.5">
            Reviewers whose comments mostly sit in one discipline, with a few
            that do not
          </div>
          <div className="text-[10.5px] text-muted mb-1.5">
            Worth a look, not a correction: the odd ones are either a mis-parse
            or a different person of the same name. Nothing here changes the
            discipline on any comment — that column is recorded by the city and
            is already right.
          </div>
          <ul className="space-y-0.5">
            {outliers.map((o) => (
              <li
                key={o.reviewer}
                className="text-[10.5px] text-text"
                data-testid={`reviewer-outlier-${o.reviewer}`}
              >
                <span className="font-semibold">{o.reviewer}</span>{' '}
                <span className="text-muted">
                  — {o.dominantItems} {o.dominant}, but{' '}
                  {o.odd.map((r) => `${r.items} ${r.discipline}`).join(' and ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
