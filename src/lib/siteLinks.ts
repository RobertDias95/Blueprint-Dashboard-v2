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
