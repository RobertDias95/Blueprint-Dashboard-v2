import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type {
  ConsultantCurrent,
  ConsultantDateField,
  ConsultantStatus,
} from '../lib/consultants';

// ===========================================================================
// ★★★ fix-474 (P-116) — the consultant data layer's client half
// ===========================================================================
//
// ★★ DATA LAYER ONLY. No component imports this yet — fix-475 builds the
// column. Shipping the hooks with the schema is what lets that ticket be a
// rendering ticket rather than a rendering-and-schema ticket.
//
// ★★★ EVERY WRITE RETURNS ITS NEW OCC TOKEN, AND EVERY WRITE HANDS IT BACK.
// fix-073's churn, and the thing fix-442 and fix-443 each had to correct
// later: an RPC that returns `updated_at` is only half the fix — the caller
// that ignores it refetches to find out what it already knows, and the caller
// that neither writes it back nor refetches conflicts with itself on the very
// next keystroke. So each mutation below returns the token, and `onSuccess`
// invalidates so the cached row carries it.

/** One row per consultant on this project, with its LATEST round flattened on.
 *
 *  ★ Reads the `project_consultant_current` VIEW rather than joining here:
 *    "which round is current" is one definition and the database owns it
 *    (highest `round_index`, tie broken by `id` — fix-338's rule). A client
 *    that re-derived it would be a second answer to that question. */
export function useProjectConsultants(projectId: string | null | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<ConsultantCurrent[]>({
    queryKey: queryKeys.projectConsultants(tenantId ?? '', projectId ?? ''),
    enabled: !!tenantId && !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_consultant_current')
        // ★ An EXPLICIT select list, and fix-386/410/461/467 are why this
        //   comment exists: a column added to the view is INVISIBLE until it
        //   is named here, with no error — the trap has bitten this repo four
        //   times. Adding a field to the view means adding it here too.
        .select(
          'consultant_id, tenant_id, project_id, discipline, firm_id, firm_name, ' +
            'firm_active, notes, updated_at, round_id, round_index, phase, status, ' +
            'est_send, sent, est_recd, recd, round_updated_at, round_count',
        )
        .eq('project_id', projectId as string)
        .order('discipline', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ConsultantCurrent[];
    },
  });
}

/** Shared invalidation: one project's consultants, after any write. */
function useInvalidate(projectId: string | null | undefined) {
  const qc = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return () => {
    void qc.invalidateQueries({
      queryKey: queryKeys.projectConsultants(tenantId ?? '', projectId ?? ''),
    });
  };
}

/** ★ The RPCs all return a one-row table; PostgREST gives it back as an array
 *  or a single object depending on the shape. One reader for both. */
function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] ?? null) as T | null;
  return (data ?? null) as T | null;
}

export interface ConsultantWriteResult {
  out_id: string;
  round_id?: string | null;
  updated_at: string | null;
  appended?: boolean;
  conflict?: boolean;
}

/** Add a consultant: one record, one round, status `Scheduled`.
 *
 *  ★ The two EST dates are passed IN — see `seedConsultantDates`, and the note
 *    there for why the seeding lives in TS while the auto-stamp lives in SQL. */
export function useAddProjectConsultant(projectId: string | null | undefined) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: async (input: {
      discipline: string;
      firmId: string;
      phase?: string | null;
      estSend?: string | null;
      estRecd?: string | null;
    }) => {
      const { data, error } = await supabase.rpc('bp_add_project_consultant', {
        p_project_id: projectId,
        p_discipline: input.discipline,
        p_firm_id: input.firmId,
        p_phase: input.phase ?? null,
        p_est_send: input.estSend ?? null,
        p_est_recd: input.estRecd ?? null,
      });
      if (error) throw error;
      return firstRow<ConsultantWriteResult>(data);
    },
    onSuccess: invalidate,
    onError: (e: Error) => pushToast(e.message, 'error'),
  });
}

