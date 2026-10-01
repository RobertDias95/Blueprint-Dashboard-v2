import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { Builder } from '../lib/database.types';

// Q9.5.e-fix-3: builders catalog. Read-only list (active builders only) plus
// a `useUpsertBuilder` mutation for the "Create new" path in the Builder/
// Owner cell. The fix-3 migration adds projects.builder_id FK so v2 can
// reference an existing builders row instead of duplicating fields per
// project.

export function useBuilders() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<Builder[]>({
    queryKey: queryKeys.builders(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('builders')
        .select('id, name, company, email, phone, notes, active')
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Builder[];
    },
  });
}

// ===========================================================================
// ★★★ fix-608 (census gap 31) — THE DIRECT-TABLE WRITE IS GONE
// ===========================================================================
//
// This file used to export `useUpsertBuilder` + `UpsertBuilderInput`, which wrote
// `public.builders` straight through PostgREST — no RPC, no OCC token, no admin
// check, and `tenant_id` left to the RLS default. **Nothing imported it.** It was
// superseded by `hooks/useBuilderRegistry`'s `useUpsertBuilderRow`
// (`bp_upsert_builder`, serialised and token-checked) and simply never deleted.
//
// ★★ DELETING IT IS PART OF THE SECURITY CHANGE, NOT TIDYING. fix-608 makes the
//    `builders` INSERT/UPDATE/DELETE policies admin-only, so this path would have
//    started failing for non-admins the moment the migration applied — as a raw
//    PostgREST error, from a code path nobody knew was reachable. Removing it
//    means there is exactly one write door per intention: the admin RPC for
//    editing, and `bp_add_builder_from_project` for adding from a project.
//
// ★ The READ stays. `useBuilders` above has live callers.
