import { useMemo } from 'react';
import { usePermits } from './usePermits';
import { useProjects } from './useProjects';
import { useAllTasks } from './useTaskTree';
import { useTeamMembers } from './useTeamMembers';
import { useSelfScope } from './useSelfScope';
import { cancelledProjectIds, useAllProjectHolds } from './useProjectHolds';
import { useAllPermitHolds } from './usePermitHolds';
import { useMilestoneAcks } from './useMilestoneAcks';
import { useShowHeldWork } from './useShowHeldWork';
import { useTaskOwnership } from './useTaskOwnership';
import {
  resolveBoardViewer,
  todayIso,
  type BoardInput,
  type BoardViewer,
} from '../lib/myBoard';

// ===========================================================================
// ★★★ fix-446 §0a — ONE ASSEMBLY OF `BoardInput`, NOT THREE
// ===========================================================================
//
// Before this it was written out twice, in `MyBoard.tsx` (~857) and
// `BoardBell.tsx` (~85), and fix-446 needed a third in My Tasks. Three copies
// of an eleven-field input is three places to forget `acks` — which is not
// hypothetical, see the discrepancy below.
//
// ★★ IT COSTS NO FETCH. Every hook here is already mounted app-wide: BoardBell
// lives in `Chrome.tsx`, so on every page of the app these queries are running
// anyway and React Query dedupes them by key. A third caller is free, which is
// the whole reason milestones can reach My Tasks without widening
// `bp_list_tasks` (~1.1 MB per refetch).
//
// ---------------------------------------------------------------------------
// ★★★ THE TWO CALLERS DID NOT AGREE, AND THE OPTIONS PRESERVE THAT ON PURPOSE
// ---------------------------------------------------------------------------
//
// `MyBoard` passed `acks` and `showHeldWork`; `BoardBell` passed neither. So
// the bell's "Past due" and "Today" counters — the only two things it reads off
// the forecast — count milestones that have already been ACKNOWLEDGED, and can
// therefore stand higher than the board they link to.
//
// ★★★ THAT IS A PRE-EXISTING DISCREPANCY AND THIS TICKET DOES NOT FIX IT.
// fix-446's brief is explicit that extracting this hook changes nothing for the
// first two callers, and "the bell now shows a smaller number" is a change.
// The options exist so the difference is DECLARED at the call site instead of
// living in a field somebody forgot, and so fixing it later is one boolean.
//
// ★ Defaults are the COMPLETE input, so the third caller and any future one get
// the correct shape without having to know this story.

export interface UseBoardInputOptions {
  /**
   * Include `permit_milestone_acks`, which suppress milestones somebody has
   * already ticked. ★ Only `BoardBell` passes false, and only to preserve its
   * existing counts — see the block above.
   */
  withAcks?: boolean;
  /** Include fix-409's shared "show held work" preference. */
  withHeldWork?: boolean;
}

export interface UseBoardInputResult {
  input: BoardInput;
  viewer: BoardViewer;
  /** True while any of the four data queries is still loading, so a caller can
   *  render a skeleton rather than an empty board. */
  isLoading: boolean;
}

export function useBoardInput(
  opts: UseBoardInputOptions = {},
): UseBoardInputResult {
  const { withAcks = true, withHeldWork = true } = opts;

  const permitsQ = usePermits();
  const projectsQ = useProjects();
  const tasksQ = useAllTasks();
  const holdsQ = useAllProjectHolds();
  // ★★ fix-390: the permit-scoped siblings, one bulk fetch like their parent.
  const permitHoldsQ = useAllPermitHolds();
  const acksQ = useMilestoneAcks();
  const team = useTeamMembers();
  const { identity } = useSelfScope();
  const { showHeldWork } = useShowHeldWork();
  const taskOwnership = useTaskOwnership();

  const viewer = useMemo(
    () => resolveBoardViewer(identity.name, team.all),
    [identity.name, team.all],
  );

  const acks = withAcks ? acksQ.data : undefined;
  const held = withHeldWork ? showHeldWork : undefined;

  const input: BoardInput = useMemo(
    () => ({
      viewer,
      permits: permitsQ.data ?? [],
      projects: projectsQ.data ?? [],
      tasks: tasksQ.data ?? [],
      today: todayIso(),
      cancelledIds: cancelledProjectIds(holdsQ.data),
      // ★★ fix-390: which projects and which permits are paused. The board
      // silences a held permit's milestone chips — reversibly, and without
      // writing an ack. Project holds cover their permits; a permit hold covers
      // ONLY its permit and never rolls up.
      holdRows: holdsQ.data ?? [],
      permitHoldRows: permitHoldsQ.data ?? [],
      // ★★★ fix-409: the one preference, shared across the surfaces. Default
      // false is byte-for-byte fix-390's behaviour.
      showHeldWork: held,
      acks,
      // ★★ fix-348: the blended forecast asks "is this task mine?" with
      // fix-238's resolver — the SAME predicate My Tasks counts with, so two
      // surfaces on one screen cannot disagree about who a task belongs to.
      taskOwns: taskOwnership.matches,
    }),
    [
      viewer,
      permitsQ.data,
      projectsQ.data,
      tasksQ.data,
      holdsQ.data,
      permitHoldsQ.data,
      held,
      acks,
      taskOwnership.matches,
    ],
  );

  return {
    input,
    viewer,
    isLoading:
      permitsQ.isLoading ||
      projectsQ.isLoading ||
      tasksQ.isLoading ||
      team.isLoading,
  };
}
