// Q2: Centralized TanStack Query keys. Realtime invalidation references the
// same keys so subscriptions and queries can never drift. Add a key here
// before adding the matching hook.

export const queryKeys = {
  projects: ['projects'] as const,
  permits: ['permits'] as const,
  permitsByProject: (projectId: string) =>
    ['permits', { projectId }] as const,
  permitCycles: ['permit_cycles'] as const,
  permitTasks: ['permit_tasks'] as const,
  drawSchedule: ['draw_schedule'] as const,
  intakeRecords: ['intake_records'] as const,
} as const;

/** Map from Postgres table name → query keys to invalidate on realtime change. */
export const REALTIME_TABLES = {
  projects: [queryKeys.projects, queryKeys.permits],
  permits: [queryKeys.permits, queryKeys.projects],
  permit_cycles: [queryKeys.permits, queryKeys.permitCycles],
  permit_tasks: [queryKeys.permitTasks],
  draw_schedule: [queryKeys.drawSchedule],
  intake_records: [queryKeys.intakeRecords],
} as const;
