import PermitTypeEditor from './PermitTypeEditor';
import TaskTemplateEditor from './TaskTemplateEditor';
import TargetSubmitFormulasEditor from './TargetSubmitFormulasEditor';
import WaitingOnOptionsEditor from './WaitingOnOptionsEditor';
import PhaseDurationsReport from '../../pages/PhaseDurationsReport';
import { useIsTenantAdmin } from '../../hooks/useIsTenantAdmin';

// Q7.3.c: Settings → Permits & Templates tab. Wraps the per-scope task
// template editor plus (fix-154) the per-type × per-jurisdiction target_submit
// formula offsets. Each editor handles its own selectors, list rendering, and
// CRUD.

export default function AdminPermitsTab() {
  const isAdmin = useIsTenantAdmin();

  return (
    <div className="space-y-3" data-testid="admin-permits-tab">
      {!isAdmin && (
        <div className="bg-surface-2 border border-border rounded-lg px-4 py-2 text-xs text-muted">
          Read-only — you need tenant admin to edit permit types or task templates.
        </div>
      )}
      {/* fix-288: the permit-type catalogue, in the tab where every other
          permit-shaped setting lives. It was previously a bare add/remove pill
          list on the Projects tab, which is where Bobby went looking for it and
          did not find it -- and which had no rename, no descriptions, and no
          usage guard on delete. */}
      <div className="bg-surface border border-border rounded-lg p-4">
        <h2 className="text-sm font-display font-bold text-text mb-1">
          Permit Types
        </h2>
        <PermitTypeEditor readOnly={!isAdmin} />
      </div>
      <div className="bg-surface border border-border rounded-lg p-4">
        <h2 className="text-sm font-display font-bold text-text mb-1">
          Task Templates
        </h2>
        <p className="text-[11px] text-muted mb-4">
          Default tasks applied when a new permit is created. Pick a permit
          type + jurisdiction + stage to edit that scope. The "Base" jurisdiction
          applies to ALL juris where no specific override exists.
        </p>
        <TaskTemplateEditor readOnly={!isAdmin} />
      </div>
      {/* ★★ fix-364 §3: "Waiting on" joins the four app_config lists already
          edited this way. It sits under Task Templates because it is a field of
          a TASK — the templates above set a task's waiting_on, and this is the
          vocabulary they set it from. */}
      <div className="bg-surface border border-border rounded-lg p-4">
        <WaitingOnOptionsEditor readOnly={!isAdmin} />
      </div>
      <div className="bg-surface border border-border rounded-lg p-4">
        <TargetSubmitFormulasEditor readOnly={!isAdmin} />
      </div>

      {/* ★ fix-319 #77: Phase Durations moved here from /reports/phase-durations.
          Bobby: "Technically this belongs in the Settings, in the permit info."
          It is not a report you run — it is reference data about permit types,
          and it is read-only. The route still exists and redirects here so old
          bookmarks survive; the component is mounted UNCHANGED.

          ★ ON THE PLACEMENT, because the brief asked me to check rather than
          stack. It sits DIRECTLY UNDER the target-submit formulas on purpose:
          those set the target, this is what actually happened, and reading one
          without the other is how a formula stays wrong for a year. The line
          below says so, so the two are not two disconnected panels.

          ★ AND ONE THING THE BRIEF HAS SLIGHTLY WRONG, worth knowing before
          anyone moves things again: it expects PermitTypeDefaultsEditor to be
          on this tab, next to PermitTypeEditor. It is not — it lives on
          Settings → Schedule. So the two "targets" phase durations is evidence
          for are currently split across two tabs: the per-type × per-juris
          target_submit offsets here, and the per-type intake→approval and
          cycle-1 resub offsets there. I have not moved either, because that is
          a bigger decision than this ticket, and pointed at the other one
          instead. */}
      <div className="bg-surface border border-border rounded-lg p-4">
        <div
          className="text-[11px] text-muted mb-3"
          data-testid="phase-durations-context"
        >
          The formulas above are the <strong>target</strong>. Below is what
          actually happened — median city review and our own turnaround, per
          permit type, jurisdiction and cycle. Nothing here is editable and
          nothing here feeds a date. The per-type estimator defaults these also
          inform (intake →
          approval, cycle-1 resubmit) live on{' '}
          <strong>Settings → Schedule</strong>.
        </div>
        <PhaseDurationsReport />
      </div>
    </div>
  );
}
