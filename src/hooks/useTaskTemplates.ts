import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type {
  TaskTemplate,
  TaskTemplateSubtask,
} from '../lib/database.types';

// Q7.3.c: read all task_templates + task_template_subtasks for the
// active tenant in parallel. Total payload is small (70 templates +
// 41 subtasks in production) so we fetch everything once and let the
// AdminPermitsTab filter by (permit_type, jurisdiction, bucket) in
// memory. Returns a grouping map: scope-key → templates[] (with
// subtasks attached) for fast lookup.
//
// Scope key format: `${permit_type}||${jurisdiction ?? ''}||${bucket}`.

export interface TaskTemplateWithSubtasks extends TaskTemplate {
  subtasks: TaskTemplateSubtask[];
}

export interface TaskTemplatesResult {
  templates: TaskTemplate[];
  subtasks: TaskTemplateSubtask[];
  /** Per-scope: sorted by sort_order, then text. Subtasks attached. */
  byScope: Map<string, TaskTemplateWithSubtasks[]>;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function scopeKey(
  permit_type: string,
  jurisdiction: string | null,
  bucket: string,
): string {
  return `${permit_type}||${jurisdiction ?? ''}||${bucket}`;
}

export function useTaskTemplates(): TaskTemplatesResult {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const [tplQ, subQ] = useQueries({
    queries: [
      {
        queryKey: queryKeys.taskTemplates(tenantId ?? ''),
        enabled: !!tenantId,
        queryFn: async () => {
          const { data, error } = await supabase
            .from('task_templates')
            .select(
              'id, permit_type, jurisdiction, bucket, text, ' +
                'default_assignee, default_target_offset, cat, ' +
                'sort_order, updated_at',
            );
          if (error) throw error;
          // PostgREST infers a GenericStringError-laden union from the
          // select string that doesn't unify with TaskTemplate. Cast via
          // unknown — columns match the interface exactly.
          return (data ?? []) as unknown as TaskTemplate[];
        },
      },
      {
        queryKey: queryKeys.taskTemplateSubtasks(tenantId ?? ''),
        enabled: !!tenantId,
        queryFn: async () => {
          const { data, error } = await supabase
            .from('task_template_subtasks')
            .select('id, template_id, text, sort_order, updated_at');
          if (error) throw error;
          return (data ?? []) as unknown as TaskTemplateSubtask[];
        },
      },
    ],
  });

  const templates = useMemo(() => tplQ.data ?? [], [tplQ.data]);
  const subtasks = useMemo(() => subQ.data ?? [], [subQ.data]);

  const byScope = useMemo(() => {
    const subsByTemplate = new Map<string, TaskTemplateSubtask[]>();
    for (const s of subtasks) {
      const list = subsByTemplate.get(s.template_id) ?? [];
      list.push(s);
      subsByTemplate.set(s.template_id, list);
    }
    for (const [, list] of subsByTemplate) {
      list.sort(
        (a, b) =>
          (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
          a.text.localeCompare(b.text),
      );
    }

    const map = new Map<string, TaskTemplateWithSubtasks[]>();
    for (const t of templates) {
      const key = scopeKey(t.permit_type, t.jurisdiction, t.bucket);
      const list = map.get(key) ?? [];
      list.push({ ...t, subtasks: subsByTemplate.get(t.id) ?? [] });
      map.set(key, list);
    }
    for (const [, list] of map) {
      list.sort(
        (a, b) =>
          (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
          a.text.localeCompare(b.text),
      );
    }
    return map;
  }, [templates, subtasks]);

  return {
    templates,
    subtasks,
    byScope,
    isLoading: tplQ.isLoading || subQ.isLoading,
    error: (tplQ.error ?? subQ.error) as Error | null,
    refetch: () => {
      tplQ.refetch();
      subQ.refetch();
    },
  };
}
