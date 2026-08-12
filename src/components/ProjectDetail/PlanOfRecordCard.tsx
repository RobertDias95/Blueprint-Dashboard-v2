import { useState } from 'react';
import {
  usePlanOfRecord,
  usePlanOfRecordThumbnail,
} from '../../hooks/usePlanOfRecord';
import {
  STAGE_CHIP,
  formatFileSize,
  formatModified,
  hasThumbnail,
  missingThumbnailReason,
  stageLabel,
} from '../../lib/planOfRecord';
import { pushToast } from '../../stores/toastStore';
import { OverviewCard, OverviewSection } from './OverviewCard';
import type {
  PlanOfRecordStage,
  ProjectPlanOfRecordRow,
} from '../../lib/database.types';

// fix-285: the Design Plan of Record card.
//
// Shows the current design set for a project: which stage it has reached, and a
// preview of page 1 big enough to READ. That is the whole point of the card —
// seeing what the design is without opening a 17 MB set over SMB.
//
// ★ READ-ONLY, AND STRUCTURALLY SO. No upload, no replace, no delete, no edit.
// The share is the source of truth and the file_indexer is its only writer.
// There is no mutation hook imported here and none belongs.
//
// ★ THE PRECEDENCE IS NOT DECIDED HERE. fix-284 owns it and the view has
// already applied it: design_guidance < schematic < marketing, furthest stage
// present, regardless of file dates. This component reads one row.
//
// Two states that are NOT errors and must never look like one:
//   * no row at all — nothing has been filed. Two production projects are in
//     this state today; their only document set is a Schematic Design folder
//     holding CAD files and no PDF.
//   * a row whose thumbnail is missing or failed — degrades to the file card,
//     with the name, date and path still fully usable.

interface Props {
  projectId: string;
}

export default function PlanOfRecordCard({ projectId }: Props) {
  const q = usePlanOfRecord(projectId);
  const [lightbox, setLightbox] = useState(false);
  const row = q.data ?? null;

  return (
    // fix-290: this card's own banner was the one that looked right, so it is
    // the one OverviewCard generalised. It now RENDERS that shared component
    // rather than a private copy of it — otherwise "all five cards match" would
    // hold only until somebody edited one of the two.
    <OverviewCard title="Design Plan of Record" testId="plan-of-record-card">
      <OverviewSection>
        {q.isLoading ? (
          <div
            className="h-[220px] rounded border animate-pulse"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--color-s2)',
            }}
            data-testid="plan-of-record-loading"
          />
        ) : q.error ? (
          // Even a failed fetch stays calm and factual: this card is context,
          // not something anybody is blocked on.
          <div
            className="rounded border border-dashed px-3 py-6 text-center text-[10.5px] text-dim leading-relaxed"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid="plan-of-record-error"
          >
            The design set could not be loaded.
            <button
              type="button"
              onClick={() => q.refetch()}
              className="ml-1 text-de font-bold hover:underline"
              data-testid="plan-of-record-retry"
            >
              Try again
            </button>
          </div>
        ) : !row ? (
          <EmptyState />
        ) : (
          <PlanOfRecordBody row={row} onEnlarge={() => setLightbox(true)} />
        )}
      </OverviewSection>

      {lightbox && row && (
        <Lightbox row={row} onClose={() => setLightbox(false)} />
      )}
    </OverviewCard>
  );
}

// --------------------------------------------------------------- empty state --

/** Most projects, initially — and two permanently, until somebody files a PDF.
 *  Says plainly what is absent and names the three things that would count, so
 *  it reads as "nothing filed" rather than "something broke". */
