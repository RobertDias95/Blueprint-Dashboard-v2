import { useMemo, useState } from 'react';
import {
  groupByPerson,
  useBuilderRegistry,
  useDeactivateBuilder,
  useMergeBuilders,
  useUpsertBuilderRow,
  type BuilderRegistryRow,
} from '../../hooks/useBuilderRegistry';
import { chipStyle } from '../../lib/chipStyle';

// ===========================================================================
// ★★★ fix-448 §A (P-098) — BUILDERS & OWNERS, AS A REGISTRY
// ===========================================================================
//
// Bobby, 2026-08-29: *"in our settings, we should have a builder/owner
// database. and builders could have different llcs per project too."*
//
// ★★ ONE LINE PER LLC, UNDER THE PERSON (ruling 3). The table already stored
// it that way — Ghennadi Ialanji holds 3 rows, Ted Chesledon 2 — so this is a
// rendering of a shape prod has, not a new model. No schema change was needed
// to make ruling 3 true; the only column the migration adds is `updated_at`,
// because the table had no OCC token at all.
//
// ★★★ "PROJECTS" IS THE COLUMN THAT MAKES THE REST SAFE. Deactivating and
// merging are both decisions about other people's data, and the only question
// worth asking first is "how much of it?". Measured on prod 2026-08-29: 61
// rows, 56 in use, 5 linked to nothing, 148 projects linked, and the biggest
// single row is Kamala Saxton · Kuleana Homes LLC with 16.

const FIELDS = [
  { key: 'company', label: 'Company / LLC', width: 'w-56' },
  { key: 'email', label: 'Email', width: 'w-52' },
  { key: 'phone', label: 'Phone', width: 'w-36' },
  { key: 'address', label: 'Address', width: 'w-64' },
] as const;

type FieldKey = (typeof FIELDS)[number]['key'];

