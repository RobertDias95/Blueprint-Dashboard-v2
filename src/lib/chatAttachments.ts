// fix-330 — the attachment rules, in one pure file.
//
// ★★ NOTHING IN THIS APPLICATION HAD EVER UPLOADED A FILE FROM THE BROWSER
// before this ticket. The one bucket, `plan-thumbnails`, is written by the file
// indexer. So every rule here is new, and the point of putting them in a pure
// module is that the SAME numbers appear in the migration, in the composer's
// refusal message, and in the tests — a limit the browser enforces and the
// bucket does not (or the reverse) is a limit nobody can trust.
//
// ★ THE LIMITS ARE ENFORCED TWICE, ON PURPOSE. The bucket
// (`storage.buckets.file_size_limit` / `allowed_mime_types`) is what makes them
// TRUE — a client check is only a courtesy. The client check is what makes them
// KIND: it names the file and says why, instead of surfacing a 413 from an
// upload the person already waited for.

/** 25 MB. ★ Chosen against the approved mockup's own example — an 11 MB
 *  marketing-plan set — so the first real file would not have been refused. It
 *  sits under Supabase's 50 MB per-request ceiling with room to spare. */
export const MAX_ATTACHMENT_BYTES = 26_214_400;

/** ★ Five per message. Not a storage limit — a reading limit. A message with
 *  twenty files in it is a folder, and the thread stops being readable. The
 *  same number is a CHECK constraint on project_messages.attachments. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

/** ★ What a permitting team actually pastes and attaches: screenshots and
 *  photos, PDFs, and the office documents that arrive by email. Everything else
 *  is refused BY NAME with the reason shown — the list is deliberately short,
 *  because "anything" is how a chat bucket becomes a file share nobody audits.
 *
 *  ★★ THIS ARRAY IS MIRRORED IN migrations/fix_330_chat_complete.sql as the
 *  bucket's allowed_mime_types, and a test diffs the two. */
export const ALLOWED_ATTACHMENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/heic',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

/** The one sentence the composer shows before anyone picks anything, so the
 *  limits are known rather than discovered by being refused. */
export const ATTACHMENT_LIMIT_HINT =
  'Up to 5 files per message, 25 MB each — images, PDF, text, CSV, Word or Excel.';

/** What is stored on the message row, and what the renderer reads back. */
export interface ChatAttachment {
  /** The storage object key: `{project_id}/{uuid}/{filename}`. */
  path: string;
  /** The original filename, for display and for the download name. */
  name: string;
  mime: string;
  size: number;
}

/** A file the composer is holding but has not uploaded yet. */
export interface PendingAttachment {
  /** Local-only id, so a list of two identically-named snips can be keyed. */
  localId: string;
  file: File;
  /** An object URL for the thumbnail, when it is an image. */
  previewUrl: string | null;
}

export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isImageAttachment(a: Pick<ChatAttachment, 'mime'>): boolean {
  return (a.mime ?? '').startsWith('image/');
}

// ═══════════════════════════════════════════════════════════════════════════
// ★★★ fix-563 (P-267) — THE FILE TYPE, WHICH WAS ALWAYS THERE
// ═══════════════════════════════════════════════════════════════════════════
//
// Bobby, 2026-09-14: *"those kind of show up as, like, gray blobs… it would be
// nice if there was maybe a logo or something … Right now it's not super
// intuitive."* His screenshot: four `10431 - SFR1..4 - Correction Letter
// CR2.pdf` cards, identical grey rectangles told apart only by reading the
// filename.
//
// ★★★ THE RENDERER HAS HAD THE FILE TYPE ALL ALONG AND NEVER USED IT. Every
//     entry in `project_messages.attachments` has carried `mime` since fix-330.
//     **This ticket stores nothing new and backfills nothing** — it reads a
//     field that was already on all 92 files.
//
// ★★ THREE KINDS, WHICH IS WHAT §A ASKS FOR: *"a type icon (PDF · image ·
//    generic)"*. Not one per mime type. A spreadsheet icon and a Word icon would
//    be a nicer product and a different ticket; three is the line the brief drew
//    and the line this stops at.
//
// ⚠️ THE GENERIC BRANCH IS NOT HYPOTHETICAL ANY MORE. Re-measured on prod
//    2026-09-29: **5 XLSX files** live in chat
//    (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`), a
//    type the brief's own census did not contain. The brief's test for "a mime
//    the UI does not know" was speculative when it was written; it now covers
//    real files.

