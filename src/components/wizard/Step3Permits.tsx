import { useEffect, useMemo } from 'react';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { useDmDaGroups } from '../../hooks/useDmDaGroups';
import {
  daHasRoutingFor,
  lookupEntLeadForDa,
  useDaTeamRouting,
} from '../../hooks/useDaTeamRouting';
import PermitAssignmentRow from './PermitAssignmentRow';
import { findDmForDa } from './dmRouting';
import {
  newPermitRowId,
  type WizardPermit,
  type WizardState,
} from './wizardState';
import type { TeamMember } from '../../lib/database.types';

// fix-22 Step 3 — per-permit role/date assignments. Building Permit is
// always present.
//
// fix-22-final updates:
//   - DA source: switched from useDmDaGroups (draw-schedule lane DAs
//     only — missed team members like Cam + Shire who aren't yet on a
//     lane) to useTeamMembers WHERE role='da' AND active=true. The DA
//     list now matches the full active DA roster.
//   - BP row persistence: previous implementation conjured the BP row
//     on every render via useMemo, generating a fresh rowId each time.
//     React's keyed list saw a new child every render → focus loss and
//     scroll-jump when the user changed any field on the BP row.
//     Now: useEffect appends the missing BP row to value.permits exactly
//     once. After that the row carries a stable rowId across renders.

const BUILDING_PERMIT = 'Building Permit';
const ENT_ROLES = new Set(['ent', 'ent_lead']);
const DA_ROLE = 'da';

