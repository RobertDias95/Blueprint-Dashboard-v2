import { useSignedAttachmentUrl } from '../../hooks/useChatAttachments';
import {
  humanSize,
  isImageAttachment,
  type ChatAttachment,
} from '../../lib/chatAttachments';

// fix-330 — attachments as they appear once sent, in BOTH surfaces.
//
// ★ The bucket is private, so every render costs a signed URL. One query per
// PATH (not per message) means the same file rendered in the rail card and in
// the modal is signed once and shared — react-query dedupes on the key.
//
// ★ An image is a thumbnail; anything else is a named chip. A PDF rendered as a
// broken <img> is worse than a filename, and the mockup's own example is a
// named plan set.

export default function ChatAttachments({
  attachments,
  compact = false,
}: {
  attachments: readonly ChatAttachment[];
  /** The rail card is 240px wide — one line per file, no thumbnails. */
  compact?: boolean;
}) {
  if (!attachments?.length) return null;
  return (
    <div
      className={compact ? 'flex flex-col gap-0.5 mt-1' : 'flex flex-wrap gap-2 mt-2'}
      data-testid="chat-attachments"
    >
      {attachments.map((a) => (
        <AttachmentItem key={a.path} attachment={a} compact={compact} />
      ))}
    </div>
  );
}

function AttachmentItem({
  attachment,
  compact,
}: {
  attachment: ChatAttachment;
  compact: boolean;
}) {
  const urlQ = useSignedAttachmentUrl(attachment.path);
  const url = urlQ.data ?? null;
  const image = isImageAttachment(attachment);

  // ★ A signature that could not be minted says so. Rendering a dead thumbnail
  // would look like a corrupt file rather than a permission or network problem.
  const failed = !!urlQ.error;

  if (compact) {
    return (
      <span
        className="text-[10px] text-dim truncate"
        title={`${attachment.name} · ${humanSize(attachment.size)}`}
        data-testid={`chat-attachment-compact-${attachment.path}`}
      >
        {image ? '🖼' : '📄'} {attachment.name}
      </span>
    );
  }

  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noreferrer"
      // Without a signature there is nothing to open; a link that navigates
      // nowhere is the disabled-control failure again.
      aria-disabled={!url}
      onClick={(e) => {
        if (!url) e.preventDefault();
      }}
      className="rounded-lg border overflow-hidden bg-bg no-underline block"
      style={{
        borderColor: 'var(--color-border)',
        maxWidth: 300,
        cursor: url ? 'pointer' : 'default',
      }}
      title={
        failed
          ? 'This attachment could not be opened'
          : `${attachment.name} · ${humanSize(attachment.size)}`
      }
      data-testid={`chat-attachment-${attachment.path}`}
      data-kind={image ? 'image' : 'file'}
    >
      <div
        className="text-[10px] text-dim px-2 py-1 border-b truncate"
        style={{ borderBottomColor: 'var(--color-border)' }}
      >
        {attachment.name}
        <span className="ml-1">· {humanSize(attachment.size)}</span>
      </div>
      {image ? (
        url ? (
          <img
            src={url}
            alt={attachment.name}
            style={{ display: 'block', maxHeight: 180, maxWidth: '100%' }}
          />
        ) : (
          <div
            className="text-[10px] text-dim px-2 py-4 text-center"
            data-testid={`chat-attachment-pending-${attachment.path}`}
          >
            {failed ? 'Could not open this image' : 'Loading…'}
          </div>
        )
      ) : (
        <div className="text-[11px] text-text px-2 py-2">
          {failed ? 'Could not open this file' : 'Open file →'}
        </div>
      )}
    </a>
  );
}
