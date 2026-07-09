import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { ExternalTeamDirectoryFirm } from '../lib/database.types';

// fix-227: the central External Team directory — a tenant-scoped master list of
// consultant firms by discipline that POPULATES the per-project external-team
// picker. The per-project blob (projects.external_team) stays the source of
// truth; this only supplies reusable dropdown options.
//
// Direct table access gated by RLS (admin-write, tenant-select), mirroring
// useBuilders. Reads are tolerant of a pre-migration prod (the table only exists
// after fix_227 is applied): a missing-table error returns empty so the picker
// silently falls back to free-text and the app never breaks before the migration
// lands. tenant_id is filled server-side by the default_tenant_id_to_caller
// trigger, so inserts don't pass it.

const MISSING_TABLE = '42P01'; // undefined_table

const SELECT_COLS =
  'id, discipline, name, contact_name, contact_email, contact_phone, notes, active, created_at';

/** Every directory firm in the tenant (active + inactive). The Settings panel
 *  shows both; the per-project picker filters to active. */
export function useExternalTeamDirectory() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<ExternalTeamDirectoryFirm[]>({
    queryKey: queryKeys.externalTeamDirectory(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('external_team_directory')
        .select(SELECT_COLS)
        .order('discipline', { ascending: true })
        .order('name', { ascending: true });
      if (error) {
        if (error.code === MISSING_TABLE) return [];
        throw error;
      }
      return (data ?? []) as ExternalTeamDirectoryFirm[];
    },
  });
}

export interface UpsertDirectoryFirmInput {
  /** Omit `id` to insert; include `id` to update. */
  id?: string;
  discipline: string;
  name: string;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
  active?: boolean;
}

/** Add (insert) / rename / (de)activate a directory firm. RLS enforces
 *  admin-only writes; a non-admin's write fails with a toast. */
export function useUpsertDirectoryFirm() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<ExternalTeamDirectoryFirm, Error, UpsertDirectoryFirmInput>({
    mutationFn: async (input) => {
      if (input.id) {
        // Update: only send the fields the caller set (rename / toggle active /
        // edit contacts). discipline is immutable on update in practice, but we
        // pass it through when provided.
        const patch: Record<string, unknown> = {
          discipline: input.discipline,
          name: input.name.trim(),
        };
        if (input.contact_name !== undefined) patch.contact_name = input.contact_name;
        if (input.contact_email !== undefined) patch.contact_email = input.contact_email;
        if (input.contact_phone !== undefined) patch.contact_phone = input.contact_phone;
        if (input.notes !== undefined) patch.notes = input.notes;
        if (input.active !== undefined) patch.active = input.active;
        const { data, error } = await supabase
          .from('external_team_directory')
          .update(patch)
          .eq('id', input.id)
          .select(SELECT_COLS)
          .single();
        if (error) throw error;
        return data as ExternalTeamDirectoryFirm;
      }
      const payload = {
        discipline: input.discipline,
        name: input.name.trim(),
        contact_name: input.contact_name ?? null,
        contact_email: input.contact_email ?? null,
        contact_phone: input.contact_phone ?? null,
        notes: input.notes ?? null,
        active: input.active ?? true,
      };
      const { data, error } = await supabase
        .from('external_team_directory')
        .insert(payload)
        .select(SELECT_COLS)
        .single();
      if (error) throw error;
      return data as ExternalTeamDirectoryFirm;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.externalTeamDirectory(tenantId),
      });
    },
    onError: (error) => {
      pushToast(`Could not save firm — ${error.message}`, 'error');
    },
  });
}
