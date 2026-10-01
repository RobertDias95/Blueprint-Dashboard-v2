import { useMemo, useState } from 'react';
import { useTaskTemplates } from '../../hooks/useTaskTemplates';
import { usePermitTaskTree } from '../../hooks/useTaskTree';
import { useMayWriteProject } from '../../hooks/useMayWriteProject';
import { useAddTemplateTasks } from '../../hooks/useAddTemplateTasks';
import { defaultTickedIds, templatesToOffer } from '../../lib/templateTasks';

// ===========================================================================
// fix-609 (P-306) — "Add template tasks (N)"
// ===========================================================================
//
// Bobby, 2026-09-30: *offered as one click, never created silently* — the same
// templates the wizard would have used. So this is a quiet action, not a
// banner: a link that opens a checklist of exactly those templates, ticked the
// way the wizard ticks them, and ONE Add button. Nothing is written until Add.
//
// ★ It draws NOTHING when there is nothing to offer, when the person may not
//   edit the project (the server's own answer, `useMayWriteProject`), or while
//   the permit's tasks have not loaded — an offer computed against a list that
//   has not arrived would offer templates that are already there.

export interface TemplateTasksOfferPermit {
  id: number;
  /** A permit with no type has no templates — the offer draws nothing. */
  type: string | null;
  project_id: string;
}

export default function TemplateTasksOffer({
  permit,
  juris,
  isBackfill = false,
  onDismiss,
  testid,
}: {
  permit: TemplateTasksOfferPermit;
  /** The project's jurisdiction — Base templates plus this city's. */
  juris: string;
  /** A backfill project's history is already done: nothing ticked (fix-386),
   *  exactly as the wizard does it. */
  isBackfill?: boolean;
  /** Shown as "Not now" when given (the post-save row offer). */
  onDismiss?: () => void;
  testid: string;
}) {
  const mayWrite = useMayWriteProject(permit.project_id);
  const tplQ = useTaskTemplates();
  const treeQ = usePermitTaskTree(permit.id);
  const add = useAddTemplateTasks();

  const offer = useMemo(
    () =>
      treeQ.data && permit.type
        ? templatesToOffer(
            tplQ.templates ?? [],
            permit.type,
            juris,
            treeQ.data.map((t) => t.text),
          )
        : [],
    [tplQ.templates, treeQ.data, permit.type, juris],
  );

  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState<Set<string> | null>(null);
  const checked = ticked ?? defaultTickedIds(offer, isBackfill);
  const nChecked = offer.filter((t) => checked.has(t.id)).length;

  if (!mayWrite || !treeQ.data || offer.length === 0) return null;

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  function toggle(id: string) {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTicked(next);
  }

  function submit() {
    const ids = offer.filter((t) => checked.has(t.id)).map((t) => t.id);
    if (ids.length === 0) return;
    add.mutate(
      { permitId: permit.id, templateIds: ids },
      {
        onSuccess: () => {
          setOpen(false);
          onDismiss?.();
        },
      },
    );
  }

  return (
    // ★ Clicks stay here: on the project page this sits inside a row whose
    //   own click opens the Permit View.
    <div onClick={stop} className="text-[10.5px]" data-testid={testid}>
      {!open ? (
        <span className="inline-flex items-center gap-2">
          <button
            type="button"
            className="underline text-de hover:opacity-80"
            onClick={() => setOpen(true)}
            data-testid={`${testid}-open`}
          >
            Add template tasks ({offer.length})
          </button>
          {onDismiss && (
            <button
              type="button"
              className="text-dim hover:text-text"
              onClick={onDismiss}
              data-testid={`${testid}-dismiss`}
            >
              Not now
            </button>
          )}
        </span>
      ) : (
        <div
          className="mt-1 rounded border p-2 flex flex-col gap-1"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-s2)' }}
          data-testid={`${testid}-list`}
        >
          {offer.map((t) => (
            <label key={t.id} className="flex items-start gap-1.5 text-text cursor-pointer">
              <input
                type="checkbox"
                checked={checked.has(t.id)}
                onChange={() => toggle(t.id)}
                data-testid={`${testid}-tpl-${t.id}`}
              />
              <span>{t.text}</span>
            </label>
          ))}
          <div className="flex items-center gap-2 mt-1">
            <button
              type="button"
              className="rounded border px-2 py-0.5 text-text hover:bg-s3 disabled:opacity-50"
              style={{ borderColor: 'var(--color-border)' }}
              disabled={add.isPending || nChecked === 0}
              onClick={submit}
              data-testid={`${testid}-add`}
            >
              {add.isPending ? 'Adding…' : 'Add'}
            </button>
            <button
              type="button"
              className="text-dim hover:text-text"
              onClick={() => setOpen(false)}
              data-testid={`${testid}-cancel`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
