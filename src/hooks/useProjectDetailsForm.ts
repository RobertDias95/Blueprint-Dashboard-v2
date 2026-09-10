import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUpdateProjectWithPermits } from './useUpdateProjectWithPermits';
import { useJurisdictions } from './useJurisdictions';
import { usePermitTypes } from './usePermitTypes';
import { useTeamMembers } from './useTeamMembers';
import { useAppConfig, readAppConfigStringArray } from './useAppConfig';
import { isCurrentMember } from '../lib/roster';
import { parseLotSizeSf, roundLotForStorage } from '../lib/lotDimensions';
import { seedExpectedIssue, seedTargetSubmit } from '../lib/permitSeedingDefaults';
import { pushToast } from '../stores/toastStore';
import {
  initProjectDetailsForm,
  projectDetailsFormIsDirty,
  type BpRoleFields,
  type PermitRow,
  type ProjectDetailsFormState,
  type ProjectScalarFields,
} from '../lib/projectDetailsForm';
import type { PermitWithCycles, Project } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-514 §A (P-191) — THE CONTROLLER `ProjectSettingsModal` USED TO BE
// ===========================================================================
//
// Everything the deleted modal did between `useState` and `handleSave`, with
// nothing added: the same `initForm` reseed rule, the same roster derivations,
// the same atomic `bp_update_project_with_permits` payload, the same lot-size
// bound fix-511 §C put in front of it, the same conflict copy.
//
// ★★★ IT IS A HOOK IN `hooks/`, NOT A CONTEXT IN THE MODAL, for two reasons.
//     One: `react-refresh/only-export-components` is an ERROR here, so a
//     component file cannot also export a hook. Two — and this is the one that
//     matters — §B needs **one dirty flag for the whole modal**, and a single
//     owner of the form is the only shape in which that is true by
//     construction rather than by nine tabs agreeing to cooperate.
//
// ★★ WHAT IS *NOT* IN HERE, deliberately: the per-field editors (Site data's
//    zone and lot rows, Dates, Unit dimensions, Consultants, Plan of record).
//    Those commit on blur through their own hooks and never had a draft. Two
//    save models in one modal reads odd until you notice it is the SAME two
//    models Project Data has shipped since fix-506 — the atomic form was
//    simply behind a second modal until now.

export interface ProjectDetailsFormController {
  form: ProjectDetailsFormState;
  /** ★ §B: true when anything in the ATOMIC form differs from what loaded. */
  dirty: boolean;
  saving: boolean;
  set: <K extends keyof ProjectDetailsFormState>(
    key: K,
    value: ProjectDetailsFormState[K],
  ) => void;
  setProj: <K extends keyof ProjectScalarFields>(
    key: K,
    value: ProjectScalarFields[K],
  ) => void;
  setBpRole: <K extends keyof BpRoleFields>(key: K, value: BpRoleFields[K]) => void;
  setPermitField: (idx: number, patch: Partial<PermitRow>) => void;
  addPermit: () => void;
  removePermit: (idx: number) => void;
  /** Resolves true when the save landed (so the caller may close). */
  save: () => Promise<boolean>;
  // --- option lists, derived once ------------------------------------------
  jurisdictionNames: string[];
  entNames: string[];
  dmNames: string[];
  daNames: string[];
  acqNames: string[];
  sdNames: string[];
  caNames: string[];
  permitTypeNames: string[];
  productTypeOptions: string[];
  /** The project's current schematic designer — reassigned by its own RPC. */
  currentSd: string;
}

