import { useMemo, useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  scopeKey,
  useTaskTemplates,
  type TaskTemplateWithSubtasks,
} from '../../hooks/useTaskTemplates';
import { useUpsertTaskTemplate } from '../../hooks/useUpsertTaskTemplate';
import { useDeleteTaskTemplate } from '../../hooks/useDeleteTaskTemplate';
import { useUpsertTaskTemplateSubtask } from '../../hooks/useUpsertTaskTemplateSubtask';
import { useDeleteTaskTemplateSubtask } from '../../hooks/useDeleteTaskTemplateSubtask';
import {
  reorderTemplateIds,
  useReorderTaskTemplates,
} from '../../hooks/useReorderTaskTemplates';
import { useJurisdictions } from '../../hooks/useJurisdictions';
import { usePermitTypes } from '../../hooks/usePermitTypes';
import { useTeamMembers, activeMemberNamesOf } from '../../hooks/useTeamMembers';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';
import { WAITING_ON_OPTIONS } from '../../lib/database.types';
import type { TaskTemplate, TemplateBucket } from '../../lib/database.types';
import {
  TEAM_OPTIONS,
  DYNAMIC_ROLES,
  DYNAMIC_ROLE_LABELS,
  roleToken,
  coAssigneeLabel,
  isRoleToken,
} from '../../lib/taskTeam';

// Q7.3.c / fix-153: task templates editor. Three scope selectors at the top
// (permit_type, jurisdiction with "Base — all jurisdictions" option, stage)
// drive the per-scope list rendered below. Each template row surfaces the task
// text plus the fix-153 trio: Team (resolved to the permit's ent_lead/da/
// schematic designer at create time), Co-Assignees (a specific person OR a
// dynamic role token, fix-222), and Waiting On (discipline). A drag handle
// reorders rows (fix-153 replaced the old up/down arrows); on drop we persist
// the whole scope's new order via bp_reorder_task_templates.
//
// fix-223: the `default_target_offset` field is RETIRED (it was unused — null on
// every template, no anchor, nothing computed a date from it). Same treatment as
// the fix-222 `cat` retirement: dropped from the UI + fetch + upsert, column left
// in place.
// fix-222: the `cat` category label is RETIRED — no longer read/written/shown.
// The team dropdown is now Entitlements / Design Associate / Schematic Team
// (retired 'Architecture'); TEAM_OPTIONS lives in lib/taskTeam.ts.
//
// fix-153: the Corrections ('co') bucket was migrated into Permitting ('pm')
// and is no longer offered here — only D&E + Permitting are editable scopes.
//
// Per-juris overlay: jurisdiction='' means the "Base" set (server stores it as
// NULL). Same data, different scope key.

const BUCKETS: { value: TemplateBucket; label: string }[] = [
  { value: 'de', label: 'D&E' },
  { value: 'pm', label: 'Permitting' },
];

interface Props {
  readOnly?: boolean;
}

