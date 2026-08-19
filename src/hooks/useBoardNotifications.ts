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
import { useAutoClosures } from './useAutoClosures';
import { useMyPostRequests } from './usePostRequests';
import { useMyPostReactions } from './useMyPostReactions';
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
  /** ★ fix-360: a stable fingerprint of WHAT is unread, not how much. Changes
   *  when a new thing arrives even if the count does not — see the note where
   *  it is built. */
  signature: string;
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
  // ★ fix-354: what the machine closed, already grouped and routed.
  const autoClosuresQ = useAutoClosures();
  // ★ fix-360 §2: applause on your own posts, one row per reaction.
  const reactionsQ = useMyPostReactions();
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
        autoClosures: autoClosuresQ.data ?? [],
        reactions: reactionsQ.data ?? [],
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
      autoClosuresQ.data,
      reactionsQ.data,
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

  // ★★★ fix-360 §2 — THE BELL AND THE BADGE ARE DIFFERENT QUESTIONS.
  //
  // Bobby: *"it's one notification, but it pops up the bell 12 times"*, and the
  // brief underlines it: *"The bell's behaviour and the centre's row count are
  // DIFFERENT questions — do not make the bell a count of rows and call it
  // done."*
  //
  // ★ A 16th reaction on a post that is already unread does not move the badge:
  // it was one unread item before and it is one unread item after, which is the
  // entire point of grouping. But something DID happen, and the bell is how a
  // person feels that. So the model exposes a signature over the unread keys —
  // which changes whenever anything new arrives, INCLUDING a change that leaves
  // the count where it was, because a reaction item's key carries its watermark
  // (see lib/postReactions).
  //
  // ★ Deliberately not a timestamp or a random token: two renders of the same
  // state must produce the same signature, or the bell would twitch on every
  // refetch and mean nothing.
  const signature = useMemo(
    () => unseen.map((i) => i.key).sort().join('|'),
    [unseen],
  );

  return {
    viewer,
    items,
    unseen,
    readKeys,
    signature,
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
