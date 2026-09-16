import { SAVES_NOW_LABEL, SAVES_NOW_TITLE } from '../../lib/saveModel';

/**
 * ★★★ fix-575 §C (P-227) — "this one does not wait for Save".
 *
 * ★★ THE SHAPE IS THE HOUSE'S QUIET NOTE, not a new one: `text-[9px] italic` in
 *    a muted colour with a `title` — the same treatment as the *"irregular
 *    lot"* mark in `SiteLotSizeRow`. §C asked for an existing pattern matched
 *    rather than invented, and that is the one this codebase uses for a small
 *    true aside that is neither an error nor a status.
 *
 * ★★★ AND IT MUST NOT READ AS A WARNING. `--color-dim` rather than
 *     `--color-co`: writing immediately is not a problem, it is how these
 *     controls have always worked. A coloured chip here would tell somebody
 *     that the hold panel is broken.
 *
 * ★ The words live in `lib/saveModel`, once — see that file for why nine
 *   literals was the failure mode rather than the shortcut.
 */
export default function SavesNowMark({ testid }: { testid?: string }) {
  return (
    <span
      className="text-[9px] italic whitespace-nowrap"
      style={{ color: 'var(--color-dim)' }}
      title={SAVES_NOW_TITLE}
      data-testid={testid ?? 'saves-now-mark'}
    >
      {SAVES_NOW_LABEL}
    </span>
  );
}