export default function BuildersRegistryPanel({
  readOnly = false,
}: {
  readOnly?: boolean;
}) {
  const q = useBuilderRegistry();
  const upsert = useUpsertBuilderRow();
  const deactivate = useDeactivateBuilder();
  const merge = useMergeBuilders();

  const [showInactive, setShowInactive] = useState(false);
  const [addingPerson, setAddingPerson] = useState(false);
  const [addingLlcFor, setAddingLlcFor] = useState<string | null>(null);
  const [mergePick, setMergePick] = useState<string[]>([]);

  const groups = useMemo(() => {
    const rows = (q.data ?? []).filter((r) => showInactive || r.active !== false);
    return groupByPerson(rows);
  }, [q.data, showInactive]);

  const byId = useMemo(() => {
    const m = new Map<string, BuilderRegistryRow>();
    for (const r of q.data ?? []) m.set(r.id, r);
    return m;
  }, [q.data]);

  function toggleMerge(id: string) {
    setMergePick((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : // ★ Two at a time. A three-way merge is two decisions wearing one
          //   confirm dialog, and the project counts stop being checkable.
          [...prev, id].slice(-2),
    );
  }

  const [loserId, winnerId] = mergePick;
  const loser = loserId ? byId.get(loserId) : undefined;
  const winner = winnerId ? byId.get(winnerId) : undefined;

  return (
    <div className="space-y-3" data-testid="builders-registry">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          disabled={readOnly}
          onClick={() => setAddingPerson(true)}
          className="text-[11px] px-2 py-1 rounded border"
          style={chipStyle(false, 'bg')}
          data-testid="builders-add-person"
        >
          + Add builder / owner
        </button>
        <button
          type="button"
          onClick={() => setShowInactive((v) => !v)}
          className="text-[11px] px-2 py-1 rounded border"
          style={chipStyle(showInactive, 'bg')}
          data-testid="builders-show-inactive"
          data-on={showInactive ? 'true' : 'false'}
        >
          Show deactivated
        </button>
        <span
          className="text-[11px] text-muted ml-auto font-mono"
          data-testid="builders-count"
        >
          {groups.length} {groups.length === 1 ? 'person' : 'people'} ·{' '}
          {groups.reduce((n, g) => n + g.rows.length, 0)} listed
        </span>
      </div>

      {/* ★★★ THE MERGE BAR. It appears only when two rows are picked, and it
          names BOTH sides in full plus the project count — because the two
          duplicates this feature exists for are not obvious from an id, and
          one of them is CROSS-PERSON (Bill Richmond / Will Richmond, both
          "JMS Homes, Inc"). See the migration for why merge is not restricted
          to rows sharing a name. */}
      {loser && winner && (
        <div
          className="rounded border px-3 py-2 text-[11px] flex items-center gap-2 flex-wrap"
          style={{
            borderColor: 'var(--color-de)',
            background: 'var(--color-de-bg, var(--color-s2))',
          }}
          data-testid="builders-merge-bar"
        >
          <span>
            Merge <strong>{describe(loser)}</strong> ({loser.projectCount}{' '}
            {loser.projectCount === 1 ? 'project' : 'projects'}) into{' '}
            <strong>{describe(winner)}</strong> ({winner.projectCount})
          </span>
          <button
            type="button"
            disabled={readOnly || merge.isPending}
            onClick={() => {
              merge.mutate({ loserId: loser.id, winnerId: winner.id });
              setMergePick([]);
            }}
            className="text-[11px] px-2 py-1 rounded border font-bold"
            style={chipStyle(true, 'bg')}
            data-testid="builders-merge-confirm"
          >
            Merge {loser.projectCount}{' '}
            {loser.projectCount === 1 ? 'project' : 'projects'} →
          </button>
          <button
            type="button"
            onClick={() => setMergePick([])}
            className="text-[11px] px-2 py-1 rounded border"
            style={chipStyle(false, 'bg')}
            data-testid="builders-merge-cancel"
          >
            Cancel
          </button>
        </div>
      )}

      {q.isLoading && (
        <div className="text-[11px] text-muted italic">Loading builders…</div>
      )}

      <div className="space-y-2">
        {groups.map((g) => (
          <div
            key={g.name}
            className="rounded border"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid={`builders-person-${g.name}`}
          >
            <div
              className="px-3 py-1.5 flex items-baseline gap-2 border-b"
              style={{
                borderBottomColor: 'var(--color-border)',
                background: 'var(--color-s2)',
              }}
            >
              <span className="text-[12px] font-display font-bold text-text">
                {g.name}
              </span>
              <span className="text-[10px] text-muted">
                {g.rows.length} {g.rows.length === 1 ? 'LLC' : 'LLCs'} ·{' '}
                {g.projectCount} {g.projectCount === 1 ? 'project' : 'projects'}
              </span>
              <button
                type="button"
                disabled={readOnly}
                onClick={() => setAddingLlcFor(g.name)}
                className="text-[10px] px-1.5 py-0.5 rounded border ml-auto"
                style={chipStyle(false, 'bg')}
                data-testid={`builders-add-llc-${g.name}`}
              >
                + LLC
              </button>
            </div>
            {g.rows.map((r) => (
              <BuilderLine
                key={r.id}
                row={r}
                readOnly={readOnly}
                merging={mergePick.includes(r.id)}
                onToggleMerge={() => toggleMerge(r.id)}
                onCommit={(field, value) =>
                  upsert.mutate({
                    id: r.id,
                    name: r.name,
                    [field]: value,
                    expectedUpdatedAt: r.updated_at ?? null,
                  })
                }
                onSetActive={(active) =>
                  deactivate.mutate({ id: r.id, active })
                }
              />
            ))}
          </div>
        ))}
        {!q.isLoading && groups.length === 0 && (
          <div className="text-[11px] text-dim italic px-3 py-6 text-center">
            No builders yet.
          </div>
        )}
      </div>

      {(addingPerson || addingLlcFor !== null) && (
        <AddBuilderRowDialog
          fixedName={addingLlcFor}
          busy={upsert.isPending}
          onCancel={() => {
            setAddingPerson(false);
            setAddingLlcFor(null);
          }}
          onSave={(input) => {
            upsert.mutate(input);
            setAddingPerson(false);
            setAddingLlcFor(null);
          }}
        />
      )}
    </div>
  );
}

function describe(r: BuilderRegistryRow): string {
  return r.company ? `${r.name} — ${r.company}` : r.name;
}

/** One LLC line. ★ Every field commits on blur/Enter and sends the row's OCC
 *  token with it, so two people editing one LLC cannot silently overwrite each
 *  other (fix-382). */
function BuilderLine({
  row,
  readOnly,
  merging,
  onToggleMerge,
  onCommit,
  onSetActive,
}: {
  row: BuilderRegistryRow;
  readOnly: boolean;
  merging: boolean;
  onToggleMerge: () => void;
  onCommit: (field: FieldKey, value: string) => void;
  onSetActive: (active: boolean) => void;
}) {
  const inactive = row.active === false;
  return (
    <div
      className="px-3 py-1.5 flex items-center gap-2 flex-wrap border-b last:border-b-0"
      style={{
        borderBottomColor: 'var(--color-border)',
        // ★★ A deactivated row is GREYED, not hidden and never deleted — it is
        //    still the answer to "who built 5627 44th Ave SW".
        opacity: inactive ? 0.5 : 1,
        background: merging ? 'var(--color-de-bg, var(--color-s2))' : undefined,
      }}
      data-testid={`builders-row-${row.id}`}
      data-active={inactive ? 'false' : 'true'}
    >
      {FIELDS.map((f) => (
        <BufferedCell
          key={f.key}
          value={row[f.key] ?? ''}
          placeholder={f.label}
          className={f.width}
          disabled={readOnly}
          onCommit={(v) => onCommit(f.key, v)}
          testid={`builders-${row.id}-${f.key}`}
        />
      ))}
      <span
        className="text-[10px] font-mono text-muted whitespace-nowrap"
        data-testid={`builders-${row.id}-projects`}
      >
        {row.projectCount} {row.projectCount === 1 ? 'project' : 'projects'}
      </span>
      <button
        type="button"
        disabled={readOnly}
        onClick={onToggleMerge}
        className="text-[10px] px-1.5 py-0.5 rounded border"
        style={chipStyle(merging, 'bg')}
        title="Pick two rows to merge one into the other"
        data-testid={`builders-${row.id}-merge-pick`}
        data-on={merging ? 'true' : 'false'}
      >
        Merge
      </button>
      <button
        type="button"
        disabled={readOnly}
        onClick={() => onSetActive(inactive)}
        className="text-[10px] px-1.5 py-0.5 rounded border"
        style={chipStyle(false, 'bg')}
        data-testid={`builders-${row.id}-active`}
      >
        {inactive ? 'Reactivate' : 'Deactivate'}
      </button>
    </div>
  );
}

/** ★ Local draft, committed on blur or Enter — the BufferedDateInput shape the
 *  house uses for anything that writes to the server on change (a raw onChange
 *  would save a transient half-typed value on every keystroke). */
function BufferedCell({
  value,
  placeholder,
  className,
  disabled,
  onCommit,
  testid,
}: {
  value: string;
  placeholder: string;
  className?: string;
  disabled?: boolean;
  onCommit: (v: string) => void;
  testid: string;
}) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  // ★ An external refresh must not clobber a value being typed — fix-73/98's
  //   dirty-flag rule, the same one the Library's unit row uses.
  if (!dirty && draft !== value) setDraft(value);
  return (
    <input
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => {
        setDirty(true);
        setDraft(e.target.value);
      }}
      onBlur={() => {
        setDirty(false);
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDirty(false);
          setDraft(value);
        }
      }}
      className={`text-[11px] px-1.5 py-0.5 border rounded ${className ?? ''}`}
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-surface)',
        color: 'var(--color-text)',
      }}
      data-testid={testid}
    />
  );
}

