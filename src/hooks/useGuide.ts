import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import {
  GUIDE_MEDIA_BUCKET,
  guideMediaObjectPath,
  refuseGuideMedia,
  type GuideAudience,
  type GuidePart,
  type GuideSection,
} from '../lib/guide';
import { isBareNetworkFailure } from '../lib/errorLogger';

// ===========================================================================
// ★★★ fix-670 (P-056) — the training guide's data
// ===========================================================================
//
// ★ Straight at the table, like useWhatsNew: the rules are exactly what RLS
//   says — every tenant member reads, tenant admins write. An RPC would be a
//   second place for those rules to drift.
//
// ★ Its OWN module, not added to useWhatsNew / useWhatsNewGuide: those two are
//   mocked WHOLE in the fix-350/387/657 tests, and a new export there would be
//   `undefined` inside every one of those mocks (fix-415's trap).

/** ★★ Explicit select — a column left out of this list is written and never
 *  read (fix-122, fix-386, fix-410). search_tsv is not read by the client. */
const SECTION_COLUMNS =
  'id, part, sort_order, slug, title, summary, audience, show_me, blocks, reviewed_on, updated_at';

export function useGuideSections() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<GuideSection[]>({
    queryKey: [...queryKeys.guideSectionsAll, tenantId ?? ''],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('guide_sections')
        .select(SECTION_COLUMNS)
        .order('part', { ascending: true })
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as GuideSection[];
    },
  });
}

export interface GuideHit {
  id: string;
  slug: string;
  title: string;
  rank: number;
  /** Matches wrapped in « » — see lib/whatsNew `snippetParts`. */
  snippet: string;
}

/** Settles `ms` after the last keystroke. A copy of useWhatsNewGuide's, kept
 *  here so a test that mocks that module whole cannot break this one. */
function useSettled<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/** ★★ bp_search_guide — the guide half of the one search box. Keyed under the
 *  sections prefix, so a realtime edit refreshes the results too. */
export function useGuideSearch(rawQuery: string) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const q = useSettled(rawQuery.trim(), 250);
  const enabled = !!tenantId && q.length >= 2;
  const query = useQuery<GuideHit[]>({
    queryKey: [...queryKeys.guideSectionsAll, 'search', tenantId ?? '', q],
    enabled,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_search_guide', { q });
      if (error) throw error;
      return ((data ?? []) as GuideHit[]).map((h) => ({
        id: h.id,
        slug: h.slug,
        title: h.title,
        rank: Number(h.rank),
        snippet: h.snippet ?? '',
      }));
    },
  });
  return { ...query, active: rawQuery.trim().length >= 2 };
}

export interface GuideSectionDraft {
  /** Absent when creating. */
  id?: string;
  part: GuidePart;
  sort_order: number;
  slug: string;
  title: string;
  summary: string;
  audience: GuideAudience[];
  show_me: string;
  blocks: unknown[];
  reviewed_on: string | null;
  /** ★ The updated_at the editor opened with — the save refuses to overwrite a
   *  section somebody else saved in between. */
  expected_updated_at?: string | null;
}

/** Thrown when the row moved under the editor. */
export class GuideConflictError extends Error {
  constructor() {
    super('Someone else saved this section while you were editing it. Close the editor to see their version, then make your change again.');
    this.name = 'GuideConflictError';
  }
}

/** ★★ Admin-only, and the gate is the DATABASE (RLS) — the hidden Edit button is
 *  a decoration. A non-admin who reached this is refused with 42501. */
export function useSaveGuideSection() {
  const qc = useQueryClient();
  return useMutation<void, Error, GuideSectionDraft>({
    meta: { write: 'guide_sections.upsert' },
    mutationFn: async (d) => {
      const row = {
        part: d.part,
        sort_order: d.sort_order,
        slug: d.slug.trim(),
        title: d.title.trim(),
        // Blank means ABSENT (fix-387): '' is written as NULL.
        summary: d.summary.replace(/\s+/g, ' ').trim() || null,
        audience: d.audience.length > 0 ? d.audience : ['everyone'],
        show_me: d.show_me.trim() || null,
        blocks: d.blocks,
        reviewed_on: d.reviewed_on,
        updated_at: new Date().toISOString(),
      };
      if (!d.id) {
        const { error } = await supabase.from('guide_sections').insert(row);
        if (error) throw error;
        return;
      }
      let req = supabase.from('guide_sections').update(row).eq('id', d.id);
      if (d.expected_updated_at) req = req.eq('updated_at', d.expected_updated_at);
      const { data, error } = await req.select('id');
      if (error) throw error;
      if ((data ?? []).length === 0) throw new GuideConflictError();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.guideSectionsAll });
    },
  });
}

/** Move up / Move down — writes only the rows whose place changed. */
export function useReorderGuideSections() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; part: GuidePart; sort_order: number }[]>({
    meta: { write: 'guide_sections.update' },
    mutationFn: async (changes) => {
      for (const c of changes) {
        const { error } = await supabase
          .from('guide_sections')
          .update({ part: c.part, sort_order: c.sort_order })
          .eq('id', c.id);
        if (error) throw error;
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.guideSectionsAll });
    },
  });
}

export function useDeleteGuideSection() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    meta: { write: 'guide_sections.delete' },
    mutationFn: async (id) => {
      const { error } = await supabase.from('guide_sections').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.guideSectionsAll });
    },
  });
}

/** Upload one GIF / image / video to `guide-media`; resolves to its path. */
export function useUploadGuideMedia() {
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<string, Error, File>({
    meta: { write: 'storage:guide-media.upload' },
    mutationFn: async (file) => {
      if (!tenantId) throw new Error('No active tenant.');
      const refusal = refuseGuideMedia(file);
      if (refusal) throw new Error(refusal);
      const path = guideMediaObjectPath(tenantId, file.name);
      const { error } = await supabase.storage
        .from(GUIDE_MEDIA_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error(`Storage refused the file — ${error.message}`);
      return path;
    },
  });
}

/** Best-effort removal of objects no saved section points at any more. */
export async function removeGuideMedia(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await supabase.storage.from(GUIDE_MEDIA_BUCKET).remove(paths);
}

const SIGNED_URL_TTL_SECONDS = 60 * 60;

/** A signed URL for one `guide-media` object — the useSignedAvatarUrl shape:
 *  keyed on the path, re-signed ten minutes before expiry, a blip retried. */
export function useSignedGuideMediaUrl(path: string | null) {
  return useQuery<string | null>({
    queryKey: ['guide_media_url', path ?? ''],
    enabled: !!path,
    staleTime: (SIGNED_URL_TTL_SECONDS - 600) * 1000,
    gcTime: SIGNED_URL_TTL_SECONDS * 1000,
    retry: (failureCount, error) => failureCount < 2 && isBareNetworkFailure(error),
    retryDelay: (attempt) => 300 * 3 ** attempt,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(GUIDE_MEDIA_BUCKET)
        .createSignedUrl(path as string, SIGNED_URL_TTL_SECONDS);
      if (error) throw error;
      return data?.signedUrl ?? null;
    },
  });
}
