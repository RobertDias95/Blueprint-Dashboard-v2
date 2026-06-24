import { useMemo, useState } from 'react';
import {
  externalTeamShowRules,
  type ExternalTeamBlob,
  type ExternalTeamShowRules,
} from '../lib/externalTeam';
import type { WaitingOnDiscipline } from '../lib/database.types';

// fix-196: the SHARED external-team show-rules hook. Owns the local
// "+ Add discipline" set and derives the show-rules from the project's blob via
// the pure externalTeamShowRules(). Consumed by BOTH the Settings panel
// (ProjectExternalTeamPanel) and the Project Overview editor (ExternalTeamEditor)
// so the two surfaces share one rule and can't drift again.

export interface UseExternalTeamShowRules extends ExternalTeamShowRules {
  /** Surface a not-yet-shown discipline as a slot (the "+ Add discipline" pick). */
  addDiscipline: (discipline: WaitingOnDiscipline) => void;
}

export function useExternalTeamShowRules(
  blob: ExternalTeamBlob | null | undefined,
): UseExternalTeamShowRules {
  // Disciplines the user explicitly surfaced. Local-only — once a firm is
  // assigned the row persists on its own via assignedDisciplines.
  const [added, setAdded] = useState<Set<WaitingOnDiscipline>>(new Set());

  const rules = useMemo(
    () => externalTeamShowRules(blob, added),
    [blob, added],
  );

  const addDiscipline = (discipline: WaitingOnDiscipline) =>
    setAdded((prev) => {
      if (prev.has(discipline)) return prev;
      const next = new Set(prev);
      next.add(discipline);
      return next;
    });

  return { ...rules, addDiscipline };
}
