import type {
  PlanOfRecordStage,
  ProjectPlanOfRecordRow,
} from './database.types';

// fix-285: presentation helpers for the Design Plan of Record card.
//
// ★ WHAT IS DELIBERATELY ABSENT FROM THIS FILE: any notion of which set_type
// WINS. fix-284 owns the precedence (design_guidance < schematic < marketing,
// furthest stage present, regardless of dates) and applies it in
// public.project_plan_of_record. The card reads one row and renders it. A
// second implementation of that rule here would be a second answer waiting to
// disagree with the first — and the disagreement would show up as the card
// naming a different document than the reconciliation does.
//
// So: labels, formatting, and the Windows-path plumbing. Nothing that decides.

export const STAGE_LABEL: Record<PlanOfRecordStage, string> = {
  design_guidance: 'Design Guidance',
  schematic: 'Schematic',
  marketing: 'Marketing',
};

// ===========================================================================
// ★★★ fix-407 §4 — TWO OF THESE THREE CHIPS PAINTED NOTHING
// ===========================================================================
//
// fix-406 found the Library's SITE chip reading `var(--color-ok)`, a variable
// **defined nowhere in this app**, and reported that `planOfRecord` read the
// same dead token. It did — and the report was INCOMPLETE. `marketing` read
// `var(--color-wa)`, which is equally undefined. An undefined custom property
// with no fallback makes the whole declaration invalid at computed-value time,
// so BOTH chips rendered with no background and inherited ink: `schematic` and
// `marketing` were indistinguishable from each other and from plain text.
//
// ★ Fixing only the one fix-406 named would have left the card half-painted,
// which is why both move here.
//
// ---------------------------------------------------------------------------
// ★★ WHAT THE TOKENS WERE MEANT TO BE, per this file's own comment
// ---------------------------------------------------------------------------
//
// The line that stood here said *"Blue / green / amber, reusing the repo's own
// tokens"*. `ok` and `wa` read like green and amber, and the repo HAS both:
// `--color-pm` (#059669, Permitting green) and `--color-co` (#d97706,
// Corrections amber). The intent was right; the names were never real. So the
// stated intent is finally what renders.
//
// ---------------------------------------------------------------------------
// ★★★ AND THE TINT IS OPAQUE NOW, WHICH IS THE MEASURABLE HALF
// ---------------------------------------------------------------------------
//
// `color-mix(… , transparent)` makes the chip's effective background depend on
// whatever surface it happens to land on, so its contrast is a different number
// per parent — 4.37:1 on white and 3.75:1 on `--color-s2` for the ONE chip that
// was rendering at all. Mixing into `--color-surface` instead gives every chip
// one definite tint, and therefore one contrast number a test can hold.
//
// ★★ THE RULE, from fix-406: darken the hue toward `--color-text` until the ink
// clears 4.5:1 **on its own tint, measured** — never trust the raw token. The
// THRESHOLD is the contract; the percentage is per-surface, because fix-406's
// chips sit on fixed `-bg` tokens and these sit on a computed tint, and amber
// is intrinsically the lightest of the three hues.
//
//     design_guidance   3.75 → 6.47      (it was the one that "worked")
//     schematic         dead → 5.21
//     marketing         dead → 4.68

/** ★ Ink strength: 65% hue + 35% `--color-text`. See the threshold note above —
 *  the shared contract is "≥ 4.5:1 measured", not this number. fix-406's
 *  `LIBRARY_GROUP_MIX.chipTextHuePct` is 70 for its own surfaces; the fix-407
 *  test pins both against the same 4.5 floor rather than against each other. */
export const CHIP_INK_HUE_PCT = 65;

/** Chip styling per stage — visually distinct, per the brief and the mockup.
 *  Blue / green / amber, reusing the repo's own tokens rather than the
 *  mockup's inline hexes.
 *
 *  ★ Stated as resolved values, not `color-mix()` calls, for the same reason
 *  fix-406's palette is: a stylesheet expression cannot be measured, and these
 *  are exactly the numbers the note above quotes. */
