import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { pushToast } from '../stores/toastStore';
import type {
  ChangeSignInEmailRequest,
  ChangeSignInEmailResult,
  ChangeSignInEmailSuccess,
} from '../../supabase/functions/admin-change-sign-in-email/handler';

// ===========================================================================
// ★★★ fix-659 (P-318, census 42) — A SIGN-IN EMAIL HAS ONE EDITOR
// ===========================================================================
// For a person WITH a login, the People email is their sign-in, so it is shown
// read-only and changed only through the `admin-change-sign-in-email` Edge
// Function, which moves auth + profile + every roster row together.
// `bp_set_person_details` refuses the change on the server, so the plain Save
// cannot split them even if this screen were bypassed.
//
// ★ The wire types come from the function's own handler.ts (fix-436's rule):
//   a change to the shape is a compile error here.

export const CHANGE_SIGN_IN_EMAIL_FUNCTION = 'admin-change-sign-in-email';

/** Does this roster name's email belong to a login? The exact join
 *  `resolveRosterIdentity` makes (server: `bp_roster_name_has_login`). */
export function useRosterNameHasLogin(name: string | null) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<boolean>({
    queryKey: ['roster_name_has_login', tenantId ?? '', name ?? ''],
    enabled: !!tenantId && !!name,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_roster_name_has_login', {
        p_name: name as string,
      });
      if (error) throw error;
      return data === true;
    },
  });
}

async function readFailureMessage(err: unknown): Promise<string | null> {
  const ctx = (err as { context?: unknown })?.context;
  if (!ctx || typeof (ctx as Response).json !== 'function') return null;
  try {
    const body = (await (ctx as Response).json()) as { message?: string };
    return body?.message ?? null;
  } catch {
    return null;
  }
}

export function useChangeSignInEmail() {
  const queryClient = useQueryClient();
  return useMutation<ChangeSignInEmailSuccess, Error, ChangeSignInEmailRequest>({
    // ★ A literal, so fix-604's write census can read it.
    meta: { write: 'admin-change-sign-in-email' },
    mutationFn: async (input) => {
      const { data, error } = await supabase.functions.invoke<ChangeSignInEmailResult>(
        CHANGE_SIGN_IN_EMAIL_FUNCTION,
        { body: input },
      );
      if (error) {
        throw new Error(
          (await readFailureMessage(error)) ??
            'The sign-in email could not be changed — the server did not answer.',
        );
      }
      if (!data) throw new Error('The sign-in email could not be changed.');
      if (!data.ok) throw new Error(data.message);
      return data;
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.teamMembersAll });
      void queryClient.invalidateQueries({ queryKey: ['roster_name_has_login'] });
      pushToast(
        res.unchanged
          ? `${res.name} already signs in with ${res.new_email}`
          : `${res.name} now signs in with ${res.new_email}`,
        'success',
      );
    },
    onError: (err) => {
      pushToast(err.message, 'error');
    },
  });
}
