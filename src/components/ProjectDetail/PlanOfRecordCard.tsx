import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { stalenessNote } from '../../lib/planOfRecordStaleness';
import {
  usePlanOfRecord,
  usePlanOfRecordThumbnail,
} from '../../hooks/usePlanOfRecord';
import { usePlanOfRecordVerdict } from '../../hooks/usePlanOfRecordVerdict';
import {
  // ★ fix-467 §3: `STAGE_CHIP` is no longer imported — the chip is neutral. It
  //   is still EXPORTED from lib/planOfRecord and its fix-407 derivation and
  //   suite are untouched; see the note on StageChip below for why keeping it
  //   and not painting with it is the right pair of decisions.
  formatFileSize,
  formatModified,
  hasThumbnail,
  missingThumbnailReason,
  planOfRecordSetAvailable,
  planOfRecordSetButtons,
  planOfRecordSetCaption,
  planOfRecordSetFor,
  // ★★★ fix-522 §A/§B/§C: the one resolution the chip, the preview and the
  //     viewer all read, and the rule that decides which viewer.
  firstAvailableVariant,
  planOfRecordViewerMode,
  shownPlanOfRecord,
  stageLabel,
  type PlanOfRecordVariant,
} from '../../lib/planOfRecord';
import { useProjects } from '../../hooks/useProjects';
import { OverviewCard, OverviewSection } from './OverviewCard';
import {
  usePlanOfRecordSets,
  // ★ fix-523 §B2: `findVariant` is no longer imported here. It matched
  //   `set_type === 'marketing'` and nothing else, so a schematic's one button
  //   resolved to `null` — harmless while nothing read it, and a button that
  //   grays itself the moment an availability guard does.
  //   `planOfRecordSetFor` matches the row's own stage.
  pagePaths,
  type PlanOfRecordSetRow,
} from '../../hooks/usePlanOfRecordSets';
import {
  SHARE_TTL_DAYS,
  formatPdfSize,
  pdfDownloadName,
  signPlanPdfUrl,
} from '../../lib/planOfRecordShare';
import { pushToast } from '../../stores/toastStore';
import { ARCHIVED_FALLBACK_LABEL, isArchivedFallback } from '../../lib/archivedFallback';
import {
  findShareLink,
  usePlanShareActions,
  type PlanShareLinkRow,
} from '../../hooks/usePlanShare';
import {
  POR_BUTTON_GAP,
  POR_BUTTON_MIN_WIDTH,
  POR_IMAGE_MAX_HEIGHT,
} from '../../lib/projectCardLayout';
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
  // ═══════════════════════════════════════════════════════════════════════
  // ★★★ fix-524 §C (P-220) — A REDESIGN READS THROUGH TO ITS ORIGINAL'S SET
  // ═══════════════════════════════════════════════════════════════════════
  //
  // ★★★ MEASURED ON PROD 2026-09-11: of the 17 live redesigns, **0 have a plan
  //     of record of their own** — not "some", every single one — and **14 of
  //     their originals do.** The drawings are indexed under the original's
  //     folder, and `usePlanOfRecordVerdict`'s own note has said so since
  //     fix-358: *"15 redesigns bound to a base project"* have no verdict row
  //     at all. So a redesign's card has been empty for its whole life while
  //     the set it is a redesign OF sits one row away.
  //
  // ★★★ READ-THROUGH, NOT A COPY, AND THE REASON IS WHOSE BYTES THEY ARE.
  //     Bobby's freeze ruling — *"the original project should be kind of
  //     frozen, like a snapshot"* — is about the ORIGINAL being a snapshot, not
  //     about the redesign owning drawings. The files still live under the
  //     original's prefix and the indexer will keep writing them there (and
  //     this ticket must not touch the indexer), so a "copy" would be a copy in
  //     name only: a second row pointing at the first one's objects, stale the
  //     next time the folder changes. Read-through is the one that survives a
  //     re-index, and it is self-healing — the day a redesign gets its own
  //     folder, its own row wins here with no code change.
  //
  // ★★ AND IT MUST SAY WHOSE THEY ARE, or it quietly lies about provenance.
  //    `BorrowedFrom` below is not decoration: without it the card asserts that
  //    these drawings are this project's, which is exactly the class of claim
  //    fix-358 spent a ticket removing from this card.
  //
  // ★ The fallback fires only once the project's OWN query has answered and
  //   come back empty — never on the loading frame, which would flash the
  //   original's drawing and then replace it.
  const projectsQ = useProjects();
  const originalId =
    projectsQ.data?.find((p) => p.id === projectId)?.redesign_of_project_id ??
    null;
  const wantsFallback = !q.isLoading && !q.data && !!originalId;
  const borrowedQ = usePlanOfRecord(wantsFallback ? originalId! : undefined);
  const borrowed = wantsFallback ? (borrowedQ.data ?? null) : null;
  /** The project whose plan of record is on screen. Everything downstream —
   *  the sets, the verdict, the share — keys off THIS, so a borrowed card
   *  shares the original's set rather than minting a link to nothing. */
  const sourceProjectId = borrowed ? originalId! : projectId;
  const borrowedFromAddress = borrowed
    ? (projectsQ.data?.find((p) => p.id === originalId)?.address ?? null)
    : null;
  // ★★★ fix-358: the REASONING, read and never re-derived. See below for the
  // three states it distinguishes and why the old single empty state was the
  // bug fix-356 was built to end.
  const verdictQ = usePlanOfRecordVerdict(sourceProjectId);
  // ★★★ fix-506 §E (P-148): TWO MARKETING VARIANTS, ONE PICKED.
  //
  // ★ fix-523: THE SECOND HALF OF THIS NOTE WAS OUT OF DATE AND SAID SO
  //   CONFIDENTLY — *"STEP 0-4 confirmed it ABSENT on prod, so `sets.available`
  //   is false today and the External button renders disabled with the
  //   reason."* `project_plan_of_record_sets` landed with fix-504 and carries
  //   334 rows (measured 2026-09-11), the `available: false` branch is now the
  //   unreachable one, and the "with the reason" caption is deleted by §B2.
  //   Corrected in place rather than removed: the feature-detect is still real
  //   and `usePlanOfRecordSets` still has to answer `42P01` without throwing.
  const setsQ = usePlanOfRecordSets(sourceProjectId);
  const row = q.data ?? borrowed;
  // ★★★ fix-523 §B2 — THE CARD OPENS ON A BUTTON THAT WORKS.
  //
  // This was `useState('internal')`, which is right for the 5 internal-only and
  // the 53 both projects and wrong for the **74 external-only** ones: with the
  // guard now two-sided, those would open on a grayed Site Plan with the live
  // Marketing button unpicked beside it — a correct guard and a useless card.
  //
  // ★ `null` means *nobody has pressed anything yet*, resolved at render rather
  //   than through an effect: the sets query has not answered on the first
  //   paint, so an initial value cannot know which button is live, and writing
  //   one in later is a re-render that fights whatever the reader just pressed.
  const [picked, setVariant] = useState<'internal' | 'external' | null>(null);
  const variant = picked ?? firstAvailableVariant(row?.set_type, setsQ.data);
  const [lightbox, setLightbox] = useState(false);
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
          <>
            {/* ★★★ fix-524 §C — WHOSE DRAWINGS THESE ARE, SAID PLAINLY.
                Read-through is the cheap half; this is the half that makes it
                honest. A card showing the original's set without naming it
                asserts the drawings are this project's — the exact class of
                silent claim fix-358 spent a ticket removing from here. */}
            {borrowedFromAddress && (
              <div
                className="text-[9px] mb-1.5 leading-snug"
                style={{ color: 'var(--color-muted)' }}
                data-testid="plan-of-record-borrowed"
              >
                From{' '}
                <span className="font-bold">{borrowedFromAddress}</span> — this
                redesign has no set of its own yet.
              </div>
            )}
            <PlanOfRecordBody
              row={row}
              verdict={verdictKnown ? verdict : null}
              onEnlarge={() => setLightbox(true)}
              sets={setsQ.data}
              variant={variant}
              onPickVariant={setVariant}
            />
          </>
        )}
      </OverviewSection>

      {lightbox && row && (
        <Lightbox
          row={row}
          verdict={verdictKnown ? verdict : null}
          onClose={() => setLightbox(false)}
          // ★★★ fix-522 §C (P-217) — THE SET, RESOLVED THE SAME WAY THE CARD
          //     FACE RESOLVES IT. This was `findVariant(sets, variant)`, which
          //     matches `set_type === 'marketing'` and nothing else — so a
          //     SCHEMATIC always got `null`, `pages` came back empty, and the
          //     viewer fell back to a single thumbnail. **86 of 101 schematics
          //     have pages** (fix-510's backfill) and none of them could be
          //     paged through. `shownPlanOfRecord` matches the row's own
          //     `set_type`, so every stage reaches its pages.
          shownSet={shownPlanOfRecord(row, setsQ.data, variant).set}
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
  sets,
  variant,
  onPickVariant,
}: {
  row: ProjectPlanOfRecordRow;
  verdict: ProjectPlanOfRecordVerdictRow | null;
  onEnlarge: () => void;
  sets: import('../../hooks/usePlanOfRecordSets').PlanOfRecordSets | undefined;
  variant: 'internal' | 'external';
  onPickVariant: (v: 'internal' | 'external') => void;
}) {
  // ★★★ fix-522 §A/§B — ONE RESOLUTION, THREE READERS. The chip, the preview
  //     and (through the card) the viewer all read this. Before, the buttons
  //     resolved the variant, the chip printed `row.set_type` and the preview
  //     was bound to `row` — three readers, three sources, and only one of them
  //     right.
  const shown = shownPlanOfRecord(row, sets, variant);
  return (
    <>
      <StageChip stage={row.set_type} label={shown.label} />
      <Preview row={row} thumbPath={shown.thumbPath} onEnlarge={onEnlarge} />

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
      <SetButtons
        row={row}
        sets={sets}
        variant={variant}
        onPickVariant={onPickVariant}
      />

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

// ===========================================================================
// ★★★ fix-467 §3 (P-113) — THE CHIP LOSES ITS COLOUR, AND KEEPS EVERYTHING ELSE
// ===========================================================================
//
// Bobby: *"I dont think we need color for schematic, design guidance or
// marketing."*
//
// ★★★ HE IS RIGHT, AND IT IS NOT A MATTER OF TASTE — THE THREE COLOURS NEVER
// APPEAR BESIDE ONE ANOTHER ANYWHERE IN THE APP. fix-284 decides precedence
// (design_guidance < schematic < marketing, furthest stage present) in the VIEW,
// before this component sees anything, and the card renders ONE row. So there is
// exactly one chip on screen, ever. A colour that is never adjacent to its
// alternatives distinguishes nothing: it is a key the reader has to learn and
// then apply from memory, on a card that already prints the stage in words two
// millimetres away.
//
// ★★★ WHAT fix-407 MEASURED IS STILL TRUE, AND IT IS STILL EXPORTED. That
// ticket derived all three tints and proved each clears 4.5:1 on its own
// surface (6.47 / 5.21 / 4.68). Nothing about that was wrong and nothing about
// it is deleted — `STAGE_CHIP`, `STAGE_CHIP_MIX` and `CHIP_INK_HUE_PCT` remain
// exported and their suite passes unmodified. What changed is not the
// measurement's correctness but what the value was FOR. Keeping the derivation
// is how the next person to want a stage colour finds the numbers instead of
// re-deriving them; painting with it here bought a distinction with no second
// term.
//
// ★ SAME BOX, SAME SIZE, SAME WEIGHT, SAME POSITION — only the hue goes.
//   Nothing else on the card moves. `--color-muted` on `--color-s2` measures
//   4.65:1, so the neutral chip clears the same floor the coloured ones did.
//
// ★★★ fix-522 §A (P-217) — AND IT NAMES WHAT IS ON SCREEN, NOT THE SET TYPE.
//
//     Bobby: *"right now it is displaying site plan (marketing internal) but if
//     i click marketing, it should show marketing external."*
//
//     The buttons were already correct — `3505 Densmore Ave N` really does have
//     `marketing/internal` (1 page) and `marketing/external` (6), and the right
//     one was being chosen. **What was wrong is that this chip read `MARKETING`
//     in BOTH states**, because both rows are `set_type = 'marketing'`.
//     "Marketing" was doing double duty — a set type AND a variant label — so
//     pressing *Site Plan* left a badge saying MARKETING and nothing confirmed
//     the switch had happened.
//
// ★★ IT IS KEPT RATHER THAN DELETED, though §A offered the choice. The pressed
//    button IS an indicator, but it sits BELOW the drawing; the chip sits above
//    it, and on a card this tall the two are not in one glance. A label that
//    now agrees with the button costs nothing and answers "what am I looking
//    at" where the eye already is.
//
// ★ The testid keeps the STAGE, not the label — four suites reach for
//   `plan-of-record-stage-marketing`, and the element they name has not moved.
function StageChip({ stage, label }: { stage: PlanOfRecordStage; label: string }) {
  return (
    <span
      className="inline-block text-[9px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full mb-2"
      style={{ background: 'var(--color-s2)', color: 'var(--color-muted)' }}
      data-testid={`plan-of-record-stage-${stage}`}
      data-label={label}
    >
      {label}
    </span>
  );
}

// ------------------------------------------------------------------ preview --

function Preview({
  row,
  thumbPath,
  onEnlarge,
}: {
  row: ProjectPlanOfRecordRow;
  /** ★★★ fix-522 §B (P-217) — THE SELECTED SET'S THUMBNAIL.
   *
   *  Bobby: *"clicking the button would change the picture from internal to
   *  external… but the ui is showing marketing internal regardless."*
   *
   *  ★★★ WHAT IT WAS BOUND TO BEFORE: `row.thumb_path` — the single
   *      `project_plan_of_record` row — while the buttons and the Lightbox's
   *      caption resolved `findVariant(sets, variant)`. So the caption tracked
   *      the button and the image never did. Both sets have carried a distinct
   *      thumbnail since fix-504 and both are `ok`; `usePlanOfRecordSets`
   *      simply never selected the column.
   *
   *  ★ Still falls back to the row's own thumbnail — a set whose image has not
   *    rendered degrades to the plan of record's, which is what the card did
   *    for every set before this. */
  thumbPath: string | null;
  onEnlarge: () => void;
}) {
  // ★ `hasThumbnail` still guards the ROW, because that is what
  //   `missingThumbnailReason` explains and what the fallback below is about.
  const usable = hasThumbnail(row) || !!thumbPath;
  const thumbQ = usePlanOfRecordThumbnail(usable ? thumbPath : null);

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
      {/* ★★★ fix-507b §G — THE SHEET FITS INSIDE A FIXED BOX, IT DOES NOT SET
          THE BOX. Shipped, this image was `w-full h-auto`, so the CARD'S HEIGHT
          WAS THE ASPECT RATIO OF WHATEVER SHEET THE INDEXER GRABBED. Measured
          across all 164 indexed plans (2026-09-09): 162 landscape, 2 portrait,
          four distinct sizes, and the portrait pair renders 716px against the
          modal sheet's 300 — a 416px card, on its own, on a row this ticket is
          trying to get above the fold.

          ★ `object-fit: contain`, never `cover`: the title block and the north
            arrow have to survive a preview, and a crop is exactly what removes
            them. A portrait sheet scales down and centres, with white either
            side. The VIEWER is untouched and still renders pages at full width.

          ★ The cap is DERIVED — what the modal 1400 × 906 sheet renders at, at
            the card's reference width — so 159 of 164 plans are pixel-identical
            to today and only the outliers move. See lib/projectCardLayout. */}
      <img
        src={thumbQ.data ?? ''}
        alt={`Page 1 of ${row.file_name}`}
        className="block w-full"
        style={{ height: POR_IMAGE_MAX_HEIGHT, objectFit: 'contain' }}
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

// ★★★ fix-506 §E — "COPY PATH" LEAVES THE FACE, AND THE PATH DOES NOT.
//
// The brief: *"Delete Copy path as a control; keep the UNC path visible in the
// viewer footer (fix-295's rule) for staff."* fix-289's finding is untouched and
// still the reason the path matters — Chrome and Edge SILENTLY refuse to
// navigate an https page to a `file:` URL or a UNC path, so copying is the one
// thing that reliably works and an "Open" button must never be added back. What
// changed is where it lives: the card face is two Marketing buttons now, and the
// selectable path is in the enlarged view, one click away, exactly where
// fix-295 put the rest of the file's facts.

/** The three-node share glyph, drawn rather than imported — the app carries no
 *  icon set, and one PNG for one glyph is a network round trip for 300 bytes. */
function ShareGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <circle cx="18" cy="5" r="2.6" stroke="currentColor" strokeWidth="2" />
      <circle cx="6" cy="12" r="2.6" stroke="currentColor" strokeWidth="2" />
      <circle cx="18" cy="19" r="2.6" stroke="currentColor" strokeWidth="2" />
      <path d="M8.4 10.8 15.6 6.4M8.4 13.2l7.2 4.4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/**
 * ★★★ fix-528 §C — HAND OVER THE DRAWING.
 *
 * Signs the set's source PDF and lets the browser save it. One place, so the
 * card's menu and anything that follows cannot sign it two different ways.
 *
 * ★★ A programmatic click on a detached `<a download>` rather than
 *    `location.assign`: the signed URL is a same-tab navigation to a PDF, which
 *    several browsers open in a viewer instead of saving. `download` on the
 *    SIGNATURE (Supabase's own option) is what makes it land as a file, and the
 *    anchor is what makes the click count as a user gesture.
 */
async function downloadPlanPdf(objectPath: string | null, fileName: string | null) {
  if (!objectPath) {
    // ★ Should be unreachable: the control does not render without a path. Kept
    //   because "unreachable" is a claim about today's data, and 336 of 336
    //   sets having a PDF is also a claim about today's data.
    pushToast('That set has no PDF on file yet', 'error');
    return;
  }
  try {
    const url = await signPlanPdfUrl(objectPath, fileName);
    const a = document.createElement('a');
    a.href = url;
    a.download = pdfDownloadName(fileName);
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    // ★ ONE message. A person who cannot download does not need to know which
    //   half refused, and naming the storage error would leak a path.
    pushToast('Could not open that PDF', 'error');
  }
}

// ★★★ fix-523 §A — `sharePlanPage` IS GONE FROM THIS FILE.
//
// It signed one page object and copied the URL. Copy link, Email it… and the
// enlarged view's Share button now all mint `/s/<token>` through
// `usePlanShareActions`, which is the same collapse fix-522 made when it put
// the two menu items on one `sharePath()` — one more control had simply been
// left outside it. The toast wording and the failure path are unchanged and
// still declared once, in `lib/planOfRecordShare`.

/**
 * ★★★ THE SET BUTTONS — AND fix-507 §F MAKES THEM NAME THE PROJECT'S STAGE.
 *
 * Bobby: *"two buttons, Marketing · Internal and Marketing · External, the
 * picked one blue, default Internal."* fix-506 §E built exactly that and gave
 * it to every project — including the **36 of 164** whose newest set is
 * Schematic or Design Guidance, which then showed a `SCHEMATIC` chip above two
 * buttons saying `Marketing` (P-178, and `233 31st Ave E` is the screenshot).
 *
 * ★★★ THE STAGE DECIDES, AND IT **REPLACES**. `planOfRecordSetButtons` owns the
 *     list; marketing gets the two variants, schematic and design guidance get
 *     ONE button each and no marketing button at all. Earlier sets are not
 *     accumulated onto the face — they stay indexed and reachable in Project
 *     Data's Plan of record tab, which is Bobby's ruling 5.
 *
 * ★★ EXTERNAL CAN STILL BE DISABLED, and only marketing has one. It needs
 *    fix-504's page objects, which are not on prod — so it renders disabled
 *    with the reason underneath rather than as a button that opens an empty
 *    viewer. A disabled control with a STATED FACT about now is not the P-032
 *    placeholder fix-506 removed: it becomes live on its own when the indexer
 *    writes the rows.
 */
function SetButtons({
  row,
  sets,
  variant,
  onPickVariant,
}: {
  row: ProjectPlanOfRecordRow;
  sets: import('../../hooks/usePlanOfRecordSets').PlanOfRecordSets | undefined;
  variant: PlanOfRecordVariant;
  onPickVariant: (v: PlanOfRecordVariant) => void;
}) {
  const buttons = planOfRecordSetButtons(row.set_type);
  // ★★★ fix-523 §A — ONE PLACE THAT MINTS. Copy link, Email it… and the
  //     enlarged view's Share button all hand over the same `/s/<token>` for
  //     the same set; `usePlanShareActions` is what makes that true by
  //     construction rather than by three call sites agreeing.
  const share = usePlanShareActions(row.project_id);
  // ★ A stage with one button can only ever be showing it. Reading the SELECTED
  //   variant off the list rather than off state is what makes "the caption
  //   names the same set as the selected button" true even if a project's stage
  //   changes under a card whose state still says `external`.
  const selected =
    buttons.find((b) => b.variant === variant) ?? buttons[0] ?? null;
  const shownVariant = selected?.variant ?? 'internal';
  // ★★★ fix-523 §B2: the set behind the SHOWN button, resolved by the shared
  //     lookup rather than by `findVariant` — which matched `set_type ===
  //     'marketing'` and nothing else, so a schematic's one button resolved to
  //     `null` and would now have grayed itself under the new guard.
  const shown = planOfRecordSetFor(row.set_type, sets, shownVariant);
  // ★ fix-532 §C: one predicate, so four surfaces cannot disagree about what
  //   "archived" means. Read, never recomputed — the indexer owns the rule.
  const archived = isArchivedFallback(shown);

  /** ★★★ fix-523 §A4 — THE `variant` THE DATABASE STORES, WHICH IS NOT THE
   *  BUTTON'S. Only `marketing` has variants: `project_plan_of_record_sets`
   *  holds `null` for all 101 schematics and all 48 design-guidance sets
   *  (measured 2026-09-11), and the RPCs compare `coalesce(variant,'')`. Send
   *  `'internal'` for a schematic and `bp_create_plan_share` raises `P0002` —
   *  correctly, because no such set exists. */
  function shareVariant(v: PlanOfRecordVariant): string | null {
    return row.set_type === 'marketing' ? v : null;
  }

  return (
    <div className="mt-1.5 flex flex-col gap-1">
      <div className="flex" style={{ gap: POR_BUTTON_GAP }}>
        {buttons.map((b) => (
          <SetButton
            key={b.variant}
            label={b.label}
            picked={shownVariant === b.variant}
            // ★★★ fix-523 §B2 (P-239) — THE GUARD ASKS ABOUT **THIS** BUTTON.
            //     It read `b.variant === 'external' && !externalReady`: one
            //     expression naming one direction, so the 74 external-only
            //     projects rendered a live Site Plan with nothing behind it.
            //     The variant is an argument now, which is what makes the
            //     other direction impossible to forget.
            disabled={!planOfRecordSetAvailable(row.set_type, sets, b.variant)}
            onPick={() => onPickVariant(b.variant)}
            onShare={() => void share.copy(row.set_type, shareVariant(b.variant))}
            // ★★★ fix-522 §D4 — THE SAME LINK, IN AN EMAIL THE SUBJECT OF WHICH
            //     NAMES THE SET. Bobby: *"boom, create the email, open it, and
            //     it's already got the subject line, what you're sharing."*
            //     ⚠️ No image and, fix-523 §B4, no attachment either — a
            //     `mailto:` can carry neither. The LINK carries the PDF; the
            //     email carries the link.
            // ★★★ fix-528 §A/§B — `Email it…` IS GONE, AND DOWNLOAD PDF TAKES
            //     ITS PLACE.
            //
            //     Bobby, for the fourth time: *"when i click email it, it still
            //     shows as a link vs putting a pdf in the emial"*, then
            //     *"i dont think we need a link, just a pdf."* The control he
            //     was complaining about is the one that opened a `mailto:`
            //     carrying a URL — and a `mailto:` cannot carry an attachment,
            //     which is why that complaint could never be answered where it
            //     stood.
            //
            // ★★★ §A5's RULE DECIDES WHAT HAPPENS MEANWHILE: *"never leave the
            //     user with a dead Email it…"* — and the Graph draft path is
            //     behind an IT gate (an Azure app registration and tenant admin
            //     consent) that §A4 says to report and STOP at. So the item is
            //     ABSENT rather than disabled, which is P-239's ruling applied
            //     to a control that cannot work yet. It comes back, carrying the
            //     PDF, once consent exists.
            pdfPath={planOfRecordSetFor(row.set_type, sets, b.variant)?.pdf_path ?? null}
            pdfBytes={planOfRecordSetFor(row.set_type, sets, b.variant)?.pdf_bytes ?? null}
            pdfName={
              planOfRecordSetFor(row.set_type, sets, b.variant)?.file_name ??
              row.file_name
            }
            // ★★★ fix-523 §A2 — UNSHARE, AND ONLY WHEN THERE IS SOMETHING TO
            //     UNSHARE. The token is a bearer credential and Bobby's
            //     standing concern is a link reaching the wrong builder.
            shareLink={findShareLink(share.links, row.set_type, shareVariant(b.variant))}
            onUnshare={(token) => void share.unshare(token)}
            testId={`plan-of-record-set-${b.variant}`}
          />
        ))}
      </div>
      <div
        className="text-[9px] text-center"
        style={{ color: 'var(--color-muted)' }}
        data-testid="plan-of-record-set-caption"
      >
        {/* ⚠⚠ fix-523 §B2 — RULED BY BOBBY 2026-09-11, NO EXPLANATORY TEXT.
            *"just dont make it clickable if it isnt available, this way, we
            know and can go fix that. adding that additional text makes it more
            busy."* The branch that stood here printed *"External pages arrive
            with the next indexer run."* and it is DELETED, not moved: no
            tooltip, no caption, no helper line, no badge, no empty state.

            ★★★ THE GRAY **IS** THE MESSAGE, and its audience is Blueprint
                rather than the builder — a gray Site Plan means somebody needs
                to go put one on the share, and Bobby reads that in a glance
                across many projects, not in a sentence on one. Adding a single
                line of copy back here would be a regression against an explicit
                instruction. A test asserts the absence. */}
        <>
          {/* ★★★ fix-532 §C (P-247) — IT SAYS WHAT IS WRONG, NOT JUST THAT
              SOMETHING IS. This read `ARCHIVED` since fix-508, which names the
              STATE and leaves the reader to work out the consequence. Measured
              2026-09-12: **60 projects** now show a superseded drawing as their
              plan of record, **50** of them through this very row. A person
              looking at one needs to know that nothing current was found —
              that is the sentence that gets somebody to go file one.
              ★ Same string on every surface; see `lib/archivedFallback`. */}
          {archived && (
            <span
              className="font-extrabold mr-1"
              style={{ color: 'var(--color-co)' }}
              title={ARCHIVED_FALLBACK_LABEL}
              data-testid="plan-of-record-archived"
            >
              {ARCHIVED_FALLBACK_LABEL}
            </span>
          )}
          {planOfRecordSetCaption(row.set_type, shownVariant)} ·{' '}
          {formatModified(row.modified_at)} ·{' '}
          {pageCountLabel(shown, shownVariant)}
        </>
      </div>
    </div>
  );
}

/** ★ `1 page` when there is no set row at all, because the single thumbnail IS
 *  one page — that is what the card has always shown and what it still shows
 *  until fix-504 lands. */
function pageCountLabel(
  set: PlanOfRecordSetRow | null,
  variant: 'internal' | 'external',
): string {
  // ★★ fix-508 §H: the SET's count wins wherever there is one. The variant is
  //    only the fallback for a project with no `project_plan_of_record_sets`
  //    row at all — where the single indexed thumbnail IS one page, and the
  //    external set does not exist yet. That is a statement about which ROWS
  //    exist, not about what a variant means.
  const n = set?.page_count ?? (variant === 'internal' ? 1 : 0);
  return `${n} ${n === 1 ? 'page' : 'pages'}`;
}

function SetButton({
  label,
  picked,
  disabled,
  onPick,
  onShare,
  pdfPath,
  pdfBytes,
  pdfName,
  shareLink,
  onUnshare,
  testId,
}: {
  label: string;
  picked: boolean;
  disabled?: boolean;
  onPick: () => void;
  onShare: () => void;
  /** ★★★ fix-528 §C: the set's source PDF, or null. The Download item renders
   *  ONLY when it is non-null — 336 of 336 current sets carry one today, and a
   *  control that appears for a set with no file would be the P-032
   *  placeholder this card has already had removed from it once. */
  pdfPath: string | null;
  pdfBytes: number | null;
  pdfName: string | null;
  /** ★★★ fix-523 §A2: the live link for THIS set, or null. `Unshare` renders
   *  only when it is non-null — a control that would be offered on every set
   *  and do nothing on most of them teaches its reader to distrust it. */
  shareLink: PlanShareLinkRow | null;
  onUnshare: (token: string) => void;
  testId: string;
}) {
  return (
    <div
      className="flex rounded border overflow-hidden"
      style={{
        flex: `1 1 ${POR_BUTTON_MIN_WIDTH}px`,
        minWidth: 0,
        borderColor: picked ? 'var(--color-de)' : 'var(--color-border)',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <button
        type="button"
        onClick={onPick}
        disabled={disabled}
        className="flex-1 min-w-0 truncate text-[10px] font-bold px-1.5 py-1 disabled:cursor-default"
        style={{
          background: picked ? 'var(--color-de)' : 'var(--color-surface)',
          color: picked ? '#fff' : 'var(--color-de)',
        }}
        aria-pressed={picked}
        data-testid={testId}
      >
        {label}
      </button>
      {/* ★ The share control sits INSIDE the button's frame, at its right end,
          as the mock draws it — but it is its own control, because picking a
          set and sharing it are two actions and one button cannot be both.
          ★★ fix-522 §D3: it opens a MENU now. See `ShareMenu`.

          ★★★ fix-523 §B2 — AND IT IS **GONE** BESIDE AN UNAVAILABLE SET, by
              the same guard, not a second one. Bobby's screenshot of
              `5947 32ND AVE SW` shows a share glyph beside the gray Marketing
              button; it was `disabled`, so it did nothing, but it still read
              as an offer. **A set you cannot open is a set you cannot share** —
              and `bp_create_plan_share` already refuses, raising `P0002` when
              no current set matches, so the UI was able to reach a call that
              could only fail. Absent is the honest render, and it is what the
              test asserts. */}
      {!disabled && (
        <ShareMenu
          label={label}
          picked={picked}
          onCopy={onShare}
          pdfPath={pdfPath}
          pdfBytes={pdfBytes}
          pdfName={pdfName}
          shareLink={shareLink}
          onUnshare={onUnshare}
          testId={testId}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------- lightbox --

function Lightbox({
  row,
  verdict,
  onClose,
  shownSet,
}: {
  row: ProjectPlanOfRecordRow;
  verdict: ProjectPlanOfRecordVerdictRow | null;
  onClose: () => void;
  /** ★★★ fix-508 §H: the set the card is SHOWING, whichever variant that is.
   *  fix-507 passed `externalSet` and a `variant` and let the viewer infer the
   *  page count from the pair; the set carries its own `page_count`, so the
   *  inference was always a guess about a fact we already had. */
  shownSet: PlanOfRecordSetRow | null;
}) {
  // ★★★ fix-506 §E — INTERNAL OPENS ONE PAGE; EXTERNAL SCROLLS EVERY PAGE.
  //
  // Bobby's ruling, and the shape follows from it: the internal marketing plan
  // IS one page, so a viewer offering "page 1 of 1" would be inventing a
  // sequence. The external set has `page_count` pages at `pages_prefix`, and
  // they stack in one scroller — not a pager. A reader flipping through a set
  // wants to scroll it the way they scroll the PDF, and a Next button turns
  // twelve pages into twelve deliberate clicks.
  // ★★★ fix-508 §H — THE PAGES COME FROM THE SET, NEVER FROM THE VARIANT.
  //
  //     fix-506 §E hard-coded *"internal opens one page; external scrolls"*,
  //     and the reasoning was sound at the time: the internal marketing plan IS
  //     one page, so a viewer offering "page 1 of 1" would have been inventing
  //     a sequence.
  //
  // ★★★ SCHEMATIC IS SCROLLABLE NOW (Bobby, 2026-09-09), and it renders through
  //     the `internal` variant — so *"internal = one page"* stopped being true
  //     the moment that ruling landed. A rule that reads a VARIANT to guess a
  //     PAGE COUNT is guessing at something the row already knows.
  //
  // ★ So the viewer scrolls whenever the set it is showing has pages, and falls
  //   back to the single thumbnail when it does not. One line, and it is right
  //   for every stage this card will ever grow.
  const pages = pagePaths(shownSet);
  // ★★★ fix-522 §C — TWO DOCUMENTS, TWO VIEWERS, AND THE PAGE COUNT DECIDES.
  //
  //     *"A site plan is one technical drawing an internal reader studies; a
  //     marketing set is a multi-page piece you page through and send out."*
  //     Driven off the SET'S OWN `page_count`, never off the variant string —
  //     a one-page marketing set should read like a site plan, and a
  //     multi-page schematic should page. **The document decides, not its
  //     label**, and on prod that distinction is worth 102 of the 334 sets.
  const mode = planOfRecordViewerMode(Math.max(1, shownSet?.page_count ?? pages.length ?? 1));
  // ★★★ fix-522 §B: the single-drawing fallback shows the SELECTED set's
  //     thumbnail, not the plan-of-record row's — the same binding the card
  //     face was missing. The row is still the fallback behind it.
  const singleThumb =
    shownSet?.thumb_status === 'ok' && shownSet.thumb_path
      ? shownSet.thumb_path
      : hasThumbnail(row)
        ? row.thumb_path
        : null;
  const thumbQ = usePlanOfRecordThumbnail(singleThumb);
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
  // ★★★ fix-523 §A: the viewer shares through the SAME minting path as the
  //     card face. It signed a Storage object of its own until this ticket.
  const share = usePlanShareActions(row.project_id);

  // ★★★ fix-440 (P-057 B2) — ESCAPE NOW ACTUALLY WORKS, AND IT NEVER DID.
  //
  // There was an `onKeyDown` here checking for Escape — on a `role="presentation"`
  // div with no `tabIndex`. A div that cannot take focus never receives a
  // keydown, so the handler was dead from the day it was written: the only way
  // to fire it was to Tab into a control INSIDE the panel first, and by then
  // the event target is that control. Measured, not assumed — nothing in the
  // lightbox autofocuses.
  //
  // ★★ A `document` listener is the fix, not `tabIndex={-1}` + autoFocus:
  //    stealing focus onto the backdrop would move it off whatever the reader
  //    was on, and the lightbox has no field to focus INTO. It is the same
  //    shape QuickEditPermitModal used until this ticket removed it there —
  //    removed there because that dialog holds unsaved input, kept here
  //    because this one does not.
  //
  // ★★★ AND THE BACKDROP CLICK STAYS. Bobby's ruling is explicit that a VIEWER
  //    keeps click-anywhere-to-close — "this is just stale text". There is
  //    nothing here to lose: a file name, a thumbnail and a verdict already
  //    written down elsewhere. See fix-411 §1 for the other half of the rule.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const meta = [formatModified(row.modified_at), formatFileSize(row.size_kb)]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(20,28,38,.72)' }}
      onClick={onClose}
      role="presentation"
      data-testid="plan-of-record-lightbox"
      data-viewer-mode={mode}
      data-page-count={String(Math.max(1, shownSet?.page_count ?? 1))}
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
              {[
                stageLabel(row.set_type),
                meta && `Modified ${meta}`,
                // ★ The COUNT is claimed only when a set row supplies one.
                //   fix-295's rule: "page 1 of 12" would be invented for a
                //   single thumbnail, which carries no page count at all.
                pages.length > 0 ? `${pages.length} pages` : 'Page 1',
              ]
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
          <div className="flex-shrink-0 flex items-center gap-1.5">
            {/* ★★★ fix-523 §A — SHARES THE WHOLE SET NOW, not page one.
                `lib/planOfRecordShare` said a multi-page share needs a landing
                page rather than a list of URLs; the landing page exists, so
                this hands over the same `/s/<token>` the card's menu does. It
                was the third control resolving the shared object on its own. */}
            <button
              type="button"
              onClick={() =>
                void share.copy(
                  row.set_type,
                  row.set_type === 'marketing'
                    ? (shownSet?.variant?.toLowerCase() ?? 'internal')
                    : null,
                )
              }
              className="text-[11px] font-bold px-2.5 py-1 rounded border border-de bg-surface text-de hover:bg-s2 transition flex items-center gap-1"
              title={`Copy a ${SHARE_TTL_DAYS}-day link to this set — no login needed`}
              data-testid="plan-of-record-lightbox-share"
            >
              <ShareGlyph />
              Share
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] font-bold px-2.5 py-1 rounded border border-border bg-surface text-text hover:bg-s2 transition"
              data-testid="plan-of-record-lightbox-close"
            >
              Close
            </button>
          </div>
        </div>

        {pages.length > 0 ? (
          // ★ Every page, stacked, each numbered. `maxHeight` + `overflow-y`
          //   rather than a pager — see the note at the top of this component.
          <div
            className="flex flex-col gap-3 overflow-y-auto"
            style={{ maxHeight: '70vh' }}
            data-testid="plan-of-record-pages"
          >
            {pages.map((path, i) => (
              <PageImage
                key={path}
                objectPath={path}
                index={i}
                total={pages.length}
                fileName={row.file_name}
              />
            ))}
          </div>
        ) : thumbQ.data ? (
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

/**
 * ★ One external page. Signed on its own, and CACHED PER PATH by the query key
 *   — a twelve-page set mints twelve signatures once and re-uses them for the
 *   session, rather than re-signing on every scroll.
 *
 * ★★ A PAGE THAT WILL NOT SIGN DOES NOT BREAK THE SET. It renders its number
 *    and a note; the pages either side still show. The alternative — one failed
 *    signature emptying the viewer — is the shape fix-358 spent a ticket
 *    removing from this very card.
 */
function PageImage({
  objectPath,
  index,
  total,
  fileName,
}: {
  objectPath: string;
  index: number;
  total: number;
  fileName: string;
}) {
  const q = usePlanOfRecordThumbnail(objectPath);
  return (
    <figure className="m-0" data-testid={`plan-of-record-page-${index + 1}`}>
      <figcaption className="text-[9px] text-dim mb-0.5">
        Page {index + 1} of {total}
      </figcaption>
      {q.data ? (
        <img
          src={q.data}
          alt={`Page ${index + 1} of ${fileName}`}
          className="block w-full h-auto rounded border mx-auto"
          style={{ borderColor: 'var(--color-border)' }}
        />
      ) : (
        <div
          className="rounded border border-dashed px-3 py-8 text-center text-[10px] text-dim"
          style={{ borderColor: 'var(--color-border)' }}
        >
          {q.isLoading ? 'Loading…' : 'This page could not be loaded.'}
        </div>
      )}
    </figure>
  );
}

/**
 * ★★★ fix-522 §D3 (P-187) — A SHARE MENU, NOT ONE ACTION.
 *
 * Bobby: *"share button doesn't have the updates we have talked about
 * either"*, against the v14 mock's `shareMenu`.
 *
 * ★★★ TWO ITEMS SHIP, AND A THIRD IS DELIBERATELY ABSENT:
 *
 *   · **Copy link** — fix-506's behaviour, unchanged to the character: a
 *     30-day signed URL to this set's FIRST PAGE, copied, with the same toast.
 *   · **Email it** — the same link in a `mailto:` whose subject names the set
 *     (§D4). No image: a `mailto:` cannot carry one, and the alternatives are
 *     a real send path or a world-readable bucket. See `planOfRecordShare`.
 *   · ⏸ **Share the whole set** is NOT here. It needs a Bridge route, a
 *     `plan_share_links` table and an access ruling — reported in the fix-522
 *     PR and not built. **The menu exists so it drops in as one more item**
 *     rather than as a redesign of this control.
 *
 * ★ The menu closes on pick, on Escape and on an outside click. It is a
 *   `<div role="menu">` over a real `<button>` rather than a `<select>`,
 *   because the items DO things rather than choose a value.
 */
/** Gap between the share glyph and its menu, and the minimum inset from the
 *  viewport edge. One number, so the two cannot drift. */
const MENU_GAP_PX = 4;

function ShareMenu({
  label,
  picked,
  onCopy,
  pdfPath,
  pdfBytes,
  pdfName,
  shareLink,
  onUnshare,
  testId,
}: {
  label: string;
  picked: boolean;
  onCopy: () => void;
  pdfPath: string | null;
  pdfBytes: number | null;
  pdfName: string | null;
  shareLink: PlanShareLinkRow | null;
  onUnshare: (token: string) => void;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  /** Viewport coordinates for the portaled menu. Measured on the CLICK, never
   *  during render — reading a ref in render is a React Compiler error and only
   *  lint catches it (fix-426, third recording). */
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);

  // ★ fix-440's lesson: a keydown listener belongs on the DOCUMENT, not on a
  //   non-focusable div — `onKeyDown` on a div with no `tabIndex` never fires.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      // ★★★ fix-525 §A: the MENU is checked too, and it has to be. It is
      //     portaled to <body>, so `wrapRef` does not contain it any more —
      //     and a mousedown on a menu item would close the menu, unmounting
      //     the item before its `click` could fire. The control would open,
      //     look right, and do nothing when pressed.
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    // ★ A fixed-position menu does not follow the page. Closing is honest and
    //   costs nothing; re-measuring on every scroll frame is not.
    function onScroll() {
      setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      setAt({
        top: r.bottom + MENU_GAP_PX,
        right: Math.max(MENU_GAP_PX, window.innerWidth - r.right),
      });
    }
    setOpen(true);
  }

  const menu = open ? (
    <div
      ref={menuRef}
      role="menu"
      className="rounded border shadow-lg overflow-hidden min-w-[168px]"
      style={{
        // ★★★ fix-525 §A — FIXED AND PORTALED. See the note above the
        //     component: this menu has been clipped out of existence since the
        //     day it was written, by TWO ancestors. Taking it out of the flow
        //     entirely is the fix that no future ancestor can undo.
        position: 'fixed',
        top: at?.top ?? 0,
        right: at?.right ?? 0,
        zIndex: 60,
        borderColor: 'var(--color-border)',
        background: 'var(--color-surface)',
      }}
      data-testid={`${testId}-share-menu`}
    >
          <ShareMenuItem
            testId={`${testId}-share-copy`}
            onPick={() => {
              setOpen(false);
              onCopy();
            }}
            title={`Copy a ${SHARE_TTL_DAYS}-day link to this set's first page — no login needed`}
          >
            Copy link
          </ShareMenuItem>
          {/* ★★★ fix-528 §C — THE DRAWING ITSELF, and it is the item that
              replaces `Email it…`. The source PDF, signed for five minutes and
              saved under the set's own name — the ORIGINAL file the indexer
              opens, not a raster of its page images, which would blur at the
              first zoom and could not be searched.

              ★ Present only when there IS one. `pdf_path` is non-null on 336 of
                336 current sets (fix-526's backfill, measured 2026-09-11), so
                in practice it is always here — but "always" is a fact about
                today's data, and the guard is a fact about the control. */}
          {pdfPath && (
            <ShareMenuItem
              testId={`${testId}-share-download`}
              onPick={() => {
                setOpen(false);
                void downloadPlanPdf(pdfPath, pdfName);
              }}
              title="Download the plan set as a PDF"
            >
              {`Download PDF${pdfBytes ? ` · ${formatPdfSize(pdfBytes)}` : ''}`}
            </ShareMenuItem>
          )}
          {/* ★★★ fix-523 §A2 — STOP SHARING. Present only when a live link for
              this set exists; there is nothing to revoke otherwise, and an item
              that is usually inert is an item people stop reading. */}
          {shareLink && (
            <ShareMenuItem
              testId={`${testId}-share-unshare`}
              onPick={() => {
                setOpen(false);
                onUnshare(shareLink.token);
              }}
              title="Stop this link working — anyone holding it loses access immediately"
            >
              Unshare
            </ShareMenuItem>
          )}
          {/* ⏸ **Download PDF is NOT here, and its absence is the correct
              result of fix-523 §B.** Every one of the 334 current sets IS a PDF
              on `\bpc-file` — `unc_path` is populated on all of them — but the
              indexer has never uploaded one: `project_file_index.pdf_path` is
              NULL on every row, and `project_plan_of_record_sets` does not
              carry the column at all (both measured 2026-09-11). Uploading is a
              scraper ticket.

              ★★★ SO THERE IS NO DISABLED BUTTON AND NO PROMISE OF ONE — the
                  affordance appears when there is a file behind it and not one
                  moment earlier, which is the P-032 placeholder rule this card
                  already had applied to it once. A test asserts the absence. */}
    </div>
  ) : null;

  return (
    <div ref={wrapRef} className="relative flex">
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="px-1.5 flex items-center border-l"
        style={{
          borderLeftColor: picked ? 'rgba(255,255,255,.4)' : 'var(--color-border)',
          background: picked ? 'var(--color-de)' : 'var(--color-surface)',
          color: picked ? '#fff' : 'var(--color-de)',
        }}
        title={`Share ${label}`}
        aria-label={`Share ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={`${testId}-share`}
      >
        <ShareGlyph />
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  );
}

function ShareMenuItem({
  children,
  onPick,
  title,
  testId,
}: {
  children: React.ReactNode;
  onPick: () => void;
  title: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onPick}
      title={title}
      className="block w-full text-left text-[10.5px] px-2.5 py-1.5 hover:bg-s2 transition"
      style={{ color: 'var(--color-text)' }}
      data-testid={testId}
    >
      {children}
    </button>
  );
}
