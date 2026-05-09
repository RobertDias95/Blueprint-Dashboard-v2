import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useCreateProjectWithPermits,
  type PermitInput,
} from '../hooks/useCreateProjectWithPermits';

// Q5: Modal wizard for atomic project creation. Replaces v1's saveProject
// (line 6489-6539 of Blueprint-Dashboard-/index.html) with a single
// transactional RPC call. Validation matches v1: address required, at
// least one permit row required, each permit row must have a type.
//
// Modal lifecycle is owned by the parent (Dashboard / ProjectList). When
// the user hits Cancel or completes successfully, parent closes via
// onClose. Conflict path keeps the modal open and surfaces an inline
// "view existing project?" prompt — no auto-navigate.

const JURISDICTIONS = [
  'Seattle',
  'Bellevue',
  'Kirkland',
  'Edmonds',
  'Bothell',
  'Shoreline',
  'Mercer Island',
  'Newcastle',
  'Issaquah',
  'Sammamish',
  'Mill Creek',
  'Burien',
  'Snoqualmie',
  'Auburn',
  'Kenmore',
  'Federal Way',
  'Phoenix',
  'Redmond',
] as const;

const PERMIT_TYPES = [
  'Building Permit',
  'Demolition',
  'ECA Waiver',
  'Grading / Clearing',
  'IPR',
  'LBA',
  'LSM',
  'PAR/Pre-Sub',
  'PPR',
  'Short Plat',
  'SIP',
  'TRAO',
  'ULS',
] as const;

interface PermitRow extends PermitInput {
  /** Stable key for React list rendering — never sent to the server. */
  _rowId: number;
}

