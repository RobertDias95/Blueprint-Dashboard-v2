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
