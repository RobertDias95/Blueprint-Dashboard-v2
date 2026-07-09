// fix-222: task-template TEAM taxonomy + co-assignee dynamic-role tokens.
//
// This is the single source of truth for:
//   - the three default_team keys the settings dropdown offers,
//   - the dynamic-role co-assignee tokens (person OR role), and
//   - how a template's default_team / default_co_assignees RESOLVE to concrete
//     people per-project at task instantiation.
//
// Its SQL twin is bp_create_project_with_permits (migrations/fix_222_*.sql):
// the CASE that maps default_team → assigned_to and the unnest/CASE that
// resolves default_co_assignees tokens mirror the functions here — KEEP IN
// LOCKSTEP, exactly like fix-214 (isPermitInCorrections ⇄ bp_permit_in_corrections)
// and fix-221 (isApprovedNotIssued ⇄ the apr CTE).

// ---------------------------------------------------------------------------
// 1. TEAM taxonomy (retires 'Architecture').
// ---------------------------------------------------------------------------
export const TEAM_OPTIONS = [
  'Entitlements',
  'Design Associate',
  'Schematic Team',
] as const;
export type TeamKey = (typeof TEAM_OPTIONS)[number];

/** fix-222 default_team migration rule: 'Architecture' → 'Design Associate',
 *  except schematic-prep templates (text mentions "schematic") → 'Schematic
 *  Team'. Any other team value passes through unchanged. Mirrors the UPDATE in
 *  migrations/fix_222_*.sql. */
export function migrateArchitectureTeam(
  currentTeam: string | null,
  text: string,
): string | null {
  if (currentTeam !== 'Architecture') return currentTeam;
  return /schematic/i.test(text) ? 'Schematic Team' : 'Design Associate';
}

// ---------------------------------------------------------------------------
// 2. Dynamic-role co-assignee tokens.
// ---------------------------------------------------------------------------
export type DynamicRole =
  | 'design_associate'
  | 'design_manager'
  | 'schematic_designer';

export const DYNAMIC_ROLE_LABELS: Record<DynamicRole, string> = {
  design_associate: 'Design Associate',
  design_manager: 'Design Manager',
  schematic_designer: 'Schematic Designer',
};

export const DYNAMIC_ROLES = Object.keys(DYNAMIC_ROLE_LABELS) as DynamicRole[];

/** A co-assignee stored on a template is EITHER a person's name OR a dynamic
 *  role token, encoded in the text[] as `role:<role>` (a plain name otherwise). */
const TOKEN_PREFIX = 'role:';

export function roleToken(role: DynamicRole): string {
  return `${TOKEN_PREFIX}${role}`;
}

export type ParsedCoAssignee =
  | { kind: 'person'; name: string }
  | { kind: 'role'; role: DynamicRole };

export function parseCoAssignee(entry: string): ParsedCoAssignee {
  if (entry.startsWith(TOKEN_PREFIX)) {
    const role = entry.slice(TOKEN_PREFIX.length) as DynamicRole;
    if (role in DYNAMIC_ROLE_LABELS) return { kind: 'role', role };
  }
  return { kind: 'person', name: entry };
}

export function isRoleToken(entry: string): boolean {
  return parseCoAssignee(entry).kind === 'role';
}

/** Display label for a stored co-assignee entry — the role's friendly name, or
 *  the person's name verbatim. */
export function coAssigneeLabel(entry: string): string {
  const c = parseCoAssignee(entry);
  return c.kind === 'role' ? DYNAMIC_ROLE_LABELS[c.role] : c.name;
}

// ---------------------------------------------------------------------------
// 3. Per-project resolution.
// ---------------------------------------------------------------------------
export interface ResolutionContext {
  /** the permit's / project's assigned Design Associate */
  da: string | null;
  /** the Design Manager paired with `da` in dm_da_groups (already looked up) */
  dm: string | null;
  /** the project's Schematic Designer(s) */
  schematicDesigners: string[];
}

/** Resolve one stored co-assignee entry to zero-or-more concrete names for a
 *  specific project. A person resolves to itself; a role token resolves to
 *  whoever fills that role on THIS project (never a hardcoded name). */
export function resolveCoAssignee(
  entry: string,
  ctx: ResolutionContext,
): string[] {
  const c = parseCoAssignee(entry);
  if (c.kind === 'person') {
    const n = c.name.trim();
    return n ? [n] : [];
  }
  switch (c.role) {
    case 'design_associate':
      return ctx.da ? [ctx.da] : [];
    case 'design_manager':
      return ctx.dm ? [ctx.dm] : [];
    case 'schematic_designer':
      return ctx.schematicDesigners.filter((s) => s && s.trim() !== '');
  }
}

/** Resolve a template's full co-assignee list for a project, flattened + deduped
 *  (order preserved, first occurrence wins). */
export function resolveCoAssignees(
  entries: string[],
  ctx: ResolutionContext,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    for (const name of resolveCoAssignee(e, ctx)) {
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
  }
  return out;
}

/** fix-224: the display name for a single stored co-assignee entry, resolving a
 *  dynamic role token to the actual person for THIS project. A plain name shows
 *  as-is; a role token resolves to its person (first, if multiple) or falls back
 *  to the role's friendly label when the project has no one in that role yet.
 *  Used by both task views (My Tasks + the permit bar) so a role-token co-
 *  assignee renders as the resolved person everywhere. */
export function coAssigneeDisplayName(
  entry: string,
  ctx: ResolutionContext,
): string {
  const resolved = resolveCoAssignee(entry, ctx);
  return resolved[0] ?? coAssigneeLabel(entry);
}

