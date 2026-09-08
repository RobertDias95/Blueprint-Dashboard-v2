import { rosterFullName } from './roster';
import type { TeamMember } from './database.types';

// ===========================================================================
// ★★★ fix-505 (P-162) — THE PROFILE-PICTURE RULES, IN ONE PURE FILE
// ===========================================================================
//
// Bobby, 2026-09-04: *"in settings, if we can have the option to upload our
// headshot or profile picture, and then that would display at the top right,
// and then in our teams… where it says our name or letters for our first and
// last name, it would show our picture there."*
//
// ★★ THE fix-330 PATTERN, AND ITS REASON: the SAME numbers appear here, in
//    migrations/fix_505_profile_pictures.sql as the bucket's limits, and in the
//    refusal message the person reads. A limit the browser enforces and the
//    bucket does not (or the reverse) is a limit nobody can trust. A test diffs
//    this file against that migration.
//
// ★ The bucket is what makes the limits TRUE. This file is what makes them
//   KIND: it names the file and says why, instead of surfacing a 413 from an
//   upload the person already waited through.

export const AVATAR_BUCKET = 'avatars';

/** 2 MB. ★ Deliberately an order of magnitude under the 25 MB chat limit: a
 *  headshot at 512×512 is ~60–150 KB, so this is roomy for anything that has
 *  been through {@link resizeToSquare} and tight enough that an un-resized
 *  original is refused rather than stored. */
export const MAX_AVATAR_BYTES = 2_097_152;

/** ★ Three types, and NOT `image/heic` — which the chat bucket does allow.
 *  The difference is deliberate: an iPhone photo arrives as HEIC and no browser
 *  canvas can decode it, so the resize below would silently produce nothing.
 *  The file picker asks for these three, and a HEIC is refused BY NAME with the
 *  reason rather than failing during the resize.
 *
 *  ★★ MIRRORED IN THE MIGRATION as the bucket's allowed_mime_types. */
export const ALLOWED_AVATAR_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/** ★ The longest edge after resize. 512 is four times the largest circle the
 *  app draws (the 28px chip at 2× DPR is 56px), which leaves room for a bigger
 *  avatar later without a re-upload, and is small enough that every picture is
 *  well inside the 2 MB limit. */
export const AVATAR_MAX_DIMENSION = 512;

/** The one sentence Settings shows before anyone picks anything, so the limits
 *  are known rather than discovered by being refused. */
export const AVATAR_LIMIT_HINT =
  'JPEG, PNG or WebP, up to 2 MB. Larger pictures are shrunk to 512×512 before upload.';

/** The file extension the object is stored under, per accepted type. ★ Derived
 *  from the MIME rather than from the filename: a `.jpg` that is really a PNG
 *  would otherwise be stored under a lie, and the bucket checks the MIME. */
export function avatarExtFor(mime: string): 'jpg' | 'png' | 'webp' | null {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return null;
}

/** ★★★ `{tenant_id}/{profile_id}.{ext}` — and BOTH segments are load-bearing.
 *  The first is the storage policy's tenant test; the second is its ownership
 *  test (`split_part(split_part(name,'/',2),'.',1) = auth.uid()`). A path built
 *  any other way is refused by the bucket, not quietly stored somewhere odd. */
export function avatarObjectPath(
  tenantId: string,
  profileId: string,
  ext: string,
): string {
  return `${tenantId}/${profileId}.${ext}`;
}

/** Why this file cannot be used, or null when it can.
 *
 *  ★ Checked BEFORE the resize as well as after: a 40 MB TIFF should be refused
 *  for its type immediately rather than after a decode that will fail anyway.
 *  The size check runs on the RESIZED blob at the call site — see
 *  `useSetAvatar` — because that is the byte count the bucket will see. */
export function refuseAvatarType(file: { name: string; type: string }): string | null {
  if (!(ALLOWED_AVATAR_TYPES as readonly string[]).includes(file.type)) {
    // ★ Name the file and the type. "Unsupported file" tells somebody with
    //   four pictures open nothing about which one to try again with.
    return `${file.name} is a ${file.type || 'file of unknown type'} — pictures must be JPEG, PNG or WebP.`;
  }
  return null;
}

/** Why the finished (resized) blob still cannot be uploaded, or null. */
export function refuseAvatarSize(name: string, bytes: number): string | null {
  if (bytes > MAX_AVATAR_BYTES) {
    const mb = (bytes / 1_048_576).toFixed(1);
    return `${name} is still ${mb} MB after shrinking — the limit is 2 MB.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// ★★★ THE INDEX, AND THE MISMATCH IT EXISTS TO SOLVE
// ---------------------------------------------------------------------------
//
// `bp_avatar_paths()` returns the login's DISPLAY NAME — which is the roster
// KEY ("Bobby") for the 36 of 37 prod logins that have a roster row.
//
// `<Avatar>` is handed `fullNameOf(rosterKey)` — "Bobby Dias" (register #127:
// `initialsOf('Bobby')` drew BO, so fix-343 made every circle resolve the full
// name first).
//
// ★★★ SO A LOOKUP ON EITHER STRING ALONE MISSES EVERY CIRCLE IN THE APP. The
//     index carries BOTH, built from the roster `useTeamMembers` has already
//     loaded — no second query, no new prop on `Avatar`, and no call site has
//     to know which of the two names it happens to be holding.
//
// ★ Lower-cased on both sides. These are names typed by people into two
//   different tables; a case difference must not be the reason a face is
//   missing.

export interface AvatarPathRow {
  name: string;
  avatar_path: string;
  avatar_updated_at?: string | null;
}

/** `(anyName) => storage path | null`, matching a roster key or a full name. */
export function buildAvatarIndex(
  rows: ReadonlyArray<AvatarPathRow> | undefined,
  members: ReadonlyArray<TeamMember> | undefined,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows ?? []) {
    const key = (r.name ?? '').trim();
    const path = (r.avatar_path ?? '').trim();
    if (!key || !path) continue;
    out.set(key.toLowerCase(), path);
    // ★ The same resolution `useRosterFullName` performs, over the same roster.
    //   `rosterFullName` returns its input when there is no match, so a login
    //   with no roster row simply sets the one entry twice.
    const full = rosterFullName(key, members ?? []).trim();
    if (full) out.set(full.toLowerCase(), path);
  }
  return out;
}

/** Look one name up in an index built above. */
export function avatarPathFor(
  index: ReadonlyMap<string, string> | undefined,
  name: string | null | undefined,
): string | null {
  const k = (name ?? '').trim().toLowerCase();
  if (!k || !index) return null;
  return index.get(k) ?? null;
}
