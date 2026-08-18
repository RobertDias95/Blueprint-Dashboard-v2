import { useMemo } from 'react';
import { usePermits } from './usePermits';
import { useProjects } from './useProjects';
import { useAllTasks } from './useTaskTree';
import { useTeamMembers } from './useTeamMembers';
import { useSelfScope } from './useSelfScope';
import { useScraperActivity } from './useScraperActivity';
import { useMilestoneAcks } from './useMilestoneAcks';
import { useBoardReads } from './useBoardReads';
import { useMyMentions } from './useProjectMessages';
import { useMyPostRequests } from './usePostRequests';
import { useAuthStore } from '../stores/authStore';
import { parseFlips } from '../lib/boardFlips';
import { buildNewItems, unseenItems, type NewItem } from '../lib/boardReads';
import {
  resolveBoardViewer,
  suppressionCounts,
  suppressionGroups,
  type BoardViewer,
  type SuppressionCounts,
  type SuppressionGroups,
} from '../lib/myBoard';
import type { ScraperActivityRow } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-336 §3 — ONE notification model, read by the bell AND the centre
// ===========================================================================
//
// The brief's rule, and fix-329's before it: "the bell's badge and the centre
// must never disagree — they are the same query."
//
// ★ THIS IS NOT A NEW MODEL. Every line below was lifted out of BoardBell
// unchanged: the same eight queries, the same `parseFlips` → `buildNewItems` →
// `unseenItems` chain, the same `resolveBoardViewer`. What changed is that it
// has a name and two callers instead of being inlined in the one component
// that happened to need it first. A centre that re-derived any of it would be
// a second read model, and the badge would drift from the list it opens.
//
// ★ NOTHING HERE READS A SOCKET. Liveness is `useRealtimeInvalidation`
// invalidating these same queries; the model is oblivious to how its inputs got
// fresh, which is the "invalidate, do not merge" rule holding at the seam.

export interface BoardNotifications {
  /** The viewer, resolved the way My Board resolves it. */
  viewer: BoardViewer;
  /** EVERY item that could be new to this person, read or not, newest first.
   *  The centre lists these; the bell shows the unread head of them. */
  items: NewItem[];
  /** The unread ones — the badge's population, and the bell's list. */
  unseen: NewItem[];
  /** The keys this person has acknowledged (fix-307's read state). */
  readKeys: ReadonlySet<string>;
  /** The badge number. `unseen.length`, exposed so no caller recomputes it. */
  unseenCount: number;
  /** The three never-notify categories, counted (the bell's "Not shown" line). */
  suppressed: SuppressionCounts;
  /** ★ …and the rows behind those counts, for the centre. */
  suppressedRows: SuppressionGroups<ScraperActivityRow>;
  /** True while any input query is still loading. */
  isLoading: boolean;
}

export function useBoardNotifications(): BoardNotifications {
  const permitsQ = usePermits();
  const projectsQ = useProjects();
  const tasksQ = useAllTasks();
  const team = useTeamMembers();
  const { identity } = useSelfScope();
  // Reuses the query the activity feed already drives — React Query dedupes, so
  // the suppression counts cost no extra fetch.
  const activityQ = useScraperActivity();
  const acksQ = useMilestoneAcks();
  const readsQ = useBoardReads();
  const mentionsQ = useMyMentions();
  const postRequestsQ = useMyPostRequests();
  const viewerUserId = useAuthStore((s) => s.user?.id ?? null);

  const viewer = useMemo(
    () => resolveBoardViewer(identity.name, team.all),
    [identity.name, team.all],
  );

  // ★ fix-307 (register #36/#38): what is NEW to this person — flips, tasks
  // newly assigned, handoffs arriving, permits newly naming them, mentions, and
  // fix-339's shared post requests. parseFlips has already applied the
  // suppression rules and the fix-304 backfill filter, so a retry-recovered
  // event or a 300-day-old applied date can never arrive here as news.
  const items = useMemo(
    () =>
      buildNewItems({
        flips: parseFlips(activityQ.data ?? []),
        tasks: tasksQ.data ?? [],
        acks: acksQ.data ?? [],
        permits: permitsQ.data ?? [],
        viewerName: viewer.name,
        // ★ fix-329: matched on the viewer's AUTH USER ID, not their roster
        // name — mentions are stored as ids precisely because a name can change
        // under a row and an id cannot.
        mentions: mentionsQ.data ?? [],
        viewerUserId,
        projects: projectsQ.data ?? [],
        postRequests: postRequestsQ.data ?? [],
      }),
    [
      activityQ.data,
      tasksQ.data,
      acksQ.data,
      permitsQ.data,
      viewer.name,
      mentionsQ.data,
      viewerUserId,
      projectsQ.data,
      postRequestsQ.data,
    ],
  );

  const readKeys = useMemo(() => new Set(readsQ.data ?? []), [readsQ.data]);
  const unseen = useMemo(() => unseenItems(items, readKeys), [items, readKeys]);

  const suppressedRows = useMemo(
    () => suppressionGroups(activityQ.data ?? [], viewer),
    [activityQ.data, viewer],
  );
  const suppressed = useMemo(
    () => suppressionCounts(activityQ.data ?? [], viewer),
    [activityQ.data, viewer],
  );

  return {
    viewer,
    items,
    unseen,
    readKeys,
    unseenCount: unseen.length,
    suppressed,
    suppressedRows,
    isLoading:
      permitsQ.isLoading ||
      projectsQ.isLoading ||
      tasksQ.isLoading ||
      activityQ.isLoading ||
      readsQ.isLoading,
  };
}