interface Props {
  value: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

function makeBpPermit(defaults: WizardState): WizardPermit {
  return {
    rowId: newPermitRowId(),
    type: BUILDING_PERMIT,
    selected: true,
    // fix-91: Step 1 no longer asks for ent_lead / design_manager; they
    // derive on DA pick. Leave blank here — the user will choose a DA
    // and onPickDa will route to ent_lead via bp_ent_lead_for_da.
    ent_lead: '',
    dm: '',
    da: '',
    dual_da: '',
    architect: '',
    num: '',
    // fix-91: inherit the Step-1 ACQ Target as the BP's initial
    // expected_issue. The user can still override per-permit on Step 3.
    expected_issue: defaults.acq_target,
    target_submit: '',
    manuallyEdited: {},
    taskTemplateIds: [],
  };
}


/** Filter + dedupe by name. Same logic the Step 1 ENT dropdown uses,
 *  for the same reason: schema has both ('ent','ent_lead') variants
 *  per person and we want a single entry. */
function dedupedByName(all: TeamMember[], roles: Set<string>): TeamMember[] {
  const seen = new Set<string>();
  const out: TeamMember[] = [];
  for (const m of all) {
    if (!roles.has(m.role)) continue;
    if (m.active === false) continue;
    if (seen.has(m.name)) continue;
    seen.add(m.name);
    out.push(m);
  }
  return out;
}

export default function Step3Permits({ value, onChange }: Props) {
  const teamQ = useTeamMembers();
  const dmDaGroupsQ = useDmDaGroups();
  const dmDaRows = dmDaGroupsQ.rows;
  // fix-96-b: routing rows for the active tenant. The DA dropdown disables
  // any DA that has no row matching the project's juris (specific OR
  // NULL-juris fallback) — mirrors bp_ent_lead_for_da's WHERE clause so
  // the wizard agrees with the server's pick.
  const routingQ = useDaTeamRouting();
  const routingRows = routingQ.data ?? [];

  const entOptions = useMemo(
    () => dedupedByName(teamQ.all ?? [], ENT_ROLES),
    [teamQ.all],
  );

  /** Full active DA roster from team_members. Replaces the previous
   *  useDmDaGroups source which only included DAs on a draw-schedule
   *  lane (missed Cam + Shire). Sort alphabetically. */
  const daOptions = useMemo(() => {
    const all = teamQ.all ?? [];
    return all
      .filter((m) => m.role === DA_ROLE && m.active !== false)
      .map((m) => m.name)
      .sort((a, b) => a.localeCompare(b));
  }, [teamQ.all]);

  /** fix-96-b: which DAs are routed for the project's juris. A DA appears
   *  in the dropdown either way (so the user can see Bobby's full team)
   *  but unrouted DAs render disabled. Recompute when juris or the
   *  routing rows change. */
  const routedDaSet = useMemo(() => {
    const set = new Set<string>();
    for (const name of daOptions) {
      if (daHasRoutingFor(name, value.juris || null, routingRows)) {
        set.add(name);
      }
    }
    return set;
  }, [daOptions, routingRows, value.juris]);

  /** Ensure a Building Permit row exists in value.permits exactly once.
   *  Persisting via useEffect (vs. computing on every render) keeps
   *  rowIds stable across renders — that's what fixes the scroll-jump
   *  + focus-loss bug. */
  useEffect(() => {
    const hasBp = value.permits.some(
      (p) => p.type === BUILDING_PERMIT && p.selected,
    );
    if (hasBp) return;
    // No selected BP. Either no BP row at all, or one is present but
    // selected=false. Add a fresh selected BP row at the top.
    onChange({ permits: [makeBpPermit(value), ...value.permits] });
    // We intentionally only depend on the BP-presence question.
    // value.permits identity changes on every keystroke; gating on the
    // boolean keeps this from looping. The wizard's parent owns the
    // state so even a self-referential update settles immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.permits.some((p) => p.type === BUILDING_PERMIT && p.selected)]);

  const selectedPermits = useMemo(
    () => value.permits.filter((p) => p.selected),
    [value.permits],
  );

  function updatePermit(rowId: string, patch: Partial<WizardPermit>) {
    onChange({
      permits: value.permits.map((p) => {
        if (p.rowId !== rowId) return p;
        const next = { ...p, ...patch };
        // fix-Phase-B: track which seed fields the user has hand-edited so
        // the reactive re-seed (applySeeding) leaves them alone. A type
        // change clears the flags so the row re-seeds under the new type's
        // rule. (The current UI has no per-row type editor — Step 2 governs
        // types — but this keeps the funnel correct if one is added.)
        const me = { ...(p.manuallyEdited ?? {}) };
        if ('type' in patch) {
          delete me.expected_issue;
          delete me.target_submit;
        }
        if ('expected_issue' in patch) me.expected_issue = true;
        if ('target_submit' in patch) me.target_submit = true;
        next.manuallyEdited = me;
        return next;
      }),
    });
  }

  /** fix-91: DA pick → look up routed ent_lead via bp_ent_lead_for_da
   *  (fix-72's DA-routing table). The async lookup fires and patches
   *  the row's ent_lead when it resolves; user can still override
   *  manually after that. We DON'T patch ent_lead on the synchronous
   *  da update — that lands first via updatePermit — so the UI shows
   *  the DA immediately and the ent_lead fills in a tick later.
   *  Lookup failures (DA not in routing, juris null) silently leave
   *  ent_lead blank; the user can pick manually. */
  function onPickDa(rowId: string, da: string) {
    updatePermit(rowId, { da });
    if (!da) return;
    void lookupEntLeadForDa(da, value.juris || null)
      .then((routed) => {
        if (!routed) return;
        updatePermit(rowId, { ent_lead: routed });
      })
      .catch(() => {
        // Lookup errors are swallowed — they shouldn't block the wizard.
        // The user can still pick the ENT manually.
      });
  }

  return (
    <div className="space-y-3" data-testid="wizard-step-3">
      <div className="text-[11px] text-muted">
        Based on your answers, the following permits are suggested. Adjust
        per-permit ENT/DA assignments and target dates as needed. Bobby
        owns PAR/Pre-Sub + SDOT/ECA permits across the team — override
        the ENT column for those.
      </div>
      <div className="flex flex-col gap-2">
        {selectedPermits.map((p) => (
          <PermitAssignmentRow
            key={p.rowId}
            permit={p}
            entOptions={entOptions}
            daOptions={daOptions}
            routedDas={routedDaSet}
            derivedDm={findDmForDa(p.da, dmDaRows)}
            onChange={(patch) => updatePermit(p.rowId, patch)}
            onPickDa={(da) => onPickDa(p.rowId, da)}
          />
        ))}
      </div>
    </div>
  );
}