function EmptyState() {
  return (
    <div
      className="rounded border border-dashed flex flex-col items-center justify-center text-center px-4 py-10 min-h-[220px]"
      style={{ borderColor: 'var(--color-border)' }}
      data-testid="plan-of-record-empty"
    >
      <div className="text-[11px] font-bold text-muted">
        No design set on file yet
      </div>
      <p className="text-[10.5px] text-dim mt-1.5 leading-relaxed max-w-[240px]">
        Nothing matching Design&nbsp;Guidance, Schematic or Marketing has been
        filed in this project&apos;s folder.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- the body --

function PlanOfRecordBody({
  row,
  onEnlarge,
}: {
  row: ProjectPlanOfRecordRow;
  onEnlarge: () => void;
}) {
  const meta = [formatModified(row.modified_at), formatFileSize(row.size_kb)]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <StageChip stage={row.set_type} />
      <Preview row={row} onEnlarge={onEnlarge} />

      <div
        className="text-[11px] font-bold text-text mt-2 leading-snug break-words"
        data-testid="plan-of-record-filename"
      >
        {row.file_name}
      </div>
      {meta && (
        <div className="text-[10px] text-dim" data-testid="plan-of-record-meta">
          {meta ? `Modified ${meta}` : ''}
        </div>
      )}

      {/* ★ fix-295: THE PATH IS NO LONGER ON THE CARD FACE.
          It rendered the full UNC string, wrapped to three or four lines, and
          was the tallest single element on the card -- a third of its height
          spent on something nobody acts on. The room goes to the preview, which
          is the only content here whose usefulness is bound by resolution.

          It is NOT gone: it still renders inside the lightbox, where there is
          space and where somebody who deliberately opened the file is far more
          likely to want it. And Copy path stays exactly where it was -- fix-289
          established that browsers will not open a UNC path from https, so it
          is the only route from this card to the actual file. Removing it would
          strand the card. */}
      <PathActions row={row} />
    </>
  );
}

function StageChip({ stage }: { stage: PlanOfRecordStage }) {
  const chip = STAGE_CHIP[stage] ?? STAGE_CHIP.design_guidance;
  return (
    <span
      className="inline-block text-[9px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full mb-2"
      style={{ background: chip.bg, color: chip.fg }}
      data-testid={`plan-of-record-stage-${stage}`}
    >
      {stageLabel(stage)}
    </span>
  );
}

// ------------------------------------------------------------------ preview --

function Preview({
  row,
  onEnlarge,
}: {
  row: ProjectPlanOfRecordRow;
  onEnlarge: () => void;
}) {
  const usable = hasThumbnail(row);
  const thumbQ = usePlanOfRecordThumbnail(usable ? row.thumb_path : null);

  // ★ Never a broken image and never an error. A row with no usable thumbnail,
  // or one whose signature could not be minted, falls back to a plain note and
  // leaves the name/date/path below fully functional.
  if (!usable || thumbQ.error || (!thumbQ.isLoading && !thumbQ.data)) {
    return (
      <div
        className="rounded border border-dashed flex items-center justify-center text-center px-3 py-8 min-h-[260px] text-[10px] text-dim leading-relaxed"
        style={{ borderColor: 'var(--color-border)' }}
        data-testid="plan-of-record-no-preview"
      >
        {missingThumbnailReason(row)}
      </div>
    );
  }

  if (thumbQ.isLoading) {
    return (
      <div
        className="rounded border animate-pulse min-h-[260px]"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-s2)',
        }}
        data-testid="plan-of-record-preview-loading"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={onEnlarge}
      className="relative block w-full rounded border overflow-hidden bg-white hover:border-de transition group"
      style={{ borderColor: 'var(--color-border)' }}
      title="Click to enlarge"
      data-testid="plan-of-record-preview"
    >
      <img
        src={thumbQ.data ?? ''}
        alt={`Page 1 of ${row.file_name}`}
        className="block w-full h-auto"
        data-testid="plan-of-record-preview-img"
      />
      <span
        className="absolute right-1.5 bottom-1.5 text-[9px] text-white px-1.5 py-0.5 rounded"
        style={{ background: 'rgba(30,42,56,.85)' }}
      >
        Click to enlarge
      </span>
    </button>
  );
}

// ------------------------------------------------------------------ actions --

// ★ fix-289: THERE IS NO "OPEN" BUTTON, AND ONE MUST NOT BE ADDED BACK.
//
// Chrome and Edge silently refuse to navigate from an https page to a file:
// URL or a UNC path. Nothing is thrown and no dialog appears — the click just
// does nothing, which is worse than not offering it at all. This is a browser
// security boundary, not a bug to route around: a file: anchor and
// window.open() are both blocked, and a custom protocol handler would need
// software installed on every machine that ever views this page.
//
// The clipboard is NOT restricted, so copying is the one thing that reliably
// works. Copy path plus the visible, selectable path above it is the whole
// mechanism, and the hint says where the copied text is meant to go.
function PathActions({ row }: { row: ProjectPlanOfRecordRow }) {
  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      pushToast(`${what} copied`, 'success');
    } catch {
      pushToast('Could not copy to the clipboard', 'error');
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
      <button
        type="button"
        onClick={() => copy(row.unc_path, 'Path')}
        className="text-[10px] font-bold px-2 py-0.5 rounded border border-de bg-de text-white hover:opacity-90 transition"
        data-testid="plan-of-record-copy"
      >
        Copy path
      </button>
      <span className="text-[9.5px] text-dim" data-testid="plan-of-record-copy-hint">
        paste into File Explorer to open
      </span>
    </div>
  );
}