/**
 * Set the status of a consultant's latest round.
 *
 * ★★★ THE AUTO-STAMP AND THE REOPEN ARE THE SERVER'S, NOT THIS FILE'S. Bobby:
 * *"okay, here's the status, auto date pops in."* Nobody types `sent` or
 * `recd`, and `Received → Scheduled` appends a round while every other
 * transition edits in place. All of that is in `bp_set_consultant_status`, so
 * no client can disagree with it — this hook only reports what happened
 * (`appended`) so the UI can say a round was opened.
 */
export function useSetConsultantStatus(projectId: string | null | undefined) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: async (input: {
      consultantId: string;
      status: ConsultantStatus;
      /** ★ The round's `updated_at`, not the consultant's — the round is what
       *  this write touches. `useProjectConsultants` surfaces it as
       *  `round_updated_at`. */
      expectedUpdatedAt: string | null;
    }) => {
      const { data, error } = await supabase.rpc('bp_set_consultant_status', {
        p_consultant_id: input.consultantId,
        p_status: input.status,
        p_expected_updated_at: input.expectedUpdatedAt,
      });
      if (error) throw error;
      const row = firstRow<ConsultantWriteResult>(data);
      if (row?.conflict) {
        // ★ fix-341's lesson: say what happened in the words of the thing that
        //   happened. "Someone else changed this" with nobody there is what a
        //   bulk write looks like — here the round genuinely moved under us.
        pushToast(
          'That consultant changed while you were editing — reloaded.',
          'error',
        );
      }
      return row;
    },
    onSuccess: invalidate,
    onError: (e: Error) => pushToast(e.message, 'error'),
  });
}

/** Edit one of the four dates on the latest round.
 *
 *  ★ All four are editable, including the two the RPC auto-stamps: the stamp
 *    is a convenience, not a claim the machine knows better. A send that
 *    really happened on Friday can be corrected to Friday. */
export function useSetConsultantDate(projectId: string | null | undefined) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: async (input: {
      consultantId: string;
      field: ConsultantDateField;
      value: string | null;
      expectedUpdatedAt: string | null;
    }) => {
      const { data, error } = await supabase.rpc('bp_set_consultant_date', {
        p_consultant_id: input.consultantId,
        p_field: input.field,
        p_value: input.value,
        p_expected_updated_at: input.expectedUpdatedAt,
      });
      if (error) throw error;
      return firstRow<ConsultantWriteResult>(data);
    },
    onSuccess: invalidate,
    onError: (e: Error) => pushToast(e.message, 'error'),
  });
}

/** Rename the latest round. Free text by ruling — `Cycle 1 & 2` is typeable. */
export function useSetConsultantPhase(projectId: string | null | undefined) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: async (input: {
      consultantId: string;
      phase: string;
      expectedUpdatedAt: string | null;
    }) => {
      const { data, error } = await supabase.rpc('bp_set_consultant_phase', {
        p_consultant_id: input.consultantId,
        p_phase: input.phase,
        p_expected_updated_at: input.expectedUpdatedAt,
      });
      if (error) throw error;
      return firstRow<ConsultantWriteResult>(data);
    },
    onSuccess: invalidate,
    onError: (e: Error) => pushToast(e.message, 'error'),
  });
}

/** Change the firm.
 *
 *  ★ This edits the CONSULTANT, so its OCC token is the consultant's
 *    `updated_at`, not the round's — a different row, a different token. The
 *    two are deliberately separate: renaming a round and re-pointing the firm
 *    are different edits and should not conflict with each other. */
export function useSetConsultantFirm(projectId: string | null | undefined) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: async (input: {
      consultantId: string;
      firmId: string;
      expectedUpdatedAt: string | null;
    }) => {
      const { data, error } = await supabase.rpc('bp_set_consultant_firm', {
        p_consultant_id: input.consultantId,
        p_firm_id: input.firmId,
        p_expected_updated_at: input.expectedUpdatedAt,
      });
      if (error) throw error;
      return firstRow<ConsultantWriteResult>(data);
    },
    onSuccess: invalidate,
    onError: (e: Error) => pushToast(e.message, 'error'),
  });
}
