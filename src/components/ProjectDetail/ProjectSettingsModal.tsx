import { useState, useEffect } from 'react';
import { useUpdateProject } from '../../hooks/useUpdateProject';
import { useBuilders } from '../../hooks/useBuilders';
import { useJurisdictions } from '../../hooks/useJurisdictions';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { pushToast } from '../../stores/toastStore';
import type { Project } from '../../lib/database.types';

// Q9.5.f-fix-16 D: per-project info editor — v1's project settings popup
// (index.html:773-850 equivalent). Edits Address / Jurisdiction / ACQ Lead /
// Builder / Notes / Archived. Save goes through useUpdateProject with OCC
// token (expectedUpdatedAt = project.updated_at). Cancel discards local
// edits; the modal is the canonical write-on-Save flow (no per-field
// debounce here).

interface Props {
  project: Project;
  onClose: () => void;
}

interface FormState {
  address: string;
  juris: string;
  acq_lead: string;
  builder_id: string;
  notes: string;
  archived: boolean;
}

function initForm(project: Project): FormState {
  return {
    address: project.address ?? '',
    juris: project.juris ?? '',
    acq_lead: project.acq_lead ?? '',
    builder_id: project.builder_id ?? '',
    notes: project.notes ?? '',
    archived: !!project.archived,
  };
}

export default function ProjectSettingsModal({ project, onClose }: Props) {
  const [form, setForm] = useState<FormState>(() => initForm(project));
  const updateProject = useUpdateProject();
  const buildersQ = useBuilders();
  const jurisdictionsQ = useJurisdictions();
  const teamQ = useTeamMembers();

  // Re-init form if the project changes underneath us (rare; e.g. realtime
  // refetch after another writer touched the row).
  useEffect(() => {
    setForm(initForm(project));
  }, [project.id, project.updated_at]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    if (!project.updated_at) return;
    if (!form.address.trim()) {
      pushToast('Address is required.', 'warn');
      return;
    }
    const patch: Partial<Project> = {
      address: form.address.trim(),
      juris: form.juris.trim() || null,
      acq_lead: form.acq_lead.trim() || null,
      builder_id: form.builder_id || null,
      notes: form.notes,
      archived: form.archived,
    };
    try {
      await updateProject.mutateAsync({
        projectId: project.id,
        expectedUpdatedAt: project.updated_at,
        patch,
        fieldLabel: 'Project Settings',
      });
      pushToast('Project settings saved.', 'success');
      onClose();
    } catch {
      // useUpdateProject onError already toasted.
    }
  }

  const builders = buildersQ.data ?? [];
  const jurisdictions = jurisdictionsQ.data ?? [];
  const team = teamQ.data ?? [];
  const acqMembers = team.filter((t) => t.role === 'acq' && t.active !== false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
      data-testid="project-settings-modal"
    >
      <div
        className="rounded-lg shadow-xl w-[520px] max-h-[90vh] overflow-hidden flex flex-col"
        style={{ background: 'var(--color-surface)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="px-4 py-2 border-b flex items-center justify-between"
          style={{
            background: 'var(--color-s2)',
            borderBottomColor: 'var(--color-border)',
          }}
        >
          <span className="text-[12px] font-extrabold uppercase tracking-wider text-text">
            Project Settings
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-dim hover:text-text text-[14px] leading-none"
            title="Close"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
          <Field label="Address">
            <input
              type="text"
              value={form.address}
              onChange={(e) => update('address', e.target.value)}
              className="w-full px-2 py-1 text-[12px] border rounded"
              style={{
                background: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)',
              }}
              data-testid="psm-address"
            />
          </Field>

          <Field label="Jurisdiction">
            <input
              type="text"
              list="psm-juris-options"
              value={form.juris}
              onChange={(e) => update('juris', e.target.value)}
              className="w-full px-2 py-1 text-[12px] border rounded"
              style={{
                background: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)',
              }}
              data-testid="psm-juris"
            />
            <datalist id="psm-juris-options">
              {jurisdictions.map((j) => (
                <option key={j.name} value={j.name} />
              ))}
            </datalist>
          </Field>

          <Field label="ACQ Lead">
            <input
              type="text"
              list="psm-acq-options"
              value={form.acq_lead}
              onChange={(e) => update('acq_lead', e.target.value)}
              className="w-full px-2 py-1 text-[12px] border rounded"
              style={{
                background: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)',
              }}
              data-testid="psm-acq"
            />
            <datalist id="psm-acq-options">
              {acqMembers.map((m) => (
                <option key={m.id} value={m.name} />
              ))}
            </datalist>
          </Field>

          <Field label="Builder / Owner">
            <select
              value={form.builder_id}
              onChange={(e) => update('builder_id', e.target.value)}
              className="w-full px-2 py-1 text-[12px] border rounded"
              style={{
                background: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)',
              }}
              data-testid="psm-builder"
            >
              <option value="">— None —</option>
              {builders.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.company ? ` (${b.company})` : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              rows={4}
              className="w-full px-2 py-1 text-[12px] border rounded resize-y"
              style={{
                background: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)',
              }}
              data-testid="psm-notes"
            />
          </Field>

          <label className="flex items-center gap-2 text-[12px] text-text cursor-pointer mt-1">
            <input
              type="checkbox"
              checked={form.archived}
              onChange={(e) => update('archived', e.target.checked)}
              data-testid="psm-archived"
            />
            <span>Archived (hide from active project lists)</span>
          </label>
        </div>

        <footer
          className="px-4 py-2 border-t flex items-center justify-end gap-2"
          style={{
            background: 'var(--color-s2)',
            borderTopColor: 'var(--color-border)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-[11px] font-bold uppercase tracking-wide rounded border"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-text)',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={updateProject.isPending}
            className="px-3 py-1 text-[11px] font-bold uppercase tracking-wide rounded border disabled:opacity-50"
            style={{
              borderColor: 'var(--color-pm)',
              background: 'var(--color-pm)',
              color: 'white',
            }}
            data-testid="psm-save"
          >
            {updateProject.isPending ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className="text-[9px] font-bold uppercase tracking-wide"
        style={{ color: 'var(--color-dim)' }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}
