// ===========================================================================
// ★★★ fix-611 §C — ONE BLOCK OPEN AT A TIME, AND WHICH CATEGORY IS SHOWING
// ===========================================================================
//
// The context lives in `lib/` rather than beside the component because a
// component module may export only components in this repo (react-refresh, and
// only LINT catches it — fix-403, fix-408 and fix-499 all moved a helper for
// this reason).
//
// ★★ TWO THINGS TRAVEL DOWN, and the second is what lets the existing tabs stay
//    whole: `category` tells a `SettingsBlock` whether it belongs on the page
//    currently showing. A tab such as AdminTeamTab contributes blocks to THREE
//    categories (People, Teams & routing, Health & tools); it is mounted on each
//    of those pages and renders only the blocks that match.
import { createContext, useContext } from 'react';
import type { SettingsSectionId } from './settingsSections';

export interface SettingsBlockState {
  /** The category being rendered. A block of any other category renders null. */
  category: SettingsSectionId;
  /** The open block's id, or null when the category is all collapsed. */
  openId: string | null;
  /** Open this block and close whatever else was open in this category. */
  toggle: (id: string) => void;
}

/**
 * ★ The default is a REAL, INERT value rather than `null`, so a tab rendered
 *   outside the Settings page (several tests do exactly that, and so does
 *   `/reports/phase-durations`) shows every block expanded instead of throwing.
 *   `category: null` means "no filtering"; `openId: null` with no toggle means
 *   "not an accordion", which is the pre-fix-611 behaviour.
 */
export const SETTINGS_BLOCK_FALLBACK = {
  category: null,
  openId: null,
  toggle: undefined,
} as const;

export type SettingsBlockContextValue = SettingsBlockState | typeof SETTINGS_BLOCK_FALLBACK;

export const SettingsBlockContext =
  createContext<SettingsBlockContextValue>(SETTINGS_BLOCK_FALLBACK);

export function useSettingsBlockContext(): SettingsBlockContextValue {
  return useContext(SettingsBlockContext);
}

/** Is this block the open one? Outside the accordion everything reads open. */
export function blockIsOpen(
  ctx: SettingsBlockContextValue,
  id: string,
): boolean {
  if (ctx.category === null) return true;
  return ctx.openId === id;
}

/** Should this block render at all on the page currently showing? */
export function blockIsOnThisPage(
  ctx: SettingsBlockContextValue,
  blockCategory: SettingsSectionId | undefined,
): boolean {
  if (ctx.category === null) return true;
  return blockCategory === ctx.category;
}
