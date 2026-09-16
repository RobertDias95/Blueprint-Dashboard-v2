import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUpdateProjectWithPermits } from './useUpdateProjectWithPermits';
import { useJurisdictions } from './useJurisdictions';
import { usePermitTypes } from './usePermitTypes';
import { useTeamMembers } from './useTeamMembers';
import { useAppConfig, readAppConfigStringArray } from './useAppConfig';
import { isCurrentMember } from '../lib/roster';
import { seedExpectedIssue, seedTargetSubmit } from '../lib/permitSeedingDefaults';
import { pushToast } from '../stores/toastStore';
import { projectValuesEqual } from './useProjectFieldCommit';
import { droppedPatchKeys, droppedPatchMessage } from '../lib/savedPatchAudit';
import {
  type ProjectDraftSink,
} from './useProjectDraft';
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
  /**
   * ★★★ fix-575 §A — THE BUFFERED SCALAR EDITS, as real column values.
   *
   * A `Partial<Project>` rather than a form-shaped object, so `save()` spreads
   * it straight into the RPC's jsonb patch: no second parse, and no second
   * place for a date or a number to be formatted differently from how it is
   * stored.
   */
  draft: Partial<Project>;
  /** The project WITH the draft overlaid — what every editor renders from, so
   *  a buffered edit is visible without a single control changing. */
  projectView: Project;
  /** The sink handed to `useProjectFieldCommit` through context. */
  draftSink: ProjectDraftSink;
  /** ★ fix-575 §B: throw the buffered edits away. Nothing was written, so
   *  nothing is undone. */
  cancel: () => void;
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

  // ════════════════════════════════════════════════════════════════════
  // ★★★ fix-575 §A (P-227) — THE 23 SCALARS BUFFER HERE
  // ════════════════════════════════════════════════════════════════════
  //
  // ★★ SEPARATE FROM `form`, NOT FOLDED INTO IT, and that is deliberate.
  //    `form.projectFields` is a FORM shape — every member a string, because it
  //    fed `<input value>`. The 23 buffered columns keep their real types
  //    (`boolean`, `number | null`, `string[] | null`), because they are read
  //    back by the same controls that read the live row and written by one
  //    multi-column RPC. Coercing them through a string shape would put a
  //    parse on both ends of a value that never needed one.
  //
  // ★ `form.projectFields` and `setProj` are now UNUSED by any caller — they
  //   have been since fix-520 §A emptied the project patch. Left in place: they
  //   are the atomic form's own shape, and deleting them is a separate cleanup
  //   with its own blast radius.
  const [draft, setDraft] = useState<Partial<Project>>({});

  /**
   * ★★★ A DRAFT ENTRY THAT MATCHES THE STORED ROW IS DROPPED, NOT KEPT.
   *
   *     Typing a value and typing it back must leave the modal CLEAN — that is
   *     what a person means by "I didn't change anything", and fix-514 §B's
   *     dirty flag has always been a comparison against what loaded rather than
   *     a touched-flag for exactly this reason.
   *
   * ★★★ AND IT IS LOAD-BEARING, NOT POLITE. fix-519 §B makes the rebuild
   *     effect refuse to run while dirty. A draft entry that can never clear
   *     would freeze that rebuild FOR EVER and strand the modal on stale permit
   *     OCC tokens — the precise failure fix-520 §A's comment warned about when
   *     it narrowed the flag. This is the line that makes widening it safe.
   *
   * ★★ `projectValuesEqual` rather than `===`, from fix-575a: `project_tags`
   *    and `product_types` are arrays, and a reference check would hold them
   *    dirty for ever — which is that same freeze, arriving by a different door.
   */
  const draftSink = useMemo<ProjectDraftSink>(
    () => ({
      setDraft: (field, value) =>
        setDraft((d) => {
          const stored = project[field] ?? null;
          const next = { ...d, [field]: value };
          if (projectValuesEqual(value ?? null, stored)) delete next[field];
          return next;
        }),
    }),
    [project],
  );

  /** ★ fix-575 §B — Cancel. Nothing was written, so nothing is undone. */
  const cancel = useCallback(() => setDraft({}), []);

  /**
   * ★★★ THE READ HALF, IN ONE LINE. Every editor takes a `project` object and
   *     reads its value off it; handing them the row with the draft overlaid
   *     makes a buffered edit visible WITHOUT touching a single control.
   *
   * ⚠️ `updated_at` IS NEVER IN THE DRAFT — only the 23 editable columns reach
   *    `setDraft` — so the OCC token on this object is the live one. That is
   *    what keeps `save()` correct while the rebuild is frozen.
   */
  const projectView = useMemo<Project>(
    () => (Object.keys(draft).length === 0 ? project : { ...project, ...draft }),
    [project, draft],
  );

  /** ★ fix-575 §A: declared ABOVE the rebuild effect because the effect reads
   *  it — a `const` used before its own line is a TDZ crash at runtime that
   *  `tsc` does not flag inside a closure. */
  const draftIsDirty = Object.keys(draft).length > 0;

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
      projectDetailsFormIsDirty(s.baseline, s.form) || draftIsDirty
        ? s
        : { form: next, baseline: next },
    );
    // ★★★ fix-575 §A — `draftIsDirty` JOINS fix-519 §B's GUARD, which is the
    //     whole reason the buffer is safe beside the immediate writers. A
    //     cascading control (the SD reassign, a hold, a DD date) invalidates
    //     `projects` and changes this prop's identity; without the draft in
    //     this condition the rebuild would fire and the buffered scalars would
    //     be silently thrown away — the exact defect fix-519 §B was written for,
    //     reintroduced through a new door.
    //
    // ★★ AND IT CLEARS: `draftSink` drops any entry equal to the stored value,
    //    and `save()`/`cancel()` empty the map outright. A flag that could not
    //    clear would freeze this rebuild permanently — see the sink above.
  }, [project, permits, saving, draftIsDirty]);

  /**
   * ★★★ fix-575 §A — DIRTY MEANS "SOMETHING IN THIS MODAL IS UNSAVED" AGAIN.
   *
   *     fix-520 §A narrowed this to permits alone, and its reasoning was right
   *     for the model it described: *"there is no such thing as an unsaved
   *     address — by the time the box loses focus it is in the database or it
   *     was refused."* §A makes that false again for the 23 scalars ON PURPOSE,
   *     which is the ticket.
   *
   * ★★ WHAT fix-520 §A WAS ACTUALLY PROTECTING is untouched and is the reason
   *    this is safe rather than a revert: a scalar that reads dirty FOR EVER
   *    freezes fix-519 §B's rebuild. The draft clears on save, on cancel, and on
   *    typing a value back to what is stored — three exits, asserted.
   */
  const dirty = useMemo(
    () => draftIsDirty || projectDetailsFormIsDirty(baseline, form),
    [draftIsDirty, baseline, form],
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
    // ★★★ fix-520 §A: TWO GUARDS MOVED OUT WITH THE FIELDS THEY GUARDED.
    //     This save refused an empty address and an out-of-range lot size,
    //     because both rode it and an atomic RPC rejecting the whole
    //     transaction would have taken the permits down with them. Neither
    //     field is in this save any more:
    //       · the address is refused by its own control, which will not commit
    //         a blank over a real one;
    //       · the lot size is parsed by `LotSizeEditor` on blur, which is where
    //         `parseLotSizeSf` has always been called for the OTHER two write
    //         paths (fix-511 §C's bound is unchanged, just enforced once).
    //     A guard over a value this function no longer sends is a check that
    //     can only ever pass.
    if (!project.updated_at) return false;
    setSaving(true);
    try {
      // ★★★ fix-520 §A (P-227) — THE PROJECT PATCH IS EMPTY, AND THAT IS THE
      //     WHOLE POINT OF THE TICKET.
      //
      //     This object used to restate EVERY project scalar — address, juris,
      //     the roles, the lots, the flags, the builder cache — on every save.
      //     That was correct while those fields lived in this form and only
      //     this button could flush them. **They commit on blur now**, through
      //     `useProjectFieldCommit`, so restating them here would take the
      //     form's snapshot from whenever the modal last rebuilt and write it
      //     over whatever has been typed since. A save that reverts nine fields
      //     to save one permit is a worse bug than the one this replaces.
      //
      // ★★ SO THIS RPC WRITES PERMITS AND NOTHING ELSE. The RPC already skips
      //    the project UPDATE on an empty patch (`IF v_patch <> '{}'`), and it
      //    still takes the project's OCC token because STEP 0 needs it to lock
      //    the row before touching its permits.
      // ★★★ fix-575 §A — THE PATCH IS THE DRAFT, AND NOTHING ELSE.
      //
      //     fix-520 §A emptied this object and its reasoning still holds
      //     word for word: restating every project scalar here would write the
      //     form's last-rebuild snapshot over whatever has been typed since.
      //     **The draft is not a snapshot** — it holds ONLY the columns somebody
      //     actually edited in this sitting, so there is nothing in it to
      //     revert. A field nobody touched is not in the patch at all.
      //
      // ★★ ONE RPC, MANY COLUMNS. `bp_update_project_fields` takes a jsonb
      //    patch and already skips the UPDATE on an empty one (`IF v_patch <>
      //    '{}'`), so a permits-only save is byte-identical to today's.
      //
      // ⚠️ THE OCC TOKEN IS `project.updated_at`, THE LIVE PROP — not a value
      //    carried in the draft, and not the form's copy. That is what lets the
      //    rebuild stay frozen behind fix-519 §B's guard without this save going
      //    stale, and it was already true before this ticket.
      const projectPatch: Record<string, unknown> = { ...draft };

      const seedAnchors = {
        // ★ fix-520 §A: off the LIVE project. The form no longer owns the GO
        //   date, so its copy is only as fresh as the last rebuild.
        goDate: project.go_date ?? '',
        bpAcq:
          form.permits.find((p) => p.type === 'Building Permit' && !p.isDeleted)
            ?.expected_issue ||
          bpPermit?.expected_issue ||
          '',
      };
      // ★★★ fix-520 §A: `bpDaEdited` is GONE. `BP Design Associate` was the
      //     one control on the Internal team tab that writes a PERMITS row
      //     rather than a project column, and this save used to smuggle it into
      //     a permit upsert. It writes the Building Permit directly through
      //     `useUpdatePermit` now — the same per-field OCC path
      //     `PermitDetailV2` uses — so a permit save has no opinion about it.

      const permitUpserts: Parameters<
        typeof updateProjectWithPermits.mutateAsync
      >[0]['permitUpserts'] = [];
      const permitDeletes: number[] = [];

      for (const row of form.permits) {
        if (row.isDeleted) {
          if (!row.isNew && row.id != null) permitDeletes.push(row.id);
          continue;
        }
        const fields = {
          type: row.type,
          ent_lead: row.ent_lead.trim() || null,
          // ★ fix-520 §A: the row's OWN `da`, always. The Internal team tab's
          //   BP Design Associate no longer overrides it from here.
          da: row.da.trim() || null,
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
      //
      // ★ It happens on BOTH paths below: the permits half of this save landed
      //   in the same transaction either way, so its rows carry stale OCC
      //   tokens until the rebase runs. A dropped project column must not hold
      //   the permits hostage.
      setState((s) => ({ ...s, baseline: s.form }));

      // ═══════════════════════════════════════════════════════════════════
      // ★★★ fix-588 §2a (P-288) — A SAVE THAT CHANGED NOTHING DOES NOT SAY
      //     IT SAVED
      // ═══════════════════════════════════════════════════════════════════
      //
      // THE REPORT: Bobby added the HVL tag here, pressed Save, read *"Project
      // details saved."* and lost the edit. Instrumented at all five hops, the
      // draft was correct the whole way down — `bp_update_project_with_permits`
      // discarded `project_tags` because the column is not in its `CASE WHEN
      // v_patch ? 'col'` list, and `updated_at` bumped anyway. **Nothing in the
      // app could tell the difference between that and a real save**, which is
      // why four tag options sat unused since 2026-09-10.
      //
      // ★★★ THE TEST IS THE ROW, NOT THE PATCH. `projectAfter` is the columns
      //     this patch tried to set, read back after the write; a column is
      //     reported only when the stored value is neither what we sent nor
      //     anything other than what was already there. See
      //     `lib/savedPatchAudit.ts` — including why a normalising server stays
      //     quiet, and why an unverifiable save says nothing at all.
      //
      // ⚠️ THE DROPPED EDIT STAYS IN THE DRAFT. Clearing it would throw away
      //    the one copy of the value that still exists, and the toast would be
      //    telling somebody about work they can no longer see. The other keys
      //    empty as usual — they are in the database now.
      const dropped = droppedPatchKeys(
        projectPatch,
        project as unknown as Record<string, unknown>,
        result.projectAfter,
      );
      if (dropped.length > 0) {
        setDraft((d) => {
          const kept: Partial<Project> = {};
          for (const key of dropped) {
            if (key in d) {
              (kept as Record<string, unknown>)[key] =
                (d as Record<string, unknown>)[key];
            }
          }
          return kept;
        });
        // ★ `error`, not `warn`: something the person asked for did not happen.
        pushToast(droppedPatchMessage(dropped) ?? 'Some fields did not save.', 'error');
        // ★★ FALSE, so the modal stays open on the edit that did not land. The
        //    permits and the columns that DID save are already committed — this
        //    return value is about whether the save did what was asked.
        return false;
      }

      // ★★★ fix-575 §A — AND THE DRAFT EMPTIES, which is the same rebase for
      //     the scalar half. The row those values came from is now the row in
      //     the database, so keeping them buffered would hold the modal dirty
      //     against itself — and fix-519 §B's guard would never let the rebuild
      //     take the server's fresh permit OCC tokens.
      setDraft({});
      pushToast('Project details saved.', 'success');
      return true;
    } catch {
      // useUpdateProjectWithPermits already toasted real errors.
      return false;
    } finally {
      setSaving(false);
    }
  }, [form, draft, project, bpPermit, updateProjectWithPermits]);

  return {
    form,
    draft,
    projectView,
    draftSink,
    cancel,
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
