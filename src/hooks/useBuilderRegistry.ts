import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { Builder } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-448 (P-098) — THE BUILDER/OWNER REGISTRY
// ===========================================================================
//
// Bobby, 2026-08-29: *"in our settings, we should have a builder/owner
// database. and builders could have different llcs per project too."*
//
// ★★★ EVERY WRITE GOES THROUGH AN RPC, AND THAT IS THE CHANGE. Before this,
// `useUpsertBuilder` wrote `public.builders` straight through PostgREST — no
// tenant check of its own, no OCC token, and (measured on origin/main) NO
// CALLERS AT ALL. It is replaced here rather than extended: the registry and
// the Project Overview cell's "Add new builder…" are two callers of one write
// path, which is the only way "text and link can never disagree again" stays
// true a ticket from now.
//
// ★★ THE ROW COUNT IS PART OF THE READ. The editor has to show how many
// projects use each LLC — it is what makes deactivating and merging safe to do
// — so the list query carries it. Measured on prod 2026-08-29: 61 rows, 56 in
// use, 5 linked to nothing, 148 projects linked, biggest is 16.

/** A catalogue row plus the one derived fact the editor needs. */
export interface BuilderRegistryRow extends Builder {
  address: string | null;
  updated_at: string | null;
  /** How many projects point at THIS row (not at this person). */
  projectCount: number;
}

/** One person, and the LLCs they trade under. Ruling 3's shape. */
export interface BuilderPersonGroup {
  name: string;
  rows: BuilderRegistryRow[];
  /** Projects across every LLC of this person. */
  projectCount: number;
}

/**
 * ★★ Both active AND inactive, deliberately.
 *
 * The picker hides retired rows; the REGISTRY must show them, or a row you
 * deactivated by mistake becomes unreachable — a delete by another name. They
 * render greyed and keep their links (see `groupByPerson`).
 */
export function useBuilderRegistry() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<BuilderRegistryRow[]>({
    queryKey: [...queryKeys.builders(tenantId ?? ''), 'registry'],
    enabled: !!tenantId,
    queryFn: async () => {
      const [buildersRes, projectsRes] = await Promise.all([
        supabase
          .from('builders')
          .select('id, name, company, email, phone, address, notes, active, updated_at')
          .order('name', { ascending: true }),
        // ★ One extra read rather than a view: `projects` is already cached
        //   app-wide, this asks for the single column that answers the
        //   question, and a view would have needed the security_invoker +
        //   grant dance for a count anybody can already compute.
        supabase.from('projects').select('builder_id'),
      ]);
      if (buildersRes.error) throw buildersRes.error;
      if (projectsRes.error) throw projectsRes.error;

      const counts = new Map<string, number>();
      for (const p of (projectsRes.data ?? []) as { builder_id: string | null }[]) {
        if (!p.builder_id) continue;
        counts.set(p.builder_id, (counts.get(p.builder_id) ?? 0) + 1);
      }
      return ((buildersRes.data ?? []) as BuilderRegistryRow[]).map((b) => ({
        ...b,
        projectCount: counts.get(b.id) ?? 0,
      }));
    },
  });
}

/**
 * ★★★ GROUP BY PERSON — ruling 3, and the reason no schema change was needed.
 *
 * *"a builder (person) can carry several LLCs … a catalog row is one (person,
 * company/LLC) pair; a person may hold several rows; the picker and the editor
 * GROUP BY PERSON."* Prod already stores it that way: Ghennadi Ialanji holds 3
 * rows and Ted Chesledon 2.
 *
 * ★★ Keyed on the TRIMMED, CASE-FOLDED name, but the displayed name is the
 * first row's own spelling. Grouping case-sensitively would file "ted
 * chesledon" as a second person; rewriting the display name would quietly
 * "correct" data nobody asked us to touch.
 *
 * ★ Sorted person A→Z then company A→Z, with the no-company row first — an
 * owner not trading through an LLC is the base case, not an afterthought, and
 * 4 of the 61 rows are exactly that.
 */
export function groupByPerson(
  rows: readonly BuilderRegistryRow[],
): BuilderPersonGroup[] {
  const byName = new Map<string, BuilderPersonGroup>();
  for (const r of rows) {
    const key = (r.name ?? '').trim().toLowerCase();
    const g = byName.get(key) ?? { name: r.name, rows: [], projectCount: 0 };
    g.rows.push(r);
    g.projectCount += r.projectCount;
    byName.set(key, g);
  }
  const out = [...byName.values()];
  for (const g of out) {
    g.rows.sort((a, b) =>
      (a.company ?? '').localeCompare(b.company ?? ''),
    );
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export interface UpsertBuilderInput {
  /** Omit to insert; include to update. */
  id?: string;
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  active?: boolean | null;
  /** The row's `updated_at` when it was read. Required on an update. */
  expectedUpdatedAt?: string | null;
}

function useInvalidate() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.builders(tenantId) });
    // ★★ A merge rewrites `projects.builder_*`, and a plain upsert can change
    //    the contact details a project's cache is showing. Both caches, every
    //    time — one of them being stale is how "text and link disagree" comes
    //    back through a different door.
    queryClient.invalidateQueries({ queryKey: queryKeys.projects(tenantId) });
  };
}

