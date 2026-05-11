import { useMemo, useState } from 'react';
import {
  scopeKey,
  useTaskTemplates,
  type TaskTemplateWithSubtasks,
} from '../../hooks/useTaskTemplates';
import { useUpsertTaskTemplate } from '../../hooks/useUpsertTaskTemplate';
import { useDeleteTaskTemplate } from '../../hooks/useDeleteTaskTemplate';
import { useUpsertTaskTemplateSubtask } from '../../hooks/useUpsertTaskTemplateSubtask';
import { useDeleteTaskTemplateSubtask } from '../../hooks/useDeleteTaskTemplateSubtask';
import { useJurisdictions } from '../../hooks/useJurisdictions';
import { usePermitTypes } from '../../hooks/usePermitTypes';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';
import type {
  TaskTemplate,
  TemplateBucket,
} from '../../lib/database.types';

// Q7.3.c: task templates editor. Three scope selectors at the top
// (permit_type, jurisdiction with "Base — all jurisdictions" option,
// bucket) drive the per-scope list rendered below. Each template row
// surfaces text + cat + assignee + offset fields with inline edit on
// blur, an "+ subtask" button to nest, and up/down arrows to swap
// sort_order with the adjacent row.
//
// Drag-reorder is deliberately omitted — arrow buttons are reliable,
// accessible, and a fraction of the DnD wiring. Drag UX can land later
// via Q7.3.x backlog if Bobby wants it.
//
// Per-juris overlay: jurisdiction='' means the "Base" set (server
// stores it as NULL). Same data, different scope key.

const BUCKETS: { value: TemplateBucket; label: string }[] = [
  { value: 'de', label: 'D&E' },
  { value: 'pm', label: 'PM' },
  { value: 'co', label: 'Corrections' },
];

interface Props {
  readOnly?: boolean;
}

export default function TaskTemplateEditor({ readOnly = false }: Props) {
  const tplsQ = useTaskTemplates();
  const typesQ = usePermitTypes();
  const jurisQ = useJurisdictions();
  const upsert = useUpsertTaskTemplate();
  const remove = useDeleteTaskTemplate();
  const upsertSub = useUpsertTaskTemplateSubtask();
  const removeSub = useDeleteTaskTemplateSubtask();

  const typeOptions = typesQ.data ?? [];
  const jurisOptions = jurisQ.data ?? [];

  const [permitType, setPermitType] = useState<string>('');
  const [juris, setJuris] = useState<string>(''); // '' = base
  const [bucket, setBucket] = useState<TemplateBucket>('de');

  const effectiveType = permitType || typeOptions[0]?.name || '';
  const list = useMemo<TaskTemplateWithSubtasks[]>(() => {
    if (!effectiveType) return [];
    return tplsQ.byScope.get(scopeKey(effectiveType, juris || null, bucket)) ?? [];
  }, [tplsQ.byScope, effectiveType, juris, bucket]);

  const error = tplsQ.error ?? typesQ.error ?? jurisQ.error;
  if (error) {
    return (
      <QueryError
        title="Task templates failed to load"
        error={error}
        onRetry={() => {
          tplsQ.refetch();
          typesQ.refetch();
          jurisQ.refetch();
        }}
      />
    );
  }
  if (tplsQ.isLoading || typesQ.isLoading || jurisQ.isLoading) {
    return <SkeletonRows count={5} rowClassName="h-12" />;
  }

  function addTemplate(text: string) {
    if (!text.trim() || !effectiveType) return;
    upsert.mutate({
      op: 'insert',
      patch: {
        permit_type: effectiveType,
        jurisdiction: juris || null,
        bucket,
        text: text.trim(),
        sort_order: list.length,
      },
    });
  }

  function updateField(t: TaskTemplate, patch: Parameters<typeof upsert.mutate>[0] extends { patch: infer P } ? P : never) {
    upsert.mutate({ op: 'update', template: t, patch });
  }

  function deleteTemplate(t: TaskTemplate) {
    remove.mutate({ id: t.id, updated_at: t.updated_at });
  }

  /** Swap sort_order with the adjacent template. If the list contains
   *  duplicate / zero sort_orders (e.g. fresh from migration), the swap
   *  uses positional indexes via a normalization pass — each row writes
   *  its new index as sort_order. */
  function moveTemplate(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const a = list[index];
    const b = list[target];
    // Use the array indexes as the new sort_orders. This auto-normalizes
    // any stale 0-values into distinct positions.
    upsert.mutate({
      op: 'update',
      template: a,
      patch: { sort_order: target },
    });
    upsert.mutate({
      op: 'update',
      template: b,
      patch: { sort_order: index },
    });
  }

  return (
    <div className="space-y-3" data-testid="task-template-editor">
      {/* Scope selectors */}
      <div className="bg-surface-2 border border-border rounded-lg p-3 flex flex-wrap gap-3 items-end">
        <Selector
          label="Permit Type"
          value={effectiveType}
          onChange={setPermitType}
          options={typeOptions.map((t) => ({ value: t.name, label: t.name }))}
          testId="tte-type"
        />
        <Selector
          label="Jurisdiction"
          value={juris}
          onChange={setJuris}
          options={[
            { value: '', label: 'Base — all jurisdictions' },
            ...jurisOptions.map((j) => ({ value: j.name, label: j.name })),
          ]}
          testId="tte-juris"
        />
        <Selector
          label="Stage"
          value={bucket}
          onChange={(v) => setBucket(v as TemplateBucket)}
          options={BUCKETS.map((b) => ({ value: b.value, label: b.label }))}
          testId="tte-bucket"
        />
      </div>

      <div className="text-[10px] uppercase tracking-wide text-muted font-display font-bold flex items-center justify-between">
        <span>
          {effectiveType} · {juris || 'Base'} · {BUCKETS.find((b) => b.value === bucket)?.label}
        </span>
        <span className="text-dim">
          {list.length} template{list.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Template rows */}
      <div className="space-y-2">
        {list.length === 0 && (
          <div className="text-xs text-dim italic px-3 py-4 bg-surface border border-border rounded-md text-center">
            No templates yet for this scope. Add one below.
          </div>
        )}
        {list.map((t, i) => (
          <TemplateRow
            key={t.id}
            template={t}
            index={i}
            total={list.length}
            readOnly={readOnly}
            onUpdate={(patch) => updateField(t, patch)}
            onDelete={() => deleteTemplate(t)}
            onMoveUp={() => moveTemplate(i, -1)}
            onMoveDown={() => moveTemplate(i, 1)}
            onAddSubtask={(text) =>
              upsertSub.mutate({
                op: 'insert',
                patch: {
                  template_id: t.id,
                  text,
                  sort_order: t.subtasks.length,
                },
              })
            }
            onUpdateSubtask={(sub, patch) =>
              upsertSub.mutate({ op: 'update', subtask: sub, patch })
            }
            onDeleteSubtask={(sub) =>
              removeSub.mutate({ id: sub.id, updated_at: sub.updated_at })
            }
          />
        ))}
      </div>

      {!readOnly && (
        <AddTemplateForm onAdd={addTemplate} disabled={!effectiveType} />
      )}
    </div>
  );
}

