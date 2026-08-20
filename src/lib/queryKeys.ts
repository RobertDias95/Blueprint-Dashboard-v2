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
  // fix-notes-1: unified notes log (project-holistic + per-permit scopes).
  notesAll: ['notes'] as const,
  // fix-329: the project chat thread + the people who can be mentioned.
  projectMessagesAll: ['project_messages'] as const,
  // ★ The bell's tenant-wide "messages that mention me" lives under the SAME
  // prefix, so one realtime event refreshes the thread and the badge together —
  // the rail count and the bell cannot drift apart because they cannot refresh
  // apart.
  mentionablePeopleAll: ['mentionable_people'] as const,
  // fix-339: the shared post-request item.
  postRequestsAll: ['post_requests'] as const,
  // ★ fix-347: reactions (read receipts) and the custom mention tags.
  messageReactionsAll: ['message_reactions'] as const,
  // ★ fix-360: the same table read for a different question — "who reacted to
  // MY posts". Its own prefix, because the per-thread query above is scoped to
  // one project and this one is scoped to one author across all of them.
  myPostReactionsAll: ['my_post_reactions'] as const,
  mentionTagsAll: ['mention_tags'] as const,
  // fix-notes-2: dashboard expanded-permit "waiting on" summaries. Own bare
  // prefix so BOTH permit_tasks and notes realtime changes can invalidate it.
  dashboardPermitCardsAll: ['dashboard_permit_cards'] as const,
  // fix-227: central External Team directory (firms by discipline) that feeds
  // the per-project external-team picker.
  externalTeamDirectoryAll: ['external_team_directory'] as const,
  // fix-27: notification center reads audit_log via bp_fetch_scraper_activity
  // RPC. Bare-prefix key participates in realtime invalidation on audit_log.
  scraperActivityAll: ['scraper_activity'] as const,
  // ★★ fix-336: the two remaining notification inputs that had no bare prefix
  // at all — their hooks declared private literal keys, which is why neither
  // could be named in REALTIME_TABLES. `board_item_reads` is fix-307's read
  // state (acknowledging in one tab must clear the badge in every other) and
  // `permit_milestone_acks` is the handoff source. Both hooks now build their
  // keys from these, so there is one spelling per table.
  boardItemReadsAll: ['board_item_reads'] as const,
  milestoneAcksAll: ['permit_milestone_acks'] as const,
  // fix-350: What's New. Two keys because the two tables have different
  // audiences — every tenant member reads the entries, and each person reads
  // only their own read rows (RLS, not a filter).
  // fix-354: the ledger the auto-closed FYI is derived from.
  autoClosuresAll: ['permit_task_auto_closures'] as const,
  whatsNewEntriesAll: ['whats_new_entries'] as const,
  whatsNewReadsAll: ['whats_new_reads'] as const,
  // fix-31: per-reviewer status table (replaces the placeholder "tasks" column
  // on Project Overview with a real rollup of city-side review state).
  permitCycleReviewersAll: ['permit_cycle_reviewers'] as const,
  // fix-225: DA handoff ledger — bare prefix for broad invalidation.
  projectDaHandoffsAll: ['project_da_handoffs'] as const,
  // ★ fix-344: the same ledger for the schematic designer.
  projectSdHandoffsAll: ['project_sd_handoffs'] as const,
  // Tenant-scoped keys used by queries and per-tenant invalidation.
  projects: (tenantId: string) => ['projects', tenantId] as const,
  // ★ fix-333: the wizard's duplicate-address check. UNDER the `projects`
  // prefix on purpose — creating a project must invalidate the index the next
  // check reads, or the second person to type the same address is told it is
  // clear. It is a separate key rather than a reuse of `projects` because it
  // includes ARCHIVED rows and is explicitly ranged; see useProjectAddressIndex.
  projectAddressIndex: (tenantId: string) =>
    ['projects', 'address_index', tenantId] as const,
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
  projectSdHandoffs: (tenantId: string, projectId: string) =>
    ['project_sd_handoffs', tenantId, projectId] as const,
  intakeRecords: (tenantId: string) => ['intake_records', tenantId] as const,
  // ★ fix-346: open-task counts for a named handful of people (the DAs with no
  // design manager). UNDER the permit_tasks prefix on purpose — a task edited
  // anywhere must refresh the number through the existing realtime
  // invalidation, or the Settings warning quietly goes stale.
  openTaskCounts: (tenantId: string, names: string[]) =>
    ['permit_tasks', tenantId, 'open_counts', names] as const,
  dmDaGroups: (tenantId: string) => ['dm_da_groups', tenantId] as const,
  // ★ fix-347: one reactions query per open project chat, not one per message.
  messageReactions: (tenantId: string, projectId: string) =>
    ['message_reactions', tenantId, projectId] as const,
  mentionTags: (tenantId: string) => ['mention_tags', tenantId] as const,
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
  // fix-notes-1: ONE query per project covers both scopes (the panel filters
  // by permit client-side), so the future dashboard card reuses the same cache.
  projectMessages: (tenantId: string, projectId: string) =>
    ['project_messages', tenantId, projectId] as const,
  myMentions: (tenantId: string, userId: string) =>
    ['project_messages', 'mentions', tenantId, userId] as const,
  mentionablePeople: (tenantId: string) =>
    ['mentionable_people', tenantId] as const,
  // ★ fix-339: post requests. Both keys sit under ONE bare prefix so resolving
  // a request refreshes the bell, My Board and the project's chat panel
  // together — a shared item that cleared in one place and not another would
  // be the whole feature failing quietly.
  myPostRequests: (tenantId: string, userId: string) =>
    ['post_requests', 'mine', tenantId, userId] as const,
  projectPostRequests: (tenantId: string, projectId: string) =>
    ['post_requests', 'project', tenantId, projectId] as const,
  // ★ fix-330: a signed URL for one attachment. NOT under the project_messages
  // prefix, deliberately — a new message must not invalidate every signed URL
  // on screen and re-sign them all. The object is immutable; only the signature
  // expires, which is what the query's own staleTime handles.
  chatAttachmentUrl: (path: string) => ['chat_attachment_url', path] as const,
  notes: (tenantId: string, projectId: string) =>
    ['notes', tenantId, { projectId }] as const,
  // fix-notes-2: active-note search index for the Project List. Under the
  // notes prefix so any note change invalidates it automatically.
  projectNoteSearch: (tenantId: string) =>
    ['notes', tenantId, 'search-index'] as const,
  // fix-notes-2: per-permit dashboard "waiting on" summaries.
  dashboardPermitCards: (tenantId: string) =>
    ['dashboard_permit_cards', tenantId] as const,
  // fix-notes-3: tenant-wide notes read for the Weekly Updates report. Under
  // the notes prefix so a write (which invalidates queryKeys.notesAll) or a
  // realtime notes change refreshes it.
  allNotes: (tenantId: string) => ['notes', tenantId, 'all-notes'] as const,
  // ★★ fix-372: the recurring-correction clusters. One bare prefix so a rebuild
  // or a curation edit invalidates the ranking, the detail and every scope at
  // once — the counts and the list must never disagree about the same rebuild.
  correctionClustersAll: ['correction_clusters'] as const,
  correctionClusterRanking: (
    tenantId: string,
    juris: string | null,
    tier: string,
    includeVerbatim: boolean,
  ) =>
    ['correction_clusters', tenantId, 'ranking', { juris, tier, includeVerbatim }] as const,
  correctionClusterDetail: (tenantId: string, clusterKey: string, juris: string | null) =>
    ['correction_clusters', tenantId, 'detail', { clusterKey, juris }] as const,

  // fix-27: notification center activity feed.
  scraperActivity: (tenantId: string, days: number) =>
    ['scraper_activity', tenantId, { days }] as const,
  // ★★ fix-370: the uncapped totals for the same window. Deliberately under the
  // SAME `scraper_activity` prefix, so the one realtime channel's audit_log
  // invalidation refreshes the count and the list together — a true number that
  // lagged the list it describes would be a new way to disagree.
  scraperActivitySummary: (tenantId: string, days: number) =>
    ['scraper_activity', tenantId, { days, summary: true }] as const,
  // fix-31: per-reviewer status table.
  permitCycleReviewers: (tenantId: string) =>
    ['permit_cycle_reviewers', tenantId] as const,
  // fix-notes-4: bare prefix — a notes realtime change refetches any open
  // Weekly DA Update report (its per-permit note box now reads public.notes).
  weeklyDaReportAll: ['weekly_da_report'] as const,
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
  // fix-249: display-only history benchmark (median anchor→submit days) behind
  // bp_target_submit_benchmark. Read-only — never feeds a date, so it has no
  // realtime invalidation; it just sits next to the target for comparison.
  targetSubmitBenchmarksAll: ['target_submit_benchmark'] as const,
  targetSubmitBenchmark: (
    tenantId: string,
    type: string,
    juris: string,
    anchor: string,
  ) => ['target_submit_benchmark', tenantId, { type, juris, anchor }] as const,
  // fix-253: learned phase durations (city review vs our turnaround, per cycle).
  // Read-only analysis surface behind bp_phase_duration_grid; no realtime.
  phaseDurationGrid: (tenantId: string, recentDays: number) =>
    ['phase_duration_grid', tenantId, { recentDays }] as const,
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
  // fix-265: the vendor send ledger — what each external vendor was last told.
  // Bare prefix participates in realtime so a "Mark as sent" in one tab moves
  // rows out of New/Changed in another.
  vendorReportStateAll: ['vendor_report_state'] as const,
  vendorReportState: (tenantId: string, vendorKey: string) =>
    ['vendor_report_state', tenantId, { vendorKey }] as const,
  // fix-265: reuse columns the shared useProjects() select deliberately does not
  // carry (see useVendorReportExtras for why they are fetched separately).
  vendorProjectExtras: (tenantId: string) =>
    ['vendor_project_extras', tenantId] as const,
  // fix-276: indexed correction-letter items, per project. Read-only — the rows
  // are written by the file_indexer on Bobby's PC (scraper repo), not by this
  // app and not by the scraper, so there is no realtime channel to hang the
  // bare prefix off. It exists so a manual invalidation (or a subscription, if
  // correction_items is ever added to the publication) has a key to target.
  correctionItemsAll: ['correction_items'] as const,
  correctionItems: (tenantId: string, projectId: string) =>
    ['correction_items', tenantId, { projectId }] as const,
  // fix-285: the Design Plan of Record view, per project. Same read-only
  // posture as correction_items — written by the file_indexer, once a day.
  planOfRecordAll: ['plan_of_record'] as const,
  // fix-358: the REASONING behind the card. A separate key from the file
  // itself because they are separate tables written by different steps of
  // the indexer, and a project can have one without the other.
  planOfRecordVerdictAll: ['plan_of_record_verdict'] as const,
  planOfRecord: (tenantId: string, projectId: string) =>
    ['plan_of_record', tenantId, { projectId }] as const,
  planOfRecordVerdict: (tenantId: string, projectId: string) =>
    ['plan_of_record_verdict', tenantId, { projectId }] as const,
  // Keyed by the storage OBJECT PATH, not the project: the signature belongs to
  // the object, and two projects can never share one (the path starts with the
  // project id). Separate from the row key so re-signing an expired URL does
  // not refetch the row.
  planOfRecordThumb: (tenantId: string, objectPath: string) =>
    ['plan_of_record_thumb', tenantId, { objectPath }] as const,
  // fix-277: every correction item for the tenant, for the Corrections report.
  // Shares the bare prefix so one invalidation covers both readers.
  allCorrectionItems: (tenantId: string) =>
    ['correction_items', tenantId, 'all'] as const,
  // fix-279: the missing-letter worklist view. Its own prefix, not the
  // correction_items one: it is driven by permits.corr_rounds and permit_cycles
  // as much as by correction_items, so an indexer run is not the only thing
  // that can change it.
  // ★ fix-363: one task's provenance, fetched only when its panel is opened.
  taskProvenanceAll: ['task_provenance'] as const,
  taskProvenance: (tenantId: string, taskId: string) =>
    ['task_provenance', tenantId, { taskId }] as const,
  // ★ …and the bulk "who assigned this" read behind the notification sentence.
  taskAssignersAll: ['task_assigners'] as const,
  correctionMissingWorklistAll: ['correction_missing_worklist'] as const,
  correctionMissingWorklist: (tenantId: string) =>
    ['correction_missing_worklist', tenantId] as const,
} as const;

