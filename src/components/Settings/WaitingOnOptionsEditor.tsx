import { useMemo } from 'react';
import PillListEditor from './PillListEditor';
import { useAppConfig } from '../../hooks/useAppConfig';
import { useSetAppConfigKey } from '../../hooks/useSetAppConfigKey';
import { useAllTasks } from '../../hooks/useTaskTree';
import {
  DEFAULT_WAITING_ON_OPTIONS,
  WAITING_ON_CITY,
  WAITING_ON_CONFIG_KEY,
  waitingOnOptions,
} from '../../lib/waitingOn';

// ===========================================================================
// ★★★ fix-364 §3 — "Waiting on", now a Settings list
// ===========================================================================
//
// Bobby: *"For waiting on — can we add it to the settings as an editable
// feature? And we want to put city as a reason, because sometimes a task is
// waiting on the city for a vendor to respond."*
//
// ★ It follows `cancelReasonOptions`, `holdReasonOptions`, `productTypeOptions`
// and `projectTagOptions` — four app_config arrays already edited by this same
// `PillListEditor`. `waiting_on` was the ONLY list of its kind still hardcoded;
// this makes it consistent rather than inventing a pattern.
//
// ★ It lives on the PERMITS tab because "waiting on" is a field of a TASK, and
// task templates are here. The Projects tab holds project-shaped catalogues.

export default function WaitingOnOptionsEditor({
  readOnly = false,
}: {
  readOnly?: boolean;
}) {
  const cfg = useAppConfig();
  const setKey = useSetAppConfigKey();
  const tasksQ = useAllTasks();

  // ★★ THE EFFECTIVE LIST, not the stored one. `app_config.waitingOnOptions`
  // does not exist until somebody edits it (no seed row is written — see
  // lib/waitingOn), so reading the raw key would show an empty editor beside a
  // working dropdown. Reading through the same helper the dropdowns use means
  // the editor shows what people actually see, and the first add or remove
  // writes the whole array.
  const options = useMemo(() => waitingOnOptions(cfg.map), [cfg.map]);

  // ★★★ HOW MANY TASKS EACH OPTION IS HOLDING — the safeguard that makes an
  // editable list safe to edit.
  //
  // An editable list creates exactly one hard question: what happens to a task
  // set to an option somebody deletes? The answer is that the task KEEPS its
  // value and keeps showing it (waitingOnOptions appends it), so nothing is
  // destroyed. But "nothing is destroyed" is a poor substitute for "you can see
  // what you are about to do", and the count is the cheaper half of that.
  const inUse = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tasksQ.data ?? []) {
      const v = (t.waiting_on ?? '').trim();
      if (!v) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return counts;
  }, [tasksQ.data]);

  // ★ A value tasks are using that the list no longer offers. It is shown at
  // the bottom, marked, and NOT removable — there is nothing to remove, and a ×
  // beside it would imply this editor could take it off the tasks. It cannot,
  // and should not.
  const retired = useMemo(
    () => [...inUse.keys()].filter((v) => !options.includes(v)).sort(),
    [inUse, options],
  );

  const items = [
    ...options.map((o) => ({
      key: o,
      label: o,
      badge: inUse.get(o) ? `${inUse.get(o)} in use` : undefined,
    })),
    ...retired.map((o) => ({
      key: o,
      label: o,
      badge: `${inUse.get(o)} in use · removed`,
      removalLocked: true,
    })),
  ];

  return (
    <div data-testid="waiting-on-options-editor">
      <h2 className="text-sm font-display font-bold text-text mb-1">
        Waiting On
      </h2>
      <p className="text-[11px] text-muted mb-3">
        The choices offered by a task&apos;s <strong>Waiting on</strong> field —
        who the work is blocked on.{' '}
        {/* ★★ WHY THE CITY IS ON A LIST OF CONSULTANTS, said on screen and not
            only in the code. Every other value names a firm we hired; the city
            is the jurisdiction we are waiting on. The question the field asks
            is "who is this task waiting on", and the city is a legitimate
            answer to it. Measured before adding it: "Other" was the
            second-most-used OPEN value (11 tasks), which is what people reach
            for when the right answer is not on the list. */}
        Most are consultant disciplines; <strong>{WAITING_ON_CITY}</strong> is
        the jurisdiction rather than a firm, and is here because a task can be
        waiting on the city just as truly as on a consultant.
      </p>
      <p
        className="text-[11px] text-muted mb-3"
        data-testid="waiting-on-options-deletion-note"
      >
        Removing an option stops it being offered for new work. Tasks already
        set to it <strong>keep their value</strong> and keep showing it — the
        option reappears at the bottom, marked, until nothing is using it.
      </p>
      <PillListEditor
        label="Waiting On"
        items={items}
        onAdd={(name) => {
          if (options.includes(name)) return;
          setKey.mutate({
            key: WAITING_ON_CONFIG_KEY,
            // ★ Added before "Other", which stays the last resort. An escape
            // hatch in the middle of a list gets picked by accident.
            value: [...options.filter((o) => o !== 'Other'), name, 'Other'].filter(
              (o, i, a) => a.indexOf(o) === i,
            ),
          });
        }}
        onRemove={(name) =>
          setKey.mutate({
            key: WAITING_ON_CONFIG_KEY,
            value: options.filter((o) => o !== name),
          })
        }
        placeholder="Add a discipline…"
        emptyState="No options — tasks cannot record what they are waiting on."
        readOnly={readOnly}
        testIdPrefix="waiting-on-options"
      />
      {options.length === 0 && (
        // ★ Deleting the last option is recoverable and says how. The list
        // falls back to the built-in set when the stored array is EMPTY, so
        // this state only appears mid-edit.
        <div className="text-[11px] text-co mt-2" data-testid="waiting-on-options-reset">
          Add one, or the built-in list ({DEFAULT_WAITING_ON_OPTIONS.length}{' '}
          options) is used instead.
        </div>
      )}
    </div>
  );
}
