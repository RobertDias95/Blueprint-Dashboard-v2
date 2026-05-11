import { useState, type ReactNode, type KeyboardEvent } from 'react';

// Q7.3.a: reusable pill-list primitive. Renders a list of items as removable
// pills + an add-input. Carries forward to Q7.3.b (team members), Q7.3.c
// (task templates header pills), Q7.3.d (consultants).
//
// Optional `extra` slot per item lets callers attach inline controls
// (e.g. the per-juris learn_window_days input). When `readOnly` is true,
// add/remove controls hide and only the labels render.
//
// Q7.3.b: optional inline rename. When `onRename` is provided, clicking
// the label swaps it to an <input>; Enter or blur commits, Esc cancels.
// Used by the Team tab — DAs/DMs use the cascade rename RPC; ENTs/ACQs
// use a simple name update. The callback is fired only on real changes.

export interface PillItem {
  /** Stable identity key. For string-only lists this equals `label`. */
  key: string;
  /** Display label shown in the pill body. */
  label: string;
  /** Optional inline control rendered to the right of the label (e.g. number
   *  input for jurisdictions). Renders inside the pill. */
  extra?: ReactNode;
  /** Optional badge text (e.g. "built-in" for builtin permit types). */
  badge?: string;
  /** When true, the × remove button hides for this row even if the editor
   *  is admin-mode. Used to protect built-in catalog rows. */
  removalLocked?: boolean;
}

interface Props {
  label: string;
  items: PillItem[];
  /** Called with a non-empty trimmed string when the user submits a new
   *  entry. Caller decides whether duplicates are rejected, etc. */
  onAdd: (name: string) => void;
  /** Called when the user clicks the × on an item. */
  onRemove: (key: string) => void;
  /** Optional: when provided, labels become click-to-edit. Fired with
   *  the item's key + the new trimmed name when the user commits a
   *  change (Enter or blur). Empty names cancel. */
  onRename?: (key: string, newName: string) => void;
  /** Placeholder for the add-input. */
  placeholder?: string;
  /** Read-only mode (hide add/remove). */
  readOnly?: boolean;
  /** Empty-state copy when items.length === 0. */
  emptyState?: string;
  /** Optional test-id prefix. Each pill gets `<prefix>-pill-<key>`; the
   *  add-input gets `<prefix>-add`; the add-button `<prefix>-add-btn`. */
  testIdPrefix?: string;
}

export default function PillListEditor({
  label,
  items,
  onAdd,
  onRemove,
  onRename,
  placeholder,
  readOnly = false,
  emptyState,
  testIdPrefix,
}: Props) {
  const [input, setInput] = useState('');
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  function submit() {
    const v = input.trim();
    if (!v) return;
    onAdd(v);
    setInput('');
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }

  function startRename(item: PillItem) {
    if (!onRename || readOnly) return;
    setRenamingKey(item.key);
    setRenameDraft(item.label);
  }
  function commitRename(item: PillItem) {
    if (!onRename) return;
    const trimmed = renameDraft.trim();
    if (trimmed && trimmed !== item.label) {
      onRename(item.key, trimmed);
    }
    setRenamingKey(null);
    setRenameDraft('');
  }
  function cancelRename() {
    setRenamingKey(null);
    setRenameDraft('');
  }
  function onRenameKey(e: KeyboardEvent<HTMLInputElement>, item: PillItem) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }

  return (
    <div data-testid={testIdPrefix ?? undefined}>
      <div className="text-[10px] uppercase tracking-wide text-muted font-display font-bold mb-2">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {items.length === 0 && (
          <span className="text-xs text-dim italic">
            {emptyState ?? 'No entries yet.'}
          </span>
        )}
        {items.map((item) => {
          const isRenaming = renamingKey === item.key;
          const canRename = !!onRename && !readOnly;
          return (
            <span
              key={item.key}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-2 border border-border text-xs"
              data-testid={
                testIdPrefix ? `${testIdPrefix}-pill-${item.key}` : undefined
              }
            >
              {isRenaming ? (
                <input
                  autoFocus
                  type="text"
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => onRenameKey(e, item)}
                  onBlur={() => commitRename(item)}
                  className="bg-bg border border-de rounded px-1 py-0 text-xs outline-none min-w-[80px]"
                  data-testid={
                    testIdPrefix
                      ? `${testIdPrefix}-rename-${item.key}`
                      : undefined
                  }
                />
              ) : (
                <span
                  className={canRename ? 'cursor-text' : ''}
                  onClick={() => startRename(item)}
                  title={canRename ? 'Click to rename' : undefined}
                >
                  {item.label}
                </span>
              )}
              {item.badge && (
                <span className="text-[9px] uppercase text-muted border border-border rounded px-1 ml-0.5">
                  {item.badge}
                </span>
              )}
              {item.extra && <span className="ml-1">{item.extra}</span>}
              {!readOnly && !item.removalLocked && (
                <button
                  onClick={() => onRemove(item.key)}
                  className="text-dim hover:text-text text-sm leading-none pl-0.5"
                  title="Remove"
                  data-testid={
                    testIdPrefix
                      ? `${testIdPrefix}-remove-${item.key}`
                      : undefined
                  }
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
      </div>
      {!readOnly && (
        <div className="flex gap-1.5">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder={placeholder ?? `Add ${label.toLowerCase()}…`}
            className="flex-1 px-2.5 py-1 text-xs border border-border rounded bg-bg text-text outline-none focus:border-de"
            data-testid={testIdPrefix ? `${testIdPrefix}-add` : undefined}
          />
          <button
            onClick={submit}
            className="px-3 py-1 text-xs font-display font-semibold bg-de text-white rounded border border-de hover:bg-de/90"
            data-testid={testIdPrefix ? `${testIdPrefix}-add-btn` : undefined}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
