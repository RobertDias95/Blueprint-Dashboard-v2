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

export class ProjectWriteDeniedError extends Error {
  readonly projectId: string;
  constructor(projectId: string) {
    super(
      'You can only edit projects you are on. Ask a design manager if you need this one.',
    );
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
