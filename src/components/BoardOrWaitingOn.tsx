import { Navigate, useSearchParams } from 'react-router-dom';
import PersonalBoard from '../pages/PersonalBoard';

/** ★★ fix-499 §D: `/board?view=waiting-on` was the way in while Waiting On
 *  lived inside the My Tasks shell. The switcher is gone; the bookmark is not,
 *  and this path has already been rescued twice (fix-315, then fix-325).
 *
 *  ★★★ A ROUTE CANNOT MATCH A QUERY STRING — React Router keys on the path
 *  alone — so this redirect has to be a component that reads the parameter.
 *
 *  ★ It lives in its own file rather than inside router.tsx because
 *  `react-refresh/only-export-components` is an ERROR in this repo: a module
 *  that exports the router cannot also define a component. Keeping router.tsx a
 *  pure route table is what the rule is asking for. */
export default function BoardOrWaitingOn() {
  const [params] = useSearchParams();
  if (params.get('view') === 'waiting-on') {
    return <Navigate to="/reports/waiting-on" replace />;
  }
  return <PersonalBoard />;
}
