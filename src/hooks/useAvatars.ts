import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { pushToast } from '../stores/toastStore';
import { useTeamMembers } from './useTeamMembers';
import {
  AVATAR_BUCKET,
  avatarExtFor,
  avatarObjectPath,
  avatarPathFor,
  buildAvatarIndex,
  refuseAvatarSize,
  refuseAvatarType,
  type AvatarPathRow,
} from '../lib/avatars';
import { resizeToSquareJpeg } from '../lib/avatarImage';

// ===========================================================================
// ★★★ fix-505 (P-162) — READING AND WRITING PROFILE PICTURES
// ===========================================================================
//
// ★★★ ONE QUERY FOR EVERY CIRCLE, AND THE BRIEF MADE IT A STOP CONDITION: "a
//     per-avatar fetch is not acceptable (a 6-person Team card + a 40-message
//     chat would be ~50 requests)". Two queries total, both already shared:
//
//       1. `bp_avatar_paths()` — one row per person WITH a picture, for the
//          whole tenant. Keyed on the tenant, so every circle on every screen
//          reads the same cached result.
//       2. `useTeamMembers()` — the roster query the app already runs, reused
//          only to resolve "Bobby" ⇄ "Bobby Dias" (see buildAvatarIndex).
//
//     Signing is separate and keyed ON THE PATH, so forty messages from one
//     author sign once — the same shape `useSignedAttachmentUrl` uses and for
//     the same reason.
//
// ★★ MISSING PICTURES ARE OMITTED FROM THE INDEX, not stored as null, so
//    `avatarPathFor` returning null means "draw initials" and there is no
//    second empty state to reason about.

/** ★ An hour, matching chat attachments. The object never changes under a path
 *  — a re-upload overwrites the same key — so only the signature expires. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/** Every picture in the tenant, indexed by BOTH roster key and full name. */
export function useAvatarIndex(): Map<string, string> {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const team = useTeamMembers();
  const rowsQ = useQuery<AvatarPathRow[]>({
    queryKey: queryKeys.avatarPaths(tenantId ?? ''),
    enabled: !!tenantId,
    // ★ Pictures change about once per person per never. Half an hour keeps a
    //   navigation from re-asking, and an upload invalidates explicitly below.
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_avatar_paths');
      if (error) {
        // ★★ PRE-MIGRATION IS A REAL STATE HERE, and it is the state prod is in
        //    until Cowork applies fix_505. An undefined function must leave
        //    every circle drawing initials — exactly what it does today —
        //    rather than throwing a query error onto six surfaces at once.
        if (isMissingFunction(error)) return [];
        throw error;
      }
      return (data ?? []) as AvatarPathRow[];
    },
    retry: false,
  });

  return useMemo(
    () => buildAvatarIndex(rowsQ.data, team.all),
    [rowsQ.data, team.all],
  );
}

/** `(name) => storage path | null`, memoised on the index. */
export function useAvatarPathFor(): (name: string | null | undefined) => string | null {
  const index = useAvatarIndex();
  return useCallback((name) => avatarPathFor(index, name), [index]);
}

/**
 * A signed URL for one avatar object.
 *
 * ★ Keyed on the PATH ALONE, so N circles for one person share one signing
 *   call and a re-render signs nothing. `enabled` on the path means "no
 *   picture" costs no request at all.
 */
export function useSignedAvatarUrl(path: string | null | undefined) {
  return useQuery<string | null>({
    queryKey: queryKeys.avatarUrl(path ?? ''),
    enabled: !!path,
    // Re-sign with ten minutes to spare rather than at the instant of expiry.
    staleTime: (SIGNED_URL_TTL_SECONDS - 600) * 1000,
    gcTime: SIGNED_URL_TTL_SECONDS * 1000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(AVATAR_BUCKET)
        .createSignedUrl(path as string, SIGNED_URL_TTL_SECONDS);
      if (error) throw error;
      return data?.signedUrl ?? null;
    },
  });
}

