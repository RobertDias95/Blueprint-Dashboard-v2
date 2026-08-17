import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import {
  attachmentPath,
  pastedFileName,
  rejectionReason,
  type ChatAttachment,
} from '../lib/chatAttachments';

// fix-330 — the first upload path this application has ever had.
//
// ★ THE BUCKET IS PRIVATE, so a rendered attachment is a SIGNED URL, not a
// public link. Every other read in this app is tenant-scoped and a public
// bucket would have made an attachment the one thing in the product readable by
// a stranger holding a URL.
//
// ★★ UPLOAD HAPPENS ON SEND, NOT ON PICK, and that is the orphan story rather
// than a performance choice. The composer holds Files in memory; nothing
// reaches storage until the same action that inserts the message. So closing
// the modal on a picked-but-unsent file uploads nothing, and there is no
// abandoned-draft sweep to write. See the migration for the one orphan that
// remains possible (upload ok, insert failed) and why the client deliberately
// cannot delete it.

export const CHAT_BUCKET = 'chat-attachments';

/** One hour. Long enough that a thread stays readable while somebody reads it,
 *  short enough that a copied URL is not a permanent hole in the tenant wall. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Upload the composer's pending files and return what goes on the message row.
 *
 * ★ Not a hook — it is one step inside `usePostMessage`'s mutation, so an
 * upload and its message are ONE failure surface. Two mutations would mean a
 * message that posted without its snip, or a snip with no message, and neither
 * has an honest thing to say to the person who pressed Send.
 */
export async function uploadChatAttachments(
  projectId: string,
  files: readonly File[],
): Promise<ChatAttachment[]> {
  const out: ChatAttachment[] = [];
  for (const [i, file] of files.entries()) {
    const name = pastedFileName(file, i);
    // ★ Re-checked here, not only in the composer. The composer's check is what
    // explains the refusal; this one is what makes it true for any caller.
    const reason = rejectionReason({ name, type: file.type, size: file.size }, i);
    if (reason) throw new Error(reason);
    const path = attachmentPath(projectId, crypto.randomUUID(), name);
    const { error } = await supabase.storage
      .from(CHAT_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    out.push({ path, name, mime: file.type, size: file.size });
  }
  return out;
}

/**
 * A signed URL for one attachment.
 *
 * ★ Keyed on the PATH ALONE and outside the project_messages prefix, so posting
 * a message does not re-sign every image already on screen. The object never
 * changes; only the signature expires, and the staleTime below is what handles
 * that.
 */
export function useSignedAttachmentUrl(path: string | null | undefined) {
  return useQuery<string | null>({
    queryKey: queryKeys.chatAttachmentUrl(path ?? ''),
    enabled: !!path,
    // Re-sign with ten minutes to spare rather than at the instant of expiry.
    staleTime: (SIGNED_URL_TTL_SECONDS - 600) * 1000,
    gcTime: SIGNED_URL_TTL_SECONDS * 1000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(CHAT_BUCKET)
        .createSignedUrl(path as string, SIGNED_URL_TTL_SECONDS);
      if (error) throw error;
      return data?.signedUrl ?? null;
    },
  });
}
