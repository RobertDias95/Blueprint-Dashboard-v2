import { useMemo, useState } from 'react';
import { usePermitTypes } from '../../hooks/usePermitTypes';
import { usePermits } from '../../hooks/usePermits';
import { useAppConfig } from '../../hooks/useAppConfig';
import { useUpsertPermitType } from '../../hooks/useUpsertPermitType';
import { useDeletePermitType } from '../../hooks/useDeletePermitType';
import { useRenamePermitType } from '../../hooks/useRenamePermitType';
import { useSetAppConfigKey } from '../../hooks/useSetAppConfigKey';
import {
  PERMIT_DESCRIPTIONS_KEY,
  readPermitDescriptions,
} from '../../hooks/usePermitDescriptions';

// fix-288: the permit-type catalogue editor — add, rename, remove, and the
// wizard Step 2 description for each type.
//
// ★ WHY THIS EXISTS WHEN AN EDITOR ALREADY DID. Settings → Projects had a
// Permit Types pill list: add and remove only, no rename, no descriptions, and
// deletion guarded solely by `is_builtin`. Bobby went looking for "the permit
// questionnaire" under Permits & Templates, where every other permit-shaped
// setting lives, and found nothing. This is that editor, in that place, and the
// pill list is retired so there is exactly ONE way to change the catalogue —
// two would mean the delete guard below could be walked around by using the
// other tab.
//
// ★ DELETION IS NEVER SILENT. permits.type is a STRING, not a foreign key, so
// removing a type the permits still name does not fail — it just leaves 143
// permits pointing at a catalogue entry that is gone, which surfaces months
// later as an unexplained blank. Every row states its usage count, a type in
// use cannot be deleted at all, and an unused one still asks first.
//
// ★ RENAME MOVES THE PERMITS WITH IT. Same reason: bp_rename_permit_type does
// the catalogue row and every referencing permit in one transaction. See
// useRenamePermitType.

interface Props {
  readOnly?: boolean;
}