export interface SetAvatarInput {
  /** Whose picture. The viewer's own id in Settings → Account; the person's in
   *  the Team dialog, which an admin may set. */
  profileId: string;
  /** The picked file, or null to remove. */
  file: File | null;
  /** The existing object key, so Remove can delete it. */
  currentPath?: string | null;
}

/** Upload (resize → storage → column) or remove (storage → column). */
export function useSetAvatar() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<string | null, Error, SetAvatarInput>({
    mutationFn: async ({ profileId, file, currentPath }) => {
      if (!tenantId) throw new Error('No active tenant.');

      // ---- Remove -------------------------------------------------------
      if (!file) {
        // ★ The OBJECT goes first. If the column were nulled first and the
        //   delete then failed, the picture would be unreachable but still
        //   stored — invisible litter nobody can find to remove.
        if (currentPath) {
          const { error } = await supabase.storage
            .from(AVATAR_BUCKET)
            .remove([currentPath]);
          if (error) throw new Error(`Could not remove the picture — ${error.message}`);
        }
        const { error } = await supabase.rpc('bp_set_avatar_path', {
          p_profile_id: profileId,
          p_path: null,
        });
        if (error) throw error;
        return null;
      }

      // ---- Upload -------------------------------------------------------
      // ★ Type first, before any decoding: a HEIC or a PDF is refused by name
      //   rather than failing inside the canvas.
      const typeRefusal = refuseAvatarType(file);
      if (typeRefusal) throw new Error(typeRefusal);

      const resized = await resizeToSquareJpeg(file);
      // ★★ The size check runs on the RESIZED blob — that is the byte count the
      //    bucket will see, and refusing the original would reject the 6 MB
      //    phone photo this resize exists to accept.
      const sizeRefusal = refuseAvatarSize(file.name, resized.size);
      if (sizeRefusal) throw new Error(sizeRefusal);

      // ★ The extension comes from the RESIZE OUTPUT (always JPEG), not from
      //   the picked file — see avatarImage.ts.
      const ext = avatarExtFor(resized.type || 'image/jpeg') ?? 'jpg';
      const path = avatarObjectPath(tenantId, profileId, ext);

      const { error: upErr } = await supabase.storage
        .from(AVATAR_BUCKET)
        // ★★★ `upsert` IS THE ONE-OBJECT-PER-PERSON RULE. The path is derived
        //     from the profile id, so a re-upload overwrites and the bucket can
        //     never accumulate a person's old headshots.
        .upload(path, resized, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) throw new Error(`Storage refused the picture — ${upErr.message}`);

      const { error } = await supabase.rpc('bp_set_avatar_path', {
        p_profile_id: profileId,
        p_path: path,
      });
      if (error) throw error;
      return path;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.avatarPaths(tenantId) });
      // ★★ The signed URL is keyed on the path, and the path does NOT change on
      //    a re-upload — so a stale signature would keep showing the OLD image
      //    until it expired. Clearing every avatar URL is the cheap, correct
      //    answer: they are re-signed on demand and only for pictures on screen.
      queryClient.removeQueries({ queryKey: ['avatar_url'] });
    },
    onError: (error) => {
      pushToast(error.message, 'error');
    },
  });
}

/** The login id for a roster name, or null when that person cannot sign in.
 *
 *  ★ Settings → Team knows a roster NAME; the write needs a login id, and
 *  `profiles` is read-own-only so the client cannot look one up. `enabled`
 *  gates it on the dialog actually being open for somebody. */
export function useProfileIdForRosterName(name: string | null | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<string | null>({
    queryKey: queryKeys.profileIdForName(tenantId ?? '', name ?? ''),
    enabled: !!tenantId && !!name,
    staleTime: 30 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_profile_id_for_roster_name', {
        p_name: name,
      });
      if (error) {
        if (isMissingFunction(error)) return null;
        throw error;
      }
      return (data as string | null) ?? null;
    },
  });
}

/** ★ PostgREST reports an unknown function as PGRST202, Postgres as 42883.
 *  Both mean "fix_505 has not been applied here yet". */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    /function .* does not exist/i.test(error.message ?? '')
  );
}