export function useUpsertBuilderRow() {
  const invalidate = useInvalidate();
  return useMutation<Builder, Error, UpsertBuilderInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('bp_upsert_builder', {
        p_id: input.id ?? null,
        p_name: input.name,
        p_company: input.company ?? null,
        p_email: input.email ?? null,
        p_phone: input.phone ?? null,
        p_address: input.address ?? null,
        p_notes: input.notes ?? null,
        p_active: input.active ?? null,
        p_expected_updated_at: input.expectedUpdatedAt ?? null,
      });
      if (error) throw error;
      return data as Builder;
    },
    onSuccess: () => {
      invalidate();
      pushToast('Saved builder', 'success');
    },
    onError: (error) => {
      pushToast(`Could not save builder — ${error.message}`, 'error');
    },
  });
}

export function useDeactivateBuilder() {
  const invalidate = useInvalidate();
  return useMutation<Builder, Error, { id: string; active: boolean }>({
    mutationFn: async ({ id, active }) => {
      const { data, error } = await supabase.rpc('bp_deactivate_builder', {
        p_id: id,
        p_active: active,
      });
      if (error) throw error;
      return data as Builder;
    },
    onSuccess: (_d, v) => {
      invalidate();
      pushToast(v.active ? 'Builder reactivated' : 'Builder deactivated', 'success');
    },
    onError: (error) => {
      pushToast(`Could not change builder — ${error.message}`, 'error');
    },
  });
}

export interface MergeResult {
  moved: number;
  winner_id: string;
  loser_id: string;
}

export function useMergeBuilders() {
  const invalidate = useInvalidate();
  return useMutation<MergeResult, Error, { loserId: string; winnerId: string }>({
    mutationFn: async ({ loserId, winnerId }) => {
      const { data, error } = await supabase.rpc('bp_merge_builders', {
        p_loser_id: loserId,
        p_winner_id: winnerId,
      });
      if (error) throw error;
      return data as MergeResult;
    },
    onSuccess: (res) => {
      invalidate();
      pushToast(
        `Merged — ${res.moved} project${res.moved === 1 ? '' : 's'} repointed`,
        'success',
      );
    },
    onError: (error) => {
      pushToast(`Could not merge — ${error.message}`, 'error');
    },
  });
}

export interface RenamePersonResult {
  rows: number;
  projects: number;
  name: string;
}

/**
 * ★★★ fix-452 §A (P-102) — RENAME THE PERSON, NOT THE ROW.
 *
 * Bobby, 2026-08-30: *"if the builders name is spelled wrong, or all caps, i
 * want to be able to edit the grammatical issues"*.
 *
 * ★★★ WHY THIS IS NOT `useUpsertBuilderRow` WITH A NEW NAME. That writer
 * already updates `name` — for ONE row. Using it here would be the bug:
 * `groupByPerson` above keys on the trimmed, case-folded name, and its own
 * comment warns that rewriting one row's spelling *"would quietly create 'ted
 * chesledon' as a second person"*. Ghennadi Ialanji holds three rows;
 * correcting one of three SPLITS him into two groups on screen.
 *
 * ★★ AND A LOOP OVER THAT WRITER IS THE SAME BUG WITH EXTRA STEPS — three
 * sequential calls that fail on the second leave a person renamed in half. The
 * RPC does both statements in one transaction, and it also rewrites
 * `projects.builder_name`, which is a READ copy: the Overview cell displays it,
 * and `lib/redesignAnalytics` groups redesign cohorts by it WITHOUT
 * case-folding — so a catalogue-only rename would make "GERRARD FLOYD" and
 * "Gerrard Floyd" two builders in that report.
 *
 * ★ Reuses `useInvalidate` deliberately (§A5): it busts BOTH the builders and
 *   the projects caches, and a renamed person whose projects still show the old
 *   spelling is the failure anybody would actually notice.
 */
export function useRenameBuilderPerson() {
  const invalidate = useInvalidate();
  return useMutation<RenamePersonResult, Error, { oldName: string; newName: string }>({
    mutationFn: async ({ oldName, newName }) => {
      const { data, error } = await supabase.rpc('bp_rename_builder_person', {
        p_old_name: oldName,
        p_new_name: newName,
      });
      if (error) throw error;
      return data as RenamePersonResult;
    },
    onSuccess: (res) => {
      invalidate();
      pushToast(
        `Renamed — ${res.rows} row${res.rows === 1 ? '' : 's'}, ${res.projects} project${res.projects === 1 ? '' : 's'}`,
        'success',
      );
    },
    onError: (error) => {
      pushToast(`Could not rename — ${error.message}`, 'error');
    },
  });
}
