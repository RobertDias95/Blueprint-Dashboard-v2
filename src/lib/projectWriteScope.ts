// ===========================================================================
// fix-539 (P-026) — a refused write says it was refused
// ===========================================================================
//
// ★★★ WHY THIS TYPE HAS TO EXIST. An RLS policy does not raise; it filters. A
//     write the policy refuses comes back as **0 rows**, and `useUpdateProject`
//     already reads 0 rows as an OCC conflict — it throws `OCCConflictError`,
//     refetches, **retries once** (fix-99), and finally says *"changed since
//     you loaded it — your edit was reverted"*.
//
// ★★★ That sentence names a concurrent editor who does not exist. It is
//     fix-341's false alarm, arriving by a new route: the user is not late,
//     they are not allowed. So the server raises `42501` through the RPC and
//     this is the error that carries it, ahead of any OCC handling.

/** Postgres `insufficient_privilege`. The server's answer, not a guess. */
export const WRITE_DENIED_CODE = '42501';

/** The wording when the project names nobody to ask. */
export const WRITE_DENIED_FALLBACK =
  'You can only edit projects you are on. Ask a design manager if you need this one.';

/**
 * ★★★ fix-549 §C — NAME THE PERSON, NOT THE ROLE.
 *
 * *"Ask a design manager"* is advice you cannot act on without first working
 * out which one. On 1917 3rd Ave W the answer was **Nicky**, and it was sitting
 * on the project the whole time.
 *
 * ⚠️ AND IT FALLS BACK, DELIBERATELY. 22 of 220 projects have no DA (measured
 *    09-13), and `"Ask ."` is worse than a vague sentence. The composer only
 *    names somebody when the project actually names them.
 *
 * ★ Order is who to ask FIRST: the DA owns the day-to-day, the design manager
 *   owns the DA. The permitting lead is not offered — this is a design-scope
 *   refusal and sending people to the wrong desk is its own small harm.
 */
export function writeDeniedMessage(members?: {
  da?: string | null;
  designManager?: string | null;
}): string {
  const da = (members?.da ?? '').trim();
  const dm = (members?.designManager ?? '').trim();
  if (da && dm) {
    return `You can only edit projects you are on. ${da} is the DA here — ask ${da}, or ${dm} (design manager).`;
  }
  if (da) {
    return `You can only edit projects you are on. ${da} is the DA here — ask ${da} if you need this one.`;
  }
  if (dm) {
    return `You can only edit projects you are on. Ask ${dm}, the design manager on this project.`;
  }
  return WRITE_DENIED_FALLBACK;
}

/** The minimum a permit row must carry to name a project's DA. */
export interface PermitLike {
  project_id?: string | null;
  da?: string | null;
}
/** The minimum a project row must carry to name its design manager. */
export interface ProjectLike {
  id: string;
  design_manager?: string | null;
}

/**
 * ★★ fix-549 §C — who to name, from the caches the screen already holds.
 *
 * ★ The design manager is on the PROJECT row; the DA is on its PERMITS. That
 *   split is why both caches are consulted — and why a message composed from
 *   the project alone would have named Derry and missed Nicky, who is the
 *   person the refusal was actually about.
 *
 * ★ First DA found wins: a project's permits carry the same DA in practice,
 *   and offering two names to ask is not more helpful than one.
 */
export function projectMembersFromCache(
  projects: readonly ProjectLike[] | undefined,
  permits: readonly PermitLike[] | undefined,
  projectId: string,
): { da: string | null; designManager: string | null } {
  const project = projects?.find((p) => p.id === projectId) ?? null;
  const da =
    permits?.find(
      (p) => p.project_id === projectId && (p.da ?? '').trim() !== '',
    )?.da ?? null;
  return { da, designManager: project?.design_manager ?? null };
}

export class ProjectWriteDeniedError extends Error {
  readonly projectId: string;
  constructor(
    projectId: string,
    members?: { da?: string | null; designManager?: string | null },
  ) {
    super(writeDeniedMessage(members));
    this.name = 'ProjectWriteDeniedError';
    this.projectId = projectId;
  }
}

export function isWriteDenied(error: unknown): error is ProjectWriteDeniedError {
  return error instanceof ProjectWriteDeniedError;
}

/**
 * Is this supabase error the server refusing the write?
 *
 * ★ Read off `code`, never the message. fix-357's rule: a message is
 *   environment-specific and gets rewritten; `42501` is the contract.
 */
export function isDeniedResponse(error: { code?: string } | null): boolean {
  return error?.code === WRITE_DENIED_CODE;
}

/**
 * Is this supabase error "that function is not deployed yet"?
 *
 * ★★★ THE STAGED-MIGRATION CASE, AND IT IS LOAD-BEARING. fix-539's SQL sits on
 *     the approval shelf until Cowork runs it. If the client simply called the
 *     RPC, **every project edit in the app would break the moment this
 *     deploys** and stay broken until the migration landed. So a missing
 *     function falls back to the direct table write — which is exactly today's
 *     behaviour — and the app crosses over by itself the moment the function
 *     appears.
 *
 * ★ `PGRST202` is PostgREST's "no such function in the schema cache"; `42883`
 *   is Postgres's own `undefined_function`, which is what arrives if the cache
 *   is warm but the function is gone. Both mean the same thing here.
 */
export function isMissingFunction(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883';
}
