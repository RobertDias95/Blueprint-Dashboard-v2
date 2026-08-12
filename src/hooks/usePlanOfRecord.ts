import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { ProjectPlanOfRecordRow } from '../lib/database.types';

// fix-285: one project's Design Plan of Record.
//
// READ ONLY, and structurally so. `authenticated` has SELECT on the view and
// nothing else; the rows are written by the file_indexer on Bobby's PC under
// service_role. There is deliberately no mutation hook in this file, and none
// belongs here — the share is the source of truth and the indexer is its only
// writer.
//
// The view returns EXACTLY ONE ROW PER PROJECT (fix-284's `distinct on`), so
// this is `.maybeSingle()`: no row is the empty state, and two rows would be a
// bug in the view rather than something for the UI to arbitrate.
//
// RLS scopes rows to the caller's tenant, so the filter is project_id alone;
// tenantId only participates in the cache key (the Q5.5.D convention) so a
// tenant switch cannot serve another tenant's cached row.

const SELECT_COLUMNS =
  'project_id,tenant_id,file_index_id,set_type,stage_rank,file_name,' +
  'unc_path,folder_name,modified_at,size_kb,thumb_path,thumb_status,' +
  'thumb_generated_at';

/** The indexer runs once a day. Re-asking every 30 seconds would be asking a
 *  question whose answer cannot have changed. */
const A_DAY_ISH = 60 * 60 * 1000;

export function usePlanOfRecord(projectId: string | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<ProjectPlanOfRecordRow | null>({
    queryKey: queryKeys.planOfRecord(tenantId ?? '', projectId ?? ''),
    enabled: Boolean(projectId) && !!tenantId,
    staleTime: A_DAY_ISH,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_plan_of_record')
        .select(SELECT_COLUMNS)
        .eq('project_id', projectId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as ProjectPlanOfRecordRow | null;
    },
  });
}

/**
 * A signed URL for one thumbnail object.
 *
 * ★ SIGNED, ALWAYS. The plan-thumbnails bucket is PRIVATE — this is drawing
 * content and must be no more reachable than the rest of the tenant's data.
 * There is no getPublicUrl call anywhere in this repo for this bucket, and
 * there must not be: a public URL would either 400 (because the bucket is
 * private) or, far worse, work — which would mean somebody had made it public.
 *
 * The signature is minted against the caller's own session, so the storage
 * policy (`the first path segment is a project in one of my tenants`) is what
 * actually authorises it. A user who cannot see the project cannot sign its
 * thumbnail.
 */
export const THUMB_BUCKET = 'plan-thumbnails';

/** Signatures last an hour; the query is refreshed comfortably before that so a
 *  tab left open overnight does not end up rendering a broken image. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const RESIGN_AFTER_MS = 45 * 60 * 1000;

export function usePlanOfRecordThumbnail(objectPath: string | null | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<string | null>({
    queryKey: queryKeys.planOfRecordThumb(tenantId ?? '', objectPath ?? ''),
    enabled: Boolean(objectPath) && !!tenantId,
    staleTime: RESIGN_AFTER_MS,
    // A missing object is a legitimate state (the indexer has not run yet), not
    // a transient failure — retrying it three times just delays the file card.
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(THUMB_BUCKET)
        .createSignedUrl(objectPath!, SIGNED_URL_TTL_SECONDS);
      if (error) throw error;
      return data?.signedUrl ?? null;
    },
  });
}
