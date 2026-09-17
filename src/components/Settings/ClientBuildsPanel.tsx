import { useMemo } from 'react';
import { useClientBuilds } from '../../hooks/useClientBuilds';
import { daysBehind, rowStep, type ClientBuildRow } from '../../lib/clientBuild';
import { BUILD_SHA, buildStamp } from '../../lib/buildInfo';
import { SkeletonRows } from '../Skeleton';

// ===========================================================================
// ★★★ fix-589 §A (P-289) — ONE SCREEN THAT ANSWERS "IS ANYONE STALE RIGHT NOW"
// ===========================================================================
//
// Bobby, 2026-09-16: *"Is there a way to see if others are on a super outdated
// version?"* Until this panel the answer was no, and P-287 is what that cost:
// a day spent on a data hypothesis and an RLS hypothesis, settled in the end by
// **counting toolbar buttons in a screenshot**.
//
// ★★ WHY IT LIVES ON THE TEAM TAB rather than in a sixth Settings section —
//    the same argument `AddPersonSection` makes one card up. It is a roster of
//    people, it is already behind this tab's admin gate, and a new section is
//    a route, a rail entry, an `AdminRoute` and five pinned test lists
//    (fix-350) for one table.
//
// ★★★ `INSTALLED?` IS THE COLUMN THE WHOLE THING IS FOR. An installed window is
//     never closed — that is the premise the update notice rests on — and it is
//     the difference between *"their reload did nothing"* and *"they reloaded a
//     window that was already current while the stale one sat behind it"*.
//     Brittani's case turned on exactly that and nothing recorded it.
//
// ⚠️ IT DOES NOT PRETEND TO KNOW WHAT IT CANNOT. The migration ships unapplied,
//    so "nothing recorded yet" is the state on merge day and it SAYS so —
//    rather than rendering an empty table that reads as "everybody is current".

/** ★ How the ladder reads on somebody else's row. The same four steps the
 *  ribbon climbs, so this screen and that person's own notice cannot disagree
 *  about what "stale" means. */
const STEP_LABEL: Record<string, string> = {
  ready: 'current',
  dated: 'a day or two behind',
  behind: 'behind',
  stale: 'very stale',
};