export default function TaskTemplateEditor({ readOnly = false }: Props) {
  const tplsQ = useTaskTemplates();
  const typesQ = usePermitTypes();
  const jurisQ = useJurisdictions();
  const teamQ = useTeamMembers();
  const upsert = useUpsertTaskTemplate();
  const remove = useDeleteTaskTemplate();
  const upsertSub = useUpsertTaskTemplateSubtask();
  const removeSub = useDeleteTaskTemplateSubtask();
  const reorder = useReorderTaskTemplates();

  const typeOptions = typesQ.data ?? [];
  const jurisOptions = jurisQ.data ?? [];
  // fix-222 (dedupe by person — team_members has a row PER role) + fix-233
  // (CURRENT members only, active + non-former): the co-assignee picker offers
  // one entry per distinct active name.
  const memberNames = useMemo(
    () => activeMemberNamesOf(teamQ.all),
    [teamQ.all],
  );

  const [permitType, setPermitType] = useState<string>('');
  const [juris, setJuris] = useState<string>(''); // '' = base
  const [bucket, setBucket] = useState<TemplateBucket>('de');

  const effectiveType = permitType || typeOptions[0]?.name || '';
  const list = useMemo<TaskTemplateWithSubtasks[]>(() => {
    if (!effectiveType) return [];
    return tplsQ.byScope.get(scopeKey(effectiveType, juris || null, bucket)) ?? [];
  }, [tplsQ.byScope, effectiveType, juris, bucket]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

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

  function updateField(
    t: TaskTemplate,
    patch: Parameters<typeof upsert.mutate>[0] extends { patch: infer P }
      ? P
      : never,
  ) {
    upsert.mutate({ op: 'update', template: t, patch });
  }

  function deleteTemplate(t: TaskTemplate) {
    remove.mutate({ id: t.id, updated_at: t.updated_at });
  }

  // fix-153: on drop, persist the whole scope's new id order via
  // bp_reorder_task_templates; the query invalidation refetches the
  // reordered list (same write-then-refetch path as every other edit).
  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const next = reorderTemplateIds(
      list.map((t) => t.id),
      String(active.id),
      String(over.id),
    );
    reorder.mutate({ ids: next });
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
          {effectiveType} · {juris || 'Base'} ·{' '}
          {BUCKETS.find((b) => b.value === bucket)?.label}
        </span>
        <span className="text-dim">
          {list.length} template{list.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Template rows */}
      {list.length === 0 ? (
        <div className="text-xs text-dim italic px-3 py-4 bg-surface border border-border rounded-md text-center">
          No templates yet for this scope. Add one below.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={list.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {list.map((t) => (
                <TemplateRow
                  key={t.id}
                  template={t}
                  readOnly={readOnly}
                  memberNames={memberNames}
                  onUpdate={(patch) => updateField(t, patch)}
                  onDelete={() => deleteTemplate(t)}
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
          </SortableContext>
        </DndContext>
      )}

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
  readOnly,
  memberNames,
  onUpdate,
  onDelete,
  onAddSubtask,
  onUpdateSubtask,
  onDeleteSubtask,
}: {
  template: TaskTemplateWithSubtasks;
  readOnly: boolean;
  memberNames: string[];
  onUpdate: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  onAddSubtask: (text: string) => void;
  onUpdateSubtask: (
    sub: TaskTemplateWithSubtasks['subtasks'][number],
    patch: Record<string, unknown>,
  ) => void;
  onDeleteSubtask: (sub: TaskTemplateWithSubtasks['subtasks'][number]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [subDraft, setSubDraft] = useState('');
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: template.id, disabled: readOnly });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

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

  const coAssignees = template.default_co_assignees ?? [];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-surface border border-border rounded-md p-2"
      data-testid={`task-template-row-${template.id}`}
    >
      {/* Row 1: drag handle + task text + actions */}
      <div className="flex items-center gap-2">
        {!readOnly && (
          <button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            className="text-dim hover:text-text cursor-grab active:cursor-grabbing leading-none px-1 touch-none"
            title="Drag to reorder"
            aria-label="Drag to reorder"
            data-testid={`task-template-row-${template.id}-drag-handle`}
          >
            ⠿
          </button>
        )}
        <InlineField
          value={template.text}
          onCommit={(v) => v !== template.text && onUpdate({ text: v })}
          placeholder="Task text…"
          className="flex-1 text-xs font-display"
          readOnly={readOnly}
          testId={`tte-text-${template.id}`}
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

      {/* Row 2: Team / Co-Assignees / Waiting On */}
      <div className="flex flex-wrap items-start gap-3 mt-2 pl-6">
        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-wide text-dim">
            Team
          </span>
          <select
            value={template.default_team ?? ''}
            disabled={readOnly}
            onChange={(e) =>
              onUpdate({ default_team: e.target.value || null })
            }
            className="bg-bg border border-border rounded px-1.5 py-0.5 text-[11px] text-text focus:outline-none focus:border-de disabled:opacity-60"
            data-testid={`task-template-row-${template.id}-team`}
          >
            <option value="">(none)</option>
            {TEAM_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <CoAssigneesField
          rowId={template.id}
          values={coAssignees}
          memberNames={memberNames}
          readOnly={readOnly}
          onChange={(next) => onUpdate({ default_co_assignees: next })}
        />

        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-wide text-dim">
            Waiting On
          </span>
          <select
            value={template.default_waiting_on ?? ''}
            disabled={readOnly}
            onChange={(e) =>
              onUpdate({ default_waiting_on: e.target.value || null })
            }
            className="bg-bg border border-border rounded px-1.5 py-0.5 text-[11px] text-text focus:outline-none focus:border-de disabled:opacity-60"
            data-testid={`task-template-row-${template.id}-waiting-on`}
          >
            <option value="">(none)</option>
            {WAITING_ON_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
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

/** fix-153/fix-222: co-assignees editor. Each chip is a SPECIFIC PERSON or a
 *  DYNAMIC ROLE token (Design Associate / Design Manager / Schematic Designer)
 *  that resolves per-project at task-create time. Applied entries render as
 *  removable chips (role chips styled distinctly); a <datalist> autocompletes
 *  team members (deduped by person) + the role labels, and any free-text name
 *  is accepted. Role labels map to a `role:<role>` token on add. */
function CoAssigneesField({
  rowId,
  values,
  memberNames,
  readOnly,
  onChange,
}: {
  rowId: string;
  values: string[];
  memberNames: string[];
  readOnly: boolean;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const listId = `co-assignee-options-${rowId}`;

  // Map a role's friendly label → its token, so typing/selecting the label
  // stores the dynamic token instead of a literal name.
  const labelToToken = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of DYNAMIC_ROLES) {
      m.set(DYNAMIC_ROLE_LABELS[r].toLowerCase(), roleToken(r));
    }
    return m;
  }, []);

  function addValue(v: string) {
    if (!v || values.includes(v)) {
      setDraft('');
      return;
    }
    onChange([...values, v]);
    setDraft('');
  }
  function add(raw: string) {
    const v = raw.trim();
    if (!v) {
      setDraft('');
      return;
    }
    // A typed/selected role label becomes its dynamic token.
    addValue(labelToToken.get(v.toLowerCase()) ?? v);
  }
  function removeAt(value: string) {
    onChange(values.filter((n) => n !== value));
  }

  return (
    <div
      className="flex flex-col gap-0.5 min-w-[12rem]"
      data-testid={`task-template-row-${rowId}-co-assignees`}
    >
      <span className="text-[9px] uppercase tracking-wide text-dim">
        Co-Assignees
      </span>
      <div className="flex flex-wrap items-center gap-1">
        {values.map((value) => {
          const role = isRoleToken(value);
          return (
            <span
              key={value}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] ${
                role
                  ? 'bg-de/10 border border-de/40 text-de'
                  : 'bg-bg border border-border text-text'
              }`}
              title={
                role
                  ? 'Dynamic — resolves to this project’s person at task creation'
                  : undefined
              }
              data-testid={`task-template-row-${rowId}-co-assignee-${value}`}
            >
              {role ? '⟳ ' : ''}
              {coAssigneeLabel(value)}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => removeAt(value)}
                  className="text-dim hover:text-co leading-none"
                  title={`Remove ${coAssigneeLabel(value)}`}
                  data-testid={`task-template-row-${rowId}-co-assignee-remove-${value}`}
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
        {!readOnly && (
          <>
            <input
              type="text"
              list={listId}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add(draft);
                } else if (e.key === 'Backspace' && !draft && values.length) {
                  removeAt(values[values.length - 1]);
                }
              }}
              placeholder="+ person / role"
              className="w-24 px-1 py-0.5 text-[10px] bg-bg border border-border rounded outline-none focus:border-de"
              data-testid={`task-template-row-${rowId}-co-assignees-input`}
            />
            <datalist id={listId}>
              {DYNAMIC_ROLES.filter(
                (r) => !values.includes(roleToken(r)),
              ).map((r) => (
                <option key={r} value={DYNAMIC_ROLE_LABELS[r]} />
              ))}
              {memberNames
                .filter((n) => !values.includes(n))
                .map((n) => (
                  <option key={n} value={n} />
                ))}
            </datalist>
          </>
        )}
      </div>
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
