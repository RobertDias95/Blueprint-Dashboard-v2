import { useContext, useMemo } from 'react';
import {
  QueryClient,
  QueryClientContext,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import {
  FALLBACK_DEPARTMENTS,
  sortDepartments,
  type DepartmentRow,
} from '../lib/departmentList';

export { FALLBACK_DEPARTMENTS, sortDepartments, type DepartmentRow };

// ===========================================================================
// ★★★ fix-670 §A (P-351) — THE ONE HOOK THAT READS THE DEPARTMENT LIST
// ===========================================================================
//
// Bobby: *"i need to be able to add their departments, so their labels are
// accurate to their roles in the company."* The list is `public.departments`
// now (the migration seeded the seven that existed). Every picker, filter and
// label reads it through here.
//
// ★★ THE BUILT-IN SEVEN ARE ONLY THE FALLBACK — while the query loads, when it
//    fails, and in a provider-less test. A list that briefly showed nothing
//    would read as "no departments" and blank every label on the screen.

/**
 * ★★ A DORMANT CLIENT FOR A TREE WITH NO PROVIDER. This hook is called from
 *    the shell (the name plate), My Board and My Tasks, whose suites render
 *    with every data hook mocked and no QueryClientProvider. Rather than make
 *    seven suites learn a new mock, the query runs against this idle client
 *    with `enabled: false` there — so it never fetches and the list is the
 *    built-in seven. In the app the provider always exists and this is unused.
 *    The hook order is identical either way.
 */
const NO_PROVIDER_CLIENT = new QueryClient();

export function useDepartments() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const provided = useContext(QueryClientContext);
  const q = useQuery<DepartmentRow[]>(
    {
      queryKey: queryKeys.departments(tenantId ?? ''),
      enabled: !!tenantId && !!provided,
      queryFn: async () => {
        const { data, error } = await supabase
          .from('departments')
          .select('key, label, sort_order')
          .order('sort_order', { ascending: true });
        if (error) throw error;
        return (data ?? []) as DepartmentRow[];
      },
    },
    provided ?? NO_PROVIDER_CLIENT,
  );

  const list = useMemo(
    () => sortDepartments(q.data && q.data.length > 0 ? q.data : FALLBACK_DEPARTMENTS),
    [q.data],
  );
  const labels = useMemo(() => new Map(list.map((d) => [d.key, d.label])), [list]);
  /** True while the list shown is the built-in fallback, not the table. */
  const isFallback = !(q.data && q.data.length > 0);

  return { ...q, list, labels, isFallback };
}

function useInvalidateDepartments() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.departments(tenantId) });
  };
}

/** Add (key null — the server makes the key from the label) or rename (the key
 *  never changes: `team_members.department` joins on it). */
export function useUpsertDepartment() {
  const invalidate = useInvalidateDepartments();
  return useMutation<DepartmentRow, Error, { key: string | null; label: string }>({
    meta: { write: 'bp_upsert_department' },
    mutationFn: async ({ key, label }) => {
      const { data, error } = await supabase.rpc('bp_upsert_department', {
        p_key: key,
        p_label: label,
      });
      if (error) throw error;
      const row = (data as DepartmentRow[] | null)?.[0];
      if (!row) throw new Error('The department was not saved.');
      return row;
    },
    onSuccess: (_row, input) => {
      invalidate();
      pushToast(input.key ? 'Department renamed' : 'Department added', 'success');
    },
    onError: (e) => pushToast(`Could not save the department — ${e.message}`, 'error'),
  });
}

export function useReorderDepartments() {
  const invalidate = useInvalidateDepartments();
  return useMutation<number, Error, string[]>({
    meta: { write: 'bp_reorder_departments' },
    mutationFn: async (keys) => {
      const { data, error } = await supabase.rpc('bp_reorder_departments', { p_keys: keys });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: () => invalidate(),
    onError: (e) => pushToast(`Could not reorder departments — ${e.message}`, 'error'),
  });
}

export function useDeleteDepartment() {
  const invalidate = useInvalidateDepartments();
  return useMutation<boolean, Error, string>({
    meta: { write: 'bp_delete_department' },
    mutationFn: async (key) => {
      const { data, error } = await supabase.rpc('bp_delete_department', { p_key: key });
      if (error) throw error;
      return data === true;
    },
    onSuccess: () => {
      invalidate();
      pushToast('Department removed', 'success');
    },
    onError: (e) => pushToast(`Could not remove the department — ${e.message}`, 'error'),
  });
}