export default function ClientBuildsPanel() {
  const q = useClientBuilds(true);

  const rows = useMemo<ClientBuildRow[]>(
    () => (q.data?.kind === 'ready' ? q.data.rows : []),
    [q.data],
  );

  // ★ One line per PERSON, not per build: a heartbeat row exists for every
  //   build somebody has ever run, and the question is what they are running
  //   NOW. The freshest `last_seen_at` wins, and the RPC already orders by it.
  const latestPerPerson = useMemo(() => {
    const seen = new Map<string, ClientBuildRow>();
    for (const row of rows) {
      if (!seen.has(row.user_id)) seen.set(row.user_id, row);
    }
    return [...seen.values()];
  }, [rows]);

  const staleCount = useMemo(
    () => latestPerPerson.filter((r) => rowStep(r) !== 'ready').length,
    [latestPerPerson],
  );

  return (
    <div className="flex flex-col gap-3" data-testid="client-builds-panel">
      <p className="text-[11px] text-muted leading-relaxed">
        Which build each person's browser last reported, and whether they were in
        the <strong>installed app</strong> or a browser tab. Compared against
        yours — <span className="font-mono">{buildStamp()}</span>.
      </p>
      <p className="text-[10px] text-muted leading-relaxed">
        A heartbeat, not analytics: who, which build, which surface, when last
        seen. No pages, no actions.
      </p>

      {q.isLoading && <SkeletonRows count={3} rowClassName="h-6" />}

      {!q.isLoading && q.data?.kind === 'unavailable' && (
        // ★★★ THE HONEST EMPTY STATE. `migrations/fix_589_client_build_seen.sql`
        //     is with Bobby, and until it runs there is no table to read. An
        //     empty grid here would read as "everybody is current", which is
        //     precisely the false all-clear this ticket exists to remove.
        <div
          className="rounded border px-3 py-2 text-[11px] text-muted"
          style={{ borderColor: 'var(--color-border)' }}
          data-testid="client-builds-unavailable"
        >
          Nothing recorded yet — <span className="font-mono">client_build_seen</span>{' '}
          has not been created. Run{' '}
          <span className="font-mono">migrations/fix_589_client_build_seen.sql</span>{' '}
          and this fills in as people open the app.
        </div>
      )}

      {!q.isLoading && q.data?.kind === 'refused' && (
        <div
          className="rounded border px-3 py-2 text-[11px] text-muted"
          style={{ borderColor: 'var(--color-border)' }}
          data-testid="client-builds-refused"
        >
          Build history is admin-only.
        </div>
      )}

      {q.data?.kind === 'ready' && latestPerPerson.length === 0 && (
        <div
          className="rounded border px-3 py-2 text-[11px] text-muted"
          style={{ borderColor: 'var(--color-border)' }}
          data-testid="client-builds-empty"
        >
          No heartbeats yet. The first one arrives when somebody opens the app on
          a build that carries this feature.
        </div>
      )}

      {q.data?.kind === 'ready' && latestPerPerson.length > 0 && (
        <>
          <div
            className="rounded border px-3 py-2 text-[11px]"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid="client-builds-summary"
          >
            {staleCount === 0 ? (
              <span className="text-muted">
                Everybody who has reported is on a current build.
              </span>
            ) : (
              <span>
                <strong>{staleCount}</strong>{' '}
                {staleCount === 1 ? 'person is' : 'people are'} behind.
              </span>
            )}
          </div>

          <table className="w-full text-[11px]" data-testid="client-builds-table">
            <thead>
              <tr className="text-left text-dim">
                <th className="font-semibold py-1">Person</th>
                <th className="font-semibold py-1">Build</th>
                <th className="font-semibold py-1">Installed?</th>
                <th className="font-semibold py-1">Behind</th>
                <th className="font-semibold py-1">Last seen</th>
                <th className="font-semibold py-1">Notice</th>
              </tr>
            </thead>
            <tbody>
              {latestPerPerson.map((row) => {
                const behind = daysBehind(row);
                const step = rowStep(row);
                const isCurrent = row.build === BUILD_SHA;
                return (
                  <tr
                    key={row.user_id}
                    className="border-t"
                    style={{ borderColor: 'var(--color-border)' }}
                    data-testid={`client-build-row-${row.user_id}`}
                    data-step={step}
                  >
                    <td className="py-1">
                      {row.name ?? row.email ?? row.user_id}
                    </td>
                    <td className="py-1 font-mono">{row.build}</td>
                    <td className="py-1">
                      {row.display_mode === 'standalone' ? 'Installed app' : 'Tab'}
                    </td>
                    <td
                      className={`py-1 ${step === 'ready' ? 'text-muted' : 'text-wa font-bold'}`}
                      data-testid={`client-build-behind-${row.user_id}`}
                    >
                      {/* ★★ "HOW FAR BEHIND", WHICH IS THE BRIEF'S OWN WORD — and
                          `null` when either side's build time is unknown, because
                          a made-up zero here reads as an all-clear. */}
                      {isCurrent
                        ? 'current'
                        : behind == null
                          ? STEP_LABEL[step]
                          : `${behind} ${behind === 1 ? 'day' : 'days'}`}
                    </td>
                    <td className="py-1 text-muted">
                      {new Date(row.last_seen_at).toLocaleString()}
                    </td>
                    <td
                      className="py-1 text-muted"
                      data-testid={`client-build-notice-${row.user_id}`}
                    >
                      {/* ★★★ THE HALF THAT WAS UNANSWERABLE. "It never showed" and
                          "it showed and was ignored" now read differently. */}
                      {row.notice_shown_count === 0
                        ? 'never shown'
                        : `shown ${row.notice_shown_count}×${
                            row.notice_reloaded_at ? ' · reloaded' : ''
                          }${row.notice_dismissed_at ? ' · dismissed' : ''}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
