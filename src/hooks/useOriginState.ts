import { useLocation } from 'react-router-dom';
import {
  currentPaneScroll,
  makeOriginState,
  rememberPaneScroll,
  type OriginState,
} from '../lib/previousOrigin';

/**
 * ★★★ fix-408 — THE `navigate()` HALF OF `<OriginLink>`.
 *
 * Most entry paths into a project are `<Link>`s and become `<OriginLink>`s with
 * a one-word change. A handful are IMPERATIVE — a board row whose click also
 * marks a notification read and may open a task panel instead of navigating, a
 * wizard that navigates once a project has been created — and those cannot be a
 * link. They call this instead:
 *
 *     const originState = useOriginState();
 *     navigate(to, { state: originState() });
 *
 * ★★ IT RETURNS A FUNCTION, not a value, for the same reason `<OriginLink>`
 * records the scroll offset in its click handler: both have to happen at the
 * moment of the click. A value computed during render would carry whatever the
 * pane offset was when the list last re-rendered — 0, for a long list you
 * scrolled without re-rendering.
 *
 * ★ `label` names pages whose name is DATA rather than a route — a project is
 * its address, not "Project". Everything with a fixed name passes nothing and
 * gets its name from previousOrigin's route table.
 */
export function useOriginState(): (label?: string) => OriginState | undefined {
  const loc = useLocation();
  return (label?: string) => {
    const origin = makeOriginState(loc, { label });
    if (origin) rememberPaneScroll(origin.from, currentPaneScroll());
    return origin;
  };
}
