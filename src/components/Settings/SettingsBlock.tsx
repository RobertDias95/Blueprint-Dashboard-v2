// ===========================================================================
// ★★★ fix-611 §C — A SETTINGS BLOCK: ONE COLLAPSED LINE, OR THE EDITOR
// ===========================================================================
//
// Collapsed: chevron · title · summary (muted, truncates) · tags.
// Open:      the Feeds line, then the editor(s) exactly as they rendered before.
//
// ★★★ THE EDITOR IS NEVER UNMOUNTED WHEN THE BLOCK CLOSES — it is hidden with
//     `display:none`. §C's warning: *"an editor with unsaved work must not lose
//     it when another block opens."* Several editors here hold local draft state
//     that lives nowhere else until it is committed:
//
//       · PillListEditor            — the "Add…" input, and an in-flight rename
//       · LearnWindowInput          — (retired by §E, but it was the clearest case)
//       · TaskTemplateEditor        — the new-subtask draft and its scope pickers
//       · TeamStructureEditor       — the pending chip assignment
//       · QuarterLayoutEditor       — drag state and the per-row drafts
//       · BuildersRegistryPanel     — the add/rename inputs and the merge choice
//       · ExternalTeamDirectoryEditor — add-firm and rename-firm inputs
//       · TargetSubmitFormulasEditor / PermitTypeDefaultsEditor — per-cell drafts
//       · AvatarControl             — a chosen-but-not-uploaded file
//
//     Unmounting any of those loses typing with no warning and no undo. Hiding
//     them costs one hidden subtree per category and keeps every draft exactly
//     where it was, which is why this is `display:none` and not a conditional
//     render. It also means no editor needed changing to survive the accordion —
//     which is the ONE RULE holding.
//
// ★ The cost is honest and bounded: a category mounts all of its editors, so
//   their queries run on arrival rather than on first open. Every one of those
//   queries is the same React Query key the old always-expanded tab fetched, so
//   this is the load Settings already had — not new work.
import { useEffect, useRef } from 'react';
import {
  blockIsOnThisPage,
  blockIsOpen,
  useSettingsBlockContext,
} from '../../lib/settingsBlockContext';
import { blockById } from '../../lib/settingsBlocks';

export default function SettingsBlock({
  id,
  children,
}: {
  /** Must match an id in `SETTINGS_BLOCKS`. A test enforces both directions. */
  id: string;
  children: React.ReactNode;
}) {
  const ctx = useSettingsBlockContext();
  const block = blockById(id);
  const headingRef = useRef<HTMLButtonElement | null>(null);

  // ★★ The hash deep-link scrolls the opened block into view, but only when the
  //    page opened it for us — not on every toggle, or clicking the third block
  //    would yank the page after you had already clicked it.
  const openedByHash = useRef(
    typeof window !== 'undefined' && window.location.hash === `#${id}`,
  );
  useEffect(() => {
    if (!openedByHash.current) return;
    openedByHash.current = false;
    headingRef.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  if (!blockIsOnThisPage(ctx, block?.category)) return null;

  // ★ A block with no registry entry still renders, fully expanded, rather than
  //   disappearing. The test is what makes that case impossible to ship; a blank
  //   screen would be a worse way to find out.
  if (!block) return <>{children}</>;

  const open = blockIsOpen(ctx, id);
  const accordion = ctx.category !== null && typeof ctx.toggle === 'function';

  if (!accordion) {
    // Outside the Settings page (a test, or a route that mounts a tab directly)
    // every block renders as the plain card it always was.
    return (
      <div
        className="bg-surface border border-border rounded-lg p-4"
        data-testid={`settings-block-${id}`}
        data-open="true"
      >
        <h2 className="text-sm font-display font-bold text-text mb-3">
          {block.title}
        </h2>
        {children}
      </div>
    );
  }

  return (
    <div
      className="bg-surface border border-border rounded-lg overflow-hidden"
      data-testid={`settings-block-${id}`}
      data-open={open ? 'true' : 'false'}
    >
      <button
        ref={headingRef}
        type="button"
        onClick={() => ctx.toggle?.(id)}
        aria-expanded={open}
        aria-controls={`settings-block-body-${id}`}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-s3 transition"
        data-testid={`settings-block-toggle-${id}`}
      >
        <span
          className="text-dim text-[10px] flex-none w-2.5"
          style={{
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 120ms',
          }}
          aria-hidden="true"
        >
          ▶
        </span>
        <span className="text-[13px] font-display font-bold text-text flex-none">
          {block.title}
        </span>
        {/* ★ The summary truncates rather than wrapping: a row that grows to two
            lines breaks the scannable column of titles, which is the whole
            reason the rows are one line. */}
        <span className="text-[11px] text-dim truncate min-w-0 flex-1">
          {block.summary}
        </span>
        {block.merged && (
          <span
            className="flex-none text-[9px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 bg-s3 text-muted"
            data-testid={`settings-block-merged-${id}`}
          >
            merged {block.merged}
          </span>
        )}
        {block.readOut && (
          <span
            className="flex-none text-[9px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 bg-s3 text-muted"
            data-testid={`settings-block-readout-${id}`}
          >
            read-out
          </span>
        )}
      </button>

      {/* ★★★ HIDDEN, NOT UNMOUNTED — see the note at the top of this file. */}
      <div
        id={`settings-block-body-${id}`}
        className="px-3.5 pb-3.5 pt-0.5 border-t border-border"
        style={open ? undefined : { display: 'none' }}
        data-testid={`settings-block-body-${id}`}
      >
        {block.feeds.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-1 mb-3 mt-2.5"
            data-testid={`settings-block-feeds-${id}`}
          >
            <span className="text-[9px] uppercase tracking-wide text-dim font-bold mr-0.5">
              Feeds
            </span>
            {block.feeds.map((f) => (
              <span
                key={f}
                className="text-[10px] rounded-full px-2 py-0.5 bg-s2 border border-border text-muted"
              >
                {f}
              </span>
            ))}
          </div>
        )}
        <div className={block.feeds.length > 0 ? undefined : 'mt-2.5'}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** ★ A sub-heading inside a merged block, for the "two editors, one row" cards
 *  (Jurisdictions, Unit options, Hold & cancel reasons, Waiting On &
 *  consultants, Per-type schedule, Former & inactive). Small on purpose: the
 *  block title is the heading, and these are its parts. */
export function SettingsSubBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 first:mt-0" data-testid={`settings-subblock-${title}`}>
      <h3 className="text-[10px] uppercase tracking-wide font-bold text-dim mb-1.5">
        {title}
      </h3>
      {children}
    </div>
  );
}
