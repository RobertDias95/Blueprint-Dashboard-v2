import { useRef, useState } from 'react';

// Q3: Inline editable field — text / date / select. Saves on blur if the
// value changed; if it didn't change, no mutation fires. While saving,
// the input is read-only and a small spinner sits next to it.

export type EditableFieldKind = 'text' | 'date' | 'select';

interface BaseProps {
  label: string;
  value: string | null;
  onSave: (next: string) => void | Promise<void>;
  saving?: boolean;
  disabled?: boolean;
  /** Stable test id so component tests can target an exact field. */
  testId?: string;
}

interface TextProps extends BaseProps {
  kind: 'text';
}

interface DateProps extends BaseProps {
  kind: 'date';
}

interface SelectProps extends BaseProps {
  kind: 'select';
  options: { value: string; label: string }[];
}

type Props = TextProps | DateProps | SelectProps;

export default function EditableField(props: Props) {
  const { label, value, onSave, saving, disabled, testId } = props;
  // While focused, draft is owned locally (so the user's typing isn't
  // clobbered by upstream realtime updates). While not focused, the
  // displayed value comes straight from `value` — so external updates
  // flow in without an effect-driven setState.
  const [focused, setFocused] = useState(false);
  const [localDraft, setLocalDraft] = useState<string>(value ?? '');
  const lastCommittedRef = useRef<string>(value ?? '');
  const draft = focused ? localDraft : value ?? '';

  function commit(next: string) {
    if (next === lastCommittedRef.current) return; // no-op blur
    lastCommittedRef.current = next;
    void onSave(next);
  }

  const inputBase =
    'text-xs font-mono px-2 py-1 rounded border bg-bg text-text border-border focus:outline-none focus:border-de transition disabled:opacity-60 disabled:cursor-not-allowed';

  let control: React.ReactNode;
  if (props.kind === 'select') {
    control = (
      <select
        data-edit-id={testId}
        data-testid={testId}
        className={inputBase}
        value={draft}
        disabled={disabled || saving}
        onChange={(e) => {
          setLocalDraft(e.target.value);
          // Selects commit immediately on change — no blur needed.
          commit(e.target.value);
        }}
      >
        {props.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  } else {
    control = (
      <input
        data-edit-id={testId}
        data-testid={testId}
        type={props.kind === 'date' ? 'date' : 'text'}
        className={inputBase}
        value={draft}
        disabled={disabled || saving}
        onFocus={() => {
          setLocalDraft(value ?? '');
          lastCommittedRef.current = value ?? '';
          setFocused(true);
        }}
        onChange={(e) => setLocalDraft(e.target.value)}
        onBlur={() => {
          commit(localDraft);
          setFocused(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'Escape') {
            setLocalDraft(lastCommittedRef.current);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[9px] uppercase tracking-wide text-dim">
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        {control}
        {saving && (
          <span
            className="inline-block w-2 h-2 rounded-full bg-de animate-pulse"
            title="Saving..."
            data-testid={testId ? `${testId}-saving` : undefined}
          />
        )}
      </div>
    </div>
  );
}
