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
  // fix-227: central External Team directory (firms by discipline) that feeds
  // the per-project external-team picker.
  externalTeamDirectoryAll: ['external_team_directory'] as const,
  // fix-27: notification center reads audit_log via bp_fetch_scraper_activity
  // RPC. Bare-prefix key participates in realtime invalidation on audit_log.
  scraperActivityAll: ['scraper_activity'] as const,
  // fix-31: per-reviewer status table (replaces the placeholder "tasks" column
  // on Project Overview with a real rollup of city-side review state).
  permitCycleReviewersAll: ['permit_cycle_reviewers'] as const,
  // fix-225: DA handoff ledger — bare prefix for broad invalidation.
  projectDaHandoffsAll: ['project_da_handoffs'] as const,
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
  // fix-225: DA handoff ledger (project reassignments). Per-project + a
  // tenant-wide "which projects have handoffs" set for the board marker.
  projectDaHandoffs: (tenantId: string, projectId: string) =>
    ['project_da_handoffs', tenantId, { projectId }] as const,
  projectDaHandoffsSet: (tenantId: string) =>
    ['project_da_handoffs', tenantId, 'set'] as const,
  // fix-226: full ledger rows (project_id + from_da + to_da) for the per-DA
  // co-credit map on the Team reports. Shares the bare prefix for invalidation.
  projectDaHandoffsRows: (tenantId: string) =>
    ['project_da_handoffs', tenantId, 'rows'] as const,
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
  // fix-227: External Team directory, tenant-scoped.
  externalTeamDirectory: (tenantId: string) =>
    ['external_team_directory', tenantId] as const,
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
  // fix-87: error triage queries. Bare prefix is shared with realtime
  // invalidation; the tenant-scoped keys carry the status filter so
  // Active / Resolved / All can coexist in the cache.
  errorReportsAll: ['error_reports'] as const,
  errorGroups: (tenantId: string, status: string[]) =>
    ['error_reports', tenantId, 'groups', { status }] as const,
  newErrorCount: (tenantId: string) =>
    ['error_reports', tenantId, 'newCount'] as const,
  // fix-96-b: the wizard's DA dropdown reads da_team_routing rows so it
  // can disable DAs with no routing for the project's juris. The lookup
  // mirrors bp_ent_lead_for_da's WHERE clause (juris-match OR NULL).
  daTeamRouting: (tenantId: string) =>
    ['da_team_routing', tenantId] as const,
  // fix-140: My Tasks Waiting On reporting view. Shares the permit_tasks bare
  // prefix so a task edit (waiting_on change, resolve) invalidates it live.
  // Keyed by the include-completed flag so the toggle's two states coexist.
  waitingOnTasks: (tenantId: string, includeCompleted: boolean) =>
    ['permit_tasks', tenantId, 'waiting-on', { includeCompleted }] as const,
  // fix-154: per-type × per-jurisdiction target_submit offset overrides.
  // Read via bp_list_target_submit_formulas; edited in Settings → Permits.
  targetSubmitFormulasAll: ['target_submit_formulas'] as const,
  targetSubmitFormulas: (tenantId: string) =>
    ['target_submit_formulas', tenantId] as const,
  // fix-167: project On-Hold history. Bare prefix participates in realtime
  // invalidation; the tenant+project key scopes one project's hold list.
  projectHoldsAll: ['project_holds'] as const,
  projectHolds: (tenantId: string, projectId: string) =>
    ['project_holds', tenantId, { projectId }] as const,
  // fix-170: all of a tenant's holds (active + closed), for the dashboard +
  // estimator surfaces. Shares the project_holds bare prefix for realtime.
  allProjectHolds: (tenantId: string) =>
    ['project_holds', tenantId, 'all'] as const,
  // fix-182b: per-quarter saved Draw Schedule column layout (Settings editor).
  // Keyed by quarter so each quarter's layout caches independently. Nothing on
  // the live grid reads this yet (Phase C).
  drawScheduleQuarterLayoutAll: ['draw_schedule_quarter_layout'] as const,
  drawScheduleQuarterLayout: (tenantId: string, quarter: string) =>
    ['draw_schedule_quarter_layout', tenantId, { quarter }] as const,
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
  // fix-87: any insert/update to error_reports refreshes the triage page
  // + the nav badge across every open tab.
  error_reports: [queryKeys.errorReportsAll],
  // fix-167: a hold opened/lifted/edited (any tab) refreshes the badge +
  // history live.
  project_holds: [queryKeys.projectHoldsAll],
  // fix-227: a directory firm added/renamed/(de)activated (Settings, any tab)
  // refreshes the per-project picker options live.
  external_team_directory: [queryKeys.externalTeamDirectoryAll],
} as const;