// ----------------------------------------------------------------- lightbox --

function Lightbox({
  row,
  onClose,
}: {
  row: ProjectPlanOfRecordRow;
  onClose: () => void;
}) {
  const thumbQ = usePlanOfRecordThumbnail(hasThumbnail(row) ? row.thumb_path : null);
  // ★ fix-295: THE ENLARGE IS CAPPED, AND NOT BY THIS REPO.
  //
  // The thumbnails are rendered by the SCRAPER (file_indexer/thumbnails.py,
  // MAX_WIDTH = 900, JPEG_QUALITY = 80) and stored in the plan-thumbnails
  // bucket. 900px is the whole source. Displaying it wider upscales a JPEG, so
  // the enlarge gets bigger and LESS readable -- the opposite of what was asked
  // for. Sharp at 900 beats blurry at 1800.
  //
  // So the dialog takes the viewport, and the IMAGE is capped at its own
  // natural width. Read from the loaded bitmap rather than hardcoded to 900:
  // when the scraper ticket raises MAX_WIDTH and re-renders, this widens on its
  // own with no change here. Empty space beside a 900px image in a wider dialog
  // is the correct and honest result -- it is the render resolution showing
  // through, and it is the signal that the fix belongs upstream.
  const [naturalWidth, setNaturalWidth] = useState<number | null>(null);

  const meta = [formatModified(row.modified_at), formatFileSize(row.size_kb)]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(20,28,38,.72)' }}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      role="presentation"
      data-testid="plan-of-record-lightbox"
    >
      <div
        className="bg-surface rounded-lg p-3.5 w-full max-w-[min(96vw,1400px)] max-h-full overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={row.file_name}
      >
        <div className="flex items-start justify-between gap-3 mb-2.5">
          <div className="min-w-0">
            <div className="text-xs font-bold text-text break-words">
              {row.file_name}
            </div>
            <div className="text-[10px] text-dim mt-0.5">
              {/* Page 1 — the only page rendered. The row carries no page
                  COUNT, so none is claimed: "page 1 of 12" would be invented. */}
              {[stageLabel(row.set_type), meta && `Modified ${meta}`, 'Page 1']
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 text-[11px] font-bold px-2.5 py-1 rounded border border-border bg-surface text-text hover:bg-s2 transition"
            data-testid="plan-of-record-lightbox-close"
          >
            Close
          </button>
        </div>

        {thumbQ.data ? (
          <img
            src={thumbQ.data}
            alt={`Page 1 of ${row.file_name}`}
            className="block w-full h-auto rounded border mx-auto"
            onLoad={(e) =>
              setNaturalWidth(e.currentTarget.naturalWidth || null)
            }
            style={{
              borderColor: 'var(--color-border)',
              // The whole no-upscale rule, in one line. width:100% via the
              // class fills the dialog; this stops it past the source width.
              maxWidth: naturalWidth ? `${naturalWidth}px` : undefined,
            }}
            data-testid="plan-of-record-lightbox-img"
          />
        ) : (
          <div
            className="rounded border border-dashed px-3 py-10 text-center text-[10.5px] text-dim"
            style={{ borderColor: 'var(--color-border)' }}
          >
            {missingThumbnailReason(row)}
          </div>
        )}

        {/* fix-295: the path lives HERE now, not on the card face. Same
            monospace, selectable treatment it always had. */}
        <div
          className="font-mono text-[9px] text-muted rounded border px-1.5 py-1 mt-2.5 break-all leading-relaxed select-all"
          style={{
            background: 'var(--color-s2)',
            borderColor: 'var(--color-border)',
          }}
          data-testid="plan-of-record-lightbox-path"
        >
          {row.unc_path}
        </div>
      </div>
    </div>
  );
}
