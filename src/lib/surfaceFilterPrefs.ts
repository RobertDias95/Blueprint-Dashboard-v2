import {
  clearFilterState,
  loadFilterState,
  numOrNull,
  oneOf,
  saveFilterState,
  str,
  strArray,
} from './filterPrefs';
import { PARKING_KINDS, type ParkingKind } from './database.types';
import type { LibraryFilters } from './libraryHelpers';
import type { RoofDeckFilter, StallsTier } from './unitParking';

// ===========================================================================
// ★★★ fix-403 — WHAT EACH SURFACE REMEMBERS
// ===========================================================================
//
// The mechanism is `filterPrefs`; this is the per-surface shape. Two thin
// callers, following fix-326's rule that a fourth panel must not become a
// fourth store.
//
// ★★ EVERY FIELD IS DECODED THROUGH A COERCION, never spread from JSON. A
// stored blob is untrusted input: it can be a shape this app shipped three
// tickets ago, hand-edited, or truncated. Decoding field by field means an
// unknown value falls back to that field's default and the rest of the filter
// still restores — instead of one bad key emptying the whole panel.

// ---------------------------------------------------------------------------
// Library — the whole fix-402 filter shape, both cards
// ---------------------------------------------------------------------------

const LIBRARY_NS = 'library.filters';

const STALLS_TIERS: readonly StallsTier[] = ['', '1+', '2+'];
const ROOF_DECKS: readonly RoofDeckFilter[] = ['', 'Yes', 'No'];
const CORNERS = ['', 'Yes', 'No'] as const;
/** ★ fix-410: the four regular-shape filter states, as a closed set so a value
 *  retired later cannot come back from storage and match nothing forever. */
const SHAPES = ['', 'Regular', 'Irregular', 'Not set'] as const;
const STORIES = ['', '1', '2', '3', '4+'] as const;

export function loadLibraryFilters(
  userId: string | null | undefined,
  fallback: LibraryFilters,
): LibraryFilters | null {
  return loadFilterState<LibraryFilters>(LIBRARY_NS, userId, (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    return {
      search: str(o.search),
      // ★ Targets are nullable numbers; buffers keep the panel's own default
      //   rather than 0, which would silently narrow every range to exact.
      lotwTarget: numOrNull(o.lotwTarget),
      lotwBuf: numOrNull(o.lotwBuf) ?? fallback.lotwBuf,
      lotdTarget: numOrNull(o.lotdTarget),
      lotdBuf: numOrNull(o.lotdBuf) ?? fallback.lotdBuf,
      unitwTarget: numOrNull(o.unitwTarget),
      unitwBuf: numOrNull(o.unitwBuf) ?? fallback.unitwBuf,
      unitdTarget: numOrNull(o.unitdTarget),
      unitdBuf: numOrNull(o.unitdBuf) ?? fallback.unitdBuf,
      zone: str(o.zone),
      alley: str(o.alley),
      productTypes: strArray(o.productTypes),
      tag: str(o.tag),
      juris: str(o.juris),
      isCornerLot: oneOf(o.isCornerLot, CORNERS, ''),
      // ★ fix-410: decoded through a coercion like every other field — a
      //   session stored before this ticket has no key at all and falls back
      //   to Any, rather than restoring `undefined` into the select.
      isRegularShape: oneOf(o.isRegularShape, SHAPES, ''),
      stories: oneOf(o.stories, STORIES, ''),
      // ★★ fix-402's three. `parkingKind` is validated against the closed set,
      //   so a kind retired later cannot come back from storage and match
      //   nothing forever.
      parkingKind: oneOf<'' | ParkingKind>(
        o.parkingKind,
        ['', ...PARKING_KINDS],
        '',
      ),
      stalls: oneOf(o.stalls, STALLS_TIERS, ''),
      roofDeck: oneOf(o.roofDeck, ROOF_DECKS, ''),
    };
  });
}

export function saveLibraryFilters(
  userId: string | null | undefined,
  filters: LibraryFilters,
): void {
  saveFilterState(LIBRARY_NS, userId, filters);
}

export function clearLibraryFilters(userId: string | null | undefined): void {
  clearFilterState(LIBRARY_NS, userId);
}

// ---------------------------------------------------------------------------
// Pipeline — the search box, fix-178's hold filter, and the four stage filters
// ---------------------------------------------------------------------------
//
// ★★★ fix-178 SAID "no persistence, resets each load", VERBATIM:
//
//     "fix-178: three-way hold filter (All / Only holds / Exclude holds).
//      Default 'all'; no persistence (resets each load)."
//
// ★★ THAT WAS RIGHT THEN AND BOBBY'S ASK SUPERSEDES IT — for the SESSION scope
// only. His complaint is losing a filter by navigating one screen away and
// back, which is precisely what "resets each load" cost him. The note's real
// concern — that a hold filter should not follow you into tomorrow — is
// PRESERVED, because sessionStorage dies with the tab: a fresh tab still opens
// on All, exactly as fix-178 intended.

const PIPELINE_NS = 'pipeline.filters';

const HOLD_MODES = ['all', 'only', 'exclude'] as const;
export type StoredHoldMode = (typeof HOLD_MODES)[number];

/** The Pipeline's filter state, in a JSON-safe shape.
 *
 *  ★★ `DashFilters` holds SETS, which `JSON.stringify` turns into `{}` —
 *  silently, with no error, restoring as an empty filter that looks like it
 *  worked. They are encoded as arrays here and rehydrated on the way out, which
 *  is the whole reason this surface needs its own encoder rather than a
 *  straight round-trip. */
export interface StoredPipelineFilters {
  search: string;
  holdMode: StoredHoldMode;
  ent: string[];
  da: string[];
  dm: string[];
  type: string[];
}

export function loadPipelineFilters(
  userId: string | null | undefined,
): StoredPipelineFilters | null {
  return loadFilterState<StoredPipelineFilters>(PIPELINE_NS, userId, (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    return {
      search: str(o.search),
      holdMode: oneOf(o.holdMode, HOLD_MODES, 'all'),
      ent: strArray(o.ent),
      da: strArray(o.da),
      dm: strArray(o.dm),
      type: strArray(o.type),
    };
  });
}

export function savePipelineFilters(
  userId: string | null | undefined,
  value: StoredPipelineFilters,
): void {
  saveFilterState(PIPELINE_NS, userId, value);
}

export function clearPipelineFilters(userId: string | null | undefined): void {
  clearFilterState(PIPELINE_NS, userId);
}
