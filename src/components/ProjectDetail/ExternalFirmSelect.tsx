import { useMemo, useState } from 'react';
import { useUpsertDirectoryFirm } from '../../hooks/useExternalTeamDirectory';
import { useIsTenantAdmin } from '../../hooks/useIsTenantAdmin';

// fix-227: the per-project external-team FIRM field, sourced from the central
// External Team directory (external_team_directory) for the row's discipline.
//
// One shared control so the Project Settings panel and the Project Overview
// editor can't drift (bidirectional principle). It renders a DROPDOWN of the
// directory's active firms for the discipline (settings-fields-default-to-
// dropdown rule), plus:
//   - "— Unassigned —" to clear the discipline (writes the blob empty),
//   - the current saved firm as an option even when it is NOT in the directory
//     (existing free-text blob values still show + stay selected),
//   - "+ Add new firm…", which reveals an inline input; confirming INSERTS the
//     firm into the directory (so it is reusable next time) AND selects it.
//
// Picking a firm calls onCommit(firm) — the parent writes projects.external_team
// (the blob stays the single source of truth). This control never touches the
// blob itself.

const ADD_SENTINEL = '__add_new_firm__';

interface Props {
  discipline: string;
  /** The firm currently saved in the project's external_team blob ('' = none). */
  value: string;
  /** Active directory firm names for this discipline (dropdown options). */
  firms: string[];
  disabled?: boolean;
  variant?: 'panel' | 'compact';
  /** Test-id base; the select is `<base>`, the add-input `<base>-add-input`. */
  testIdBase: string;
  /** Write the chosen firm to the project blob (parent owns the write). */
  onCommit: (firm: string) => void;
}

export default function ExternalFirmSelect({
  discipline,
  value,
  firms,
  disabled = false,
  variant = 'panel',
  testIdBase,
  onCommit,
}: Props) {
  const upsert = useUpsertDirectoryFirm();
  const isAdmin = useIsTenantAdmin();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const saved = value.trim();
  // Show the saved firm as an option even when it isn't in the directory, so an
  // existing free-text blob value renders and stays selected.
  const savedIsCustom =
    saved !== '' &&
    !firms.some((f) => f.toLowerCase() === saved.toLowerCase());

  const options = useMemo(() => {
    const opts = firms.map((f) => ({ value: f, label: f, custom: false }));
    if (savedIsCustom) {
      opts.unshift({ value: saved, label: `${saved} (not in directory)`, custom: true });
    }
    return opts;
  }, [firms, savedIsCustom, saved]);

  const selectCls =
    variant === 'compact'
      ? 'text-[10px] border-0 border-b outline-none bg-transparent w-full px-0 py-0.5 cursor-pointer disabled:opacity-50'
      : 'flex-1 px-2 py-1 text-[11px] border rounded bg-surface text-text outline-none focus:border-de disabled:opacity-50 cursor-pointer';
  const selectStyle =
    variant === 'compact'
      ? { borderBottomColor: 'var(--color-border)' }
      : { borderColor: 'var(--color-border)' };
  const inputCls =
    variant === 'compact'
      ? 'text-[10px] border-0 border-b outline-none bg-transparent w-full px-0 py-0.5'
      : 'flex-1 px-2 py-1 text-[11px] border rounded bg-surface text-text outline-none focus:border-de';

  async function confirmAdd() {
    const name = draft.trim();
    if (!name) {
      setAdding(false);
      setDraft('');
      return;
    }
    // Only admins can write the directory (RLS). For a non-admin, skip the
    // directory insert (no spurious error toast) but still let the firm land on
    // THIS project's blob — the blob is the source of truth.
    if (isAdmin) {
      try {
        await upsert.mutateAsync({ discipline, name });
      } catch {
        // useUpsertDirectoryFirm already toasts; don't block the blob write.
      }
    }
    onCommit(name);
    setAdding(false);
    setDraft('');
  }

  function cancelAdd() {
    setAdding(false);
    setDraft('');
  }

  if (adding) {
    return (
      <input
        autoFocus
        type="text"
        value={draft}
        placeholder="New firm name"
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={confirmAdd}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          else if (e.key === 'Escape') cancelAdd();
        }}
        className={inputCls}
        style={variant === 'compact' ? selectStyle : { borderColor: 'var(--color-border)' }}
        data-testid={`${testIdBase}-add-input`}
      />
    );
  }

  return (
    <select
      value={saved}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value;
        if (v === ADD_SENTINEL) {
          setDraft('');
          setAdding(true);
          return;
        }
        onCommit(v);
      }}
      className={selectCls}
      style={selectStyle}
      data-testid={testIdBase}
    >
      <option value="">— Unassigned —</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      <option value={ADD_SENTINEL}>+ Add new firm…</option>
    </select>
  );
}
