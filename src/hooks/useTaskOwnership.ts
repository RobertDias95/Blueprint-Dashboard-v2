import { useMemo } from 'react';
import { usePermits } from './usePermits';
import { useProjects } from './useProjects';
import { useDmDaGroups } from './useDmDaGroups';
import { findDmForDa } from '../components/wizard/dmRouting';
import {
  taskMatchesSelfResolved,
  type TaskOwnershipContext,
} from '../lib/selfScope';
import type { MyTaskNode } from '../lib/database.types';

// fix-238: shared My-Tasks ownership resolver.
//
// The My Tasks board's "Mine" scope filter and the Waiting On view both narrow
// to the logged-in user's tasks. Ownership can't be read off the task row alone:
// permit_tasks.assigned_to is an overloaded text column holding ROLE placeholders
// ("Design Manager", "Schematic Team", …) that only resolve to a person once you
// know who fills that role on the task's project. Previously the filter matched
// on the server-derived primary_assignee (arch→da, ent→ent_lead) which ignored
// assigned_to entirely — so a task switched to "Design Manager" stayed in the
// DA's list and never reached the DM's (the reported 4040/4060 E Via Estrella
// bug).
//
// This hook builds each task's role context from the cached permits + projects +
// dm_da_groups the app already loads — the SAME sources the task chip resolves
// its displayed owner from — so a task always routes to the person it is shown
// as. Exposed as a single `matches(task, name)` predicate shared by both
// surfaces so their ownership definitions can't drift.

export interface TaskOwnership {
  /** True when `task` belongs in `name`'s My Tasks (see taskMatchesSelfResolved
   *  for the three rules). */
  matches: (
    task: Pick<
      MyTaskNode,
      'assigned_to' | 'discipline' | 'co_assignees' | 'permit_da' | 'permit_id' | 'project_id'
    >,
    name: string | null,
  ) => boolean;
}

export function useTaskOwnership(): TaskOwnership {
  const permitsQ = usePermits();
  const projectsQ = useProjects();
  const dmRows = useDmDaGroups().rows;

  const permitById = useMemo(() => {
    const m = new Map<
      number,
      { da: string | null; dm: string | null; ent_lead: string | null }
    >();
    for (const p of permitsQ.data ?? []) {
      m.set(p.id, { da: p.da, dm: p.dm, ent_lead: p.ent_lead });
    }
    return m;
  }, [permitsQ.data]);

  const projectById = useMemo(() => {
    const m = new Map<
      string,
      {
        design_manager: string | null;
        entitlement_lead: string | null;
        schematic: string[];
      }
    >();
    for (const p of projectsQ.data ?? []) {
      m.set(p.id, {
        design_manager: p.design_manager ?? null,
        entitlement_lead: p.entitlement_lead ?? null,
        schematic: p.schematic_designer ?? [],
      });
    }
    return m;
  }, [projectsQ.data]);

  const matches = useMemo(() => {
    return (
      task: Pick<
        MyTaskNode,
        | 'assigned_to'
        | 'discipline'
        | 'co_assignees'
        | 'permit_da'
        | 'permit_id'
        | 'project_id'
      >,
      name: string | null,
    ): boolean => {
      const permit = permitById.get(task.permit_id);
      const project = projectById.get(task.project_id);
      // DA rides on the task row (permit_da); fall back to the permit's da.
      const da = task.permit_da ?? permit?.da ?? null;
      const ctx: TaskOwnershipContext = {
        da,
        // Resolve the DM the SAME way the chip does (dm_da_groups keyed by DA)
        // so routing agrees with the displayed owner, then fall back to the
        // project's / permit's stored DM.
        dm: findDmForDa(da ?? '', dmRows) ?? project?.design_manager ?? permit?.dm ?? null,
        // Ent lead: the permit's lead first (per-permit PAR/SDOT/ECA routing),
        // then the project default.
        entLead: permit?.ent_lead ?? project?.entitlement_lead ?? null,
        schematicDesigners: project?.schematic ?? [],
      };
      return taskMatchesSelfResolved(task, name, ctx);
    };
  }, [permitById, projectById, dmRows]);

  return { matches };
}
