import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast, pushRecoveredToast } from '../stores/toastStore';
import { occToken } from '../lib/occ';
import { occCall, occInsertKey, occRowKey } from '../lib/occQueue';
import { useAuthStore } from '../stores/authStore';
import type { ExternalTeamDirectoryFirm } from '../lib/database.types';

// fix-227: the central External Team directory — a tenant-scoped master list of
// consultant firms by discipline that POPULATES the per-project external-team
// picker. The per-project blob (projects.external_team) stays the source of
// truth; this only supplies reusable dropdown options.
//
// Reads go to the table (tenant-select RLS). ★ fix-666: WRITES go through
// `bp_upsert_external_firm` — see useUpsertDirectoryFirm. Reads are tolerant of a pre-migration prod (the table only exists
// after fix_227 is applied): a missing-table error returns empty so the picker
// silently falls back to free-text and the app never breaks before the migration
// lands.

const MISSING_TABLE = '42P01'; // undefined_table

const SELECT_COLS =
  'id, discipline, name, contact_name, contact_email, contact_phone, notes, active, created_at, updated_at';

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
  /** ★ fix-666: the firm's `updated_at` as the editor last saw it. Required
   *  by the server on an update — a missing one is refused as stale. */
  expectedUpdatedAt?: string | null;
}

/** ★ fix-666: what the server's stale-edit refusal (SQLSTATE 40001) reads as. */
export const STALE_FIRM_MESSAGE =
  'This firm changed since you loaded it — reload and try again.';

function isStaleRefusal(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === '40001'
  );
}

/** ★ bp_upsert_builder's convention for an optional field: `undefined` = leave
 *  it (NULL on the wire), `null` or blank = clear it (`''`). */
function optionalField(v: string | null | undefined): string | null {
  if (v === undefined) return null;
  return v ?? '';
}

// ===========================================================================
// ★★★ fix-666 §A (P-318 census 30) — ONE SERVER STEP, LIKE THE REST OF SETTINGS
// ===========================================================================
//
// This used to write the table directly. RLS made it admin-only, so it was
// never a hole, but it had none of the checks fix-608's Settings writes carry:
// no stale-edit check (the table had no updated_at — two admins editing one
// firm silently overwrote each other), no audit row, the tenant picked by a
// trigger, and a duplicate refused only by an exact-discipline unique index in
// Postgres' own words.
//
// `bp_upsert_external_firm` is the one write now: admin of the tenant, tenant
// decided server-side, the token compared BEFORE anything writes, the name
// trimmed, a duplicate in the discipline (ignoring case and spaces) refused
// with a sentence, and the audit_row trigger records it. Nothing on screen
// changes.

/** Add (insert) / rename / (de)activate / edit contacts of a directory firm. */
export function useUpsertDirectoryFirm() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<ExternalTeamDirectoryFirm, Error, UpsertDirectoryFirmInput>({
    meta: { write: 'bp_upsert_external_firm' },
    mutationFn: async (input) =>
      occCall(
        input.id
          ? occRowKey('external_team_directory', input.id)
          : occInsertKey('external_team_directory'),
        occToken(input.expectedUpdatedAt ?? null),
        async (expected) => {
          const { data, error } = await supabase.rpc('bp_upsert_external_firm', {
            p_id: input.id ?? null,
            p_discipline: input.discipline,
            p_name: input.name.trim(),
            p_contact_name: optionalField(input.contact_name),
            p_contact_email: optionalField(input.contact_email),
            p_contact_phone: optionalField(input.contact_phone),
            p_notes: optionalField(input.notes),
            p_active: input.active ?? null,
            p_expected_updated_at: input.id ? expected : null,
          });
          if (error) throw error;
          return data as ExternalTeamDirectoryFirm;
        },
        (firm) => firm?.updated_at ?? undefined,
      ),
    onSuccess: (firm) => {
      // ★ fix-666 (fix-73's pattern): the saved row — and its NEW token — goes
      //   into the list synchronously, so an edit made before the refetch lands
      //   posts the fresh stamp instead of being refused as stale.
      if (firm?.id) {
        queryClient.setQueryData<ExternalTeamDirectoryFirm[]>(
          queryKeys.externalTeamDirectory(tenantId),
          (rows) => rows?.map((r) => (r.id === firm.id ? { ...r, ...firm } : r)),
        );
      }
      queryClient.invalidateQueries({
        queryKey: queryKeys.externalTeamDirectory(tenantId),
      });
    },
    onError: (error) => {
      if (isStaleRefusal(error)) {
        // ★ The normal "changed elsewhere — reload" warning, plus a refetch so
        //   the fresh row (and its token) is already on screen.
        pushRecoveredToast(STALE_FIRM_MESSAGE, 'warn');
        queryClient.invalidateQueries({
          queryKey: queryKeys.externalTeamDirectory(tenantId),
        });
        return;
      }
      pushToast(`Could not save firm — ${error.message}`, 'error');
    },
  });
}
