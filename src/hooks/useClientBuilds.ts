import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import type { ClientBuildRow, DisplayMode } from '../lib/clientBuild';

// ===========================================================================
// ★★★ fix-589 §A (P-289) — THE ROSTER THAT ANSWERS "IS ANYONE STALE RIGHT NOW"
// ===========================================================================
//
// ★★★ IT MUST WORK WITH THE MIGRATION UNAPPLIED, and that is not defensive
//     habit — it is the shipping condition. `migrations/fix_589_client_build_
//     seen.sql` goes to Bobby, not to Claude, so from merge until he runs it
//     `bp_list_client_builds` does not exist and PostgREST answers **PGRST202**.
//
//     The distinction the screen has to draw is between:
//
//       · **not recorded yet** — the function is missing, nothing has ever been
//         written, and that is exactly today's situation;
//       · **recorded, and nobody is stale** — an empty list that means
//         something.
//
//     Collapsing those two into "no rows" would let the panel report all-clear
//     about a table that does not exist. That is fix-588's injury in a new
//     costume: a surface reporting success for work that never happened.
//
// ⚠️ A REFUSAL IS NOT AN OUTAGE EITHER. `bp_list_client_builds` RAISEs 42501
//    for a non-admin — the gate working. The panel is admin-only anyway, but a
//    role that changes mid-session must read as "not for you", never as broken.

export type ClientBuildsState =
  /** The function is not deployed yet — the migration is still with Bobby. */
  | { kind: 'unavailable' }
  /** The server refused: this person is not a tenant admin. */
  | { kind: 'refused' }
  | { kind: 'ready'; rows: ClientBuildRow[] };

interface RpcRow {
  out_user_id: string;
  out_email: string | null;
  out_name: string | null;
  out_build: string;
  out_built_at: string | null;
  out_display_mode: string;
  out_first_seen_at: string;
  out_last_seen_at: string;
  out_notice_shown_count: number | null;
  out_notice_first_shown_at: string | null;
  out_notice_dismissed_at: string | null;
  out_notice_reloaded_at: string | null;
}

/** PostgREST's code for "no function matches" — the migration-unapplied case. */
const MISSING_FUNCTION = 'PGRST202';
/** Postgres `insufficient_privilege`, raised by the function's own admin gate. */
const REFUSED = '42501';

export function mapClientBuildRow(row: RpcRow): ClientBuildRow {
  return {
    user_id: row.out_user_id,
    email: row.out_email,
    name: row.out_name,
    build: row.out_build,
    built_at: row.out_built_at,
    display_mode: (row.out_display_mode === 'standalone'
      ? 'standalone'
      : 'browser') as DisplayMode,
    first_seen_at: row.out_first_seen_at,
    last_seen_at: row.out_last_seen_at,
    notice_shown_count: row.out_notice_shown_count ?? 0,
    notice_first_shown_at: row.out_notice_first_shown_at,
    notice_dismissed_at: row.out_notice_dismissed_at,
    notice_reloaded_at: row.out_notice_reloaded_at,
  };
}

/** ★ Classify an RPC error without matching on its MESSAGE — fix-357's rule:
 *  a message is host- and version-specific, a code is a contract. */
export function classifyClientBuildsError(error: {
  code?: string | null;
  message?: string | null;
} | null): ClientBuildsState | null {
  if (!error) return null;
  if (error.code === MISSING_FUNCTION) return { kind: 'unavailable' };
  if (error.code === REFUSED) return { kind: 'refused' };
  // ★ Anything else — a network blip, a 500 — is also "cannot say", and
  //   saying "nobody is stale" would be a claim we have not earned.
  return { kind: 'unavailable' };
}

export function useClientBuilds(enabled: boolean) {
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useQuery<ClientBuildsState>({
    queryKey: ['client_build_seen', tenantId],
    enabled: enabled && !!tenantId,
    // ★ A heartbeat moves when somebody opens the app. Half a minute is fresh
    //   enough for a support question and stops a panel that is open on a
    //   second monitor from polling the roster all afternoon.
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<ClientBuildsState> => {
      const { data, error } = await supabase.rpc('bp_list_client_builds');
      const classified = classifyClientBuildsError(error);
      if (classified) return classified;
      return {
        kind: 'ready',
        rows: ((data as RpcRow[] | null) ?? []).map(mapClientBuildRow),
      };
    },
  });
}