let _nextRowId = 1;
function newRow(): PermitRow {
  return { _rowId: _nextRowId++, type: PERMIT_TYPES[0] };
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function NewProjectWizard({ open, onClose }: Props) {
  const navigate = useNavigate();
  const create = useCreateProjectWithPermits();

  const [address, setAddress] = useState('');
  const [juris, setJuris] = useState<string>(JURISDICTIONS[0]);
  const [notes, setNotes] = useState('');
  const [permits, setPermits] = useState<PermitRow[]>([newRow()]);
  const [validationErr, setValidationErr] = useState<string | null>(null);
  const [conflictExistingId, setConflictExistingId] = useState<string | null>(
    null,
  );

  function reset() {
    setAddress('');
    setJuris(JURISDICTIONS[0]);
    setNotes('');
    setPermits([newRow()]);
    setValidationErr(null);
    setConflictExistingId(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function updatePermit(rowId: number, patch: Partial<PermitRow>) {
    setPermits((rows) =>
      rows.map((r) => (r._rowId === rowId ? { ...r, ...patch } : r)),
    );
  }

  function addPermitRow() {
    setPermits((rows) => [...rows, newRow()]);
  }

  function removePermitRow(rowId: number) {
    setPermits((rows) => rows.filter((r) => r._rowId !== rowId));
  }

  async function handleSubmit() {
    setValidationErr(null);
    setConflictExistingId(null);

    const trimmedAddress = address.trim();
    if (!trimmedAddress) {
      setValidationErr('Please enter a project address.');
      return;
    }
    if (permits.length === 0) {
      setValidationErr('Please add at least one permit type.');
      return;
    }
    for (const p of permits) {
      if (!p.type || !p.type.trim()) {
        setValidationErr('Every permit row needs a type.');
        return;
      }
    }

    try {
      const result = await create.mutateAsync({
        address: trimmedAddress,
        juris,
        notes: notes.trim() || undefined,
        permits: permits.map((p) => {
          const { _rowId, ...rest } = p;
          void _rowId;
          return rest;
        }),
      });

      if (result.conflict) {
        setConflictExistingId(result.project_id);
        return;
      }

      navigate(`/project/${result.project_id}`);
      reset();
      onClose();
    } catch {
      // Toast already pushed by the hook's onError. Keep modal open with
      // form data intact so the user can retry.
    }
  }

  function handleViewExisting() {
    if (conflictExistingId) {
      navigate(`/project/${conflictExistingId}`);
      reset();
      onClose();
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9000] flex items-start justify-center pt-12 pb-12 px-4 bg-black/40 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-title"
      data-testid="new-project-wizard"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="bg-surface border border-border rounded-xl shadow-xl w-full max-w-3xl">
        <header className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2
            id="wizard-title"
            className="text-sm font-display font-extrabold uppercase tracking-wide text-text"
          >
            Add New Project
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="text-dim hover:text-text text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="px-5 py-4 space-y-4">
          {validationErr && (
            <div className="text-[12px] text-co bg-co-bg/40 border border-co-border rounded-md px-3 py-2">
              {validationErr}
            </div>
          )}

          {conflictExistingId && (
            <div className="text-[12px] text-jv bg-jv-bg/40 border border-jv-border rounded-md px-3 py-3 flex items-center justify-between gap-3">
              <span>This address already exists in the system.</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleViewExisting}
                  className="text-[11px] px-2.5 py-1 rounded-md border border-jv-border bg-surface text-jv font-semibold hover:bg-jv-bg/60 transition"
                  data-testid="wizard-view-existing"
                >
                  View existing project
                </button>
                <button
                  type="button"
                  onClick={() => setConflictExistingId(null)}
                  className="text-[11px] px-2.5 py-1 rounded-md border border-border bg-bg text-muted hover:bg-s2 transition"
                >
                  Pick a different address
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-dim">
                Address
              </span>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Main St"
                className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de"
                data-testid="wizard-address"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-dim">
                Jurisdiction
              </span>
              <select
                value={juris}
                onChange={(e) => setJuris(e.target.value)}
                className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text focus:outline-none focus:border-de"
                data-testid="wizard-juris"
              >
                {JURISDICTIONS.map((j) => (
                  <option key={j} value={j}>
                    {j}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Notes (optional)
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de resize-none"
              data-testid="wizard-notes"
            />
          </label>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wide text-dim">
                Permits ({permits.length})
              </span>
              <button
                type="button"
                onClick={addPermitRow}
                className="text-[11px] px-2 py-0.5 rounded border border-border bg-s2 hover:bg-s3 text-text transition"
                data-testid="wizard-add-permit"
              >
                + Add another permit type
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {permits.map((permit) => (
                <div
                  key={permit._rowId}
                  className="border border-border rounded-md bg-bg/40 p-3 grid grid-cols-1 md:grid-cols-4 gap-2"
                  data-testid={`wizard-permit-row-${permit._rowId}`}
                >
                  <label className="flex flex-col gap-0.5 md:col-span-2">
                    <span className="text-[9px] uppercase tracking-wide text-dim">
                      Type
                    </span>
                    <select
                      value={permit.type}
                      onChange={(e) =>
                        updatePermit(permit._rowId, { type: e.target.value })
                      }
                      className="bg-surface border border-border rounded-md px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-de"
                      data-testid={`wizard-permit-type-${permit._rowId}`}
                    >
                      {PERMIT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase tracking-wide text-dim">
                      Permit #
                    </span>
                    <input
                      type="text"
                      value={permit.num ?? ''}
                      onChange={(e) =>
                        updatePermit(permit._rowId, { num: e.target.value })
                      }
                      placeholder="optional"
                      className="bg-surface border border-border rounded-md px-2 py-1 text-xs font-mono text-text placeholder:text-dim focus:outline-none focus:border-de"
                    />
                  </label>

                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => removePermitRow(permit._rowId)}
                      className="text-co hover:text-co/70 text-base px-1"
                      title="Remove permit row"
                      data-testid={`wizard-remove-permit-${permit._rowId}`}
                    >
                      ×
                    </button>
                  </div>

                  <label className="flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase tracking-wide text-dim">
                      DA
                    </span>
                    <input
                      type="text"
                      value={permit.da ?? ''}
                      onChange={(e) =>
                        updatePermit(permit._rowId, { da: e.target.value })
                      }
                      className="bg-surface border border-border rounded-md px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-de"
                    />
                  </label>

                  <label className="flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase tracking-wide text-dim">
                      DM
                    </span>
                    <input
                      type="text"
                      value={permit.dm ?? ''}
                      onChange={(e) =>
                        updatePermit(permit._rowId, { dm: e.target.value })
                      }
                      className="bg-surface border border-border rounded-md px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-de"
                    />
                  </label>

                  <label className="flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase tracking-wide text-dim">
                      ENT Lead
                    </span>
                    <input
                      type="text"
                      value={permit.ent_lead ?? ''}
                      onChange={(e) =>
                        updatePermit(permit._rowId, {
                          ent_lead: e.target.value,
                        })
                      }
                      className="bg-surface border border-border rounded-md px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-de"
                    />
                  </label>

                  <label className="flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase tracking-wide text-dim">
                      Kickoff
                    </span>
                    <input
                      type="date"
                      value={permit.kickoff_date ?? ''}
                      onChange={(e) =>
                        updatePermit(permit._rowId, {
                          kickoff_date: e.target.value,
                        })
                      }
                      className="bg-surface border border-border rounded-md px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-de"
                    />
                  </label>

                  <label className="flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase tracking-wide text-dim">
                      Target Submit
                    </span>
                    <input
                      type="date"
                      value={permit.target_submit ?? ''}
                      onChange={(e) =>
                        updatePermit(permit._rowId, {
                          target_submit: e.target.value,
                        })
                      }
                      className="bg-surface border border-border rounded-md px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-de"
                    />
                  </label>

                  <label className="flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase tracking-wide text-dim">
                      DD Start
                    </span>
                    <input
                      type="date"
                      value={permit.dd_start ?? ''}
                      onChange={(e) =>
                        updatePermit(permit._rowId, {
                          dd_start: e.target.value,
                        })
                      }
                      className="bg-surface border border-border rounded-md px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-de"
                    />
                  </label>

                  <label className="flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase tracking-wide text-dim">
                      DD End
                    </span>
                    <input
                      type="date"
                      value={permit.dd_end ?? ''}
                      onChange={(e) =>
                        updatePermit(permit._rowId, {
                          dd_end: e.target.value,
                        })
                      }
                      className="bg-surface border border-border rounded-md px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-de"
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-s2/60">
          <button
            type="button"
            onClick={handleClose}
            className="text-xs px-3 py-1.5 rounded-md border border-border bg-surface text-text hover:bg-s2 transition"
            data-testid="wizard-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={create.isPending}
            className="text-xs px-3 py-1.5 rounded-md bg-de text-white font-display font-bold hover:opacity-90 disabled:opacity-50 transition"
            data-testid="wizard-save"
          >
            {create.isPending ? 'Saving…' : '✓ Create Project'}
          </button>
        </footer>
      </div>
    </div>
  );
}
