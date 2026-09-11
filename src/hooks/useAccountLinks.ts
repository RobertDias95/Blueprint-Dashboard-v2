import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import type { AccountRow } from '../lib/workDataNames';

// ===========================================================================
// ★★★ fix-527 §A — THE ACCOUNT LIST, AND WHY IT NEEDS NO NEW RPC
// ===========================================================================
//
// Several comments in this repo say `profiles` is *"read-own-only"* and that
// the client cannot look an account up. **Measured on prod 2026-09-11, that is
// stale:** the policy is
//
//     profiles_read_own   FOR SELECT   USING (auth.uid() = id OR is_admin())
//
// — so an ADMIN can already list every account, and the Settings screen this
// feeds is admin-only twice over (the route is wrapped in `AdminRoute`, and the
// panel renders read-only for a non-admin). fix-525 banked *"a comment is not
// evidence"*; this is the same coin found the same way, by reading `pg_policy`
// instead of the prose.
//
// ★★★ SO THERE IS NO NEW RPC HERE. A `SECURITY DEFINER` function to read a
//     table the caller may already read would be a second door to the same
//     room, and the first one is the one RLS is guarding.
//
// ★★ AND A NON-ADMIN GETS BACK **ONE ROW — THEIR OWN**, not an error. That is
//    the policy working, and it is why `resolveNameLinks` must treat a missing
//    account as `unmapped` rather than as absent evidence of anything. A short
//    list is not a wrong list; it is a differently-scoped one.

const SELECT_COLUMNS = 'id,email,may_edit_library';

export interface AccountLinkRow extends AccountRow {
  /** ★ fix-527 §B. **Optional until Cowork applies the migration** — an
   *  unlisted column makes PostgREST fail the WHOLE query with `42703`, so the
   *  select below is retried without it rather than taking the screen away.
   *  See the note on the query. */
  may_edit_library?: boolean | null;
}

/** ★ PostgREST's code for "column does not exist" — the migration has not run
 *  yet. The same shape fix-506 used for a missing VIEW (`42P01`), applied to a
 *  missing COLUMN. */
const UNDEFINED_COLUMN = '42703';

export interface AccountLinks {
  /** ★★★ `false` until Cowork applies fix-527's migration. Every consumer
   *  branches on it, and the absent branch is the one prod runs today. */
  capabilityAvailable: boolean;
  rows: AccountLinkRow[];
}

/**
 * Every account this caller may see, with its Library capability when the
 * column exists.
 *
 * ★★★ FEATURE-DETECTED, BECAUSE THE MIGRATION IS NOT APPLIED. fix-527's brief
 *     is explicit: *"do not ship code that assumes it has run."* So the query
 *     asks for the capability, and on `42703` asks again without it — the
 *     screen renders either way, and says which world it is in.
 *
 * ★ Admin-only in practice: RLS returns the caller's own row to everybody else,
 *   which is the correct answer rather than an error.
 */
export function useAccountLinks() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<AccountLinks>({
    queryKey: ['accountLinks', tenantId ?? ''],
    enabled: !!tenantId,
    // ★ Accounts change when somebody is added, which is rare and goes through
    //   its own Edge Function. A minute is plenty and keeps the Settings screen
    //   from re-asking on every tab switch.
    staleTime: 60 * 1000,
    retry: false,
    queryFn: async () => {
      const withCapability = await supabase.from('profiles').select(SELECT_COLUMNS);
      if (!withCapability.error) {
        return {
          capabilityAvailable: true,
          rows: (withCapability.data ?? []) as unknown as AccountLinkRow[],
        };
      }
      // ★★★ THE ONE CODE THAT IS NOT AN ERROR. Anything else propagates: a
      //     table that exists and is refusing to answer must not look identical
      //     to a column that has not shipped.
      if (withCapability.error.code !== UNDEFINED_COLUMN) throw withCapability.error;
      const { data, error } = await supabase.from('profiles').select('id,email');
      if (error) throw error;
      return {
        capabilityAvailable: false,
        rows: (data ?? []) as unknown as AccountLinkRow[],
      };
    },
  });
}
