import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { WhatsNewEntry, WhatsNewKind } from '../lib/whatsNew';

// fix-350 — What's New: the data half.
//
// ★ Two queries and three mutations, all straight at the tables. No RPC, and
// that is deliberate: the rules this feature needs are exactly the rules RLS
// already expresses — everyone reads the entries, admins write them, and a
// person sees only their own read rows. An RPC would be a second place for
// those rules to live and a second place for them to drift.

export function useWhatsNewEntries() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<WhatsNewEntry[]>({
    queryKey: [...queryKeys.whatsNewEntriesAll, tenantId ?? ''],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('whats_new_entries')
        .select('id, published_on, kind, title, body, sort_order, updated_at')
        .order('published_on', { ascending: false })
        .order('sort_order', { ascending: false });
      if (error) throw error;
      return (data ?? []) as WhatsNewEntry[];
    },
  });
}

/** ★★ The ids THIS person has read.
 *
 *  ★ Keyed on the user as well as the tenant, like fix-307's board reads: two
 *  logins on one browser must not share a cache entry, which is the bug that
 *  would make "Bobby reading it cleared it for Cam" true in the client even
 *  though the database is correct. */
export function useWhatsNewReads() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  return useQuery<string[]>({
    queryKey: [...queryKeys.whatsNewReadsAll, tenantId ?? '', userId ?? ''],
    enabled: !!tenantId && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('whats_new_reads')
        .select('entry_id')
        .eq('user_id', userId);
      if (error) throw error;
      return (data ?? []).map((r) => (r as { entry_id: string }).entry_id);
    },
  });
}

/** ★ Mark entries read for the signed-in person.
 *
 *  ★★ `ignoreDuplicates` and an onConflict on (user_id, entry_id): the page
 *  marks everything unread as read when you open it, and opening it twice must
 *  be a no-op rather than a unique-violation the user sees as an error. */
export function useMarkWhatsNewRead() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  return useMutation<void, Error, string[]>({
    mutationFn: async (entryIds) => {
      if (!userId || entryIds.length === 0) return;
      const { error } = await supabase.from('whats_new_reads').upsert(
        entryIds.map((entry_id) => ({ user_id: userId, entry_id })),
        { onConflict: 'user_id,entry_id', ignoreDuplicates: true },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.whatsNewReadsAll });
    },
  });
}

export interface WhatsNewDraft {
  /** Absent when creating. */
  id?: string;
  published_on: string;
  kind: WhatsNewKind;
  title: string;
  body: string;
  sort_order?: number;
}

/** ★★ Admin-only, and the gate is the DATABASE. The editor is hidden from a
 *  non-admin in the page, but this mutation is a plain table write — a
 *  non-admin who reached it anyway is refused by the RLS policy with 42501,
 *  which is fix-234's lesson and the one fix-331 §6 had to go back and apply. */
export function useUpsertWhatsNewEntry() {
  const qc = useQueryClient();
  return useMutation<void, Error, WhatsNewDraft>({
    mutationFn: async (draft) => {
      const row = {
        published_on: draft.published_on,
        kind: draft.kind,
        title: draft.title.trim(),
        body: draft.body.trim(),
        sort_order: draft.sort_order ?? 0,
        updated_at: new Date().toISOString(),
      };
      const { error } = draft.id
        ? await supabase.from('whats_new_entries').update(row).eq('id', draft.id)
        : await supabase.from('whats_new_entries').insert(row);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.whatsNewEntriesAll });
    },
  });
}

export function useDeleteWhatsNewEntry() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const { error } = await supabase.from('whats_new_entries').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.whatsNewEntriesAll });
      // The FK is ON DELETE CASCADE, so the read rows went with it.
      void qc.invalidateQueries({ queryKey: queryKeys.whatsNewReadsAll });
    },
  });
}
