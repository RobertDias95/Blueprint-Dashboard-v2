// ===========================================================================
// fix-632 (P-328) — MAP AND DRONE LINKS UNDER SITE DATA
// ===========================================================================
//
// Dave: *"add a link to goggle maps and the drone videos under site data on
// project overview."* · Bobby on drone footage: *"working on getting them in a
// file, lets build everything out that we can, and then clean it up once the
// location is set."*

/** The app_config key for the shared "Drone Photos" folder (Settings). */
export const DRONE_FOLDER_CONFIG_KEY = 'droneFootageFolderUrl';

/**
 * Google Maps at the project's address. The `search` URL needs no API key.
 * ★ `projects` carries no state column, so the query is address + city —
 *   which is enough for Google to resolve every address on file.
 */
export function googleMapsUrl(
  address: string | null | undefined,
  city: string | null | undefined,
): string | null {
  const parts = [address, city].map((p) => (p ?? '').trim()).filter(Boolean);
  if (parts.length === 0 || !(address ?? '').trim()) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.join(', '))}`;
}

export function isWebUrl(v: string | null | undefined): v is string {
  return typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim());
}

export type DroneUrlCheck = { ok: true; value: string | null } | { ok: false; message: string };

/**
 * What the drone-video field accepts: a web link (http/https — SharePoint and
 * OneDrive links are) or nothing.
 *
 * ★★ A SERVER PATH IS REFUSED BY NAME. A `\\server\share\…` or `X:\…` path
 *    does not open from a browser (P-149), so storing one would give Site Data
 *    a link that does nothing when clicked.
 */
export function checkDroneUrl(raw: string | null | undefined): DroneUrlCheck {
  const v = (raw ?? '').trim();
  if (v === '') return { ok: true, value: null };
  if (isWebUrl(v)) return { ok: true, value: v };
  if (/^\\\\|^[a-z]:\\|^file:/i.test(v)) {
    return {
      ok: false,
      message:
        "That's a server path, and a browser can't open those. Paste the SharePoint or OneDrive web link instead (it starts with https://).",
    };
  }
  return { ok: false, message: 'Paste a web link that starts with https://.' };
}

/** The shared folder link from Settings, when it is a usable web link. */
export function droneFolderUrl(map: Map<string, unknown> | null | undefined): string | null {
  const v = map?.get(DRONE_FOLDER_CONFIG_KEY);
  return isWebUrl(v as string) ? (v as string).trim() : null;
}

// ===========================================================================
// fix-641 §B (P-337) — "FOOTAGE FOLDER" OPENS THE PROJECT'S OWN FOLDER
// ===========================================================================
//
// Bobby, 10-11: *"when i clicked it, it did not open 10431, just opened the
// wholisitic drone library. it should open the project address"*.
//
// ★★ THE LINK IS BUILT, NOT STORED. `projects.drone_folder` holds only the
//    folder's exact name; the shared folder URL stays the Settings value, so
//    moving the library changes one key and every project follows.

/**
 * SharePoint's own encoding for the `id=` path: `encodeURIComponent` plus the
 * characters it leaves alone (`-` `_` `.` `!` `~` `*` `'` `(` `)`), which is
 * how the shared link spells them (`%2D`, `%5F`, `%2E` …). Spaces are `%20`,
 * never `+`.
 */
