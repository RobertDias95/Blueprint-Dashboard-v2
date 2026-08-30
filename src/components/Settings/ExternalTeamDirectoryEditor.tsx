import { useMemo, useState, type KeyboardEvent } from 'react';
import {
  useExternalTeamDirectory,
  useUpsertDirectoryFirm,
} from '../../hooks/useExternalTeamDirectory';
import {
  directoryFirmsByDiscipline,
  EXTERNAL_TEAM_COMMON_DISCIPLINES,
} from '../../lib/externalTeam';
import {
  WAITING_ON_OPTIONS,
  type ExternalTeamDirectoryFirm,
} from '../../lib/database.types';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';

// fix-227: Settings → Projects → External Team Directory.
//
// The central master list of consultant firms BY DISCIPLINE that populates the
// per-project external-team picker (projects.external_team stays the source of
// truth; this only supplies reusable options). Admin-editable; read-only for
// non-admins (add/rename/toggle hide). Mirrors the other settings-list panels.
//
// Grouped by discipline. The COMMON FOUR (Civil / Surveyor / Structural /
// Arborist) always show a group so an admin can seed them; other disciplines
// show once they have a firm or are surfaced via "+ Add discipline". Firms are
// added (insert), renamed (update name), or deactivated/reactivated (toggle
// active) — never hard-deleted, so a firm still referenced by a project's blob
// isn't silently lost from the picker's "not in directory" fallback.

interface Props {
  readOnly: boolean;
}

// ===========================================================================
// ★★★ fix-451 §E (P-100) — THE CONTACT THE DIRECTORY WAS ALREADY BUILT TO HOLD
// ===========================================================================
//
// ★★★ THIS IS A FORM, NOT A FEATURE. `external_team_directory` has carried
// contact_name / contact_email / contact_phone / notes since fix-227;
// `useExternalTeamDirectory`'s SELECT_COLS already reads all four, and
// `useUpsertDirectoryFirm` already accepts and writes all four on BOTH its
// insert and update paths. Nothing in the UI has ever passed one, so all 15
// firms on prod hold NULL in every contact column. No migration, no new hook,
// no new column — the gap was a field on a form.

/** Does this firm have anything a person could be reached by? */
function hasContact(f: ExternalTeamDirectoryFirm): boolean {
  return Boolean(
    (f.contact_name ?? '').trim() ||
      (f.contact_email ?? '').trim() ||
      (f.contact_phone ?? '').trim(),
  );
}

/** ★ Empty persists as NULL, never ''. §E2: the "has a contact" question stays
 *  a null check, and a firm somebody cleared reads the same as one nobody has
 *  filled in — because it is the same thing. */
const nullIfBlank = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/** ★★ §E2: "looks like an address, or is empty". Deliberately NOT a format
 *  gate — a save is never blocked on a guess about what an email may look
 *  like. It colours the field and says so; it does not refuse the work. */
