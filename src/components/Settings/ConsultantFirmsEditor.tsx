import { useState } from 'react';
import {
  useConsultantFirms,
  useUpsertConsultantFirm,
  useArchiveConsultantFirm,
} from '../../hooks/useConsultantFirms';
import { useIsTenantAdmin } from '../../hooks/useIsTenantAdmin';
import {
  WAITING_ON_OPTIONS,
  type ConsultantFirm,
  type WaitingOnDiscipline,
} from '../../lib/database.types';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';

// fix-139: Settings → Consultant Firms. The NEW table-backed firms list
// (consultant_firms) that feeds the project External Team panel keyed by
// WAITING_ON_OPTIONS disciplines. Lives alongside the legacy
// app_config.consultantTypes JSONB editor (AdminConsultantsTab) — that older
// editor drives the separate projects.external_team JSON map and is untouched
// here.
//
// Inline add/edit form (matches the rest of the Settings tabs, which use
// inline inputs rather than modals). Archive is a soft-delete via the RPC with
// an inline confirm.

interface FormState {
  /** null = no form open; '' = adding new; otherwise the firm id being edited. */
  editing: string | null | '';
  name: string;
  discipline: WaitingOnDiscipline | '';
  notes: string;
}

const EMPTY_FORM: FormState = {
  editing: null,
  name: '',
  discipline: '',
  notes: '',
};

