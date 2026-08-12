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

/** Chip styling per stage — visually distinct, per the brief and the mockup.
 *  Blue / green / amber, reusing the repo's own tokens rather than the
 *  mockup's inline hexes. */
export const STAGE_CHIP: Record<PlanOfRecordStage, { bg: string; fg: string }> = {
  design_guidance: { bg: 'color-mix(in srgb, var(--color-de) 12%, transparent)', fg: 'var(--color-de)' },
  schematic:       { bg: 'color-mix(in srgb, var(--color-ok) 14%, transparent)', fg: 'var(--color-ok)' },
  marketing:       { bg: 'color-mix(in srgb, var(--color-wa) 16%, transparent)', fg: 'var(--color-wa)' },
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
