import { useMemo } from 'react';
import { useProjects } from '../../hooks/useProjects';
import { usePermits } from '../../hooks/usePermits';
import { useDrawSchedule } from '../../hooks/useDrawSchedule';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { useAccountLinks } from '../../hooks/useAccountLinks';
import {
  collectWorkDataNames,
  resolveNameLinks,
  unmappedCount,
  type NameLink,
} from '../../lib/workDataNames';

// ===========================================================================
// ★★★ fix-527 §A (P-243) — WHO THE WORK DATA IS TALKING ABOUT
// ===========================================================================
//
// Bobby's role model — *"a Design Associate may edit only projects they are
// part of"* — has been filed as blocked on permissions since P-026. **It is
// blocked on identity.** This screen is where that gets closed, and it is
// deliberately a RECONCILIATION rather than a migration: the names are free
// text, people keep typing them, and a one-time cleanup would be stale the
// week after it ran.
//
// ★★★ THE LINK ALREADY EXISTS AND MOSTLY WORKS, WHICH IS THIS TICKET'S MAIN
//     FINDING. §0's *"DA names matching any account: 0"* measures
//     `profiles.name`, which is NULL on all 37 accounts and was never the
//     mapping. The mapping is `team_members.email`, read by
//     `resolveRosterIdentity` since fix-176. Measured 2026-09-11:
//
//       26 distinct names across the six columns · all 26 in the roster
//       22 resolve to a real account          · 4 do not
//       848 name→project hits behind the 22   · 22 behind the 4
//
//     So this screen is not building a mapping from nothing. **It is showing
//     the four gaps and keeping them visible** — `George · Alex · Chad ·
//     Nidhi`, every one of them a roster row with no email.
//
// ★★ WHAT IT DOES NOT DO: guess. Not by email local-part, not by initials, not
//    by a drawing stamp reading `E. RUIVO`. §A: *"probably is not good enough
//    to grant access to 33 projects."* Every unresolved name reads `unmapped`,
//    which grants nothing.
//
// ★★★ AND HOW A NEWLY-TYPED NAME SURFACES: it is derived on every render from
//     the live work data, so a name typed into `permits.da` this afternoon is
//     in this list the next time the screen is opened, marked **Not in the
//     roster**. Nothing has to be re-run. Until somebody files it, it is
//     `unmapped` — no access — which is the safe direction for a name nobody
//     has vouched for.

export default function WorkDataNamesPanel({ readOnly }: { readOnly: boolean }) {
  const projectsQ = useProjects();
  const permitsQ = usePermits();
  const drawQ = useDrawSchedule();
  const team = useTeamMembers();
  const accountsQ = useAccountLinks();

  const links = useMemo(() => {
    const names = collectWorkDataNames(
      projectsQ.data ?? [],
      permitsQ.data ?? [],
      drawQ.data ?? [],
    );
    // ★★★ `accountsQ.data?.rows` is UNDEFINED while the query is in flight, and
    //     `resolveNameLinks` answers `unmapped` for everything in that state.
    //     That is the correct reading: an unknown is not a yes. The heading
    //     below waits for the query rather than announcing 26 gaps for a frame.
    return resolveNameLinks(names, team.all, accountsQ.data?.rows);
  }, [projectsQ.data, permitsQ.data, drawQ.data, team.all, accountsQ.data]);

  const loading =
    projectsQ.isLoading || permitsQ.isLoading || drawQ.isLoading || team.isLoading || accountsQ.isLoading;
  const gaps = unmappedCount(links);

  return (
    <div data-testid="work-data-names-panel">
      <p className="text-[11px] text-muted mb-2 leading-relaxed">
        Every name typed into the work data, and the account it belongs to. A
        name with no account grants nothing — the app cannot scope anybody's
        work until it knows who they are.
      </p>

      {!accountsQ.data?.capabilityAvailable && !loading && (
        // ★★★ THE MIGRATION HAS NOT RUN, AND THE SCREEN SAYS SO RATHER THAN
        //     PRETENDING. fix-527's brief forbids shipping code that assumes it
        //     has been applied, so this branch is the one prod runs today.
        <div
          className="mb-3 rounded border px-3 py-2 text-[10.5px] leading-relaxed"
          style={{ borderColor: 'var(--color-co)', background: 'var(--color-co-bg)' }}
          data-testid="work-data-names-pending-migration"
        >
          <span className="font-semibold" style={{ color: 'var(--color-co)' }}>
            Read-only until the fix-527 migration is applied.
          </span>{' '}
          Marking someone “no account”, and the Library capability, both need it.
          Setting an account works today — edit the person’s email in People
          above.
        </div>
      )}

      {!loading && (
        <div
          className="mb-2 text-[11px] font-semibold"
          style={{ color: gaps > 0 ? 'var(--color-co)' : 'var(--color-muted)' }}
          data-testid="work-data-names-gap"
        >
          {gaps === 0
            ? `All ${links.length} names resolve to an account.`
            : `${gaps} of ${links.length} names have no account.`}
        </div>
      )}

      {loading ? (
        <div className="text-[11px] text-dim" data-testid="work-data-names-loading">
          Loading…
        </div>
      ) : (
        <div className="flex flex-col gap-1" data-testid="work-data-names-list">
          {links.map((l) => (
            <NameRow key={l.name} link={l} readOnly={readOnly} />
          ))}
        </div>
      )}
    </div>
  );
}

/** ★ A MISSING VALUE IS A WORD, NOT A BLANK — fix-461's rule. A column of empty
 *  cells reads as a loading bug rather than as the work it is. */
const STATUS_LABEL: Record<NameLink['status'], string> = {
  linked: 'Account',
  'no-account': 'No account',
  unmapped: 'Not mapped',
};

function NameRow({ link, readOnly }: { link: NameLink; readOnly: boolean }) {
  const tone =
    link.status === 'linked'
      ? 'var(--color-muted)'
      : link.status === 'no-account'
        ? 'var(--color-dim)'
        : 'var(--color-co)';
  return (
    <div
      className="flex items-center gap-2 rounded border border-border bg-bg px-2.5 py-1.5"
      data-testid={`work-data-name-${link.name}`}
      data-status={link.status}
    >
      <span className="text-[12px] font-semibold text-text w-[92px] shrink-0 truncate">
        {link.name}
      </span>
      {/* ★★★ THE COST OF THE DECISION, BESIDE THE DECISION. §A asks for the
          project count *"so Bobby can see what each decision costs"* — mapping
          `Marc` wrong is 33 projects and mapping `Jade` wrong is 1, and those
          are not the same call. Counted by DISTINCT PROJECT, so a person on
          four of one project's permits reads 1. */}
      <span
        className="text-[10.5px] font-mono w-[76px] shrink-0"
        style={{ color: 'var(--color-dim)' }}
        data-testid={`work-data-name-${link.name}-projects`}
      >
        {link.projects} {link.projects === 1 ? 'project' : 'projects'}
      </span>
      <span className="text-[11px] flex-1 min-w-0 truncate" style={{ color: tone }}>
        {STATUS_LABEL[link.status]}
        {link.email ? ` · ${link.email}` : ''}
        {link.unknownToRoster ? ' · not in the roster' : ''}
      </span>
      {readOnly && (
        <span className="text-[10px] text-dim shrink-0 hidden sm:inline">view only</span>
      )}
    </div>
  );
}
