import type { Permit, PermitTask, Project } from './database.types';

// Q7.1.a: pure helpers for the My Tasks view. Mirrors v1's renderMyTasks
// logic (index.html lines 4917-5045) under v2's unified data model:
//   - assigned_to is one column (v1 had assignedTo + owner; unified here
//     with special-case role string handling per Q4c).
//   - No priority column → sort tiebreak is created_at (per Q1c).
//   - No extra_assignees / consultant fields (per Q2c / Q3b).
//   - Single "Assigned to" dropdown vs v1's ENT/DA/DM multi-select (Q7b).
//
// PM tasks are excluded — only DE + CO render in My Tasks.

const DAY_MS = 24 * 60 * 60 * 1000;

export type TaskState = 'not-started' | 'in-progress' | 'complete';

/** Derive a task's visual state from the unified completion_status + done +
 * start_date fields. v1 had separate DE/CO rules; under v2 the same
 * derivation works for both buckets because completion_status carries
 * 'Resolved' / 'In Progress' / 'Open' uniformly.
 *
 * Precedence:
 *   1. done OR completion_status === 'Resolved' → complete
 *   2. completion_status === 'In Progress' OR start_date is set → in-progress
 *   3. otherwise → not-started
 */
export function deriveTaskState(task: PermitTask): TaskState {
  if (task.done || task.completion_status === 'Resolved') return 'complete';
  if (task.completion_status === 'In Progress' || task.start_date) {
    return 'in-progress';
  }
  return 'not-started';
}

/** The effective "when is this due" date for a task. v1 falls back from
 * target_date to due_date — same here. Returns null if both missing. */
export function effectiveDueDate(task: PermitTask): string | null {
  return task.target_date ?? task.due_date ?? null;
}

/** Truncate a Date to local midnight + return ISO yyyy-mm-dd. */
function toDateKey(d: Date): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

/** Add `n` days to today (or `today`) at midnight, return ISO date. */
function addDaysKey(today: Date, n: number): string {
  const x = new Date(today);
  x.setHours(0, 0, 0, 0);
  x.setTime(x.getTime() + n * DAY_MS);
  return x.toISOString().slice(0, 10);
}

/** v1's overdue rule (line 4978): non-done task whose effective due date
 * is strictly before today. */
export function isOverdue(task: PermitTask, today: Date = new Date()): boolean {
  if (deriveTaskState(task) === 'complete') return false;
  const due = effectiveDueDate(task);
  if (!due) return false;
  return due < toDateKey(today);
}

/** v1's "due this week" rule (line 4980): non-done task whose effective
 * due date is in [today, today + 7 days] inclusive. Note this OVERLAPS
 * with isOverdue on the same task is impossible — overdue requires
 * < today, this requires >= today. */
export function isDueThisWeek(
  task: PermitTask,
  today: Date = new Date(),
): boolean {
  if (deriveTaskState(task) === 'complete') return false;
  const due = effectiveDueDate(task);
  if (!due) return false;
  return due >= toDateKey(today) && due <= addDaysKey(today, 7);
}

// ============================================================
// Filtering
// ============================================================

export interface TaskFilters {
  /** 'de' | 'co' | 'all'. PM is always excluded regardless of this. */
  stage: 'de' | 'co' | 'all';
  /** 'active' = not complete; 'done' = complete; 'not-started' / 'in-progress' =
   * derived state exact match. */
  status: 'active' | 'done' | 'not-started' | 'in-progress' | 'all';
  /** Exact match against task.assigned_to. Empty string = no filter. */
  assignee: string;
  /** Multi-token search; matches against task text, assignee, address,
   * juris, permit type/da/dm/ent_lead. */
  search: string;
  // Q9.5.f-fix-2 C: multi-select person/consultant filters. Empty Set = no
  // filter (matches the Dashboard/Reports filter conventions).
  entLeads: Set<string>;
  /** Matches against either permit.da OR permit.dual_da. */
  das: Set<string>;
  dms: Set<string>;
  /** Matches task.assigned_to when the value is something other than the
   *  internal 'Entitlements' / 'Architecture' team labels — i.e., a
   *  consultant firm name from the v2 consultantTypes config. */
  externalConsultants: Set<string>;
}

export interface FilterContext {
  permitsById: Map<number, Permit>;
  projectsById: Map<string, Project>;
}

/** Multi-token tokenizer — splits on whitespace + commas, lowercases. */
function tokenize(query: string): string[] {
  return query.toLowerCase().split(/[,\s]+/).filter(Boolean);
}

/** Build the searchable haystack for a task — task text, assignee, plus
 * everything reachable on the linked permit + project. */
function searchHaystack(
  task: PermitTask,
  ctx: FilterContext,
): string {
  const permit = ctx.permitsById.get(task.permit_id);
  const project = permit ? ctx.projectsById.get(permit.project_id) : undefined;
  const parts: (string | null | undefined)[] = [
    task.text,
    task.assigned_to,
    permit?.type,
    // fix-22 Mig 3 / fix-91: product types live on projects as an array.
    // Join for the search haystack.
    project?.product_types?.join(' '),
    permit?.da,
    permit?.dm,
    permit?.ent_lead,
    permit?.nickname,
    project?.address,
    project?.juris,
  ];
  return parts.filter((p): p is string => Boolean(p)).join(' ').toLowerCase();
}

