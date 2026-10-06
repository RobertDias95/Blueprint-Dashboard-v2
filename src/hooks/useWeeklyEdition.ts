import { useCallback, useEffect, useRef, useState } from 'react';
import { useBoardItemRead, useMarkBoardItemsRead } from './useBoardReads';
import { useIsAgendaMember } from './useAgendaMember';
import { currentEdition, editionReadKey, type EditionKey } from '../lib/weeklyEdition';

// ===========================================================================
// ★★★ fix-463 §B (P-108) — THE TRIGGER IS A CLOCK, NOT A LOGIN
// ===========================================================================
//
// Bobby: *"the tool is, like, always logged in… if they don't ever restart their
// PC, then they're technically not logging in. Is there a way that this can fire
// automatically, like Wednesday at midnight, so that when they wake up their
// computer that's the first thing that they see on the bridge until they
// acknowledge it?"*
//
// ---------------------------------------------------------------------------
// ★★★ 0c — HOW A TAB THAT HAS BEEN OPEN FOR DAYS NOTICES A CLOCK EVENT
// ---------------------------------------------------------------------------
// THREE CHECK POINTS, and they are `NewBuildNotice`'s (fix-371 + fix-424),
// reused rather than re-reasoned:
//
//   1. ON MOUNT — the ordinary case, and the only one that needs no explaining.
//   2. `visibilitychange` — a tab switched to, or an installed app restored.
//      ★ In a BACKGROUNDED INSTALLED APP TIMERS STOP ENTIRELY, so for that
//        surface this event is not an optimisation, it is the only thing that
//        works at all (fix-371 §1).
//   3. `focus` — A DIFFERENT EVENT, and fix-424's finding. `visibilitychange`
//      does NOT fire when a window that was already on screen is clicked into —
//      a second monitor, a side-by-side split. Those windows had no event and
//      waited out the whole interval. They are not alternatives; they cover
//      different surfaces and this needs both.
//   4. …and a slow TIMER underneath, so a window nobody touches between Tuesday
//      night and Wednesday morning still notices. The edition changes at most
//      once a week, so this is a safety net rather than the mechanism.
//
// ★★ ALL FOUR SHARE ONE FLOOR. Alt-tabbing fires `focus` and `visibilitychange`
// in quick succession; without a gap every pass would recompute and re-render.
// Same reason as fix-371 §1's REALTIME_VISIBILITY_MIN_GAP_MS.
//
// ★★★ AND THE CHECK IS FREE — IT IS A CLOCK READ, NOT A FETCH. `currentEdition`
// is pure arithmetic on `Date`. The one network read is the acknowledgement
// list, which React Query already holds for the bell. That is what makes a
// 60-second timer defensible where a poll would not be.

/** ★ The floor between checks — see the block above. */
const EDITION_CHECK_MIN_GAP_MS = 5_000;
/** ★ The safety net. The edition changes once a week; this only has to notice
 *  within a minute of a window sitting untouched through the boundary. */
const EDITION_CHECK_INTERVAL_MS = 60_000;

export interface WeeklyEditionState {
  /** The edition current right now, recomputed at every check point. */
  edition: EditionKey;
  /** ★★★ §B2/§B4: a MEMBER with an unacknowledged edition. A non-member is
   *  never true, whatever the clock says. */
  shouldShow: boolean;
  /** ★ §B5: this acknowledges a REMINDER. It records that the modal was
   *  dismissed, and makes no claim that anybody read anything. */
  acknowledge: () => void;
  isMember: boolean;
}

export function useWeeklyEdition(): WeeklyEditionState {
  const isMember = useIsAgendaMember();
  const markRead = useMarkBoardItemsRead();

  const [edition, setEdition] = useState<EditionKey>(() => currentEdition());
  const lastCheckAt = useRef(0);

  const check = useCallback(() => {
    const now = Date.now();
    if (now - lastCheckAt.current < EDITION_CHECK_MIN_GAP_MS) return;
    lastCheckAt.current = now;
    const next = currentEdition();
    // ★ setState only when it actually moved — this runs on every focus, and an
    //   unconditional set would re-render the whole shell each time.
    setEdition((prev) => (prev === next ? prev : next));
  }, []);

  useEffect(() => {
    // ★ Deferred, not called from the effect body: a synchronous setState inside
    //   an effect is what the React Compiler rejects, and it cost fix-350 two
    //   attempts. Mount already has the right value from useState's initialiser.
    const first = window.setTimeout(check, 0);
    const id = window.setInterval(check, EDITION_CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
    };
  }, [check]);

  const key = editionReadKey(edition);

  // ═══ ★★★ fix-627 (P-322) — ASK FOR THE ONE KEY, NOT THE WHOLE HISTORY ═══
  //
  // Miles, 2026-10-06: *"I cannot close the update pop-up even if I restart."*
  //
  // THIS LINE USED TO BE `(readsQ.data ?? []).includes(key)` over
  // `useBoardReads()`. That hook had no `.range()`, PostgREST capped it at 1,000
  // rows silently, and Miles had 1,001 — his `weekly-update:2026-09-30` row was
  // the one cut off. So `acknowledged` was false although the row existed, the
  // modal showed, Close upserted a duplicate (ignored), and it showed again. For
  // two days, over every screen, at z-9500.
  //
  // ★★★ fix-627 §A1 PAGES THAT HOOK, WHICH FIXES THIS TOO — AND THIS STILL
  //     CHANGES. A modal nobody can dismiss is the worst failure this app has,
  //     so the decision behind it must not depend on the SIZE of anything. One
  //     row, asked for by key: exact at 1,000 reads and exact at 100,000.
  //
  // ★★ THE GUARD BELOW IS WHY `isSuccess` STILL MATTERS. fix-463's reasoning is
  //    unchanged — showing the modal for 200ms on every load before the answer
  //    arrives would train people to dismiss it unread, which defeats it.
  const readQ = useBoardItemRead(key);
  const acknowledged = readQ.data === true;

  const acknowledge = useCallback(() => {
    markRead.mutate([key]);
  }, [markRead, key]);

  return {
    edition,
    // ★★ `readsQ.isSuccess` gates it so the modal cannot flash over the Bridge
    //    for a moment on every load before the acknowledgement list arrives.
    //    Showing it wrongly for 200ms every single day would train people to
    //    dismiss it without reading, which is the one outcome that defeats it.
    shouldShow: isMember && readQ.isSuccess && !acknowledged,
    acknowledge,
    isMember,
  };
}
