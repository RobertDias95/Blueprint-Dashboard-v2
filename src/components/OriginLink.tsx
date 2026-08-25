import { Link, useLocation, type LinkProps } from 'react-router-dom';
import {
  currentPaneScroll,
  makeOriginState,
  rememberPaneScroll,
} from '../lib/previousOrigin';

// ===========================================================================
// ★★★ fix-408 — THE ONE HELPER EVERY ENTRY PATH CALLS
// ===========================================================================
//
// Bobby, 2026-08-25 (register P-041): *"Previous is a site-wide smart function.
// Whenever you enter a page from another page, Previous takes you back to that
// page in the state you left it."*
//
// ★★★ WHY A LINK WRAPPER AND NOT A PER-PAGE `setPreviousOrigin()` CALL.
//
// The brief asked for "a single helper called at each link/navigate site rather
// than per-page ad-hoc code". This IS that helper, in the shape that makes the
// remaining thirty-odd call sites a one-word change (`Link` → `OriginLink`)
// rather than a hook, a variable and a prop each:
//
//   · IT READS THE ORIGIN ITSELF. `useLocation()` inside the link is the whole
//     mechanism — no call site has to know, or get right, which page it is on.
//     That is what makes fix-408 §6 (chained navigation) true BY CONSTRUCTION:
//     a link inside a project chat records the chat, because the chat is where
//     `useLocation()` says it is. There is no stack to keep and nothing to pop.
//   · IT CANNOT GO STALE. A page that moves address, gains a tab or gains a
//     query parameter keeps recording itself correctly, because nothing about
//     the address is written down at the call site.
//   · ONE-LINE ADOPTION means the next surface that links into a project gets
//     this for free by importing the thing it would have imported anyway.
//
// ★★ IT IS STILL A <Link>. Same props, same DOM, same middle-click and
// open-in-new-tab behaviour, same styling hooks — the only difference is the
// `state` it carries. An explicit `state` prop from the caller WINS, so a site
// with its own routing state is never silently overridden.
//
// ★ NOT A GLOBAL HISTORY TRACKER, deliberately. Recording "the last location I
// was at" in a shell-level effect would also fire for the browser BACK button
// (turning Previous into a ping-pong between two pages) and for the ribbon
// (which is a fresh start, not an origin). The click is the only event that
// means "I came here from there", so the click is what records it.

export interface OriginLinkProps extends LinkProps {
  /** ★ Override the recorded page NAME for surfaces whose name is data rather
   *  than a route — a project is "4137 S Junction St", not "Project". Ignored
   *  when blank; never used to pick the destination (see `previousTarget`). */
  originLabel?: string;
}

/**
 * A `<Link>` that tells its destination which page the click came from.
 */
export default function OriginLink({
  originLabel,
  state,
  onClick,
  ...rest
}: OriginLinkProps) {
  const loc = useLocation();
  const origin = makeOriginState(loc, { label: originLabel });
  return (
    <Link
      {...rest}
      state={state ?? origin}
      onClick={(e) => {
        // ★★ THE SCROLL OFFSET IS READ HERE, IN THE CLICK — never in render.
        //    A long list renders once at the top and is clicked after you have
        //    scrolled to the bottom; a render-time read would record 0 every
        //    time. It goes into previousOrigin's module map rather than into
        //    the state object this render created — see the note there for why
        //    the obvious version is illegal as well as wrong.
        if (origin) rememberPaneScroll(origin.from, currentPaneScroll());
        onClick?.(e);
      }}
    />
  );
}
