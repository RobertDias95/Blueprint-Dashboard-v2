import { useState, useEffect, useCallback } from 'react';
import { useUpdatePermit } from '../../hooks/useUpdatePermit';
import { usePermitTypes } from '../../hooks/usePermitTypes';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { pushToast } from '../../stores/toastStore';
import { supabase } from '../../lib/supabase';
import type {
  Permit,
  PermitWithCycles,
  TaskNode,
} from '../../lib/database.types';

// Q9.5.f-fix-19: v1 Quick Edit Permit popup (index.html:1325-1355). Opens on
// double-click of a permit sidebar row. Edits the 5 most-touched fields
// without leaving the project view. All other permit fields stay editable
// via PermitDetailV2 / ProjectSettingsModal.

interface Props {
  permit: PermitWithCycles;
  onClose: () => void;
}

interface FormState {
  type: string;
  ent_lead: string;
  da: string;
  num: string;
  struct_address: string;
  portal_url: string;
}

function initForm(permit: PermitWithCycles): FormState {
  return {
    type: permit.type ?? '',
    ent_lead: permit.ent_lead ?? '',
    da: permit.da ?? '',
    num: permit.num ?? '',
    struct_address: permit.struct_address ?? '',
    portal_url: permit.portal_url ?? '',
  };
}

function diff(original: FormState, current: FormState): Partial<Permit> {
  const out: Partial<Permit> = {};
  if (current.type !== original.type) out.type = current.type;
  if (current.ent_lead !== original.ent_lead) out.ent_lead = current.ent_lead.trim() || null;
  if (current.da !== original.da) out.da = current.da.trim() || null;
  if (current.num !== original.num) out.num = current.num.trim() || null;
  if (current.struct_address !== original.struct_address)
    out.struct_address = current.struct_address.trim() || null;
  if (current.portal_url !== original.portal_url)
    out.portal_url = current.portal_url.trim() || null;
  return out;
}