export function sharePointEncode(s: string): string {
  return encodeURIComponent(s).replace(
    /[-_.!~*'()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/**
 * The shared "Drone Photos" link with `/<folder>` appended to its `id=` path —
 * the shape Cowork opened in Bobby's browser on 10-11.
 *
 * ★ Null when there is no folder, no shared link, or the shared link has no
 *   `id=` to extend: Site Data then falls back to the shared folder itself
 *   rather than a link that lands nowhere.
 */
export function projectFolderUrl(
  sharedUrl: string | null | undefined,
  folder: string | null | undefined,
): string | null {
  const name = (folder ?? '').trim();
  if (!name || !isWebUrl(sharedUrl)) return null;
  const url = sharedUrl.trim();
  const m = /([?&]id=)([^&#]*)/.exec(url);
  if (!m) return null;
  let path: string;
  try {
    path = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  const next = `${path.replace(/\/+$/, '')}/${name}`
    .split('/')
    .map(sharePointEncode)
    .join('%2F');
  return url.slice(0, m.index) + m[1] + next + url.slice(m.index + m[0].length);
}

export type FootageLink =
  | { kind: 'own'; href: string }
  | { kind: 'project-folder'; href: string }
  | { kind: 'shared-folder'; href: string }
  | { kind: 'none' };

/**
 * ★★ THE PRIORITY, IN ONE PLACE:
 *   1. the project's pasted `drone_video_url` — a person put it there, so it
 *      is an override;
 *   2. `drone_folder` — that project's folder inside the shared library;
 *   3. the shared library itself (what fix-632 shipped);
 *   4. nothing.
 */
export function footageLink(
  project: { drone_video_url?: string | null; drone_folder?: string | null },
  sharedUrl: string | null,
): FootageLink {
  if (isWebUrl(project.drone_video_url)) {
    return { kind: 'own', href: project.drone_video_url.trim() };
  }
  const own = projectFolderUrl(sharedUrl, project.drone_folder);
  if (own) return { kind: 'project-folder', href: own };
  if (sharedUrl) return { kind: 'shared-folder', href: sharedUrl };
  return { kind: 'none' };
}

// ---------------------------------------------------------------------------
// ★★★ THE MATCHING RULE — the tested mirror of the fix-641 migration's seed.
// ---------------------------------------------------------------------------
// The one-time seed ran in SQL (migrations/fix_641_drone_folder.sql); this is
// the same rule in TypeScript so it is pinned by tests and the scraper's
// nightly refresh (fix-639 §D) has a reference. EXACT matches only — every
// step below is a spelling equivalence, never a similarity score.

const ADDRESS_TOKENS: Record<string, string> = {
  street: 'st', avenue: 'ave', av: 'ave', place: 'pl', drive: 'dr',
  boulevard: 'blvd', road: 'rd', lane: 'ln', court: 'ct', terrace: 'ter',
  parkway: 'pkwy', circle: 'cir',
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
};

/** Lower-case, drop dots, collapse whitespace, abbreviate token by token. */
export function normaliseAddress(raw: string | null | undefined): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/\./g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ADDRESS_TOKENS[t] ?? t)
    .join(' ');
}

/**
 * The addresses one folder name stands for.
 *   `10431 SE 19th St - Bellevue` → [`10431 SE 19th St`]  (city suffix off)
 *   `1301, 1303, 1307 6th Ave N`  → 1301 / 1303 / 1307 `6th Ave N`
 * ★ A comma list whose leading parts are not bare house numbers is not a list
 *   this rule understands, so it yields NOTHING rather than a guess.
 */
export function folderAddresses(folder: string): string[] {
  const base = folder.replace(/\s+-\s+[A-Za-z .]+$/, '');
  const parts = base.split(',').map((p) => p.trim());
  if (parts.length === 1) return [parts[0]];
  const last = parts[parts.length - 1];
  const lead = parts.slice(0, -1);
  if (!/^\d+\s+\S/.test(last) || lead.some((p) => !/^\d+$/.test(p))) return [];
  const street = last.replace(/^\d+\s+/, '');
  return [...lead.map((n) => `${n} ${street}`), last];
}

export interface FolderMatch {
  folder: string;
  projectIds: string[];
}

/** Every folder with the projects it matched exactly (possibly none). */
export function matchDroneFolders(
  folders: readonly string[],
  projects: readonly { id: string; address: string | null }[],
): FolderMatch[] {
  const byKey = new Map<string, string[]>();
  for (const p of projects) {
    const k = normaliseAddress(p.address);
    if (!k) continue;
    byKey.set(k, [...(byKey.get(k) ?? []), p.id]);
  }
  return folders.map((folder) => ({
    folder,
    projectIds: [
      ...new Set(folderAddresses(folder).flatMap((a) => byKey.get(normaliseAddress(a)) ?? [])),
    ],
  }));
}