export type AttachmentKind = 'image' | 'pdf' | 'generic';

/**
 * What KIND of thing is this, for the purpose of picking an icon?
 *
 * ★ TOTAL AND NEVER THROWING. A missing, null or malformed `mime` reads as
 *   `generic` rather than exploding or rendering an empty box. All 92 files on
 *   prod carry a `mime` today, **which is exactly why a missing one would never
 *   be noticed** — so the default is the safe one.
 */
export function attachmentKind(
  a: Pick<ChatAttachment, 'mime'> | null | undefined,
): AttachmentKind {
  const mime = (a?.mime ?? '').toLowerCase().trim();
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  return 'generic';
}

/** The word on the card, for a screen reader and for the `title`. */
export const ATTACHMENT_KIND_LABEL: Record<AttachmentKind, string> = {
  image: 'Image',
  pdf: 'PDF',
  generic: 'File',
};

/**
 * ★★ The card's subtitle: `PDF · 17.1 MB`, or just `PDF` when the size is
 *    missing.
 *
 * ★★★ THE SEPARATOR IS CONDITIONAL, AND THAT IS THE WHOLE REASON THIS IS A
 *     FUNCTION. `humanSize` returns `''` for a missing or non-finite size, so
 *     `${kind} · ${humanSize(size)}` would render *"PDF · "* — a dangling
 *     middle dot, which is the "never an empty box" failure in miniature.
 */
export function attachmentMeta(
  a: Pick<ChatAttachment, 'mime' | 'size'> | null | undefined,
): string {
  const label = ATTACHMENT_KIND_LABEL[attachmentKind(a)];
  const size = humanSize(a?.size as number);
  return size ? `${label} · ${size}` : label;
}

/**
 * ★ Why a file cannot be attached, in words a person can act on — or null when
 * it can.
 *
 * The brief's rule: "A rejected file must say why." Every branch below names
 * the file and the limit it broke, because "Upload failed" is the message this
 * codebase has spent tickets replacing.
 */
export function rejectionReason(
  file: Pick<File, 'name' | 'type' | 'size'>,
  alreadyPending: number,
): string | null {
  if (alreadyPending >= MAX_ATTACHMENTS_PER_MESSAGE) {
    return `Up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message — send these first, then attach more.`;
  }
  const type = (file.type ?? '').toLowerCase();
  if (!(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(type)) {
    return `${file.name || 'That file'} is ${type || 'an unrecognised type'} — attach an image, PDF, text, CSV, Word or Excel file.`;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `${file.name || 'That file'} is ${humanSize(file.size)} — the limit is ${humanSize(MAX_ATTACHMENT_BYTES)}.`;
  }
  if (file.size === 0) {
    return `${file.name || 'That file'} is empty.`;
  }
  return null;
}

/** ★ Keep the original filename readable but make it safe to put in an object
 *  key. `/` would silently re-parent the object out of its project folder,
 *  which is the folder the storage RLS policy reads the tenant from. */
export function sanitizeFileName(name: string): string {
  const trimmed = (name ?? '').trim() || 'file';
  const cleaned = trimmed
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+/, '')
    .slice(0, 96);
  return cleaned || 'file';
}

/**
 * ★ THE PATH IS THE PERMISSION. `{project_id}/{uuid}/{filename}` — the storage
 * policy reads `split_part(name,'/',1)` and requires that project to be in the
 * caller's tenant, exactly as `plan-thumbnails` already does. A flat key, or a
 * key starting with the user id, would have left the bucket with no tenant
 * boundary at all.
 *
 * The uuid segment keeps two files with the same name from colliding without
 * mangling the name people see.
 */
export function attachmentPath(
  projectId: string,
  uid: string,
  fileName: string,
): string {
  return `${projectId}/${uid}/${sanitizeFileName(fileName)}`;
}

/** ★ A pasted screenshot arrives as a File with a browser-chosen name, and in
 *  some browsers with none at all. Falling back to a generic name keeps the
 *  chip from rendering an empty label. */
export function pastedFileName(file: File, index: number): string {
  const given = (file.name ?? '').trim();
  if (given) return given;
  const ext = (file.type ?? '').split('/')[1] || 'png';
  return `snip-${index + 1}.${ext}`;
}