export default function QuickEditPermitModal({ permit, onClose }: Props) {
  const [original, setOriginal] = useState<FormState>(() => initForm(permit));
  const [form, setForm] = useState<FormState>(() => initForm(permit));
  const updatePermit = useUpdatePermit();
  const permitTypesQ = usePermitTypes();
  const teamQ = useTeamMembers();

  useEffect(() => {
    const next = initForm(permit);
    // Permit-prop sync: rebuild form drafts when the modal opens on a
    // different permit or upstream data updates. eslint complains about
    // setState-in-effect but the form is intentionally controlled by
    // the permit prop here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOriginal(next);
    setForm(next);
  }, [permit.id, permit.updated_at]);

  // ESC to close — matches v1's overlay-click-closes behavior.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSave = useCallback(async () => {
    if (!permit.updated_at) return;
    const patch = diff(original, form);
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    try {
      await updatePermit.mutateAsync({
        permitId: permit.id,
        projectId: permit.project_id,
        expectedUpdatedAt: permit.updated_at,
        patch,
        fieldLabel: 'Permit',
      });
      pushToast('Permit updated.', 'success');
      // fix-155: when a number is newly entered, surface (don't auto-complete)
      // any open number_entry auto-task for this permit. The system suggests;
      // the human verifies the submission and closes the task — that's the
      // accountability contract.
      if (typeof patch.num === 'string' && patch.num && !original.num) {
        void (async () => {
          const { data, error } = await supabase.rpc('bp_list_permit_tasks', {
            p_permit_id: permit.id,
          });
          if (error || !Array.isArray(data)) return;
          const openNumberEntry = (data as TaskNode[]).some(
            (t) => t.auto_event === 'number_entry' && t.status !== 'Resolved',
          );
          if (openNumberEntry) {
            pushToast(
              'Number added — an "Enter permit number" task is still open for this permit. Verify the submission, then close it in My Tasks.',
              'info',
            );
          }
        })();
      }
      onClose();
    } catch {
      // useUpdatePermit's onError already surfaces the OCC / network error.
    }
  }, [original, form, permit, updatePermit, onClose]);

  const team = teamQ.data ?? [];
  const entOptions = team
    .filter((t) => t.role === 'ent' && t.active !== false)
    .map((t) => t.name);
  const daOptions = team
    .filter((t) => t.role === 'da' && t.active !== false)
    .map((t) => t.name);
  const permitTypes = (permitTypesQ.data ?? []).map((t) => t.name);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
      data-testid="quick-edit-permit-modal"
    >
      <div
        className="rounded-lg shadow-xl w-[440px] overflow-hidden flex flex-col"
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
            Quick Edit Permit
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

        <div className="px-4 py-3 flex flex-col gap-2.5">
          <QeField label="Permit Type">
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              className={qeInputCls}
              style={qeInputStyle}
              data-testid="qe-type"
            >
              {!permitTypes.includes(form.type) && form.type && (
                <option value={form.type}>{form.type}</option>
              )}
              {permitTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </QeField>

          <QeField
            label="Assigned To"
            hint="(ENT + DA)"
          >
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                list="qe-ent-options"
                value={form.ent_lead}
                onChange={(e) =>
                  setForm((f) => ({ ...f, ent_lead: e.target.value }))
                }
                placeholder="ENT"
                className={qeInputCls}
                style={qeInputStyle}
                data-testid="qe-ent"
              />
              <input
                type="text"
                list="qe-da-options"
                value={form.da}
                onChange={(e) =>
                  setForm((f) => ({ ...f, da: e.target.value }))
                }
                placeholder="DA"
                className={qeInputCls}
                style={qeInputStyle}
                data-testid="qe-da"
              />
              <datalist id="qe-ent-options">
                {entOptions.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              <datalist id="qe-da-options">
                {daOptions.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>
          </QeField>

          <QeField label="Permit Number" hint="(from city)">
            <input
              type="text"
              value={form.num}
              onChange={(e) => setForm((f) => ({ ...f, num: e.target.value }))}
              placeholder="BP-2025-XXXX"
              className={qeInputCls}
              style={qeInputStyle}
              data-testid="qe-num"
            />
          </QeField>

          <QeField label="Structure Address">
            <input
              type="text"
              value={form.struct_address}
              onChange={(e) =>
                setForm((f) => ({ ...f, struct_address: e.target.value }))
              }
              placeholder="e.g. 4717-A Fremont Ave N"
              className={qeInputCls}
              style={qeInputStyle}
              data-testid="qe-struct"
            />
          </QeField>

          <QeField label="Permit Portal URL" hint="(makes permit # clickable)">
            <input
              type="text"
              value={form.portal_url}
              onChange={(e) =>
                setForm((f) => ({ ...f, portal_url: e.target.value }))
              }
              placeholder="https://..."
              className={qeInputCls}
              style={qeInputStyle}
              data-testid="qe-url"
            />
          </QeField>
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
            data-testid="qe-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={updatePermit.isPending}
            className="px-3 py-1 text-[11px] font-bold uppercase tracking-wide rounded border disabled:opacity-50"
            style={{
              borderColor: 'var(--color-pm)',
              background: 'var(--color-pm)',
              color: 'white',
            }}
            data-testid="qe-save"
          >
            {updatePermit.isPending ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}

const qeInputCls = 'w-full px-2 py-1 text-[12px] border rounded';
const qeInputStyle = {
  background: 'var(--color-surface)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text)',
} as const;

function QeField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className="text-[9px] font-bold uppercase tracking-wide"
        style={{ color: 'var(--color-dim)' }}
      >
        {label}
        {hint && (
          <span className="ml-1 normal-case font-normal text-[8px]" style={{ color: 'var(--color-dim)' }}>
            {hint}
          </span>
        )}
      </span>
      {children}
    </div>
  );
}