function toNumOrNull(s: string): number | null {
  const v = s.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function useProjectDetailsForm(
  project: Project,
  permits: PermitWithCycles[],
): ProjectDetailsFormController {
  const jurisdictionsQ = useJurisdictions();
  const teamQ = useTeamMembers();
  const permitTypesQ = usePermitTypes();
  const appConfigQ = useAppConfig();
  const updateProjectWithPermits = useUpdateProjectWithPermits();

  /**
   * ★★★ fix-519 §B (P-227) — THE FORM AND ITS BASELINE ARE ONE STATE.
   *
   * `baseline` is the form AS IT LOADED: compared against, never written to.
   * `form` is what the user has typed. They only ever move TOGETHER — a
   * rebuild replaces both — and holding them in one object is what lets the
   * rebuild below decide, inside a functional updater, whether it is safe to
   * run at all. Two `useState`s could not: the check needs the current `form`
   * AND the current `baseline`, and reaching for either through the effect's
   * dependency array re-runs the rebuild on every keystroke.
   *
   * ★★ IT IS STATE, NOT A REF, AND ONLY LINT CATCHES THE DIFFERENCE. Reading
   *    `ref.current` during render is `react-hooks/refs` — an ERROR in this
   *    repo, invisible to `tsc` and to vitest, and the fourth time this
   *    codebase has tripped it (fix-403, fix-408, fix-426). The dirty flag IS
   *    render output, so its input has to be state.
   */
  const [state, setState] = useState<{
    form: ProjectDetailsFormState;
    baseline: ProjectDetailsFormState;
  }>(() => {
    const initial = initProjectDetailsForm(project, permits);
    return { form: initial, baseline: initial };
  });
  const { form, baseline } = state;
  const [saving, setSaving] = useState(false);

  /** ★ Every setter writes through `setState` DIRECTLY rather than through a
   *  `setForm` wrapper. A `useCallback` wrapper is not a React setter, so
   *  `react-hooks/exhaustive-deps` wants it in six dependency arrays — six
   *  warnings for an indirection that buys nothing. */
  useEffect(() => {
    // fix-36's rule, unchanged: never rebuild mid-save — the atomic save's own
    // invalidation and the engine cascade's realtime invalidation must not
    // churn the form (and its OCC tokens) while a save is in flight.
    if (saving) return;
    const next = initProjectDetailsForm(project, permits);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((s) =>
      // ★★★ fix-519 §B (P-227) — …AND NEVER WHILE THE USER HAS UNSAVED EDITS.
      //
      // This effect rebuilds the whole form whenever the `project` object
      // changes identity, and one of the things that changes it is a SIBLING
      // CONTROL IN THIS SAME MODAL: the Schematic Designer saves immediately
      // through `bp_reassign_project_sd` and invalidates `projects`. So
      // changing the schematic designer — which sits directly beneath the five
      // roles that ride the Save button — silently threw away every unsaved
      // edit on the tab. Prod's ledger shows Dave doing exactly that three
      // times in twenty-one seconds on `5627 44th Ave SW`.
      //
      // ★★★ THE OCC TOKENS SURVIVE THE GUARD, WHICH IS WHY IT IS SAFE. The
      //     PROJECT's token is read from the live `project` prop at save time,
      //     not from this form, so it is never stale. A PERMIT row's token can
      //     be, and the atomic save answers that correctly already: it returns
      //     a conflict and says "modified elsewhere — reload and retry".
      //     Telling somebody their edit collided is a service; discarding it
      //     without a word is not.
      //
      // ★ `currentSd` is derived from `project` on every render rather than
      //   held in this form, so the Schematic Designer select still shows its
      //   new value the moment the reassign lands. The guard costs it nothing.
      projectDetailsFormIsDirty(s.baseline, s.form)
        ? s
        : { form: next, baseline: next },
    );
  }, [project, permits, saving]);

  const dirty = useMemo(
    () => projectDetailsFormIsDirty(baseline, form),
    [baseline, form],
  );

  // --- rosters -------------------------------------------------------------
  const team = useMemo(() => teamQ.data ?? [], [teamQ.data]);
  const rosters = useMemo(() => {
    // fix-22-final: dedupe by name — the schema carries both legacy and lead
    // role variants for the same person.
    const dedup = (list: typeof team) => {
      const seen = new Set<string>();
      const out: typeof team = [];
      for (const m of list) {
        if (seen.has(m.name)) continue;
        seen.add(m.name);
        out.push(m);
      }
      return out;
    };
    // ★ fix-321 #79: assignment pickers offer the CURRENT roster only.
    return {
      entNames: dedup(
        team.filter((t) => (t.role === 'ent' || t.role === 'ent_lead') && isCurrentMember(t)),
      ).map((m) => m.name),
      dmNames: team.filter((t) => t.role === 'dm' && isCurrentMember(t)).map((m) => m.name),
      daNames: team.filter((t) => t.role === 'da' && isCurrentMember(t)).map((m) => m.name),
      acqNames: dedup(
        team.filter((t) => (t.role === 'acq' || t.role === 'acq_lead') && isCurrentMember(t)),
      ).map((m) => m.name),
      sdNames: dedup(
        team.filter((t) => t.role === 'schematic' && isCurrentMember(t)),
      ).map((m) => m.name),
      caNames: dedup(team.filter((t) => t.role === 'ca' && isCurrentMember(t))).map(
        (m) => m.name,
      ),
    };
  }, [team]);

  const currentSd = Array.isArray(project.schematic_designer)
    ? (project.schematic_designer.find((n) => !!n && n.trim() !== '') ?? '')
    : '';

  // --- setters -------------------------------------------------------------
  const set = useCallback(
    <K extends keyof ProjectDetailsFormState>(key: K, value: ProjectDetailsFormState[K]) => {
      setState((s) => ({ ...s, form: { ...s.form, [key]: value } }));
    },
    [],
  );
  const setProj = useCallback(
    <K extends keyof ProjectScalarFields>(key: K, value: ProjectScalarFields[K]) => {
      setState((s) => ({
        ...s,
        form: { ...s.form, projectFields: { ...s.form.projectFields, [key]: value } },
      }));
    },
    [],
  );
  const setBpRole = useCallback(
    <K extends keyof BpRoleFields>(key: K, value: BpRoleFields[K]) => {
      setState((s) => ({
        ...s,
        form: { ...s.form, bpRole: { ...s.form.bpRole, [key]: value } },
      }));
    },
    [],
  );
  const setPermitField = useCallback((idx: number, patch: Partial<PermitRow>) => {
    setState((s) => ({ ...s, form: {
      ...s.form,
      permits: s.form.permits.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    } }));
  }, []);
  const addPermit = useCallback(() => {
    setState((s) => ({ ...s, form: {
      ...s.form,
      permits: [
        ...s.form.permits,
        {
          id: null,
          isNew: true,
          isDeleted: false,
          type: 'Building Permit',
          ent_lead: '',
          da: '',
          portal_url: '',
          num: '',
          struct_address: '',
          expected_issue: '',
          parent_permit_id: '',
        },
      ],
    } }));
  }, []);
  const removePermit = useCallback((idx: number) => {
    setState((s) => ({ ...s, form: {
      ...s.form,
      permits: s.form.permits.map((p, i) => (i === idx ? { ...p, isDeleted: true } : p)),
    } }));
  }, []);

  // --- the atomic save, unchanged from fix-36 ------------------------------
  const bpPermit = useMemo(
    () => permits.find((p) => p.type === 'Building Permit') ?? permits[0] ?? null,
    [permits],
  );

  const save = useCallback(async (): Promise<boolean> => {
    if (!form.address.trim()) {
      pushToast('Address is required.', 'warn');
      return false;
    }
    // ★★★ fix-511 §C (P-198): the lot-size bound, refused BEFORE the RPC —
    //     this save is atomic across the project and every permit, so an
    //     integer overflow rejects the whole transaction and the person loses
    //     edits that had nothing to do with the lot.
    const lotSize = parseLotSizeSf(form.projectFields.lot_size_sf);
    if (!lotSize.ok) {
      pushToast(lotSize.message, 'warn');
      return false;
    }
    if (!project.updated_at) return false;
    setSaving(true);
    try {
      const projectPatch: Record<string, unknown> = {
        address: form.address.trim(),
        juris: form.juris.trim() || null,
        acq_lead: form.acq_lead.trim() || null,
        archived: form.archived,
        // ★★ fix-386: only sent when there IS an answer — the RPC's patch is
        //    key-presence based, so omitting it leaves a "not recorded" null.
        ...(form.is_backfill === null ? {} : { is_backfill: form.is_backfill }),
        go_date: form.projectFields.go_date || null,
        units: toNumOrNull(form.projectFields.units),
        zone: form.projectFields.zone.trim() || null,
        // ★ fix-415 B2: rounded on SUBMIT — this form has no per-field commit.
        lot_width: roundLotForStorage(toNumOrNull(form.projectFields.lot_width)),
        lot_depth: roundLotForStorage(toNumOrNull(form.projectFields.lot_depth)),
        // ★ fix-511 §C: parsed once, above, so the guard and the value cannot
        //   disagree about what the box said.
        lot_size_sf: lotSize.value,
        alley: form.projectFields.alley || null,
        product_types: form.projectFields.product_types,
        entitlement_lead: form.projectFields.entitlement_lead.trim() || null,
        construction_admin: form.projectFields.construction_admin.trim() || null,
        design_manager: form.projectFields.design_manager.trim() || null,
        poc_name: form.projectFields.poc_name.trim() || null,
        poc_email: form.projectFields.poc_email.trim() || null,
        builder_name: form.builder.builder_name.trim() || null,
        builder_company: form.builder.builder_company.trim() || null,
        builder_email: form.builder.builder_email.trim() || null,
        builder_phone: form.builder.builder_phone.trim() || null,
        builder_address: form.builder.builder_address.trim() || null,
      };

      const seedAnchors = {
        goDate: form.projectFields.go_date || '',
        bpAcq:
          form.permits.find((p) => p.type === 'Building Permit' && !p.isDeleted)
            ?.expected_issue ||
          bpPermit?.expected_issue ||
          '',
      };
      const bpDaEdited = form.bpRole.da !== (bpPermit?.da ?? '');
      const permitUpserts: Parameters<
        typeof updateProjectWithPermits.mutateAsync
      >[0]['permitUpserts'] = [];
      const permitDeletes: number[] = [];

      for (const row of form.permits) {
        if (row.isDeleted) {
          if (!row.isNew && row.id != null) permitDeletes.push(row.id);
          continue;
        }
        const isBp = bpPermit != null && row.id === bpPermit.id;
        const da = isBp && bpDaEdited ? form.bpRole.da : row.da;
        const fields = {
          type: row.type,
          ent_lead: row.ent_lead.trim() || null,
          da: da.trim() || null,
          portal_url: row.portal_url.trim() || null,
          num: row.num.trim() || null,
          struct_address: row.struct_address.trim() || null,
        };
        if (row.isNew) {
          // Seed only when the type has a rule AND its anchor is set.
          const seededExpected = seedExpectedIssue(row.type, seedAnchors);
          const seededSubmit = seedTargetSubmit(row.type, seedAnchors);
          permitUpserts.push({
            ...fields,
            // ★★★ fix-514 §G: a TYPED ACQ date on a new row wins over the
            //     seeding rule — somebody who filled the box meant it.
            ...(row.expected_issue.trim()
              ? { expected_issue: row.expected_issue.trim() }
              : seededExpected !== null
                ? { expected_issue: seededExpected }
                : {}),
            ...(seededSubmit !== null ? { target_submit: seededSubmit } : {}),
          });
        } else if (row.id != null && row.updated_at) {
          permitUpserts.push({
            id: row.id,
            expected_updated_at: row.updated_at,
            ...fields,
            // ★★★ fix-514 §G (P-221): the per-permit ACQ date, sent on every
            //     existing row. An emptied box CLEARS the column, which is how
            //     Target Approval falls back to the closing date or GO + 6
            //     months — the point of it being a `max` over three candidates.
            expected_issue: row.expected_issue.trim() || null,
            // ★★★ fix-517 §E: sent on every EXISTING row, so clearing the
            //     select clears the column. Not sent on a NEW row — an unsaved
            //     permit has no id for a sibling to point at and no id of its
            //     own, so the selector does not render there either.
            parent_permit_id: row.parent_permit_id.trim()
              ? Number(row.parent_permit_id)
              : null,
          });
        }
      }

      const result = await updateProjectWithPermits.mutateAsync({
        projectId: project.id,
        projectExpectedUpdatedAt: project.updated_at,
        projectPatch,
        permitUpserts,
        permitDeletes,
      });

      if (result.conflict) {
        // The whole edit rolled back atomically — nothing partial landed.
        pushToast('This project was modified elsewhere — reload and retry.', 'warn');
        return false;
      }
      // ★★★ fix-519 §B — REBASE, so the modal reads CLEAN and the next
      //     `project` refresh is free to rebuild. Without this the new
      //     dirty-guard above would see the just-saved edits as unsaved for
      //     ever and never take the server's fresh OCC tokens.
      setState((s) => ({ ...s, baseline: s.form }));
      pushToast('Project details saved.', 'success');
      return true;
    } catch {
      // useUpdateProjectWithPermits already toasted real errors.
      return false;
    } finally {
      setSaving(false);
    }
  }, [form, project.id, project.updated_at, bpPermit, updateProjectWithPermits]);

  return {
    form,
    dirty,
    saving,
    set,
    setProj,
    setBpRole,
    setPermitField,
    addPermit,
    removePermit,
    save,
    jurisdictionNames: (jurisdictionsQ.data ?? []).map((j) => j.name),
    permitTypeNames: (permitTypesQ.data ?? []).map((t) => t.name),
    productTypeOptions: readAppConfigStringArray(appConfigQ.map, 'productTypeOptions'),
    currentSd,
    ...rosters,
  };
}