/** Apply all four filters. PM is hard-excluded (v1 only iterates de/co). */
export function filterTasks(
  tasks: PermitTask[],
  filters: TaskFilters,
  ctx: FilterContext,
): PermitTask[] {
  const tokens = tokenize(filters.search);
  return tasks.filter((task) => {
    if (task.bucket === 'pm') return false;
    if (filters.stage !== 'all' && task.bucket !== filters.stage) return false;

    const state = deriveTaskState(task);
    if (filters.status === 'active' && state === 'complete') return false;
    if (filters.status === 'done' && state !== 'complete') return false;
    if (filters.status === 'not-started' && state !== 'not-started') return false;
    if (filters.status === 'in-progress' && state !== 'in-progress') return false;

    if (filters.assignee && (task.assigned_to ?? '') !== filters.assignee) {
      return false;
    }

    // Q9.5.f-fix-2 C: person/consultant filter checks. Each requires the
    // permit to be loaded in ctx (it always is when the page mounts), then
    // matches against the relevant column. Sets are empty by default so
    // these are no-ops unless the user has narrowed.
    const permit = ctx.permitsById.get(task.permit_id);
    if (filters.entLeads.size > 0) {
      if (!permit?.ent_lead || !filters.entLeads.has(permit.ent_lead)) return false;
    }
    if (filters.das.size > 0) {
      const da = permit?.da;
      const dualDa = permit?.dual_da;
      const matched =
        (da !== null && da !== undefined && filters.das.has(da)) ||
        (dualDa !== null && dualDa !== undefined && filters.das.has(dualDa));
      if (!matched) return false;
    }
    if (filters.dms.size > 0) {
      if (!permit?.dm || !filters.dms.has(permit.dm)) return false;
    }
    if (filters.externalConsultants.size > 0) {
      const a = task.assigned_to ?? '';
      if (!filters.externalConsultants.has(a)) return false;
    }

    if (tokens.length > 0) {
      const hay = searchHaystack(task, ctx);
      for (const t of tokens) {
        if (!hay.includes(t)) return false;
      }
    }
    return true;
  });
}

// ============================================================
// Sorting
// ============================================================

/** v1 sort (line 4998): effective due date ascending (missing → end),
 * tiebreak by created_at (older first). v1 used priority for tiebreak;
 * we don't have a priority column (Q1c), so created_at substitutes —
 * stable and meaningful (older tasks float up when dates tie). */
export function sortTasksForColumn(tasks: PermitTask[]): PermitTask[] {
  return [...tasks].sort((a, b) => {
    const da = effectiveDueDate(a) ?? '9999-12-31';
    const db = effectiveDueDate(b) ?? '9999-12-31';
    if (da !== db) return da < db ? -1 : 1;
    const ca = a.created_at ?? '';
    const cb = b.created_at ?? '';
    if (ca !== cb) return ca < cb ? -1 : 1;
    return 0;
  });
}

// ============================================================
// Stats row
// ============================================================

export interface TaskStats {
  open: number;
  overdue: number;
  thisWeek: number;
  projects: number;
  done: number;
  total: number;
  pct: number;
}

/** Stats computed across DE + CO after filters. Returns counts the v1
 * stats row displays (line 4983-4992). `projects` counts distinct
 * project_ids touched by non-complete tasks. */
export function computeStats(
  tasks: PermitTask[],
  ctx: FilterContext,
  today: Date = new Date(),
): TaskStats {
  let open = 0;
  let overdue = 0;
  let thisWeek = 0;
  let done = 0;
  const total = tasks.length;
  const projectIdsOpen = new Set<string>();

  for (const task of tasks) {
    const state = deriveTaskState(task);
    if (state === 'complete') {
      done++;
      continue;
    }
    open++;
    if (isOverdue(task, today)) overdue++;
    if (isDueThisWeek(task, today)) thisWeek++;
    const permit = ctx.permitsById.get(task.permit_id);
    if (permit) projectIdsOpen.add(permit.project_id);
  }

  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return {
    open,
    overdue,
    thisWeek,
    projects: projectIdsOpen.size,
    done,
    total,
    pct,
  };
}

// ============================================================
// Dropdown options
// ============================================================

/** Distinct non-empty assigned_to values across the task set, sorted. Used
 * to populate the "Assigned to" dropdown (Q7b). Production data is mostly
 * group names today (Entitlements, Architecture); real names show up as
 * they appear in the data. */
export function assignedToOptions(tasks: PermitTask[]): string[] {
  const set = new Set<string>();
  for (const t of tasks) {
    const v = (t.assigned_to ?? '').trim();
    if (v) set.add(v);
  }
  return Array.from(set).sort();
}

// Q9.5.f-fix-2 C: person/consultant dropdown option derivers. Each picks
// distinct non-empty values from the linked permits + tasks; alpha-sorted.

export function entLeadOptions(permits: Permit[]): string[] {
  const set = new Set<string>();
  for (const p of permits) if (p.ent_lead) set.add(p.ent_lead);
  return Array.from(set).sort();
}

export function daOptions(permits: Permit[]): string[] {
  const set = new Set<string>();
  for (const p of permits) {
    if (p.da) set.add(p.da);
    if (p.dual_da) set.add(p.dual_da);
  }
  return Array.from(set).sort();
}

export function dmOptions(permits: Permit[]): string[] {
  const set = new Set<string>();
  for (const p of permits) if (p.dm) set.add(p.dm);
  return Array.from(set).sort();
}

/** External-consultant options = distinct task.assigned_to values that are
 * NOT the internal 'Entitlements' / 'Architecture' labels. These end up
 * being consultant firm names (Civil/Surveyor/Structural — set via the
 * Q9.5.e-fix-3 consultantTypes config or typed inline by users). */
export function externalConsultantOptions(tasks: PermitTask[]): string[] {
  const set = new Set<string>();
  for (const t of tasks) {
    const v = (t.assigned_to ?? '').trim();
    if (!v) continue;
    if (v === 'Entitlements' || v === 'Architecture') continue;
    set.add(v);
  }
  return Array.from(set).sort();
}
