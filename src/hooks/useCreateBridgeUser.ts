import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { addPersonNetworkMessage } from '../lib/addPerson';
import type {
  AddPersonRequest,
  AddPersonResult,
  AddPersonSuccess,
} from '../../supabase/functions/admin-create-user/handler';

// ===========================================================================
// ★★★ fix-436 — the browser's ONE call, and it carries the session token
// ===========================================================================
//
// `supabase.functions.invoke` attaches the signed-in user's access token as
// `Authorization: Bearer …` automatically, which is exactly what the function's
// gate reads. Nothing about the caller is sent in the body — not the user id,
// not the tenant — because a body the browser controls cannot be a gate.
//
// ★★ THE TYPES COME FROM THE FUNCTION ITSELF, imported across the directory
// boundary. `supabase/functions/**` is outside `tsconfig.app.json`'s `include`,
// so it is not compiled as part of the app — but an import pulls it into the
// graph, which is what makes a change to the wire shape a compile error here
// rather than a runtime surprise. `handler.ts` has no Deno in it precisely so
// this import is safe.
//
// ★ A NON-2xx RESPONSE IS NOT A THROW WORTH SWALLOWING. supabase-js turns one
// into a FunctionsHttpError whose body still holds our `{ code, message }`, so
// the error path reads that body and hands the screen the function's own
// sentence. Inventing a second wording here is how "that email already has a
// login" becomes "Edge Function returned a non-2xx status code".

export const ADD_PERSON_FUNCTION = 'admin-create-user';

export class AddPersonError extends Error {
  readonly code: string;
  readonly field?: string;
  constructor(message: string, code: string, field?: string) {
    super(message);
    this.name = 'AddPersonError';
    this.code = code;
    this.field = field;
  }
}

async function readFailureBody(err: unknown): Promise<AddPersonError | null> {
  // FunctionsHttpError carries the Response on `context`.
  const ctx = (err as { context?: unknown })?.context;
  if (!ctx || typeof (ctx as Response).json !== 'function') return null;
  try {
    const body = (await (ctx as Response).json()) as {
      code?: string;
      message?: string;
      field?: string;
    };
    if (!body?.message) return null;
    return new AddPersonError(body.message, body.code ?? 'create_failed', body.field);
  } catch {
    return null;
  }
}

export function useCreateBridgeUser() {
  const queryClient = useQueryClient();
  return useMutation<AddPersonSuccess, Error, AddPersonRequest>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.functions.invoke<AddPersonResult>(
        ADD_PERSON_FUNCTION,
        { body: input },
      );
      if (error) {
        const parsed = await readFailureBody(error);
        if (parsed) throw parsed;
        throw new AddPersonError(addPersonNetworkMessage(error), 'unreachable');
      }
      if (!data) {
        throw new AddPersonError(addPersonNetworkMessage(null), 'unreachable');
      }
      if (!data.ok) {
        throw new AddPersonError(data.message, data.code, data.field);
      }
      return data;
    },
    onSuccess: () => {
      // ★ The roster changed, so every picker and the Team screen re-read it.
      //   Bare prefix, the same key the realtime channel uses for this table.
      void queryClient.invalidateQueries({ queryKey: queryKeys.teamMembersAll });
    },
  });
}