export default function ConsultantFirmsEditor() {
  const isAdmin = useIsTenantAdmin();
  const [showInactive, setShowInactive] = useState(false);
  const firmsQ = useConsultantFirms({ includeInactive: showInactive });
  const upsert = useUpsertConsultantFirm();
  const archive = useArchiveConsultantFirm();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [confirmingArchive, setConfirmingArchive] = useState<string | null>(
    null,
  );

  const firms = firmsQ.data ?? [];

  function openAdd() {
    setForm({ editing: '', name: '', discipline: '', notes: '' });
  }
  function openEdit(firm: ConsultantFirm) {
    setForm({
      editing: firm.id,
      name: firm.name,
      discipline: firm.discipline,
      notes: firm.notes ?? '',
    });
  }
  function closeForm() {
    setForm(EMPTY_FORM);
  }

  function submitForm() {
    if (!form.name.trim() || !form.discipline) return;
    if (form.editing === '') {
      upsert.mutate(
        {
          op: 'insert',
          patch: {
            name: form.name.trim(),
            discipline: form.discipline,
            notes: form.notes.trim() || null,
          },
        },
        { onSuccess: closeForm },
      );
    } else {
      const firm = firms.find((f) => f.id === form.editing);
      if (!firm) return;
      upsert.mutate(
        {
          op: 'update',
          firm,
          patch: {
            name: form.name.trim(),
            discipline: form.discipline,
            notes: form.notes.trim() || null,
          },
        },
        { onSuccess: closeForm },
      );
    }
  }

  function toggleActive(firm: ConsultantFirm) {
    upsert.mutate({ op: 'update', firm, patch: { active: !firm.active } });
  }

  if (firmsQ.error) {
    return (
      <QueryError
        title="Consultant firms failed to load"
        error={firmsQ.error}
        onRetry={() => firmsQ.refetch()}
      />
    );
  }

  return (
    <div
      className="bg-surface border border-border rounded-lg p-4"
      data-testid="settings-consultant-firms-section"
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <h2 className="text-sm font-display font-bold text-text">
            Consultant Firms
          </h2>
          <p className="text-[11px] text-muted">
            External consultant firms your projects assign to disciplines.
          </p>
        </div>
        <label className="flex items-center gap-1 text-[10px] text-muted whitespace-nowrap mt-0.5">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            data-testid="settings-firm-show-inactive"
          />
          Show inactive
        </label>
      </div>

      {!isAdmin && (
        <div className="bg-surface-2 border border-border rounded px-3 py-2 text-[11px] text-muted mb-3">
          Read-only — you need tenant admin to manage consultant firms.
        </div>
      )}

      {firmsQ.isLoading ? (
        <SkeletonRows count={3} rowClassName="h-8" />
      ) : firms.length === 0 && form.editing === null ? (
        <div
          className="text-xs text-dim italic px-3 py-4 bg-surface-2 border border-border rounded text-center"
          data-testid="settings-consultant-firms-empty"
        >
          No consultant firms yet. Add one to start assigning them to project
          disciplines.
        </div>
      ) : (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-[9px] uppercase tracking-wide text-dim font-display font-bold text-left">
              <th className="py-1">Name</th>
              <th className="py-1">Discipline</th>
              <th className="py-1">Active</th>
              <th className="py-1">Notes</th>
              <th className="py-1 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {firms.map((firm) => (
              <tr
                key={firm.id}
                className="border-t border-border align-top"
                data-testid={`settings-firm-row-${firm.id}`}
              >
                <td className="py-1.5 font-display font-bold text-text">
                  {firm.name}
                </td>
                <td className="py-1.5 text-text">{firm.discipline}</td>
                <td className="py-1.5">
                  <input
                    type="checkbox"
                    checked={firm.active}
                    disabled={!isAdmin}
                    onChange={() => toggleActive(firm)}
                    data-testid={`settings-firm-active-${firm.id}`}
                    aria-label={`${firm.name} active`}
                  />
                </td>
                <td
                  className="py-1.5 text-muted max-w-[160px] truncate"
                  title={firm.notes ?? ''}
                >
                  {firm.notes ?? ''}
                </td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  {isAdmin &&
                    (confirmingArchive === firm.id ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="text-co">Archive?</span>
                        <button
                          onClick={() => {
                            archive.mutate(firm, {
                              onSuccess: () => setConfirmingArchive(null),
                            });
                          }}
                          className="px-1.5 py-0.5 rounded border border-co-border bg-co-bg text-co"
                          data-testid={`settings-firm-archive-confirm-${firm.id}`}
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmingArchive(null)}
                          className="px-1.5 py-0.5 rounded border border-border"
                          data-testid={`settings-firm-archive-cancel-${firm.id}`}
                        >
                          No
                        </button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <button
                          onClick={() => openEdit(firm)}
                          className="text-dim hover:text-text"
                          title="Edit firm"
                          data-testid={`settings-firm-edit-${firm.id}`}
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => setConfirmingArchive(firm.id)}
                          className="text-dim hover:text-co"
                          title="Archive firm"
                          data-testid={`settings-firm-archive-${firm.id}`}
                        >
                          🗑
                        </button>
                      </span>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Inline add/edit form */}
      {form.editing !== null ? (
        <div
          className="mt-3 bg-surface-2 border border-border rounded-lg p-3 space-y-2"
          data-testid="settings-firm-form"
        >
          <div className="text-[10px] font-bold uppercase tracking-wide text-dim">
            {form.editing === '' ? 'Add Firm' : 'Edit Firm'}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[9px] uppercase tracking-wide text-dim">
                Name
              </span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="px-2 py-1 text-xs border border-border rounded bg-bg text-text outline-none focus:border-de"
                data-testid="settings-firm-form-name"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[9px] uppercase tracking-wide text-dim">
                Discipline
              </span>
              <select
                value={form.discipline}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    discipline: e.target.value as WaitingOnDiscipline | '',
                  }))
                }
                className="px-2 py-1 text-xs border border-border rounded bg-bg text-text outline-none focus:border-de"
                data-testid="settings-firm-form-discipline"
              >
                <option value="">— select —</option>
                {WAITING_ON_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-wide text-dim">
              Notes
            </span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="px-2 py-1 text-xs border border-border rounded bg-bg text-text outline-none focus:border-de resize-none"
              data-testid="settings-firm-form-notes"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              onClick={closeForm}
              className="px-3 py-1 text-xs font-display font-semibold border border-border rounded"
              data-testid="settings-firm-form-cancel"
            >
              Cancel
            </button>
            <button
              onClick={submitForm}
              disabled={!form.name.trim() || !form.discipline || upsert.isPending}
              className="px-3 py-1 text-xs font-display font-semibold bg-de text-white rounded border border-de disabled:opacity-50"
              data-testid="settings-firm-form-save"
            >
              {form.editing === '' ? 'Add Firm' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        isAdmin && (
          <button
            onClick={openAdd}
            className="mt-3 px-3 py-1 text-xs font-display font-semibold bg-de text-white rounded border border-de hover:bg-de/90"
            data-testid="settings-firm-add-button"
          >
            + Add firm
          </button>
        )
      )}
    </div>
  );
}
