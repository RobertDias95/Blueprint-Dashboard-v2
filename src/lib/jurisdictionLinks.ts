// ===========================================================================
// ★★★ fix-485 §A3 (P-147) — THE JURISDICTION LINK REGISTRY
// ===========================================================================
//
// Bobby, 2026-09-02: *"Then links: D&E Studio, and a drop-down of Seattle,
// Kirkland, Bellevue with folders inside that take you to their GIS, their
// code, whatever."*
//
// ★★★ CITIES AND LINKS ARE DATA, NOT CODE. The fix-415 pattern, and its reason:
// a jurisdiction the team starts working in must not need a deploy, and a URL a
// city changes must not need one either. `app_config.jurisdictionLinks`, edited
// in Settings → Lists & Catalogs, read here.
//
// ---------------------------------------------------------------------------
// ★★★ THE SEED SHIPS THE THREE CITIES WITH **NO LINKS**
// ---------------------------------------------------------------------------
// Bobby named the cities and has not supplied the URLs. A GIS address is a
// thing you can be wrong about in a way nobody notices until they follow it to
// the wrong county's parcel viewer, so this invents none: the three cities
// exist, each renders "no links yet — add in Settings", and the first real URL
// arrives the way every other catalogue value does.
//
// ★ Same reasoning fix-335 §4 gave for naming `SHAREPOINT_URL` as a constant a
//   test asserts rather than "an href exists": a nav link to the wrong site is
//   the fix-306 defect class, and it is worse than no link at all.

/** The app_config key. Named once — the editor writes it and the ribbon reads
 *  it, and a typo in either would be a silently empty folder. */
export const JURISDICTION_LINKS_KEY = 'jurisdictionLinks';

export interface JurisdictionLink {
  label: string;
  url: string;
}

export interface Jurisdiction {
  city: string;
  links: JurisdictionLink[];
}

/** ★ The three Bobby named, with empty link lists. Used when the key has never
 *  been written — the fix-415 shape, where `zoneOptions()` supplies the shipped
 *  21 so a fresh tenant gets a working control rather than an empty one.
 *
 *  ★★ IT IS ALSO WHAT WAS SEEDED to prod on 2026-09-03, so a tenant that has
 *  never touched Settings and one that has both read the same three cities. */
export const DEFAULT_JURISDICTIONS: readonly Jurisdiction[] = [
  { city: 'Seattle', links: [] },
  { city: 'Kirkland', links: [] },
  { city: 'Bellevue', links: [] },
];

/** ★ Only `http(s)`. A stored value is untrusted input — it can be hand-typed
 *  in Settings — and `javascript:` in an `href` is the fix-387 finding
 *  ("starts with /" is not a safe URL rule) pointed at the other end of the
 *  same problem. A link that fails this is DROPPED rather than rendered inert,
 *  because a row that cannot be followed is indistinguishable from one that
 *  can until it is clicked. */
export function isSafeJurisdictionUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Decode the stored value. ★★ FIELD BY FIELD, never spread from JSON — the
 * `surfaceFilterPrefs` rule applied to a catalogue: a blob can be a shape this
 * app shipped three tickets ago, hand-edited, or truncated, and one bad row
 * must cost that row rather than the folder.
 *
 * ★ An unwritten key falls back to `DEFAULT_JURISDICTIONS`; a key written as an
 *   EMPTY ARRAY does not — that is somebody deliberately clearing the list, and
 *   re-seeding it would make the delete impossible.
 */
export function readJurisdictions(map: Map<string, unknown>): Jurisdiction[] {
  const raw = map.get(JURISDICTION_LINKS_KEY);
  if (!Array.isArray(raw)) return [...DEFAULT_JURISDICTIONS];
  const out: Jurisdiction[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const city = typeof r.city === 'string' ? r.city.trim() : '';
    if (!city) continue;
    const links: JurisdictionLink[] = [];
    if (Array.isArray(r.links)) {
      for (const l of r.links) {
        if (!l || typeof l !== 'object') continue;
        const link = l as Record<string, unknown>;
        const label = typeof link.label === 'string' ? link.label.trim() : '';
        if (!label || !isSafeJurisdictionUrl(link.url)) continue;
        links.push({ label, url: (link.url as string).trim() });
      }
    }
    out.push({ city, links });
  }
  return out;
}

/** ★ The copy a city with no links shows. One string, so the ribbon and the
 *  Settings editor cannot describe the same state two ways. */
export const NO_LINKS_YET = 'No links yet — add in Settings';