function Selector({
  label,
  value,
  onChange,
  options,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  testId: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-dim">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-bg border border-border rounded px-2 py-1 text-xs font-display text-text focus:outline-none focus:border-de"
        data-testid={testId}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TemplateRow({
  template,
  index,
  total,
  readOnly,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onAddSubtask,
  onUpdateSubtask,
  onDeleteSubtask,
}: {
  template: TaskTemplateWithSubtasks;
  index: number;
  total: number;
  readOnly: boolean;
  onUpdate: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onAddSubtask: (text: string) => void;
  onUpdateSubtask: (
    sub: TaskTemplateWithSubtasks['subtasks'][number],
    patch: Record<string, unknown>,
  ) => void;
  onDeleteSubtask: (sub: TaskTemplateWithSubtasks['subtasks'][number]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [subDraft, setSubDraft] = useState('');

  function submitSubtask() {
    const v = subDraft.trim();
    if (!v) {
      setAdding(false);
      return;
    }
    onAddSubtask(v);
    setSubDraft('');
    setAdding(false);
  }

  return (
    <div
      className="bg-surface border border-border rounded-md p-2"
      data-testid={`tte-row-${template.id}`}
    >
      <div className="flex items-center gap-2">
        {!readOnly && (
          <div className="flex flex-col gap-0">
            <button
              onClick={onMoveUp}
              disabled={index === 0}
              className="text-dim hover:text-text text-[10px] leading-none disabled:opacity-30 px-1"
              title="Move up"
              data-testid={`tte-up-${template.id}`}
            >
              ▲
            </button>
            <button
              onClick={onMoveDown}
              disabled={index === total - 1}
              className="text-dim hover:text-text text-[10px] leading-none disabled:opacity-30 px-1"
              title="Move down"
              data-testid={`tte-down-${template.id}`}
            >
              ▼
            </button>
          </div>
        )}
        <InlineField
          value={template.text}
          onCommit={(v) => v !== template.text && onUpdate({ text: v })}
          placeholder="Task text…"
          className="flex-1 text-xs font-display"
          readOnly={readOnly}
          testId={`tte-text-${template.id}`}
        />
        <InlineField
          value={template.cat ?? ''}
          onCommit={(v) =>
            v !== (template.cat ?? '') && onUpdate({ cat: v || null })
          }
          placeholder="cat"
          className="w-20 text-[11px] text-muted"
          readOnly={readOnly}
          testId={`tte-cat-${template.id}`}
        />
        <InlineField
          value={template.default_assignee ?? ''}
          onCommit={(v) =>
            v !== (template.default_assignee ?? '') &&
            onUpdate({ default_assignee: v || null })
          }
          placeholder="assignee"
          className="w-28 text-[11px] text-muted"
          readOnly={readOnly}
          testId={`tte-assignee-${template.id}`}
        />
        <InlineField
          value={
            template.default_target_offset !== null
              ? String(template.default_target_offset)
              : ''
          }
          onCommit={(v) => {
            const n = v === '' ? null : parseInt(v, 10);
            if (n !== template.default_target_offset && !Number.isNaN(n)) {
              onUpdate({ default_target_offset: n });
            }
          }}
          placeholder="offset"
          className="w-14 text-[11px] text-muted text-right"
          readOnly={readOnly}
          numeric
          testId={`tte-offset-${template.id}`}
        />
        {!readOnly && (
          <button
            onClick={() => setAdding(!adding)}
            className="text-[10px] text-de hover:underline px-1"
            title="Add subtask"
            data-testid={`tte-add-sub-${template.id}`}
          >
            + sub
          </button>
        )}
        {!readOnly && (
          <button
            onClick={onDelete}
            className="text-dim hover:text-co text-sm leading-none"
            title="Remove template"
            data-testid={`tte-remove-${template.id}`}
          >
            ×
          </button>
        )}
      </div>

      {(template.subtasks.length > 0 || adding) && (
        <div className="mt-1 pl-6 space-y-0.5">
          {template.subtasks.map((sub) => (
            <div key={sub.id} className="flex items-center gap-2">
              <span className="text-dim text-[10px]">↳</span>
              <InlineField
                value={sub.text}
                onCommit={(v) =>
                  v && v !== sub.text && onUpdateSubtask(sub, { text: v })
                }
                placeholder="Subtask…"
                className="flex-1 text-[11px] text-muted"
                readOnly={readOnly}
                testId={`tte-sub-text-${sub.id}`}
              />
              {!readOnly && (
                <button
                  onClick={() => onDeleteSubtask(sub)}
                  className="text-dim hover:text-co text-xs leading-none"
                  title="Remove subtask"
                  data-testid={`tte-sub-remove-${sub.id}`}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {adding && (
            <div className="flex items-center gap-2">
              <span className="text-dim text-[10px]">↳</span>
              <input
                autoFocus
                type="text"
                value={subDraft}
                onChange={(e) => setSubDraft(e.target.value)}
                onBlur={submitSubtask}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submitSubtask();
                  } else if (e.key === 'Escape') {
                    setSubDraft('');
                    setAdding(false);
                  }
                }}
                placeholder="New subtask…"
                className="flex-1 px-1 py-0 text-[11px] bg-bg border border-de rounded outline-none"
                data-testid={`tte-sub-new-${template.id}`}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Click-to-edit inline field. Renders as plain text by default; becomes
 * <input> on click. Commits on Enter or blur; Esc cancels. */
function InlineField({
  value,
  onCommit,
  placeholder,
  className,
  readOnly,
  numeric,
  testId,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
  readOnly: boolean;
  numeric?: boolean;
  testId?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function start() {
    if (readOnly) return;
    setDraft(value);
    setEditing(true);
  }
  function commit() {
    onCommit(draft);
    setEditing(false);
  }
  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  if (editing && !readOnly) {
    return (
      <input
        autoFocus
        type={numeric ? 'number' : 'text'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        placeholder={placeholder}
        className={`${className ?? ''} bg-bg border border-de rounded px-1 py-0 outline-none`}
        data-testid={testId}
      />
    );
  }

  return (
    <span
      onClick={start}
      className={`${className ?? ''} ${readOnly ? '' : 'cursor-text hover:bg-bg/40'} rounded px-1 py-0.5 ${!value ? 'text-dim italic' : ''}`}
      title={readOnly ? undefined : 'Click to edit'}
      data-testid={testId}
    >
      {value || placeholder || '—'}
    </span>
  );
}

function AddTemplateForm({
  onAdd,
  disabled,
}: {
  onAdd: (text: string) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onAdd(draft);
            setDraft('');
          }
        }}
        placeholder="New template task text…"
        className="flex-1 px-2 py-1 text-xs border border-border rounded bg-bg text-text outline-none focus:border-de"
        disabled={disabled}
        data-testid="tte-add"
      />
      <button
        onClick={() => {
          onAdd(draft);
          setDraft('');
        }}
        className="px-3 py-1 text-xs font-display font-semibold bg-de text-white rounded border border-de hover:bg-de/90 disabled:opacity-50"
        disabled={disabled}
        data-testid="tte-add-btn"
      >
        Add Template
      </button>
    </div>
  );
}