export const STAGE_CHIP: Record<PlanOfRecordStage, { bg: string; fg: string }> = {
  // 12% #2563eb on #ffffff · ink 65% #2563eb + 35% #1a2540 → 6.47:1
  design_guidance: { bg: '#e5ecfd', fg: '#214daf' },
  // 14% #059669 on #ffffff · ink 65% #059669 + 35% #1a2540 → 5.21:1
  schematic:       { bg: '#dcf0ea', fg: '#0c6e5b' },
  // 16% #d97706 on #ffffff · ink 65% #d97706 + 35% #1a2540 → 4.68:1
  marketing:       { bg: '#f9e9d7', fg: '#965a1a' },
};

/** ★ The tint recipe, exported so the fix-407 test can replay it from the real
 *  tokens instead of trusting the three hexes above. */
export const STAGE_CHIP_MIX: Record<PlanOfRecordStage, { token: string; tintPct: number }> = {
  design_guidance: { token: '--color-de', tintPct: 12 },
  schematic:       { token: '--color-pm', tintPct: 14 },
  marketing:       { token: '--color-co', tintPct: 16 },
};

export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return '—';
  return STAGE_LABEL[stage as PlanOfRecordStage] ?? stage;
}

/**
 * "627 KB" / "4.1 MB". Input is KILOBYTES — the column is size_kb.
 *
 * Production sets run from a 727 KB design-guidance PDF to a 17,398 KB
 * marketing set, so both branches are exercised by real data.
 */
export function formatFileSize(sizeKb: number | null | undefined): string {
  if (sizeKb == null || !Number.isFinite(sizeKb) || sizeKb < 0) return '';
  if (sizeKb < 1024) return `${Math.round(sizeKb)} KB`;
  const mb = sizeKb / 1024;
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/**
 * "Jun 18, 2026". Date-only: the time a file was written is noise here.
 *
 * ★ FORMATTED IN UTC, DELIBERATELY. The indexer stores midnight UTC for a file
 * modified on the 18th, and `toLocaleDateString` with no timeZone renders that
 * as "Jun 17" for every viewer west of Greenwich — so the same file appears to
 * have a different date depending on who is looking at it. Pinning to UTC keeps
 * the displayed date equal to the date the share reports.
 */
export function formatModified(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// ★ fix-289: `uncToFileUrl` AND `parentFolder` WERE DELETED HERE, DELIBERATELY.
//
// They existed only to feed the card's Open and "Show in folder" buttons, and
// those buttons could not work: Chrome and Edge block navigation from an https
// page to a file: URL or a UNC path, silently. The helper was not wrong — it
// minted a correct file: URL — but a correct URL the browser refuses to follow
// is a button that does nothing.
//
// If a future ask is "let me open the file from the dashboard", the answer is
// not a file: URL, a window.open, or a custom protocol handler. It is serving
// the PDF over https (the thumbnail already is, via a signed Storage URL).

/** True when the row has a usable, successfully-rendered thumbnail.
 *
 *  Both halves matter: `thumb_status === 'ok'` without a path, or a path left
 *  behind by a failed re-render, must both degrade to the file card. */
export function hasThumbnail(
  row: Pick<ProjectPlanOfRecordRow, 'thumb_path' | 'thumb_status'> | null | undefined,
): boolean {
  return Boolean(row && row.thumb_status === 'ok' && row.thumb_path);
}

/** Why there is no preview, in words a person can act on. Never "error". */
export function missingThumbnailReason(
  row: Pick<ProjectPlanOfRecordRow, 'thumb_path' | 'thumb_status'> | null | undefined,
): string {
  if (!row) return '';
  if (row.thumb_status === 'failed') {
    return 'The preview could not be generated from this file. The file itself is fine — open it from the path below.';
  }
  return 'No preview has been generated yet. It will appear after the next file-server index.';
}
