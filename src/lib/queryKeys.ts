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
  permitTypeDefaultsAll: ['permit_type_defaults'] as const,
  appConfigAll: ['app_config'] as const,
  teamMembersAll: ['team_members'] as const,
  taskTemplatesAll: ['task_templates'] as const,
  taskTemplateSubtasksAll: ['task_template_subtasks'] as const,
  // Q9.5.e-fix-3
  buildersAll: ['builders'] as const,
  projectDocumentsAll: ['project_documents'] as const,
  // fix-27: notification center reads audit_log via bp_fetch_scraper_activity
  // RPC. Bare-prefix key participates in realtime invalidation on audit_log.
  scraperActivityAll: ['scraper_activity'] as const,
  // fix-31: per-reviewer status table (replaces the placeholder "tasks" column
  // on Project Overview with a real rollup of city-side review state).
  permitCycleReviewersAll: ['permit_cycle_reviewers'] as const,
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
  permitTypeDefaults: (tenantId: string) =>
    ['permit_type_defaults', tenantId] as const,
  appConfig: (tenantId: string) => ['app_config', tenantId] as const,
  teamMembers: (tenantId: string) => ['team_members', tenantId] as const,
  taskTemplates: (tenantId: string) => ['task_templates', tenantId] as const,
  taskTemplateSubtasks: (tenantId: string) =>
    ['task_template_subtasks', tenantId] as const,
  // Q9.5.e-fix-3
  builders: (tenantId: string) => ['builders', tenantId] as const,
  projectDocuments: (tenantId: string, projectId: string) =>
    ['project_documents', tenantId, { projectId }] as const,
  // fix-27: notification center activity feed.
  scraperActivity: (tenantId: string, days: number) =>
    ['scraper_activity', tenantId, { days }] as const,
  // fix-31: per-reviewer status table.
  permitCycleReviewers: (tenantId: string) =>
    ['permit_cycle_reviewers', tenantId] as const,
  // fix-67: Weekly DA Update report. Keyed by the filter/window inputs so
  // changing the week or a filter refetches; tenant-scoped like the rest.
  weeklyDaReport: (
    tenantId: string,
    weekStart: string,
    windowDays: number,
    filters: Record<string, string>,
  ) =>
    ['weekly_da_report', tenantId, { weekStart, windowDays, filters }] as const,
  // fix-68: Reports hub (Settings -> Reporting). Categories + saved reports.
  reportHub: (tenantId: string) => ['report_hub', tenantId] as const,
  // fix-69: report builder catalog (static per deploy) + a saved custom
  // report's executed result.
  reportBuilderCatalog: (tenantId: string) =>
    ['report_builder_catalog', tenantId] as const,
  customReport: (tenantId: string, id: string) =>
    ['custom_report', tenantId, id] as const,
  // fix-70: v1-parity tasks. Per-permit nested task tree (bp_list_permit_tasks)
  // and the caller's assigned tasks (bp_my_tasks). Both share the permit_tasks
  // bare-prefix for realtime invalidation.
  permitTaskTree: (tenantId: string, permitId: number) =>
    ['permit_tasks', tenantId, 'tree', { permitId }] as const,
  myTasks: (tenantId: string, userName: string) =>
    ['permit_tasks', tenantId, 'mine', { userName }] as const,
  // fix-78: My Tasks now lists every task in the tenant; the page filters
  // client-side (Assignee=Me preset, Discipline, Status, Project, Title).
  allTasks: (tenantId: string) =>
    ['permit_tasks', tenantId, 'all'] as const,
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
  // fix-31: scraper writes reviewer rows -> bell badge ticks + Project
  // Overview rollup refreshes live.
  permit_cycle_reviewers: [queryKeys.permitCycleReviewersAll],
} as const;