// ---------------------------------------------------------------------------
// 4. fix-228: PRIMARY owner (permit_tasks.assigned_to) — a labeled owner on a
//    LIVE task, selectable as a team key / dynamic role / specific person and
//    resolved to a person for DISPLAY. Brings the live task editors up to parity
//    with the fix-222 template taxonomy. The stored value lives in assigned_to;
//    both task views (permit bar + My Tasks) resolve it through these helpers so
//    they can't drift (bidirectional principle — the client twin of the fix-222
//    taxonomy; display is client-side, no SQL twin needed).
// ---------------------------------------------------------------------------

/** The primary-owner selector's team/role options (fix-222 taxonomy + Design
 *  Manager). Design Associate leads — it is the DEFAULT (→ the project's DA). */
export const PRIMARY_TEAM_OPTIONS = [
  'Design Associate',
  'Entitlements',
  'Schematic Team',
  'Design Manager',
] as const;
export type PrimaryTeamKey = (typeof PRIMARY_TEAM_OPTIONS)[number];

export interface PrimaryResolutionContext {
  /** the project's / permit's DA (the default primary) */
  da: string | null;
  /** the permit's entitlement lead */
  entLead: string | null;
  /** the DM paired with the DA in dm_da_groups (already looked up) */
  dm: string | null;
  /** the project's schematic designer(s) */
  schematicDesigners: string[];
}

/** Normalize a stored assigned_to to its canonical selector KEY, or null when it
 *  is a specific person or unset. 'Architecture' (legacy, pre-fix-222) maps to
 *  'Design Associate' so the label matches the new taxonomy (fix-228 point 4:
 *  remap on read — no backfill required). */
export function normalizePrimaryTeamKey(
  assignedTo: string | null | undefined,
): PrimaryTeamKey | null {
  const raw = (assignedTo ?? '').trim();
  if (raw === '') return null;
  if (raw === 'Architecture') return 'Design Associate';
  return (PRIMARY_TEAM_OPTIONS as readonly string[]).includes(raw)
    ? (raw as PrimaryTeamKey)
    : null;
}

/** True when assigned_to names a SPECIFIC PERSON (not a team key / role / unset). */
export function isPrimaryPerson(assignedTo: string | null | undefined): boolean {
  const raw = (assignedTo ?? '').trim();
  return raw !== '' && raw !== 'Architecture' && normalizePrimaryTeamKey(raw) === null;
}

/** Resolve a team/role KEY to its person for a project (null when no one fills
 *  that role yet). Exported so the selector can label each option with who it
 *  resolves to. */
export function resolvePrimaryTeamPerson(
  key: PrimaryTeamKey,
  ctx: PrimaryResolutionContext,
): string | null {
  switch (key) {
    case 'Design Associate':
      return ctx.da ?? null;
    case 'Entitlements':
      return ctx.entLead ?? null;
    case 'Schematic Team':
      return ctx.schematicDesigners[0] ?? null;
    case 'Design Manager':
      return ctx.dm ?? null;
  }
}

/** fix-230: the DEFAULT primary team key for an UNSET task, following the task's
 *  COLUMN/discipline — an Entitlements-column task ('ent') owns via the ENT lead;
 *  everything else (Architecture/permitting, or unknown) via the DA. Fixes the
 *  fix-228 regression where an unset primary always defaulted to the DA. */
export function defaultPrimaryTeamKey(
  discipline: string | null | undefined,
): PrimaryTeamKey {
  return discipline === 'ent' ? 'Entitlements' : 'Design Associate';
}

/** Resolve a task's stored assigned_to to the PRIMARY owner's display person.
 *  Empty/unset defaults to the discipline's team (fix-230: 'ent' → ent_lead,
 *  else → the DA). A team/role key resolves to that role's person on THIS
 *  project, falling back to the friendly key label when the role has no one yet
 *  (so it never renders blank). A specific person resolves to itself. */
export function resolvePrimaryAssignee(
  assignedTo: string | null | undefined,
  ctx: PrimaryResolutionContext,
  discipline?: string | null,
): string | null {
  const raw = (assignedTo ?? '').trim();
  // fix-230: unset → the discipline's default team's person (DA / ent_lead).
  if (raw === '') return resolvePrimaryTeamPerson(defaultPrimaryTeamKey(discipline), ctx);
  const key = normalizePrimaryTeamKey(raw);
  if (key === null) return raw; // a specific person
  return resolvePrimaryTeamPerson(key, ctx) ?? key; // person, else friendly label
}

/** The value the primary <select> shows as selected for a stored assigned_to:
 *  the team key, the person string, or — when unset — the discipline's default
 *  team key (fix-230: 'ent' → 'Entitlements', else → 'Design Associate'). */
export function primarySelectValue(
  assignedTo: string | null | undefined,
  discipline?: string | null,
): string {
  const raw = (assignedTo ?? '').trim();
  if (raw === '') return defaultPrimaryTeamKey(discipline);
  return normalizePrimaryTeamKey(raw) ?? raw;
}

/** Resolve a template's default_team to the single `assigned_to` person for a
 *  project. Mirrors the CASE in bp_create_project_with_permits. */
export function resolveTeamAssignee(
  team: string | null,
  ctx: {
    entLead: string | null;
    da: string | null;
    schematicDesigners: string[];
  },
): string | null {
  switch (team) {
    case 'Entitlements':
      return ctx.entLead ?? null;
    // 'Architecture' is the legacy key kept so a pre-migration template still
    // routes to the DA (the fix-222 data migration renames it to Design Associate).
    case 'Design Associate':
    case 'Architecture':
      return ctx.da ?? null;
    case 'Schematic Team':
      return ctx.schematicDesigners[0] ?? null;
    default:
      return team && team.trim() ? team : null;
  }
}
