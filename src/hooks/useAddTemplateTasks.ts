import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';

// ★ fix-609 (P-306): add a permit's template tasks after the fact — the offer
//   made to a permit added to an existing project, and to any open permit
//   with no tasks. The server (`bp_add_template_tasks_to_permit`) refuses a
//   template that does not apply, refuses a person who may not edit the
//   project (`bp_may_write_project`), and skips a template already applied.
//
// ★★ INVALIDATION. Every task read lives under the bare `permit_tasks` prefix:
//    the permit's own tree (`permitTaskTree`), My Tasks (`permitTasks` /
//    `myTasks` / the 'all' list) and Waiting On (`waitingOnTasks`). So
//    `queryKeys.permitTasksAll` reaches all of them, and the two neighbours
//    that also read tasks are named beside it.

export interface AddTemplateTasksInput {
  permitId: number;
  templateIds: string[];
}

export function useAddTemplateTasks() {
  const queryClient = useQueryClient();
  return useMutation<number, Error, AddTemplateTasksInput>({
    meta: { write: 'bp_add_template_tasks_to_permit' },
    mutationFn: async ({ permitId, templateIds }) => {
      const { data, error } = await supabase.rpc('bp_add_template_tasks_to_permit', {
        p_permit_id: permitId,
        p_template_ids: templateIds,
      });
      if (error) throw error;
      return typeof data === 'number' ? data : 0;
    },
    onSuccess: (n) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.permitTasksAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboardPermitCardsAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskProvenanceAll });
      pushToast(
        n === 1 ? 'Added 1 template task.' : `Added ${n} template tasks.`,
        'success',
      );
    },
    onError: (error) => {
      pushToast(`Could not add template tasks — ${error.message}`, 'error');
    },
  });
}