/** ★★ Add a person, or add an LLC under one. Same dialog: when `fixedName` is
 *  set the person is decided and only the LLC is asked for — ruling 3, and the
 *  same pre-fill the Overview cell's "Add new builder…" does. */
function AddBuilderRowDialog({
  fixedName,
  busy,
  onCancel,
  onSave,
}: {
  fixedName: string | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: {
    name: string;
    company: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
  }) => void;
}) {
  const [name, setName] = useState(fixedName ?? '');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const canSave = name.trim() !== '' && !busy;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      data-testid="builders-add-dialog"
    >
      <div
        className="rounded-xl border p-4 w-[420px] space-y-2"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-surface)',
        }}
      >
        <div className="text-[13px] font-display font-extrabold uppercase tracking-wide text-text">
          {fixedName ? `New LLC for ${fixedName}` : 'New builder / owner'}
        </div>
        {!fixedName && (
          <Labelled label="Name (person)">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-[12px] px-2 py-1 border rounded"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
              data-testid="builders-add-name"
            />
          </Labelled>
        )}
        <Labelled label="Company / LLC">
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="w-full text-[12px] px-2 py-1 border rounded"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            data-testid="builders-add-company"
          />
        </Labelled>
        <Labelled label="Email">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full text-[12px] px-2 py-1 border rounded"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            data-testid="builders-add-email"
          />
        </Labelled>
        <Labelled label="Phone">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full text-[12px] px-2 py-1 border rounded"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            data-testid="builders-add-phone"
          />
        </Labelled>
        <Labelled label="LLC address">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full text-[12px] px-2 py-1 border rounded"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            data-testid="builders-add-address"
          />
        </Labelled>
        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="text-[11px] px-2 py-1 rounded border"
            style={chipStyle(false, 'bg')}
            data-testid="builders-add-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() =>
              onSave({
                name: name.trim(),
                company: company.trim() || null,
                email: email.trim() || null,
                phone: phone.trim() || null,
                address: address.trim() || null,
              })
            }
            className="text-[11px] px-2 py-1 rounded border font-bold"
            style={chipStyle(true, 'bg')}
            data-testid="builders-add-save"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Labelled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[9px] font-semibold text-muted uppercase tracking-wide">
        {label}
      </span>
      {children}
    </label>
  );
}
