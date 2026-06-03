import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { UnitType } from '../lib/database.types';

// fix-22: extended to match the new bp_create_project_with_permits RPC
// signature (Migration 5). Adds p_project_data with the 13 new project-
// level columns; each permit now carries task_template_ids[] (uuids) so
// Step 4's task toggles map directly to permit_tasks inserts.
//
// Q5 conflict semantics preserved: address collision returns conflict=true
// with the existing project_id; other errors throw.

/** Per-permit payload — fields default to undefined; the hook wires
 *  undefined → null on the wire so the DB keeps clean NULLs. */
export interface PermitInput {
  type: string;
  num?: string;
  da?: string;
  dm?: string;
  ent_lead?: string;
  dual_da?: string;
  architect?: string;
  target_submit?: string;
  /** fix-25c: ACQ Target Date from the wizard. Maps to
   *  permits.expected_issue (the column Schedule Health labels
   *  "ACQ Target"). target_submit stays NULL on wizard-created permits. */
  expected_issue?: string;
  /** REQUIRED on the new signature. Empty array = create no tasks for
   *  this permit (Bobby's "task toggle behavior" decision). */
  task_template_ids: string[];
}

/** Project-level fields collected by Step 1; serialized as p_project_data.
 *  Migration 6 added builder_name/_company/_email/_phone; Migration 7
 *  taught the RPC to read them from this payload (NULLIF(..., '') →
 *  projects.builder_*). */
export interface ProjectData {
  entitlement_lead?: string | null;
  design_manager?: string | null;
  acq_lead?: string | null;
  go_date?: string | null;
  units?: number | null;
  zone?: string | null;
  lot_width?: number | null;
  lot_depth?: number | null;
  unit_types?: UnitType[] | null;
  parking_type?: string | null;
  parking_stalls?: number | null;
  alley?: string | null;
  /** fix-91: was a single string column, now an array. The RPC reads
   *  this as a jsonb array and stores it in projects.product_types
   *  (text[] NOT NULL DEFAULT '{}'). Empty array is the "no types
   *  selected" representation. */
  product_types?: string[] | null;
  project_tags?: string[] | null;
  builder_name?: string | null;
  builder_company?: string | null;
  builder_email?: string | null;
  builder_phone?: string | null;
  /** fix-107: Step 1's Lead Design Associate. When set, the RPC's BP
   *  branch calls bp_next_available_da_slot to find the first gap on
   *  that DA's lane and writes both the BP's dd_start/dd_end and a
   *  matching draw_schedule row. Leaving this null preserves the
   *  pre-fix flow — the wizard's post-create bp_place_new_project_on_da
   *  call then handles placement using whatever DA the first selected
   *  permit picked (same behavior as today). */
  lead_da?: string | null;
}

export interface CreateProjectInput {
  address: string;
  juris: string;
  notes?: string;
  project_data: ProjectData;
  permits: PermitInput[];
}

export interface CreateProjectResult {
  project_id: string;
  permit_ids: number[];
  conflict: boolean;
}

export function useCreateProjectWithPermits() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId);

  return useMutation<CreateProjectResult, Error, CreateProjectInput>({
    mutationFn: async (input) => {
      if (!tenantId) {
        throw new Error('No active tenant — cannot create project');
      }
      const { data, error } = await supabase.rpc(
        'bp_create_project_with_permits',
        {
          p_tenant_id: tenantId,
          p_address: input.address,
          p_juris: input.juris,
          p_notes: input.notes ?? null,
          p_project_data: input.project_data,
          p_permits: input.permits,
        },
      );
      if (error) throw error;
      const row = (data as CreateProjectResult[])[0];
      if (!row) throw new Error('RPC returned no row');
      return row;
    },

    onSuccess: (result) => {
      // Bare-prefix invalidation matches every tenant variant.
      queryClient.invalidateQueries({ queryKey: queryKeys.projectsAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.permitsAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.permitTasksAll });
      if (!result.conflict) {
        pushToast('Project created', 'success');
      }
    },

    onError: (error) => {
      pushToast(`Could not create project — ${error.message}`, 'error');
    },
  });
}
