// Q2: Centralized TanStack Query keys. Realtime invalidation references the
// same keys so subscriptions and queries can never drift. Add a key here
// before adding the matching hook.
//
// Q5.5.D: Every key is now parameterized by tenantId. Cache entries for a
// previous tenant are isolated from the active tenant, which matters when
// (Phase 2) the user switches tenants — old data must not bleed through.
// Realtime invalidation uses the bare table-prefix key (without tenantId),
// which TanStack Query treats as a prefix match for all tenant variants.

export const queryKeys = {
  // Bare prefixes used by realtime invalidation (prefix-match across tenants).
  projectsAll: ['projects'] as const,
  permitsAll: ['permits'] as const,
  permitCyclesAll: ['permit_cycles'] as const,
  permitTasksAll: ['permit_tasks'] as const,
  drawScheduleAll: ['draw_schedule'] as const,
  intakeRecordsAll: ['intake_records'] as const,
  dmDaGroupsAll: ['dm_da_groups'] as const,
  daTimeBlocksAll: ['da_time_blocks'] as const,
  jurisdictionsAll: ['jurisdictions'] as const,
  permitTypesAll: ['permit_types'] as const,
  appConfigAll: ['app_config'] as const,
  teamMembersAll: ['team_members'] as const,
  // Tenant-scoped keys used by queries and per-tenant invalidation.
  projects: (tenantId: string) => ['projects', tenantId] as const,
  permits: (tenantId: string) => ['permits', tenantId] as const,
  permitsByProject: (tenantId: string, projectId: string) =>
    ['permits', tenantId, { projectId }] as const,
  permitCycles: (tenantId: string) => ['permit_cycles', tenantId] as const,
  permitTasks: (tenantId: string) => ['permit_tasks', tenantId] as const,
  permitTasksFor: (tenantId: string, permitId: number) =>
    ['permit_tasks', tenantId, { permitId }] as const,
  drawSchedule: (tenantId: string) => ['draw_schedule', tenantId] as const,
  intakeRecords: (tenantId: string) => ['intake_records', tenantId] as const,
  dmDaGroups: (tenantId: string) => ['dm_da_groups', tenantId] as const,
  daTimeBlocks: (tenantId: string) => ['da_time_blocks', tenantId] as const,
  // Q7.3.a — admin catalogs. Jurisdictions + permit_types are global (no
  // tenant_id) but we still parameterize by tenantId so cache entries scope
  // cleanly. app_config IS tenant-scoped.
  jurisdictions: (tenantId: string) => ['jurisdictions', tenantId] as const,
  permitTypes: (tenantId: string) => ['permit_types', tenantId] as const,
  appConfig: (tenantId: string) => ['app_config', tenantId] as const,
  teamMembers: (tenantId: string) => ['team_members', tenantId] as const,
} as const;

/** Map from Postgres table name → bare-prefix query keys to invalidate on
 * realtime change. Bare prefixes match all tenant variants under each prefix.
 */
export const REALTIME_TABLES = {
  projects: [queryKeys.projectsAll, queryKeys.permitsAll],
  permits: [queryKeys.permitsAll, queryKeys.projectsAll],
  permit_cycles: [queryKeys.permitsAll, queryKeys.permitCyclesAll],
  permit_tasks: [queryKeys.permitTasksAll],
  draw_schedule: [queryKeys.drawScheduleAll, queryKeys.permitsAll],
  intake_records: [queryKeys.intakeRecordsAll],
} as const;
