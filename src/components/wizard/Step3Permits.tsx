import { useEffect, useMemo, useRef } from 'react';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { useDmDaGroups } from '../../hooks/useDmDaGroups';
import { usePermitTypes } from '../../hooks/usePermitTypes';
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
    // fix-96-c: BP DA is now a project-level question (Step 1's
    // lead_da). Seed it here so the read-only cell renders the right
    // value on first paint instead of a brief flash of empty; applySeeding
    // also mirrors lead_da → BP.da defensively for any path that bypasses
    // makeBpPermit.
    da: defaults.lead_da,
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
function dedupedByName(
  all: TeamMember[],
  roles: Set<string>,
  includeInactive: boolean,
): TeamMember[] {
  const seen = new Set<string>();
  const out: TeamMember[] = [];
  for (const m of all) {
    if (!roles.has(m.role)) continue;
    if (!includeInactive && m.active === false) continue;
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
  // fix-130: full active permit type catalog drives the per-row type
  // dropdown. The Step 2 questionnaire seeds the initial set; Step 3
  // lets the user change any row's type after the fact (Bobby's
  // "questionnaire is a starting point, not a lock-in").
  const permitTypesQ = usePermitTypes();
  const typeOptions = useMemo(
    () => (permitTypesQ.data ?? []).map((t) => t.name),
    [permitTypesQ.data],
  );
  // fix-120-a: keep a ref pointing at the LATEST value so async lookup
  // callbacks (onPickDa's bp_ent_lead_for_da resolution + the cascade
  // effect's Path B) read the current permits array instead of the one
  // captured at the time the callback was queued. Without this, a sync
  // updatePermit({da}) followed by an async updatePermit({ent_lead})
  // wins the race: when the .then fires, React has already committed
  // the {da} change but the inline `value.permits` reference in the
  // closure still points at pre-{da}-update permits, so the {ent_lead}
  // patch is built from stale permits and overwrites the {da} change.
  //
  // Bobby's repro on 6516 37th Ave SW + 5917 41st Ave SW: picking Cam
  // as the Demolition DA caused the dropdown to "auto-default" back to
  // blank as soon as bp_ent_lead_for_da resolved. Cam isn't special —
  // his routing (jurisdiction=NULL fallback to Miles) is identical to
  // Trevor's; the race fires for any DA. Cam was just the one Bobby
  // tested. Prod confirms: both Demo permits ended up with da=Cam
  // (set via Project Settings post-create, Bobby's workaround) — the
  // wizard save path itself was dropping it.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  });
  // fix-96-b: routing rows for the active tenant. The DA dropdown disables
  // any DA that has no row matching the project's juris (specific OR
  // NULL-juris fallback) — mirrors bp_ent_lead_for_da's WHERE clause so
  // the wizard agrees with the server's pick.
  const routingQ = useDaTeamRouting();
  const routingRows = routingQ.data ?? [];

  // fix-143: backfill mode opens the ENT + DA pickers to inactive/former staff.
  const backfillMode = value.backfill_mode;
  const entOptions = useMemo(
    () => dedupedByName(teamQ.all ?? [], ENT_ROLES, backfillMode),
    [teamQ.all, backfillMode],
  );

  /** Full DA roster from team_members (members, not bare names, so backfill
   *  mode can render the inactive/former suffix). Replaces the previous
   *  useDmDaGroups source which only included DAs on a draw-schedule lane
   *  (missed Cam + Shire). fix-143: include inactive/former when backfill. */
  const daMembers = useMemo(() => {
    const seen = new Set<string>();
    const out: TeamMember[] = [];
    for (const m of teamQ.all ?? []) {
      if (m.role !== DA_ROLE) continue;
      if (!backfillMode && m.active === false) continue;
      if (seen.has(m.name)) continue;
      seen.add(m.name);
      out.push(m);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [teamQ.all, backfillMode]);

  /** fix-96-b: which DAs are routed for the project's juris. A DA appears
   *  in the dropdown either way (so the user can see Bobby's full team)
   *  but unrouted DAs render disabled. Recompute when juris or the
   *  routing rows change. */
  const routedDaSet = useMemo(() => {
    const set = new Set<string>();
    for (const m of daMembers) {
      if (daHasRoutingFor(m.name, value.juris || null, routingRows)) {
        set.add(m.name);
      }
    }
    return set;
  }, [daMembers, routingRows, value.juris]);

  /** Ensure a Building Permit row exists in value.permits exactly once.
   *  Persisting via useEffect (vs. computing on every render) keeps
   *  rowIds stable across renders — that's what fixes the scroll-jump
   *  + focus-loss bug.
   *
   *  fix-126: skip the BP injection on a reuse=yes redesign — the
   *  redesign creates no permits and the Step 3 reuse banner takes
   *  over the surface. */
  useEffect(() => {
    if (
      value.redesign_of_project_id !== '' &&
      value.redesign_reuses_original_permit === 'yes'
    ) {
      return;
    }
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
    // fix-120-a: read permits via valueRef so async callers (.then on
    // bp_ent_lead_for_da, the cascade effect) merge into the LATEST
    // permits array, not the one captured when the callback was queued.
    const currentPermits = valueRef.current.permits;
    onChange({
      permits: currentPermits.map((p) => {
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
        // fix-166: an ent_lead patch routed through updatePermit comes from the
        // ENT picker (PermitAssignmentRow's onChange) — an explicit user pick.
        // Flag it so a later DA change in onPickDa won't auto-overwrite it. The
        // auto-derive path writes ent_lead via setDerivedEntLead (flag=false),
        // NOT through here, so it stays re-derivable.
        if ('ent_lead' in patch) me.ent_lead = true;
        next.manuallyEdited = me;
        return next;
      }),
    });
  }

  /** fix-96-c: BP row's ent_lead derives on tab-in, not on user pick
   *  (the BP DA is set on Step 1 now; Step 3's DA cell is read-only).
   *  When the BP has a DA, fire the same bp_ent_lead_for_da lookup
   *  the manual-pick path uses. The juris + lookup-failure semantics
   *  match onPickDa below.
   *
   *  fix-101-c: the routed ent_lead also cascades to every non-BP
   *  permit whose ent_lead is still empty. Bobby owns PAR / SDOT /
   *  ECA Waiver across the team — typing his name on every row was
   *  manual busywork — so the BP's derived ENT pre-fills them in
   *  one shot. Empty cells only: a user who already picked an ENT
   *  on a sibling permit (via that permit's DA pick → onPickDa
   *  derivation, or a manual override) is preserved. The cascade
   *  re-runs when the BP's DA changes (or juris flips), and re-runs
   *  in the same way — never overwriting non-empty siblings — so
   *  later BP DA edits fill in newly-added empty rows without
   *  clobbering earlier per-permit overrides. The (da, juris) the
   *  cascade last fired for is tracked via ref so the effect's
   *  follow-up renders (after onChange lands the new ent_leads
   *  through React state) don't loop the RPC. */
  const lastDerivedRef = useRef<{ da: string; juris: string } | null>(null);
  useEffect(() => {
    const bp = value.permits.find(
      (p) => p.type === BUILDING_PERMIT && p.selected,
    );
    if (!bp || !bp.da) return;
    const bpDa = bp.da;
    const bpJuris = value.juris || '';
    // fix-120-b: split the idempotency gate. Path A (BP.ent_lead is
    // already known — fill empty non-BP siblings locally) needs to
    // ALWAYS fire so that newly-added rows pick up the project's
    // derived ENT default. cascade(..., overwriteBp=false) is
    // idempotent over non-empty ent_lead cells, so re-firing on row-
    // count changes is a no-op for existing rows but fills new ones.
    // Path B (RPC fire to derive BP.ent_lead from BP.da) keeps the
    // gate so the same (da, juris) pair doesn't re-issue the RPC.
    const bpRowId = bp.rowId;
    /** Patch the BP row + every non-BP permit with an empty ent_lead
     *  in a single onChange. Returning early when nothing would
     *  change keeps the wizard idle on no-op rerenders.
     *
     *  fix-120-a: read from valueRef so a cascade that resolves after
     *  the user has already edited a sibling DA preserves that DA edit
     *  instead of overwriting it with the pre-edit permits snapshot. */
    const cascade = (entLead: string, overwriteBp: boolean) => {
      let changed = false;
      const livePermits = valueRef.current.permits;
      const nextPermits = livePermits.map((p) => {
        // The "lead" BP row (the one whose DA drove this derivation)
        // only gets overwritten on the explicit Path B branch where we
        // just discovered its routing.
        if (p.rowId === bpRowId) {
          if (!overwriteBp || p.ent_lead === entLead) return p;
          changed = true;
          return { ...p, ent_lead: entLead };
        }
        // fix-120-c: fill ANY other selected row with empty ent_lead —
        // including additional BPs from a multi-building project added
        // via the "+ Add permit" button. The dropped `p.type !==
        // BUILDING_PERMIT` check used to skip multi-BPs (a fix-91-era
        // assumption that there was at most one BP per project), so the
        // 4th BP Bobby added stayed empty until the cascade re-fired.
        if (p.selected && !p.ent_lead) {
          changed = true;
          return { ...p, ent_lead: entLead };
        }
        return p;
      });
      if (changed) onChange({ permits: nextPermits });
    };

    // fix-120-b Path A: BP.ent_lead is already set (e.g. a saved
    // draft or a prior cascade round). Skip the RPC — just propagate
    // the existing value to any empty non-BP siblings. Fires on every
    // permits-list change (row added/removed) so newly-added rows
    // pick up the project ENT default; idempotent on the second pass
    // because cascade() returns early when no row needs the fill.
    if (bp.ent_lead) {
      cascade(bp.ent_lead, false);
      return;
    }

    // Path B: BP.ent_lead empty — fire the lookup, then cascade.
    // Gated by lastDerivedRef so the same (da, juris) pair doesn't
    // re-issue the RPC on every render.
    if (
      lastDerivedRef.current?.da === bpDa &&
      lastDerivedRef.current?.juris === bpJuris
    ) {
      return;
    }
    lastDerivedRef.current = { da: bpDa, juris: bpJuris };
    void lookupEntLeadForDa(bpDa, value.juris || null)
      .then((routed) => {
        if (!routed) return;
        cascade(routed, true);
      })
      .catch(() => {
        // Same as onPickDa — swallow + let the user fill ent_lead
        // manually if the routing table doesn't cover this DA. Roll
        // back the dedupe ref so a corrected DA pick (e.g. user
        // switches to a routed DA) re-fires the lookup.
        lastDerivedRef.current = null;
      });
    // fix-120-b: include permits.length AND BP.ent_lead so Path A re-fires
    // when 120-c's + Add permit / × Remove buttons (or Step 2 toggles)
    // change the row set, or when Path B's RPC resolves BP.ent_lead.
    // Newly-added rows have empty ent_lead, and Path A's cascade fills
    // them in idempotently — second-pass renders no-op because no row
    // qualifies for the fill anymore. value.permits identity churns on
    // every keystroke; the length signal is the right granularity.
    /* eslint-disable react-hooks/exhaustive-deps */
  }, [
    value.juris,
    value.permits.find((p) => p.type === BUILDING_PERMIT && p.selected)?.da,
    value.permits.find((p) => p.type === BUILDING_PERMIT && p.selected)?.ent_lead,
    value.permits.length,
  ]);
  /* eslint-enable react-hooks/exhaustive-deps */

  /** fix-166: write an auto-derived ent_lead onto a row and flag it as
   *  NON-manual (manuallyEdited.ent_lead = false). Routing this separately
   *  from updatePermit is the whole point: updatePermit marks ent_lead as a
   *  manual pick, but a DA-derived value must stay re-derivable when the DA
   *  changes again. Reads + writes via valueRef so a lookup that resolves
   *  after later edits merges into the live permits array (fix-120-a). */
  function setDerivedEntLead(rowId: string, entLead: string) {
    const livePermits = valueRef.current.permits;
    onChange({
      permits: livePermits.map((p) => {
        if (p.rowId !== rowId) return p;
        const me = { ...(p.manuallyEdited ?? {}), ent_lead: false };
        return { ...p, ent_lead: entLead, manuallyEdited: me };
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
   *  ent_lead blank; the user can pick manually.
   *  fix-96-c: this path now only fires for NON-BP permits; the BP's
   *  DA is set on Step 1 and Step 3's BP cell is read-only.
   *
   *  fix-166 → fix-211: the auto-fill is BLANK-ONLY — it must NEVER replace a
   *  non-empty ENT. Bobby's repro: a Demolition permit with ENT=Briana flipped
   *  to Miles every time he set DA=Cam (Cam routes to Miles). fix-166 had only
   *  guarded explicit picks (manuallyEdited.ent_lead === true), so an ENT that
   *  wasn't flagged manual (e.g. an earlier auto-derived value, or one set via a
   *  path that didn't flag it) still got stomped. The routing now fills ENT only
   *  when the cell is currently blank; any non-empty ENT is left untouched
   *  regardless of how it got there. To re-derive, clear ENT first, then pick a
   *  DA. Same "fill blanks, never overwrite" rule as fix-147's project-settings
   *  cascade, applied to the wizard's per-permit rows. */
  function onPickDa(rowId: string, da: string) {
    updatePermit(rowId, { da });
    if (!da) return;
    void lookupEntLeadForDa(da, value.juris || null)
      .then((routed) => {
        if (!routed) return;
        const row = valueRef.current.permits.find((p) => p.rowId === rowId);
        if (!row) return;
        // fix-211: blank-only — never overwrite a non-empty ENT.
        if (row.ent_lead) return;
        setDerivedEntLead(rowId, routed);
      })
      .catch(() => {
        // Lookup errors are swallowed — they shouldn't block the wizard.
        // The user can still pick the ENT manually.
      });
  }

  // fix-120-c: + Add permit / × Remove. Bobby's spec was "I sometimes
  // need a 4th BP (multi-building project) and currently can only do
  // this in Project Settings post-create." The buttons let him adjust
  // the row count in the wizard directly. Min row count = 1: the
  // cascade depends on a selected BP row being present, and a wizard
  // with zero permits is meaningless. The × on the last remaining row
  // renders disabled.
  //
  // fix-130: type starts empty rather than hardcoded Building Permit.
  // The pre-fix default tricked users into a BP they didn't pick — Bobby
  // wants each new row to explicitly own its type choice. The type
  // dropdown in PermitAssignmentRow shows "— pick a type —" until the
  // user commits. When the user picks a type, Step3Permits.updatePermit
  // clears the manuallyEdited.expected_issue / .target_submit flags so
  // applySeeding's sibling-inheritance-then-formula cascade fills both
  // fields on the next render.
  function addPermit() {
    const livePermits = valueRef.current.permits;
    const newRow: WizardPermit = {
      rowId: newPermitRowId(),
      type: '',
      selected: true,
      ent_lead: '',
      dm: '',
      da: '',
      dual_da: '',
      architect: '',
      num: '',
      expected_issue: '',
      target_submit: '',
      manuallyEdited: {},
      taskTemplateIds: [],
    };
    onChange({ permits: [...livePermits, newRow] });
  }

  function removePermit(rowId: string) {
    const livePermits = valueRef.current.permits;
    // Min 1 selected row — guard against UI races that get past the
    // disabled button (keyboard activation on a disabled button).
    const selectedCount = livePermits.filter((p) => p.selected).length;
    if (selectedCount <= 1) return;
    onChange({ permits: livePermits.filter((p) => p.rowId !== rowId) });
  }

  // fix-126: reuse=yes redesign skips Step 3's permit rows entirely.
  // The redesign is metadata + draw schedule block only; the original
  // project's permits remain canonical. Banner explains the state so
  // the user doesn't wonder where the row UI went.
  const isReuseRedesign =
    value.redesign_of_project_id !== '' &&
    value.redesign_reuses_original_permit === 'yes';

  if (isReuseRedesign) {
    return (
      <div className="space-y-3" data-testid="wizard-step-3">
        <div
          className="text-[12px] px-3 py-3 rounded-md border"
          style={{
            background: 'var(--color-co-bg)',
            borderColor: 'var(--color-co-border)',
            color: 'var(--color-co)',
          }}
          data-testid="wizard-step-3-reuse-banner"
        >
          <div className="font-bold mb-1">Reusing original permits</div>
          <div className="font-display">
            This redesign reuses the original project's permits. No new
            permits will be created — the redesign project records the
            scope change + lands on the draw schedule as its own block.
          </div>
        </div>
      </div>
    );
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
            daMembers={daMembers}
            backfillMode={backfillMode}
            typeOptions={typeOptions}
            routedDas={routedDaSet}
            derivedDm={findDmForDa(p.da, dmDaRows)}
            // fix-96-c: BP DA is set on Step 1, read-only here.
            daReadOnly={p.type === BUILDING_PERMIT}
            onChange={(patch) => updatePermit(p.rowId, patch)}
            onPickDa={(da) => onPickDa(p.rowId, da)}
            // fix-120-c: × Remove. Disabled when this is the last
            // selected row — the wizard needs at least one permit.
            onRemove={() => removePermit(p.rowId)}
            canRemove={selectedPermits.length > 1}
          />
        ))}
      </div>
      {/* fix-120-c: + Add permit. Pre-fix the row count was fixed by
          Step 2's permit-type checklist + the auto-injected BP. Bobby
          needs to add a 4th BP for multi-building projects without
          leaving the wizard. New rows default to type=Building Permit;
          the cascade (fix-120-b Path A) fills ENT from BP.ent_lead on
          the next render so the user doesn't have to retype it. */}
      <button
        type="button"
        onClick={addPermit}
        className="self-start text-xs font-display font-bold px-3 py-1.5 rounded-md border border-border bg-bg/40 text-text hover:bg-bg transition"
        data-testid="wizard-step-3-add-permit"
      >
        + Add permit
      </button>
    </div>
  );
}
