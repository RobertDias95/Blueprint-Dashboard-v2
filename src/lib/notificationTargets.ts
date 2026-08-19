// ===========================================================================
// ★★★ fix-362 — the notification knows the PROJECT, not the THING
// ===========================================================================
//
// Bobby:
//
//   "If I get a notification about something in the chat, if I then click that
//    notification, does it take me to that chat, to that post? And same thing,
//    if in the task, does it take me automatically… anytime you get a
//    notification, you can click it and go to where that item is occurring."
//
// ★★ THE NOTIFICATIONS WERE ALREADY LINKS, and they already navigated. The
// problem was where they landed: `NewItem` carried `permitId` and `projectId`
// and nothing else, so a notification about one chat reply could only take you
// to the project, and one about one task only to the permit. You arrived on a
// page CONTAINING the thing and then had to find it — which on a project with
// forty posts is most of the work you were trying to skip.
//
// ★ So `permitId`/`projectId` stay and answer WHERE. A target answers WHAT.

/** ★ The thing a notification is about, as opposed to the page it lives on.
 *
 *  ★★ Every variant carries enough to build a URL WITHOUT another lookup. Deep
 *  link state belongs in the URL (§2) and a target that needed a query to
 *  become a link would be a target that cannot survive a cold browser load. */
export type NewItemTarget =
  /** A chat post or one reply, by message id. The modal resolves which post the
   *  message belongs to — a reply's parent is a fact of the row, not something
   *  the notification should have to carry and keep true. */
  | { kind: 'message'; projectId: string; messageId: string }
  /** The project's chat, with no finer anchor — see CHAT-ONLY below. */
  | { kind: 'chat'; projectId: string }
  /** One permit task, opened in the board's detail pane. */
  | { kind: 'task'; taskId: string }
  /** The permit itself: for the sources where the permit IS the thing. */
  | { kind: 'permit'; projectId: string | null; permitId: number };

/** The minimum of a NewItem this module needs. Deliberately structural rather
 *  than importing NewItem: `lib/boardReads` imports the type above, and a cycle
 *  between the two would be a real one. */
export interface TargetableItem {
  target?: NewItemTarget;
  permitId: number | null;
  projectId: string | null;
}

// ---------------------------------------------------------------------------
// ★★ THE URL PARAMETERS, and why each is what it is
// ---------------------------------------------------------------------------
//
// ★★★ EVERY ONE OF THESE IS IN THE URL AND NOWHERE ELSE. §2's rule: "if you
// can't paste the URL and get the same result, it isn't done." A notification
// is exactly the thing somebody opens tomorrow, or on another machine, so a
// destination held in memory — a store, a prop, a router `state` object — is a
// destination that works only for the person who clicked.
//
//   ?permit=<id>   fix-217's, unchanged. Selects a permit on the project page.
//   ?msg=<uuid>    fix-362. Opens the chat AND focuses one message. It implies
//                  the chat is open, because a message you cannot see is not a
//                  destination.
//   ?chat=1        fix-362. Opens the chat with no message focused, for the
//                  targets whose thing IS the conversation.
//   ?task=<uuid>   fix-362. Selects one task in the board's detail pane.
//
// ★ `msg` and `chat` are separate rather than one overloaded parameter: each is
// meaningful on its own, and `?chat=<uuid-or-1>` would be one parameter with
// two grammars, which is the kind of thing that survives exactly until somebody
// writes the second reader.
export const PARAM_PERMIT = 'permit';
export const PARAM_MESSAGE = 'msg';
export const PARAM_CHAT = 'chat';
export const PARAM_TASK = 'task';

/**
 * ★★★ WHERE A NOTIFICATION GOES.
 *
 * ★ ONE FUNCTION, TWO CALLERS. The bell and the centre both render the same
 * items and both had the same inline expression; two copies of a routing rule
 * is how the bell and the centre start disagreeing about the same row, which is
 * the failure fix-329 exists to prevent and fix-360 had to hold again.
 *
 * ★★ THE FALLBACK CHAIN IS THE WHOLE POINT OF §3. A target may be gone — a
 * chat thread was hard-deleted from production on 2026-08-19 — so nothing here
 * asserts that a target exists. It builds the most specific URL the item can
 * describe, and the DESTINATION decides what to do when the thing is not there.
 * Landing on the project and saying so is the requirement; a 404 is not.
 */
export function targetHref(item: TargetableItem): string {
  const t = item.target;
  if (t) {
    switch (t.kind) {
      case 'message':
        return `/project/${t.projectId}?${PARAM_MESSAGE}=${encodeURIComponent(t.messageId)}`;
      case 'chat':
        return `/project/${t.projectId}?${PARAM_CHAT}=1`;
      case 'task':
        return `/board?${PARAM_TASK}=${encodeURIComponent(t.taskId)}`;
      case 'permit':
        return t.projectId
          ? `/project/${t.projectId}?${PARAM_PERMIT}=${t.permitId}`
          : '/board';
    }
  }
  // ★ The pre-fix-362 behaviour, kept as the floor rather than deleted. An item
  // with no target still navigates somewhere sensible, which is what stops a
  // future source that forgets to declare one from becoming a dead link.
  if (item.projectId) {
    return `/project/${item.projectId}${
      item.permitId ? `?${PARAM_PERMIT}=${item.permitId}` : ''
    }`;
  }
  return '/board';
}
