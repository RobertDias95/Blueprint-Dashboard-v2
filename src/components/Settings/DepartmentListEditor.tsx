import { useMemo, useState } from 'react';
import {
  useDeleteDepartment,
  useReorderDepartments,
  useUpsertDepartment,
  type DepartmentRow,
} from '../../hooks/useDepartments';
import type { TeamMember } from '../../lib/database.types';
import { moveKey, peopleByDepartment } from '../../lib/departmentList';

// ===========================================================================
// ★★★ fix-670 §A (P-351) — THE DEPARTMENT LIST, EDITABLE
// ===========================================================================
//
// Bobby: *"other departments need access to this to view our work… so i need
// to be able to add their departments, so their labels are accurate to their
// roles in the company."*
//
// ★★ WHAT EACH ACTION MAY TOUCH:
//   - Add: the key is made from the label by the server (a unique slug) and
//     never changes again.
//   - Rename: the LABEL only. `team_members.department` joins on the key, so
//     a rename moves nobody and every name plate follows at once.
//   - Reorder: the order every picker offers.
//   - Delete: only while nobody is in it. The button says why when it can't.
//
// The database is the gate (admin-only RLS + the RPCs refuse a non-admin);
// `readOnly` only hides the controls, as everywhere else on this tab.

export default function DepartmentListEditor({
  departments,
  members,
  readOnly,
}: {
  departments: readonly DepartmentRow[];
  members: readonly TeamMember[];
  readOnly: boolean;
}) {
  const upsert = useUpsertDepartment();
  const reorder = useReorderDepartments();
  const remove = useDeleteDepartment();
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState<{ key: string; label: string } | null>(null);
  const counts = useMemo(() => peopleByDepartment(members), [members]);
  const keys = departments.map((d) => d.key);
  const busy = upsert.isPending || reorder.isPending || remove.isPending;

  function add() {
    const label = draft.trim();
    if (!label) return;
    upsert.mutate({ key: null, label }, { onSuccess: () => setDraft('') });
  }

  function commitRename() {
    if (!renaming) return;
    const label = renaming.label.trim();
    const was = departments.find((d) => d.key === renaming.key)?.label;
    setRenaming(null);
    if (label && label !== was) upsert.mutate({ key: renaming.key, label });
  }

  return (
    <div className="flex flex-col gap-2" data-testid="department-list-editor">
      <p className="text-[11px] text-muted leading-relaxed">
        The departments people can belong to. A department is{' '}
        <strong>not a permission</strong>; for someone who views the Bridge it is
        the label on their name plate. Renaming changes the words everywhere and
        moves nobody.
      </p>
      <ul className="flex flex-col gap-1">
        {departments.map((d, i) => {
          const n = counts.get(d.key) ?? 0;
          const isRenaming = renaming?.key === d.key;
          return (
            <li
              key={d.key}
              className="rounded border px-2.5 py-1.5 flex items-center gap-2 text-[12px]"
              style={{ borderColor: 'var(--color-border)' }}
              data-testid={`department-list-row-${d.key}`}
            >
              {isRenaming ? (
                <input
                  autoFocus
                  value={renaming.label}
                  onChange={(e) => setRenaming({ key: d.key, label: e.target.value })}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  className="text-[12px] border border-de rounded px-1.5 py-0.5 bg-bg flex-1"
                  data-testid={`department-list-rename-input-${d.key}`}
                />
              ) : (
                <span className="font-semibold text-text flex-1">{d.label}</span>
              )}
              <span
                className="text-[10px] text-muted tabular-nums"
                data-testid={`department-list-count-${d.key}`}
              >
                {n === 1 ? '1 person' : `${n} people`}
              </span>
              {!readOnly && (
                <>
                  <button
                    type="button"
                    disabled={busy || i === 0}
                    onClick={() => reorder.mutate(moveKey(keys, d.key, -1))}
                    className="text-[11px] px-1 text-muted hover:text-text disabled:opacity-30"
                    aria-label={`Move ${d.label} up`}
                    data-testid={`department-list-up-${d.key}`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={busy || i === departments.length - 1}
                    onClick={() => reorder.mutate(moveKey(keys, d.key, 1))}
                    className="text-[11px] px-1 text-muted hover:text-text disabled:opacity-30"
                    aria-label={`Move ${d.label} down`}
                    data-testid={`department-list-down-${d.key}`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setRenaming({ key: d.key, label: d.label })}
                    className="text-[11px] px-1.5 text-de hover:underline disabled:opacity-30"
                    data-testid={`department-list-rename-${d.key}`}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    disabled={busy || n > 0}
                    onClick={() => remove.mutate(d.key)}
                    // ★ A disabled button that cannot say why reads as broken.
                    title={
                      n > 0
                        ? `${n === 1 ? '1 person is' : `${n} people are`} in ${d.label}. Move them to another department first.`
                        : `Delete ${d.label}`
                    }
                    className="text-[11px] px-1.5 text-er hover:underline disabled:opacity-30 disabled:no-underline"
                    data-testid={`department-list-delete-${d.key}`}
                  >
                    Delete
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {!readOnly && (
        <div className="flex gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder="Add a department…"
            className="flex-1 px-2.5 py-1 text-xs border border-border rounded bg-bg text-text outline-none focus:border-de"
            data-testid="department-list-add"
          />
          <button
            type="button"
            onClick={add}
            disabled={busy || draft.trim() === ''}
            className="px-3 py-1 text-xs font-display font-semibold bg-de text-white rounded border border-de disabled:opacity-50"
            data-testid="department-list-add-btn"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
