import { useMemo, useState } from 'react';
import {
  useDeleteMentionTag,
  useMentionTags,
  useUpsertMentionTag,
} from '../../hooks/useMentionTags';
import { useMentionablePeople } from '../../hooks/useProjectMessages';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { mentionableAfterRoster } from '../../lib/projectChat';
import { PROJECT_TAG } from '../../lib/mentionTags';

// ===========================================================================
// ★★ fix-347 §2 — where the custom tags live
// ===========================================================================
//
// Bobby: "I should be able to create different tags for different groups of
// people… one group tag, or 30 group tags, and it could be a different
// combination of anyone in the tool."
//
// ★ SETTINGS → TEAM, beside the other roster that decides who gets work. A tag
// is tenant-wide (the same tag in every project chat), so a per-project home
// would have been the wrong shape and a per-project copy would be 120 copies.
//
// ★★ ADMIN-ONLY TO EDIT, EVERYONE CAN SEE. The gate is the database's —
// bp_upsert_mention_tag refuses a non-admin and the tables carry no write
// policy — and this hides the controls so nobody is handed a button that will
// fail. Read-only is deliberate rather than absent: knowing that "@Leadership"
// exists and who is in it is exactly what stops somebody @-ing five people by
// hand.

export default function MentionTagsEditor({
  readOnly = false,
}: {
  readOnly?: boolean;
}) {
  const tagsQ = useMentionTags();
  const peopleQ = useMentionablePeople();
  const team = useTeamMembers();
  const upsert = useUpsertMentionTag();
  const remove = useDeleteMentionTag();

  // ★ fix-321's rule: CHOOSING somebody offers the current roster only. A tag
  // is a thing you send to, so a departed login must not be addable — the same
  // reason the @ picker filters them.
  const people = useMemo(
    () => mentionableAfterRoster(peopleQ.data ?? [], team.all),
    [peopleQ.data, team.all],
  );

  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>([]);

  function startNew() {
    setEditing('new');
    setName('');
    setMembers([]);
  }
  function startEdit(id: string) {
    const tag = (tagsQ.data ?? []).find((t) => t.id === id);
    if (!tag) return;
    setEditing(id);
    setName(tag.name);
    setMembers([...(tag.member_ids ?? [])]);
  }
  function save() {
    if (!name.trim()) return;
    upsert.mutate(
      {
        id: editing === 'new' ? null : editing,
        name: name.trim(),
        memberIds: members,
      },
      { onSuccess: () => setEditing(null) },
    );
  }

  return (
    <div className="space-y-3" data-testid="mention-tags-editor">
      <div className="text-[10px] uppercase tracking-wide text-muted font-display font-bold">
        Chat tags
      </div>
      <p className="text-xs text-muted">
        Type <span className="font-mono">@</span> in a project chat to notify a
        group. A tag stores the people it notified at the time, so editing one
        never changes who a past message reached.
      </p>

      {/* ★★★ The smart tag is listed FIRST and is not editable — it is a name
          plus a query, not a membership list, and saying so here is what stops
          somebody trying to "fix" it by adding people. */}
      <div
        className="bg-surface-2 border border-border rounded-lg p-3"
        data-testid="mention-tag-smart"
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] font-bold text-de">
            @{PROJECT_TAG}
          </span>
          <span className="text-[10px] text-dim">built in</span>
        </div>
        <div className="text-[11px] text-muted mt-0.5">
          Everyone on the project you are posting in — ACQ, ENT, SD, DM and DA,
          exactly as the Team card lists them. It re-derives every time, so it
          is right the day after a DA changes.
        </div>
      </div>

      {(tagsQ.data ?? []).map((tag) => (
        <div
          key={tag.id}
          className="bg-surface-2 border border-border rounded-lg p-3"
          data-testid={`mention-tag-${tag.name}`}
        >
          {editing === tag.id ? (
            <TagForm
              name={name}
              setName={setName}
              members={members}
              setMembers={setMembers}
              people={people}
              onSave={save}
              onCancel={() => setEditing(null)}
              saving={upsert.isPending}
            />
          ) : (
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <span className="font-mono text-[12px] font-bold text-de">
                  @{tag.name}
                </span>
                <div className="text-[11px] text-muted mt-0.5">
                  {(tag.member_ids ?? []).length === 0
                    ? 'Nobody yet — it will notify no one'
                    : (tag.member_ids ?? [])
                        .map(
                          (id) =>
                            people.find((p) => p.user_id === id)?.name ??
                            'Someone',
                        )
                        .join(', ')}
                </div>
              </div>
              {!readOnly && (
                <>
                  <button
                    type="button"
                    onClick={() => startEdit(tag.id)}
                    className="text-[10.5px] text-de hover:underline"
                    data-testid={`mention-tag-edit-${tag.name}`}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => remove.mutate(tag.id)}
                    className="text-[10.5px] text-dim hover:text-co"
                    data-testid={`mention-tag-delete-${tag.name}`}
                  >
                    ×
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      ))}

      {!readOnly && editing === 'new' && (
        <div className="bg-surface-2 border border-border rounded-lg p-3">
          <TagForm
            name={name}
            setName={setName}
            members={members}
            setMembers={setMembers}
            people={people}
            onSave={save}
            onCancel={() => setEditing(null)}
            saving={upsert.isPending}
          />
        </div>
      )}

      {!readOnly && editing !== 'new' && (
        <button
          type="button"
          onClick={startNew}
          className="text-[11px] text-de hover:underline"
          data-testid="mention-tag-new"
        >
          + New tag
        </button>
      )}
    </div>
  );
}

function TagForm({
  name,
  setName,
  members,
  setMembers,
  people,
  onSave,
  onCancel,
  saving,
}: {
  name: string;
  setName: (v: string) => void;
  members: string[];
  setMembers: (v: string[]) => void;
  people: { user_id: string; name: string | null; email: string | null }[];
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-2" data-testid="mention-tag-form">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Tag name — one word, no @"
        className="w-full border border-border rounded px-2 py-1 text-xs bg-bg text-text"
        aria-label="Tag name"
        data-testid="mention-tag-name"
      />
      <div className="flex flex-wrap gap-1">
        {people.map((p) => {
          const on = members.includes(p.user_id);
          return (
            <button
              key={p.user_id}
              type="button"
              onClick={() =>
                setMembers(
                  on
                    ? members.filter((m) => m !== p.user_id)
                    : [...members, p.user_id],
                )
              }
              className="px-2 py-0.5 rounded-full border text-[11px] transition"
              style={{
                borderColor: on ? 'var(--color-de)' : 'var(--color-border)',
                background: on ? 'var(--color-de-bg)' : 'transparent',
                color: on ? 'var(--color-de)' : 'var(--color-muted)',
              }}
              data-testid={`mention-tag-member-${p.user_id}`}
              data-on={on ? 'true' : 'false'}
            >
              {p.name ?? p.email}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={!name.trim() || saving}
          className="bg-de text-white rounded px-3 py-1 text-[11px] font-bold disabled:opacity-50"
          data-testid="mention-tag-save"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] text-dim hover:text-text px-2"
          data-testid="mention-tag-cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
