// ===========================================================================
// ★★★ fix-654 (P-149) — ONE CLICK TO A FOLDER ON \\bpc-file
// ===========================================================================
//
// Bobby, 10-12: *"under drone, can we add a link to the file folder, so when
// you click it, it would open the file folder"* — and on the install: *"build
// it on my pc, and i go through the install option so that it is clear for
// everyone else."*
//
// ★★★ A BROWSER CANNOT OPEN `\\bpc-file` ON ITS OWN, and fix-289 measured why:
//     Chrome and Edge silently refuse to send an https page to a `file:` URL
//     or a UNC path. So the Bridge never tries. It links to `bridge-open:`, a
//     link type the per-user "Bridge opener" registers (public/bridge-opener/),
//     and ALWAYS copies the path as well — a PC without the opener still gets
//     there by pasting into File Explorer.
//
// ★★ THE ALLOWLIST LIVES IN TWO PLACES ON PURPOSE. The handler on the PC is the
//    one that matters (it is what runs); `isAllowedSharePath` is its tested
//    mirror, so the Bridge never builds a link the handler would refuse.
//    `opener/bridge-open.ps1` ⇄ this file — change both or neither.

/** The app_config key holding the Building Permits share root. */
export const SHARE_ROOT_CONFIG_KEY = 'projectShareRoot';

/** The only tree the opener will open anything in. */
export const ALLOWED_SHARE_PREFIX = '\\\\bpc-file\\SoleilData\\';

/** The link type the opener registers. */
export const BRIDGE_OPEN_SCHEME = 'bridge-open:';

/** Where Settings → My account → One-click folders lives. */
export const ONE_CLICK_SETTINGS_HREF = '/settings/account#one-click-folders';

/** The downloads the Bridge serves (public/bridge-opener/). */
export const OPENER_INSTALL_HREF = '/bridge-opener/Install-BridgeOpener.cmd';
export const OPENER_UNINSTALL_HREF = '/bridge-opener/Uninstall-BridgeOpener.cmd';

function startsWithFold(s: string, prefix: string): boolean {
  return s.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase();
}

/**
 * ★★★ THE HANDLER'S RULE, MIRRORED. A path is openable only when it is under
 * `\\bpc-file\SoleilData\`, names something below it, and has no character or
 * segment that could step outside it or mean something else to Windows:
 * no control characters, `"` `*` `?` `<` `>` `|` `/` `:`, no empty segment,
 * and no `.` / `..` segment.
 */
export function isAllowedSharePath(path: string | null | undefined): path is string {
  if (typeof path !== 'string' || path === '') return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f"*?<>|/:]/.test(path)) return false;
  if (!startsWithFold(path, ALLOWED_SHARE_PREFIX)) return false;
  const rest = path.slice(ALLOWED_SHARE_PREFIX.length).replace(/\\+$/, '');
  if (rest === '') return false;
  return rest.split('\\').every((seg) => seg !== '' && !/^\.+$/.test(seg));
}

/** The share root from Settings, when it is a usable path under the allowlist. */
export function shareRoot(map: Map<string, unknown> | null | undefined): string | null {
  const v = map?.get(SHARE_ROOT_CONFIG_KEY);
  if (typeof v !== 'string') return null;
  const root = v.trim().replace(/\\+$/, '');
  return isAllowedSharePath(root) ? root : null;
}

/**
 * The project's folder on the share: the Settings root + `projects.share_folder`
 * (a folder NAME, which fix-655's indexer keeps filled).
 *
 * ★ Null when either half is missing, or when the name is not a single folder
 *   name (a separator or a dot segment) — a stored value that would walk the
 *   path somewhere else is never turned into a link.
 */
export function projectSharePath(
  root: string | null | undefined,
  folder: string | null | undefined,
): string | null {
  const name = (folder ?? '').trim();
  if (!root || !name || /[\\/]/.test(name)) return null;
  const path = `${root.replace(/\\+$/, '')}\\${name}`;
  return isAllowedSharePath(path) ? path : null;
}

/**
 * The `bridge-open:` link for a path. `encodeURIComponent` plus the five
 * characters it leaves alone (`!` `'` `(` `)` `*`), so EVERY character that
 * could matter to a browser or a command line arrives percent-encoded and the
 * handler decodes it back exactly.
 */
export function bridgeOpenUrl(path: string): string {
  const encoded = encodeURIComponent(path).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return BRIDGE_OPEN_SCHEME + encoded;
}

/** The decode the handler performs — kept here so the round trip is tested. */
export function pathFromBridgeOpenUrl(url: string): string | null {
  if (!startsWithFold(url, BRIDGE_OPEN_SCHEME)) return null;
  try {
    return decodeURIComponent(url.slice(BRIDGE_OPEN_SCHEME.length).replace(/\/+$/, ''));
  } catch {
    return null;
  }
}

export type ShareTargetKind = 'folder' | 'file';

/** What the toast says after a click. Exported so the wording is pinned. */
export function openingMessage(kind: ShareTargetKind, copied: boolean): string {
  const what = kind === 'folder' ? 'folder' : 'file';
  return copied
    ? `Opening ${what}… (path copied — if nothing opened, set up one-click folders)`
    : `Opening ${what}… (could not copy the path — if nothing opened, set up one-click folders)`;
}

export interface ClipboardWriter {
  writeText: (text: string) => Promise<void>;
}

/**
 * ★★ THE COPY FALLBACK ALWAYS FIRES. Called from the link's click handler; the
 *    link itself (a plain `<a href="bridge-open:…">`) is what asks Windows to
 *    open the path, so this never blocks or prevents it. Resolves to whether
 *    the copy succeeded.
 */
export async function copySharePath(
  path: string,
  clipboard: ClipboardWriter | undefined = typeof navigator !== 'undefined'
    ? navigator.clipboard
    : undefined,
): Promise<boolean> {
  if (!clipboard || typeof clipboard.writeText !== 'function') return false;
  try {
    await clipboard.writeText(path);
    return true;
  } catch {
    return false;
  }
}
