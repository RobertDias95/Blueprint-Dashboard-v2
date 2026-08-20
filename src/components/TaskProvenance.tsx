import { useState } from 'react';
import { useTaskProvenance } from '../hooks/useTaskProvenance';
import { buildProvenance, type ProvenanceLine } from '../lib/taskProvenance';

// ===========================================================================
// ★★ fix-363 §2 — ONE COMPONENT, RENDERED IN THREE PLACES
// ===========================================================================
//
// Bobby named all three surfaces: the notification, My Tasks, and the permit.
//
// ★ THE SAME FOUR FACTS TOLD THREE WAYS WILL DRIFT, and this is a codebase that
// has paid for that twice — fix-298 Phase 2 spent a ticket collapsing two
// answers to "what is waiting on me", and fix-329 wrote the rule down
// afterwards. So this is a component with three call sites, not three displays.
//
// ★★ NOT ALWAYS-ON. Bobby: "maybe a pop-up of the information." Four more lines
// on every task row would bury the work itself, so the button is small, the
// panel is a popover, and the query does not run until it is opened.

const STATE_STYLE: Record<
  ProvenanceLine['state'],
  { color: string; testid: string }
> = {
  // ★★★ THREE STATES, THREE TREATMENTS — structural, not merely worded. A
  // reader must be able to tell "Cam did this" from "a trigger did this" from
  // "nobody wrote it down" without reading to the end of the sentence, and a
  // test must be able to hold that apart from the words.
  person: { color: 'var(--color-text)', testid: 'person' },
  // The machine's lines are quieter: they are true, they are complete, and
  // there is nobody to go and ask.
  machine: { color: 'var(--color-muted)', testid: 'machine' },
  // ★ …and a gap is neither. It is not dimmed into invisibility (that would
  // read as unimportant) and it is not styled like a name (that would read as
  // one). It borrows the CORRECTIONS palette, which already means "this needs
  // your attention rather than your action".
  unrecorded: { color: 'var(--color-co)', testid: 'unrecorded' },
};

/** The lines themselves. Exported so a caller that already has the rows — or a
 *  test — can render them without the popover around them. */
export function ProvenanceLines({ lines }: { lines: ProvenanceLine[] }) {
  if (lines.length === 0) {
    return (
      <div
        className="text-[10.5px] italic"
        style={{ color: 'var(--color-dim)' }}
        data-testid="task-provenance-empty"
      >
        Nothing about this task&apos;s history was recorded.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1" data-testid="task-provenance-lines">
      {lines.map((line, i) => (
        <div
          key={`${line.kind}-${i}`}
          className="text-[10.5px] leading-snug"
          style={{ color: STATE_STYLE[line.state].color }}
          data-testid={`task-provenance-${line.kind}`}
          // ★ THE STATE IS IN THE DOM. "Three states are visually and
          // structurally distinct" is a requirement, and an attribute is how a
          // test asserts it without asserting a colour value.
          data-state={STATE_STYLE[line.state].testid}
        >
          {line.text}
        </div>
      ))}
    </div>
  );
}

/**
 * The control and its popover.
 *
 * ★ `label` lets the three surfaces name it in their own register — a permit's
 * task bar has room for a word, a notification row has room for a glyph — while
 * everything below the button stays identical by construction.
 */
export default function TaskProvenance({
  taskId,
  label = 'History',
  align = 'left',
}: {
  taskId: string;
  label?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  // ★ The query is gated on `open`: reference information nobody has asked for
  // costs nothing.
  const q = useTaskProvenance(taskId, open);
  const lines = buildProvenance(q.data ?? []);

  return (
    <span className="relative inline-block" data-testid={`task-provenance-${taskId}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[9.5px] font-bold bg-transparent border-none p-0 hover:underline"
        style={{ color: 'var(--color-de)' }}
        title="Who created, assigned and completed this"
        aria-expanded={open}
        data-testid="task-provenance-button"
      >
        {label}
      </button>

      {open && (
        <>
          {/* Click-away, the same shape every other popover in the app uses. */}
          <span
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            className="absolute z-50 mt-1 rounded-md border shadow-lg p-2.5"
            style={{
              [align]: 0,
              minWidth: 250,
              maxWidth: 340,
              background: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
            }}
            role="dialog"
            aria-label="Task history"
            data-testid="task-provenance-panel"
          >
            <div
              className="text-[8px] font-extrabold uppercase tracking-wide mb-1.5"
              style={{ color: 'var(--color-muted)' }}
            >
              History
            </div>
            {q.isLoading ? (
              <div
                className="text-[10.5px]"
                style={{ color: 'var(--color-dim)' }}
                data-testid="task-provenance-loading"
              >
                Loading…
              </div>
            ) : q.error ? (
              // ★ A failed read is not a gap in the record, and must not be
              // rendered as one — "not recorded" is a claim about history, and
              // this is a claim about the network.
              <div
                className="text-[10.5px]"
                style={{ color: 'var(--color-er)' }}
                data-testid="task-provenance-error"
              >
                The history could not be loaded.
              </div>
            ) : (
              <ProvenanceLines lines={lines} />
            )}
          </div>
        </>
      )}
    </span>
  );
}
