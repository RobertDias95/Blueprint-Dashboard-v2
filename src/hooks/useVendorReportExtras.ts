import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';

// fix-265: the two project columns the vendor forecast needs that the shared
// useProjects() select does not carry — reused_from_project_id (fix-216, live)
// and reuse_notes (NEW in the fix-265 migration).
//
// WHY A SEPARATE QUERY. useProjects() lists its columns explicitly and is read
// by the Dashboard, Project List, My Tasks and every report. Adding an
// unapplied column to that select would 400 the query that the WHOLE APP
// depends on the moment this branch merged ahead of the migration. Keeping the
// new column here confines the blast radius to this one report.
//
// It also degrades on purpose: if reuse_notes does not exist yet, the first
// select fails and we retry without it, so the report renders (with a blank
// reuse-notes column and a banner) both before and after the migration is
// applied. Once applied, the first select simply succeeds.

export interface VendorProjectExtras {
  reusedFromProjectId: Map<string, string>;
  reuseNotes: Map<string, string>;
  /** True when reuse_notes is not in the schema yet — the fix-265 migration has
   *  not been applied. Drives the "migration pending" banner. */
  migrationPending: boolean;
}

interface Row {
  id: string;
  reused_from_project_id: string | null;
  reuse_notes?: string | null;
}

const EMPTY: VendorProjectExtras = {
  reusedFromProjectId: new Map(),
  reuseNotes: new Map(),
  migrationPending: false,
};

export function useVendorReportExtras() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<VendorProjectExtras>({
    queryKey: queryKeys.vendorProjectExtras(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      let migrationPending = false;
      let rows: Row[];

      const withNotes = await supabase
        .from('projects')
        .select('id, reused_from_project_id, reuse_notes');

      if (withNotes.error) {
        // Pre-migration: reuse_notes is not a column yet. Fall back to the
        // columns that do exist rather than failing the whole report.
        migrationPending = true;
        const fallback = await supabase
          .from('projects')
          .select('id, reused_from_project_id');
        if (fallback.error) throw fallback.error;
        rows = (fallback.data ?? []) as unknown as Row[];
      } else {
        rows = (withNotes.data ?? []) as unknown as Row[];
      }

      const out: VendorProjectExtras = {
        reusedFromProjectId: new Map(),
        reuseNotes: new Map(),
        migrationPending,
      };
      for (const r of rows) {
        if (r.reused_from_project_id) {
          out.reusedFromProjectId.set(r.id, r.reused_from_project_id);
        }
        const notes = (r.reuse_notes ?? '').trim();
        if (notes) out.reuseNotes.set(r.id, notes);
      }
      return out;
    },
    // A schema-shape probe: no point retrying a missing column.
    retry: false,
    placeholderData: EMPTY,
  });
}
