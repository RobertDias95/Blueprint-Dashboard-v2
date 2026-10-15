import { loadFilterState, saveFilterState } from "./filterPrefs";
import { GUIDE_FILTER_DEFAULT, isGuideFilter, type GuideFilter } from "./guide";

// ★★ fix-673 §A — the Guide's role pill, remembered for the SESSION.
//
// fix-403's store (sessionStorage, per user id), not localStorage: "I am
// reading the Design chapters" is a train of thought, and a fresh tab should
// open on All again — Bobby's ruling is that the Guide opens on All.

const NAMESPACE = "whatsnew.guide.filter";

/** The stored pill for this user, or All. */
export function loadGuideFilter(
  userId: string | null | undefined,
): GuideFilter {
  return (
    loadFilterState<GuideFilter>(NAMESPACE, userId, (raw) =>
      isGuideFilter(raw) ? raw : null,
    ) ?? GUIDE_FILTER_DEFAULT
  );
}

export function saveGuideFilter(
  userId: string | null | undefined,
  filter: GuideFilter,
): void {
  saveFilterState(NAMESPACE, userId, filter);
}
