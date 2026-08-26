import { useAppConfig } from '../../hooks/useAppConfig';
import { isRetiredZone, zoneOptions } from '../../lib/zoneOptions';

// ===========================================================================
// ★★★ fix-415 SCOPE A3 — ONE ZONE CONTROL, AND IT IS A DROPDOWN
// ===========================================================================
//
// *"Dropdown-only on every surface that writes zone. Free text is what caused
// this."* — the same rule fix-232 applied to product types after the same thing
// happened to them.
//
// ★★ THREE MOUNTS, ONE DEFINITION: the Project Overview SITE card, the Project
// Settings modal, and the wizard's Step 1. Those are exactly the three surfaces
// STEP 0 found that WRITE `projects.zone`, and they wrote through three
// different paths — a direct table UPDATE, `bp_update_project_with_permits`,
// and `bp_create_project_with_permits`. One control means the vocabulary cannot
// differ between them; separate ones is how 33 spellings happened.
//
// ★ It reads the registry itself rather than taking an options prop, for the
// same reason fix-409's toggle reads its own preference: three call sites
// cannot then be handed three different lists.

export default function ZoneSelect({
  value,
  onChange,
  disabled,
  testid,
  className,
  style,
}: {
  /** The stored zone, or '' / null when the project has none. */
  value: string | null | undefined;
  /** '' means the user cleared it back to no zone. */
  onChange: (next: string) => void;
  disabled?: boolean;
  testid: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const cfg = useAppConfig();
  const current = (value ?? '').trim();
  // ★★ `current` is passed in so a stored value an admin has since retired is
  //    APPENDED rather than dropped — see lib/zoneOptions. A <select> whose
  //    value matches no option renders BLANK, which would silently claim the
  //    project has no zone.
  const options = zoneOptions(cfg.map, current);
  const retired = isRetiredZone(cfg.map, current);

  return (
    <select
      value={current}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      style={style}
      data-testid={testid}
      data-retired={retired ? 'true' : 'false'}
      aria-label="Zone"
    >
      {/* ★ The empty option is NOT a 22nd zone — it is how a project says it has
          none, and five on prod legitimately do. Removing it would force a
          zone onto every project that has never been looked at. */}
      <option value="">—</option>
      {options.map((z) => (
        <option key={z} value={z}>
          {z === current && retired ? `${z} (retired)` : z}
        </option>
      ))}
    </select>
  );
}
