import { useCallback } from 'react';
import { usePermitTypes } from './usePermitTypes';
import {
  anchorForType,
  type TargetSubmitAnchor,
} from '../lib/targetSubmitLearner';

// ★★★ fix-680: the ONE way a screen learns a permit type's Target Submit
// anchor — `permit_types.ts_anchor`, the same column bp_recompute_target_submits
// reads. There is no type list in code any more, so a type added in Settings
// gets its anchor (GO date by default) everywhere at once.

export function useTargetSubmitAnchors() {
  const typesQ = usePermitTypes();
  const types = typesQ.data;
  const anchorOf = useCallback(
    (type: string | null | undefined): TargetSubmitAnchor =>
      anchorForType(type, types),
    [types],
  );
  return { anchorOf, isLoading: typesQ.isLoading };
}
