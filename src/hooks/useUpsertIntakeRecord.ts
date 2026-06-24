import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { IntakeRecord } from '../lib/database.types';

// Q6.3.c: row-level OCC upsert via bp_upsert_intake_records_row (already
// in place since Q5.5.C). intake_records.id is integer — server-assigned
// on insert; required for update. p_expected_updated_at=null on insert.

type EditableField =
  | 'project_id'
  | 'permit_id'
  | 'address'
  | 'permit_num'
  | 'permit_type'
  | 'intake_date'
  | 'is_placeholder'
  | 'portal_url'
  | 'link';

export type IntakeRecordPatch = Partial<Pick<IntakeRecord, EditableField>>;

export type UpsertIntakeInput =
  | { op: 'insert'; patch: IntakeRecordPatch & { address: string } }
  | { op: 'update'; record: IntakeRecord; patch: IntakeRecordPatch };

interface Row {
  out_id: number;
  updated_at: string;
  conflict: boolean;
}

function buildPayload(
  base: Partial<IntakeRecord>,
  patch: IntakeRecordPatch,
): Record<string, string | number | boolean | null> {
  const merged = { ...base, ...patch };
  return {
    project_id: merged.project_id ?? '',
    permit_id: merged.permit_id ?? '',
    address: merged.address ?? '',
    permit_num: merged.permit_num ?? '',
    permit_type: merged.permit_type ?? '',
    intake_date: merged.intake_date ?? '',
    is_placeholder: merged.is_placeholder ?? false,
    portal_url: merged.portal_url ?? '',
    link: merged.link ?? '',
  };
}

/** Insert path: server assigns the id. We synthesize a "next id" by
 *  finding the current max + 1. The upsert RPC INSERTs the row at that
 *  id; if it races with another insert, ON CONFLICT(id) DO NOTHING + a
 *  conflict response would surface, but in practice this is a single-
 *  admin editor with negligible collision risk. */
async function nextId(): Promise<number> {
  const { data, error } = await supabase
    .from('intake_records')
    .select('id')
    .order('id', { ascending: false })
    .limit(1);
  if (error) throw error;
  const maxId = (data?.[0]?.id ?? 0) as number;
  return maxId + 1;
}

export function useUpsertIntakeRecord() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<IntakeRecord, Error, UpsertIntakeInput>({
    mutationFn: async (input) => {
      if (input.op === 'insert') {
        const id = await nextId();
        const payload = buildPayload({}, input.patch);
        const { data, error } = await supabase.rpc(
          'bp_upsert_intake_records_row',
          { p_id: id, p_data: payload, p_expected_updated_at: null },
        );
        if (error) throw error;
        const row = (data as Row[])[0];
        if (!row) throw new Error('Insert returned no row');
        if (row.conflict) throw new Error('Insert id collision — retry');
        return {
          id: row.out_id,
          project_id: payload.project_id ? (payload.project_id as string) : null,
          permit_id:
            typeof payload.permit_id === 'number' ? payload.permit_id : null,
          address: (payload.address as string) || null,
          permit_num: (payload.permit_num as string) || null,
          permit_type: (payload.permit_type as string) || null,
          intake_date: (payload.intake_date as string) || null,
          is_placeholder: payload.is_placeholder as boolean,
          portal_url: (payload.portal_url as string) || null,
          link: (payload.link as string) || null,
          created_at: null,
          updated_at: row.updated_at,
        };
      }
      const payload = buildPayload(input.record, input.patch);
      const { data, error } = await supabase.rpc(
        'bp_upsert_intake_records_row',
        {
          p_id: input.record.id,
          p_data: payload,
          p_expected_updated_at: input.record.updated_at,
        },
      );
      if (error) throw error;
      const row = (data as Row[])[0];
      if (!row) throw new Error('Update returned no row');
      if (row.conflict) throw new OCCConflictError(0, 'Intake');
      return { ...input.record, ...input.patch, updated_at: row.updated_at };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.intakeRecords(tenantId),
      });
      // fix-199: a real-permit row's date now syncs to the linked permit
      // (bp_upsert_intake_records_row reverse sync) — refresh permit surfaces.
      queryClient.invalidateQueries({ queryKey: queryKeys.permitsAll });
    },
    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        queryClient.invalidateQueries({
          queryKey: queryKeys.intakeRecords(tenantId),
        });
      } else {
        pushToast(`Could not save intake — ${error.message}`, 'error');
      }
    },
  });
}
