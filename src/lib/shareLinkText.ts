// ===========================================================================
// fix-632 (P-325) — A SHARE LINK READS AS "<address> — <set label>"
// ===========================================================================
//
// Bobby, 2026-10-10: *"can the view online be more professional - make the
// link the address - marketing/site plan."* · Dave: *"change the share hyper
// link to be address and title ('224 2nd Ave N- Marketing Plans' or '120 7th
// Ave W – Schematic')."*
//
// ★★ THE LABEL IS THE CARD'S OWN — `Site Plan`, `Marketing`, `Schematic`,
//    `Design Guidance` (lib/planOfRecord `planOfRecordSetButtons`). No new
//    words: the email and the clipboard say what the button says.
//
// ★★ ONE FORMATTER for the email draft and every Copy link, so the two can
//    never read differently.

/** `2601 E Galer St — Marketing`; the label alone when there is no address. */
export function shareLinkText(address: string | null | undefined, setLabel: string): string {
  const a = (address ?? '').trim();
  const l = setLabel.trim();
  return a ? `${a} — ${l}` : l;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `<a href="url">text</a>`, both escaped. Null for anything but http(s). */
export function shareLinkAnchorHtml(url: string, text: string): string | null {
  if (!/^https?:\/\//i.test(url)) return null;
  return `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`;
}

/** What the clipboard is handed — kept separate so it is testable. */
export interface ClipboardLike {
  write?: (items: ClipboardItem[]) => Promise<void>;
  writeText: (text: string) => Promise<void>;
}

/**
 * ★★★ A RICH LINK ON THE CLIPBOARD. `text/html` carries the anchor, so pasting
 * into an Outlook email shows `2601 E Galer St — Marketing` as the link;
 * `text/plain` carries the bare URL, so Teams, a text box or a chat still get
 * a working link. Where `ClipboardItem` is unavailable (older browsers, some
 * embedded views) it falls back to the bare URL — the same as before.
 */
export async function writeShareLinkToClipboard(
  url: string,
  text: string,
  clipboard: ClipboardLike = navigator.clipboard,
  Item: typeof ClipboardItem | undefined = typeof ClipboardItem === 'undefined' ? undefined : ClipboardItem,
): Promise<'rich' | 'plain'> {
  const html = shareLinkAnchorHtml(url, text);
  if (html && Item && typeof clipboard.write === 'function') {
    try {
      await clipboard.write([
        new Item({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([url], { type: 'text/plain' }),
        }),
      ]);
      return 'rich';
    } catch {
      // ★ Some browsers expose ClipboardItem but refuse text/html — fall back.
    }
  }
  await clipboard.writeText(url);
  return 'plain';
}
