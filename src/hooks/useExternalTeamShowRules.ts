import { useMemo, useState } from 'react';
import {
  externalTeamShowRules,
  type ExternalTeamBlob,
  type ExternalTeamShowRules,
} from '../lib/externalTeam';
import { useAppConfig } from './useAppConfig';
import { firmDisciplineOptions } from '../lib/waitingOn';

// fix-196: the SHARED external-team show-rules hook. Owns the local
// "+ Add discipline" set and derives the show-rules from the project's blob via
// the pure externalTeamShowRules(). Consumed by BOTH the Settings panel
// (ProjectExternalTeamPanel) and the Project Overview editor (ExternalTeamEditor)
// so the two surfaces share one rule and can't drift again.

export interface UseExternalTeamShowRules extends ExternalTeamShowRules {
  /** Surface a not-yet-shown discipline as a slot (the "+ Add discipline" pick). */
  addDiscipline: (discipline: string) => void;
  /**
   * ★ fix-423: the disciplines surfaced in THIS session, exposed.
   *
   * The Project Overview editor collapses its External block when the project
   * has nothing external AND nobody has asked for a slot — and it cannot tell
   * the second half from `shownDisciplines` alone, because surfacing one of the
   * common four adds to this set without changing that list's length. Without
   * it, picking "Civil" from the collapsed control would do nothing visible.
   * The RULE is untouched; only what the hook admits to knowing changes.
   */
  addedDisciplines: ReadonlySet<string>;
}

export function useExternalTeamShowRules(
  blob: ExternalTeamBlob | null | undefined,
): UseExternalTeamShowRules {
  // Disciplines the user explicitly surfaced. Local-only — once a firm is
  // assigned the row persists on its own via assignedDisciplines.
  const [added, setAdded] = useState<Set<string>>(new Set());

  // ★★★ fix-606: THE VOCABULARY COMES FROM SETTINGS, AND THIS IS THE SEAM.
  //     `externalTeamShowRules` is pure and cannot read a hook, so the list is
  //     resolved here — `firmDisciplineOptions` is the admin's Waiting-On list
  //     minus `City` and `Other`, which are answers but not firms.
  const cfg = useAppConfig();
  const disciplines = useMemo(() => firmDisciplineOptions(cfg.map), [cfg.map]);

  const rules = useMemo(
    () => externalTeamShowRules(blob, added, disciplines),
    [blob, added, disciplines],
  );

  const addDiscipline = (discipline: string) =>
    setAdded((prev) => {
      if (prev.has(discipline)) return prev;
      const next = new Set(prev);
      next.add(discipline);
      return next;
    });

  return { ...rules, addDiscipline, addedDisciplines: added };
}