/** Map from Postgres table name → bare-prefix query keys to invalidate on
 * realtime change. Bare prefixes match all tenant variants under each prefix.
 */
export const REALTIME_TABLES = {
  projects: [queryKeys.projectsAll, queryKeys.permitsAll],
  permits: [queryKeys.permitsAll, queryKeys.projectsAll],
  permit_cycles: [queryKeys.permitsAll, queryKeys.permitCyclesAll],
  // fix-notes-2: a task change also refreshes the dashboard "waiting on" cards.
  // ★ fix-363: a task edit rewrites its own history, so the provenance panel
  // and the notification's "who assigned it" both refresh from the same event.
  permit_tasks: [
    queryKeys.permitTasksAll,
    queryKeys.dashboardPermitCardsAll,
    queryKeys.taskProvenanceAll,
    queryKeys.taskAssignersAll,
  ],
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
  // fix-265: a vendor send recorded in one tab re-buckets the forecast in every
  // other tab, so a second person can't re-send the same "new" projects.
  vendor_report_state: [queryKeys.vendorReportStateAll],
  // fix-227: a directory firm added/renamed/(de)activated (Settings, any tab)
  // refreshes the per-project picker options live.
  external_team_directory: [queryKeys.externalTeamDirectoryAll],
  // ★ fix-329: a chat message posted in one tab appears in every other tab's
  // thread AND ticks the mentioned person's bell — ON THE EXISTING CHANNEL.
  // useScraperActivity's comment records what opening a second one cost, and
  // one prefix covers the thread, the rail card and the bell's mention query
  // because they all live under project_messages.
  project_messages: [queryKeys.projectMessagesAll],
  // ★ fix-339: a request raised or resolved in one tab clears in every other
  // one — ON THE EXISTING CHANNEL. A shared item is only as shared as its
  // refresh, so this is not optional decoration.
  post_requests: [queryKeys.postRequestsAll],
  // fix-notes-1: a note added/edited/completed in any tab refreshes every
  // mounted NotesPanel live. fix-notes-2: also the dashboard "waiting on" cards
  // (the search index lives under the notes prefix, so it refreshes too).
  // fix-notes-4: + the Weekly DA Update report, whose per-permit note box
  // reads the newest active public.notes note.
  notes: [
    queryKeys.notesAll,
    queryKeys.dashboardPermitCardsAll,
    queryKeys.weeklyDaReportAll,
  ],
  // ★★★ fix-336 — the three tables the NOTIFICATION MODEL reads, published to
  // `supabase_realtime` by migrations/fix_336_realtime_publication.sql. Every
  // one of these was subscribed-to or needed and silent before that migration.
  //
  // ★ audit_log is the scraper's status flips — the largest single source of
  // board items (lib/boardReads source 1). useScraperActivity used to open its
  // OWN channel for this table, per mount, with a random name; that channel is
  // deleted and this entry replaces it, which is the "do not open one channel
  // per component that happens to need the same table" rule applied to the one
  // place that broke it.
  audit_log: [queryKeys.scraperActivityAll],
  // ★ The handoff source (boardReads source 3): the design leg completing is
  // what puts "Ready to file" in an entitlement lead's bell.
  permit_milestone_acks: [queryKeys.milestoneAcksAll],
  // ★★ fix-347: a reaction is a READ RECEIPT, so it streams — see the note in
  // useMessageReactions. Two people on the same post must not disagree about
  // how many have acknowledged it.
  // ★★ fix-360 §2: …and the AUTHOR's feed of them. This is what makes the bell
  // move on each new reaction while the centre still shows one row — the two
  // are different questions, and the brief was explicit that they are.
  message_reactions: [
    queryKeys.messageReactionsAll,
    queryKeys.myPostReactionsAll,
  ],
  // ★★ The READ STATE, and the reason the badge could disagree with itself.
  // Acknowledging an item in one tab wrote a row that no other tab heard about,
  // so a second tab kept counting it until something else forced a refetch.
  // fix-307's model is per-user and RLS-scoped to auth.uid(), so this streams
  // only your own rows — proven on the wire, see the PR.
  board_item_reads: [queryKeys.boardItemReadsAll],
  // fix-350: a new entry has to reach an open tab, otherwise the ribbon's
  // unread dot appears only for whoever happens to reload next.
  // fix-354: a closure should reach an open bell without a reload —
  // register #101's whole point is that you just see the bell.
  permit_task_auto_closures: [queryKeys.autoClosuresAll],
  whats_new_entries: [queryKeys.whatsNewEntriesAll],
  whats_new_reads: [queryKeys.whatsNewReadsAll],
} as const;
