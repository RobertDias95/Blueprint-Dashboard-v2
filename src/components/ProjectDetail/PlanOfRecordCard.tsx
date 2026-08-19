import { useState } from 'react';
import { stalenessNote } from '../../lib/planOfRecordStaleness';
import {
  usePlanOfRecord,
  usePlanOfRecordThumbnail,
} from '../../hooks/usePlanOfRecord';
import { usePlanOfRecordVerdict } from '../../hooks/usePlanOfRecordVerdict';
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
  ProjectPlanOfRecordVerdictRow,
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
  // ★★★ fix-358: the REASONING, read and never re-derived. See below for the
  // three states it distinguishes and why the old single empty state was the
  // bug fix-356 was built to end.
  const verdictQ = usePlanOfRecordVerdict(projectId);
  const [lightbox, setLightbox] = useState(false);
  const row = q.data ?? null;
  const verdict = verdictQ.data ?? null;
  // ★ Only trust the verdict once it has actually answered. While it is loading
  // — or if it fails — the card behaves exactly as it did before fix-358, which
  // is what keeps an additive piece of context from being able to break the
  // card it annotates.
  const verdictKnown = !verdictQ.isLoading && !verdictQ.isError;

  return (
    // fix-290: this card's own banner was the one that looked right, so it is
    // the one OverviewCard generalised. It now RENDERS that shared component
    // rather than a private copy of it — otherwise "all five cards match" would
    // hold only until somebody edited one of the two.
    <OverviewCard title="Design Plan of Record" testId="plan-of-record-card">
      {/* ★★ fix-335 §6: the ONE card that centres its content vertically.
          Bobby: "can we center the design plan of record so it's vertically
          spaced in that area … so it doesn't look like there's a ton of
          opening." See OverviewSection.centerVertically for why this is opt-in
          and why fix-331 §1's even distribution is deliberately left alone. */}
      <OverviewSection centerVertically>
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
        ) : verdictKnown && verdict && verdict.stage === null ? (
          // ★★★ NOTHING QUALIFIED — a DESIGNED state, not an absence.
          //
          // 33 of 138 projects are here, and every one already carries the
          // sentence that explains it. This is the whole point of fix-358: a
          // blank card teaches nobody anything, and each blank becomes a
          // specific filing request the moment the reason is printed.
          <NothingQualified verdict={verdict} />
        ) : verdictKnown && !verdict && !row ? (
          // ★★★ A THIRD THING, and getting it wrong accuses the team of not
          // filing something they filed. 21 of 159 projects have no verdict row
          // at all, ten of them carrying permits — and two were created after
          // the last walk, so every new project lands here first.
          <NotIndexed />
        ) : !row ? (
          // ★ The pre-fix-358 wording, now reached only while the verdict is
          // still in flight (or if reading it failed). It is deliberately kept
          // rather than deleted: the card must say something sane in the
          // fraction of a second before the reasoning arrives, and "no design
          // set on file yet" is the honest reading of a missing file row when
          // nothing better is known yet.
          <EmptyState />
        ) : (
          <PlanOfRecordBody
            row={row}
            verdict={verdictKnown ? verdict : null}
            onEnlarge={() => setLightbox(true)}
          />
        )}
      </OverviewSection>

      {lightbox && row && (
        <Lightbox
          row={row}
          verdict={verdictKnown ? verdict : null}
          onClose={() => setLightbox(false)}
        />
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

function Staleness({ computedAt }: { computedAt: string }) {
  const note = stalenessNote(computedAt);
  if (!note) return null;
  return (
    <div
      className="text-[9px] text-wa mt-2 leading-relaxed"
      data-testid="plan-of-record-stale"
    >
      {note}
    </div>
  );
}

/** ★★★ NOTHING QUALIFIED — the state this ticket exists to render.
 *
 *  ★ "This project has no design set" and "the tool has no opinion" must not
 *  render identically. They did: one `EmptyState` covered both, which is the
 *  exact failure fix-356 was built to end. This one has an opinion and says it.
 *
 *  ★★ THE SENTENCE IS PRINTED, NEVER REBUILT. The vocabulary — internal,
 *  review, draft, final, "design guidance" — lives in one Python file on
 *  purpose (fix-356 §4). Composing the same sentence in TypeScript would be one
 *  rule in two languages, drifting from the day it shipped. The Bridge renders
 *  a decision; it never re-decides one.
 *
 *  ★ Safe on the card FACE, and that is measured rather than assumed: not one
 *  of the 33 nothing-qualified sentences contains a file name (all 105 chosen
 *  ones do), so printing this here cannot reintroduce the text fix-331 §2
 *  deleted. Longest on prod is 101 characters. */
function NothingQualified({ verdict }: { verdict: ProjectPlanOfRecordVerdictRow }) {
  return (
    <div
      className="rounded border border-dashed flex flex-col items-center justify-center text-center px-4 py-10 min-h-[220px]"
      style={{ borderColor: 'var(--color-border)' }}
      data-testid="plan-of-record-nothing-qualified"
    >
      <div className="text-[11px] font-bold text-muted">
        No approved design set filed
      </div>
      <p
        className="text-[10.5px] text-dim mt-1.5 leading-relaxed max-w-[250px]"
        data-testid="plan-of-record-verdict-sentence"
      >
        {verdict.sentence}
      </p>
      <Staleness computedAt={verdict.computed_at} />
    </div>
  );
}

/** ★★★ NOT INDEXED — the third thing, and the one that is easiest to get wrong.
 *
 *  ★★ 21 of the 159 projects have no verdict row (measured 2026-08-19; the
 *  brief said 19, and the gap is the point): 15 are redesigns bound to a base
 *  project, 6 are folders the indexer could not match — and TEN of the 21 carry
 *  permits, one of them nine. Telling those "no design set filed" would accuse
 *  the team of not filing something they filed.
 *
 *  ★★ AND TWO OF THE 21 WERE CREATED AFTER THE LAST WALK. So this is not a
 *  static backlog to be cleared once; it is the arrival lane every new project
 *  passes through between being created and being indexed. It has to read as a
 *  waiting state, because for a new project that is exactly what it is.
 *
 *  ★ So this says what is actually true: nobody has looked.
 *
 *  ★★ AND IT DOES NOT WEAR THE OTHER STATE'S BOX. The brief asks that the two
 *  not render identically, and two different sentences inside one identical
 *  dashed frame is most of the way to identical at a glance — which is the
 *  distance a card is read from. So the dashed frame belongs to the state that
 *  has an ANSWER; this one, which has none, is unframed and dimmer. A person
 *  who never reads the words still sees two different things. */
function NotIndexed() {
  return (
    <div
      className="flex flex-col items-center justify-center text-center px-4 py-10 min-h-[220px]"
      data-testid="plan-of-record-not-indexed"
    >
      <div className="text-[11px] font-semibold text-dim">Not indexed yet</div>
      <p className="text-[10.5px] text-dim mt-1.5 leading-relaxed max-w-[250px] opacity-80">
        The file indexer has not walked this project&apos;s folder, so there is
        nothing to report either way. This is not a statement about what has
        been filed.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- the body --

function PlanOfRecordBody({
  row,
  verdict,
  onEnlarge,
}: {
  row: ProjectPlanOfRecordRow;
  verdict: ProjectPlanOfRecordVerdictRow | null;
  onEnlarge: () => void;
}) {
  return (
    <>
      <StageChip stage={row.set_type} />
      <Preview row={row} onEnlarge={onEnlarge} />

      {/* ★★ fix-331 §2: THE FILENAME AND THE MODIFIED/SIZE LINE ARE NOT HERE
          ANY MORE. Bobby, highlighting them: "It should just be, here's the
          marketing, click to enlarge, copy path, that's it. And when you click
          to enlarge, we can have that text inside of there."

          ★ NOTHING WAS DELETED — the Lightbox already renders all three
          (file name as its heading, then stage · Modified <date> · <size> ·
          Page 1), so this is the second half of the relocation fix-295 started
          with the UNC path. Card face: label, preview, enlarge, copy. Enlarged
          view: everything about the file.

          The card is also the tallest in the row, and its height is what §1's
          equal-height distribution has to absorb — three lines of text off the
          face is three lines the neighbouring cards no longer have to fill.

          ★ fix-295, still true: the path is in the lightbox, and Copy path
          stays because fix-289 established browsers will not open a UNC path
          from https — it is the only route from this card to the actual file.
          Removing it would strand the card. */}
      <PathActions row={row} />

      {/* ★★★ fix-358 §3 + §4: THE ONLY THING THE SENTENCE ADDS TO THE FACE IS A
          WARNING, AND ONLY WHEN THERE IS ONE.

          ★ The sentence itself is in the enlarged view for a CHOSEN set, and
          that is measured rather than preferred: all 105 chosen sentences on
          prod end in "showing <stage>: <file name>", so printing one here would
          put the file name back on the face — exactly the text fix-331 §2
          removed at Bobby's request ("here's the marketing, click to enlarge,
          copy path, that's it"). §4 says not to undo that, so the reasoning
          goes where fix-331 §2 already put the file's text.

          ★★ Staleness is the exception, because §3 requires it to be visible
          without a hover and a stale confident sentence is worse than none. It
          renders only once the walk is a week old, so a healthy card is
          unchanged and the tallest card does not grow. */}
      {verdict && <Staleness computedAt={verdict.computed_at} />}
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

  // ★ fix-331 §2: the "paste into File Explorer to open" hint is gone from the
  // card face — Bobby highlighted it with the filename and the size line. The
  // button's own title still says it, so the instruction survives on hover for
  // anyone who wonders what Copy path is for, without spending a line of a card
  // whose height every other card in the row now has to match.
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
      <button
        type="button"
        onClick={() => copy(row.unc_path, 'Path')}
        className="text-[10px] font-bold px-2 py-0.5 rounded border border-de bg-de text-white hover:opacity-90 transition"
        title="Copy the file path — paste it into File Explorer to open"
        data-testid="plan-of-record-copy"
      >
        Copy path
      </button>
    </div>
  );
}

// ----------------------------------------------------------------- lightbox --

function Lightbox({
  row,
  verdict,
  onClose,
}: {
  row: ProjectPlanOfRecordRow;
  verdict: ProjectPlanOfRecordVerdictRow | null;
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
            {/* ★★★ fix-358 §1: WHY THIS SET, AND NOT THE OTHERS.
                Bobby: "Hey, you had a couple of options here — why would you
                take that option versus the other option that you already had?"

                ★ PRINTED, NEVER REBUILT. fix-356 decided it and wrote the
                sentence; this renders the string. The vocabulary lives in one
                Python file on purpose, and composing it again in TypeScript
                would be one rule in two languages.

                ★ Here rather than on the face because every chosen sentence
                ends in the file name — see PlanOfRecordBody for why that makes
                the enlarged view the only place it can go without undoing
                fix-331 §2. This is also exactly where fix-331 §2 moved the
                file's own text, so the two sit together. */}
            {verdict && (
              <div
                className="text-[10px] text-muted mt-1.5 leading-relaxed"
                data-testid="plan-of-record-verdict-sentence"
              >
                {verdict.sentence}
              </div>
            )}
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