export default function PermitTypeEditor({ readOnly = false }: Props) {
  const typesQ = usePermitTypes();
  const permitsQ = usePermits();
  const cfgQ = useAppConfig();

  const upsert = useUpsertPermitType();
  const remove = useDeletePermitType();
  const rename = useRenamePermitType();
  const setKey = useSetAppConfigKey();

  const [adding, setAdding] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  /** How many permits carry each type string. Counted off the permits the app
   *  already has cached — no extra round trip, and it is the same list every
   *  other count on the page is derived from. */
  const usageByType = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of permitsQ.data ?? []) {
      const t = (p.type ?? '').trim();
      if (t) m.set(t, (m.get(t) ?? 0) + 1);
    }
    return m;
  }, [permitsQ.data]);

  const descriptions = useMemo(
    () => readPermitDescriptions(cfgQ.map),
    [cfgQ.map],
  );

  const types = useMemo(
    () =>
      [...(typesQ.data ?? [])].sort(
        (a, b) =>
          (usageByType.get(b.name) ?? 0) - (usageByType.get(a.name) ?? 0)
          || a.name.localeCompare(b.name),
      ),
    [typesQ.data, usageByType],
  );

  function saveDescription(type: string, text: string) {
    const next = { ...descriptions };
    const trimmed = text.trim();
    if (trimmed === '') delete next[type];
    else next[type] = trimmed;
    setKey.mutate({ key: PERMIT_DESCRIPTIONS_KEY, value: next });
  }

  function commitAdd() {
    const name = adding.trim();
    if (!name) return;
    if (types.some((t) => t.name.toLowerCase() === name.toLowerCase())) return;
    upsert.mutate({ name, is_builtin: false, notes: null });
    setAdding('');
  }

  function commitRename(from: string) {
    const to = renameDraft.trim();
    setRenaming(null);
    if (!to || to === from) return;
    rename.mutate({ from, to });
  }

  if (typesQ.isLoading || permitsQ.isLoading || cfgQ.isLoading) {
    return <div className="text-[11px] text-dim italic">Loading permit types…</div>;
  }

  return (
    <div data-testid="permit-type-editor">
      <p className="text-[11px] text-muted mb-3">
        The permit types offered by the project wizard. The description shows
        under each type on the questionnaire step — editing it here changes the
        wizard immediately, with no deploy.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[560px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-dim border-b border-border">
              <th className="text-left py-1.5 font-display font-bold">Type</th>
              <th className="text-right py-1.5 font-display font-bold w-20">
                Permits
              </th>
              <th className="text-left py-1.5 font-display font-bold">
                Wizard description
              </th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {types.map((t) => {
              const used = usageByType.get(t.name) ?? 0;
              return (
                <tr
                  key={t.name}
                  className="border-b border-border/40 align-top"
                  data-testid={`permit-type-row-${t.name}`}
                >
                  <td className="py-1.5 pr-2">
                    {renaming === t.name ? (
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => commitRename(t.name)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                        className="w-full px-1 py-0.5 text-xs border border-de rounded bg-bg text-text outline-none"
                        data-testid={`permit-type-rename-input-${t.name}`}
                      />
                    ) : (
                      <span className="font-semibold text-text">{t.name}</span>
                    )}
                    {t.is_builtin && (
                      <span
                        className="ml-1.5 text-[9px] uppercase tracking-wide text-muted"
                        data-testid={`permit-type-builtin-${t.name}`}
                      >
                        built-in
                      </span>
                    )}
                  </td>
                  <td
                    className="py-1.5 text-right font-mono text-muted"
                    data-testid={`permit-type-usage-${t.name}`}
                  >
                    {used}
                  </td>
                  <td className="py-1.5 pr-2">
                    <DescriptionInput
                      type={t.name}
                      value={descriptions[t.name] ?? ''}
                      readOnly={readOnly}
                      onCommit={(text) => saveDescription(t.name, text)}
                    />
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    {!readOnly && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setRenameDraft(t.name);
                            setRenaming(t.name);
                          }}
                          className="text-[10px] font-bold text-de hover:underline mr-2"
                          data-testid={`permit-type-rename-${t.name}`}
                        >
                          Rename
                        </button>
                        <DeleteControl
                          type={t.name}
                          used={used}
                          confirming={confirmingDelete === t.name}
                          onAsk={() => setConfirmingDelete(t.name)}
                          onCancel={() => setConfirmingDelete(null)}
                          onConfirm={() => {
                            remove.mutate({ name: t.name });
                            setConfirmingDelete(null);
                          }}
                        />
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="flex items-center gap-2 mt-3">
          <input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitAdd();
            }}
            placeholder="Add permit type…"
            className="px-2 py-1 text-xs border border-border rounded bg-bg text-text outline-none focus:border-de"
            data-testid="permit-type-add-input"
          />
          <button
            type="button"
            onClick={commitAdd}
            disabled={!adding.trim()}
            className="px-2.5 py-1 text-[11px] font-bold rounded border border-de bg-de text-white disabled:opacity-40"
            data-testid="permit-type-add"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

/** Buffered so a description is saved once on blur, not once per keystroke —
 *  the same reason the jurisdiction learn-window input buffers. */
function DescriptionInput({
  type,
  value,
  readOnly,
  onCommit,
}: {
  type: string;
  value: string;
  readOnly: boolean;
  onCommit: (text: string) => void;
}) {
  const [local, setLocal] = useState(value);
  const [focused, setFocused] = useState(false);
  // Follow the server value while not being edited, so another admin's change
  // (or a rename) is not masked by a stale local draft.
  const shown = focused ? local : value;

  return (
    <input
      value={shown}
      onFocus={() => {
        setLocal(value);
        setFocused(true);
      }}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        setFocused(false);
        if (local.trim() !== value.trim()) onCommit(local);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      disabled={readOnly}
      placeholder="No description"
      className="w-full px-1 py-0.5 text-[11px] border border-border rounded bg-bg text-text outline-none focus:border-de disabled:opacity-60"
      data-testid={`permit-type-desc-${type}`}
    />
  );
}

/**
 * ★ The guard the ticket is really about.
 *
 * A type still named by permits cannot be deleted — not "warned about", not
 * "confirmed": the button is disabled and says how many permits are in the way,
 * because permits.type is a plain string and nothing downstream would complain.
 * An unused type is deletable, and still asks first.
 */
function DeleteControl({
  type,
  used,
  confirming,
  onAsk,
  onCancel,
  onConfirm,
}: {
  type: string;
  used: number;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (used > 0) {
    return (
      <span
        className="text-[10px] text-dim"
        title={`${used} permit${used === 1 ? '' : 's'} still use this type. Rename it instead, or change those permits first.`}
        data-testid={`permit-type-delete-blocked-${type}`}
      >
        in use
      </span>
    );
  }
  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={onConfirm}
          className="text-[10px] font-bold text-co hover:underline"
          data-testid={`permit-type-delete-confirm-${type}`}
        >
          Remove?
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[10px] text-dim hover:underline"
          data-testid={`permit-type-delete-cancel-${type}`}
        >
          Cancel
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onAsk}
      className="text-[10px] font-bold text-co hover:underline"
      data-testid={`permit-type-delete-${type}`}
    >
      Remove
    </button>
  );
}