function emailLooksOff(v: string): boolean {
  const t = v.trim();
  if (t === '') return false;
  return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

function ContactPanel({
  firm,
  readOnly,
  busy,
  onSave,
}: {
  firm: ExternalTeamDirectoryFirm;
  readOnly: boolean;
  busy: boolean;
  onSave: (patch: {
    contact_name: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    notes: string | null;
  }) => void;
}) {
  const [name, setName] = useState(firm.contact_name ?? '');
  const [email, setEmail] = useState(firm.contact_email ?? '');
  const [phone, setPhone] = useState(firm.contact_phone ?? '');
  const [notes, setNotes] = useState(firm.notes ?? '');

  // ★★★ §E3 — READ-ONLY SHOWS, IT DOES NOT HIDE. A DA needs the surveyor's
  //     email; what they must not have is the ability to change it. So the
  //     non-admin path renders the VALUES and no inputs at all.
  if (readOnly) {
    return (
      <div
        className="mt-2 border-t border-border pt-2 text-xs"
        data-testid={`etd-contact-${firm.id}`}
      >
        {hasContact(firm) ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {firm.contact_name && <span className="text-text">{firm.contact_name}</span>}
            {firm.contact_email && (
              <a
                href={`mailto:${firm.contact_email}`}
                className="text-de hover:underline"
                data-testid={`etd-contact-email-${firm.id}`}
              >
                {firm.contact_email}
              </a>
            )}
            {firm.contact_phone && <span className="text-muted">{firm.contact_phone}</span>}
            {firm.notes && <span className="text-muted italic">{firm.notes}</span>}
          </div>
        ) : (
          <span className="text-dim italic" data-testid={`etd-no-contact-${firm.id}`}>
            No contact on file.
          </span>
        )}
      </div>
    );
  }

  const cls =
    'px-2 py-1 text-xs border border-border rounded bg-bg text-text outline-none focus:border-de';
  return (
    <div
      className="mt-2 border-t border-border pt-2"
      data-testid={`etd-contact-${firm.id}`}
    >
      {/* ★★ §E4 — the gap is legible at a glance. 15 of 15 firms are in this
          state today; four empty boxes with no explanation would make Settings
          look broken rather than unfilled. */}
      {!hasContact(firm) && (
        <div
          className="text-[11px] text-dim italic mb-1.5"
          data-testid={`etd-no-contact-${firm.id}`}
        >
          No contact on file — add one and it travels to every project using
          this firm.
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Contact name"
          className={cls}
          data-testid={`etd-contact-name-${firm.id}`}
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className={cls}
          style={emailLooksOff(email) ? { borderColor: 'var(--color-wa)' } : undefined}
          title={emailLooksOff(email) ? "That does not look like an address — saving anyway is fine" : undefined}
          data-testid={`etd-contact-email-${firm.id}`}
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone"
          className={cls}
          data-testid={`etd-contact-phone-${firm.id}`}
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes"
          className={cls}
          data-testid={`etd-contact-notes-${firm.id}`}
        />
      </div>
      <button
        onClick={() =>
          onSave({
            contact_name: nullIfBlank(name),
            contact_email: nullIfBlank(email),
            contact_phone: nullIfBlank(phone),
            notes: nullIfBlank(notes),
          })
        }
        disabled={busy}
        className="mt-1.5 px-3 py-1 text-xs font-display font-semibold bg-de text-white rounded border border-de hover:bg-de/90"
        data-testid={`etd-contact-save-${firm.id}`}
      >
        Save contact
      </button>
    </div>
  );
}

export default function ExternalTeamDirectoryEditor({ readOnly }: Props) {
  const dirQ = useExternalTeamDirectory();
  const byDiscipline = useMemo(
    () => directoryFirmsByDiscipline(dirQ.data),
    [dirQ.data],
  );
  const [added, setAdded] = useState<Set<string>>(new Set());

  if (dirQ.error) {
    return (
      <QueryError
        title="External Team directory failed to load"
        error={dirQ.error}
        onRetry={() => dirQ.refetch()}
      />
    );
  }
  if (dirQ.isLoading) {
    return <SkeletonRows count={3} rowClassName="h-10" />;
  }

  const shown = WAITING_ON_OPTIONS.filter(
    (d) =>
      EXTERNAL_TEAM_COMMON_DISCIPLINES.includes(d) ||
      byDiscipline.has(d) ||
      added.has(d),
  );
  const shownSet = new Set(shown);
  const addable = WAITING_ON_OPTIONS.filter((d) => !shownSet.has(d));

  return (
    <div className="space-y-4" data-testid="external-team-directory-editor">
      <p className="text-[11px] text-muted">
        Master list of consultant firms by discipline. These populate the firm
        dropdown on each project's External Team. Editing here never changes a
        project's assignment — it just curates the reusable options.
      </p>

      {shown.map((discipline) => (
        <DisciplineGroup
          key={discipline}
          discipline={discipline}
          firms={byDiscipline.get(discipline) ?? []}
          readOnly={readOnly}
        />
      ))}

      {!readOnly && addable.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted">Add another discipline:</span>
          <select
            value=""
            onChange={(e) => {
              const d = e.target.value;
              if (d) setAdded((prev) => new Set(prev).add(d));
            }}
            className="text-xs px-2 py-1 border border-border rounded bg-bg text-text outline-none focus:border-de"
            data-testid="etd-add-discipline"
          >
            <option value="">+ Add discipline…</option>
            {addable.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function DisciplineGroup({
  discipline,
  firms,
  readOnly,
}: {
  discipline: string;
  firms: ExternalTeamDirectoryFirm[];
  readOnly: boolean;
}) {
  const upsert = useUpsertDirectoryFirm();
  const [addInput, setAddInput] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // ★★★ fix-451 §E1: which firm has its contact panel open.
  //
  // ★★ A SEPARATE "Details" TOGGLE, not the click-to-rename interaction. That
  //    gesture is already bound to the firm's NAME, and overloading one click
  //    with "rename" and "show contact" makes both ambiguous — you would find
  //    out which you got after it happened.
  const [detailsId, setDetailsId] = useState<string | null>(null);

  function addFirm() {
    const name = addInput.trim();
    if (!name) return;
    // Guard against an obvious in-list dupe (the DB unique index is the real
    // gate; this just avoids a needless failing round-trip).
    if (firms.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      setAddInput('');
      return;
    }
    upsert.mutate({ discipline, name });
    setAddInput('');
  }

  function startRename(f: ExternalTeamDirectoryFirm) {
    if (readOnly) return;
    setRenamingId(f.id);
    setRenameDraft(f.name);
  }
  function commitRename(f: ExternalTeamDirectoryFirm) {
    const trimmed = renameDraft.trim();
    if (trimmed && trimmed !== f.name) {
      upsert.mutate({ id: f.id, discipline: f.discipline, name: trimmed });
    }
    setRenamingId(null);
    setRenameDraft('');
  }
  function onAddKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addFirm();
    }
  }
  function onRenameKey(e: KeyboardEvent<HTMLInputElement>, f: ExternalTeamDirectoryFirm) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename(f);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setRenamingId(null);
      setRenameDraft('');
    }
  }

  return (
    <div
      className="border border-border rounded-lg p-3 bg-surface-2"
      data-testid={`etd-group-${discipline}`}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted font-display font-bold mb-2">
        {discipline}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {firms.length === 0 && (
          <span className="text-xs text-dim italic">No firms yet.</span>
        )}
        {firms.map((f) => {
          const isRenaming = renamingId === f.id;
          return (
            <span
              key={f.id}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs ${
                f.active
                  ? 'bg-surface border-border'
                  : 'bg-bg border-border opacity-60'
              }`}
              data-testid={`etd-firm-${f.id}`}
              data-active={f.active ? 'true' : 'false'}
            >
              {isRenaming ? (
                <input
                  autoFocus
                  type="text"
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => onRenameKey(e, f)}
                  onBlur={() => commitRename(f)}
                  className="bg-bg border border-de rounded px-1 py-0 text-xs outline-none min-w-[80px]"
                  data-testid={`etd-firm-rename-${f.id}`}
                />
              ) : (
                <span
                  className={`${readOnly ? '' : 'cursor-text'} ${f.active ? '' : 'line-through'}`}
                  onClick={() => startRename(f)}
                  title={readOnly ? undefined : 'Click to rename'}
                  data-testid={`etd-firm-name-${f.id}`}
                >
                  {f.name}
                </span>
              )}
              {!f.active && (
                <span className="text-[9px] uppercase text-muted border border-border rounded px-1">
                  inactive
                </span>
              )}
              {/* ★★ fix-451 §E: the contact affordance. It is shown to
                  EVERYONE — §E3: a DA needs to read the surveyor's email
                  without being able to change it — and what opens behind it is
                  editable only when `readOnly` is false. */}
              <button
                onClick={() => setDetailsId(detailsId === f.id ? null : f.id)}
                className="text-dim hover:text-text text-[10px] leading-none pl-0.5"
                title="Contact details"
                aria-expanded={detailsId === f.id}
                data-testid={`etd-details-${f.id}`}
              >
                {hasContact(f) ? '✉' : 'Details'}
              </button>
              {!readOnly && (
                <button
                  onClick={() =>
                    upsert.mutate({
                      id: f.id,
                      discipline: f.discipline,
                      name: f.name,
                      active: !f.active,
                    })
                  }
                  className="text-dim hover:text-text text-[10px] leading-none pl-0.5"
                  title={f.active ? 'Deactivate' : 'Reactivate'}
                  data-testid={`etd-toggle-${f.id}`}
                >
                  {f.active ? 'Deactivate' : 'Reactivate'}
                </button>
              )}
            </span>
          );
        })}
      </div>
      {/* The open firm's contact panel, under the pill row so a wide form does
          not break the pills' wrapping. */}
      {firms
        .filter((f) => f.id === detailsId)
        .map((f) => (
          <ContactPanel
            key={f.id}
            firm={f}
            readOnly={readOnly}
            busy={upsert.isPending}
            onSave={(patch) =>
              upsert.mutate({
                id: f.id,
                discipline: f.discipline,
                name: f.name,
                ...patch,
              })
            }
          />
        ))}
      {!readOnly && (
        <div className="flex gap-1.5">
          <input
            type="text"
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            onKeyDown={onAddKey}
            placeholder={`Add ${discipline} firm…`}
            className="flex-1 px-2.5 py-1 text-xs border border-border rounded bg-bg text-text outline-none focus:border-de"
            data-testid={`etd-add-${discipline}`}
          />
          <button
            onClick={addFirm}
            className="px-3 py-1 text-xs font-display font-semibold bg-de text-white rounded border border-de hover:bg-de/90"
            data-testid={`etd-add-btn-${discipline}`}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
