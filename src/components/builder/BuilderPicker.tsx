import { useEffect, useMemo, useRef, useState } from 'react';
import { useBuilderSearch } from '../../hooks/useBuilderSearch';
import { useUpsertBuilderRow } from '../../hooks/useBuilderRegistry';
import type { Builder } from '../../lib/database.types';

// ===========================================================================
// ★★★ fix-448 §B (P-082) — THE BUILDER/OWNER CELL IS PICK-ONLY
// ===========================================================================
//
// Bobby, 2026-08-29: *"The Builder/Owner cell on Project Overview is PICK-ONLY,
// like Zone (fix-415). Typing a name that is not in the catalog offers 'Add new
// builder…' which creates the catalog row and links it. Text and link can never
// disagree again."*
//
// ---------------------------------------------------------------------------
// ★★★ WHAT WAS ACTUALLY WRONG, AND WHY PICK-ONLY IS THE FIX
// ---------------------------------------------------------------------------
//
// The cell was five free-text boxes with a catalogue autocomplete bolted on.
// Picking wrote `builder_id` plus five cache columns; then TYPING over the name
// left `builder_id` pointing at the row you had just stopped naming. fix-425
// added a half-measure — clearing the name clears the link — and froze the
// surface. This is the other half: there is no free-text commit path left, so
// the only ways the five cache columns can change are a pick, an add, or a
// clear, and all three write the link in the same patch.
//
// ★★ BLUR WITHOUT A PICK REVERTS. Not "saves what you typed", not "warns" —
// reverts to the linked value, silently and immediately, because the typed text
// was a SEARCH not an edit. That is what makes the guarantee absolute rather
// than a rule people have to remember.
//
// ★★★ RESULTS ARE GROUPED BY PERSON AND EACH LLC IS ITS OWN CHOICE (ruling 3).
// Ghennadi Ialanji holds 3 catalogue rows and Ted Chesledon 2; picking "Ted
// Chesledon" is not a choice anybody can act on, picking "Ted Chesledon —
// Cooper Thomas Homes, LLC" is.

export interface BuilderPickerProps {
  /** The linked row's display name, or '' when nothing is linked. */
  value: string;
  /** The company of the linked row, for the "person matches, LLC does not" case. */
  linkedCompany?: string | null;
  onPick: (b: Builder) => void;
  /** Create a catalogue row and link it in one gesture. */
  onCreated: (b: Builder) => void;
  onClear: () => void;
  disabled?: boolean;
  inputClassName?: string;
  inputStyle?: React.CSSProperties;
  testid?: string;
}

export default function BuilderPicker({
  value,
  onPick,
  onCreated,
  onClear,
  disabled,
  inputClassName,
  inputStyle,
  testid = 'pd-builder-picker',
}: BuilderPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState<{ name: string; company: string } | null>(
    null,
  );
  const blurTimer = useRef<number | null>(null);
  const { data: results, isLoading } = useBuilderSearch(open ? query : '');
  const upsert = useUpsertBuilderRow();

  // ★★ ACTIVE ONLY. `useBuilderSearch` does not filter — measured on
  //    origin/main, despite a comment elsewhere claiming it does — and a
  //    deactivated row must not be pickable, or Settings' Deactivate button
  //    would mean nothing here.
  const live = useMemo(
    () => (results ?? []).filter((b) => b.active !== false),
    [results],
  );

  const groups = useMemo(() => {
    const m = new Map<string, Builder[]>();
    for (const b of live) {
      const key = (b.name ?? '').trim().toLowerCase();
      m.set(key, [...(m.get(key) ?? []), b]);
    }
    return [...m.values()].sort((a, b) =>
      (a[0]!.name ?? '').localeCompare(b[0]!.name ?? ''),
    );
  }, [live]);

  const typed = query.trim();
  // ★★★ THE PERSON-MATCH CASE (ruling 3). If what you typed IS an existing
  //     person but none of their LLCs match, the dialog should not ask you to
  //     retype their name — it asks only for the new LLC.
  const personMatch = useMemo(() => {
    if (typed === '') return null;
    const hit = live.find(
      (b) => (b.name ?? '').trim().toLowerCase() === typed.toLowerCase(),
    );
    return hit ? hit.name : null;
  }, [live, typed]);

  // ★★★ fix-452: THE BLUR TIMER MUST DIE WITH THE COMPONENT.
  //
  // fix-448 defers `close()` by 120ms so a click on a result lands before the
  // menu unmounts. If the component goes away inside that window the timer
  // still fires and calls `setOpen` on nothing — which CI caught as an
  // UNHANDLED "ReferenceError: window is not defined" from React's scheduler,
  // thrown after the test environment had been torn down. All 7,493 tests
  // passed and the run still failed, which is exactly what a stray timer looks
  // like: not a flake, a leak that only sometimes lands after teardown.
  useEffect(
    () => () => {
      if (blurTimer.current) window.clearTimeout(blurTimer.current);
    },
    [],
  );

  function close() {
    setOpen(false);
    // ★ The typed text is a SEARCH. Dropping it is what "blur without a pick
    //   reverts" means — the displayed value comes from the link, always.
    setQuery('');
  }

  return (
    <div className="relative" data-testid={`${testid}-wrap`}>
      <div className="flex items-center gap-1">
        <input
          value={open ? query : value}
          disabled={disabled}
          placeholder={value ? undefined : 'Search builders…'}
          onFocus={() => {
            setOpen(true);
            setQuery('');
          }}
          onChange={(e) => {
            setOpen(true);
            setQuery(e.target.value);
          }}
          onBlur={() => {
            // ★ Deferred so a click on a result lands before the menu closes.
            blurTimer.current = window.setTimeout(close, 120);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
          }}
          className={inputClassName}
          style={inputStyle}
          data-testid={testid}
          role="combobox"
          aria-expanded={open}
        />
        {value !== '' && !disabled && (
          // ★★★ fix-425's clear, unchanged in meaning: the link and all five
          //     cache fields go together. Never one without the other (§B3).
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClear}
            className="text-dim hover:text-text text-[11px] leading-none px-1"
            title="Clear builder"
            data-testid={`${testid}-clear`}
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <div
          className="absolute z-30 mt-1 left-0 min-w-[260px] max-h-64 overflow-y-auto rounded border shadow-lg"
          style={{
            background: 'var(--color-panel)',
            borderColor: 'var(--color-border)',
          }}
          onMouseDown={() => {
            if (blurTimer.current) window.clearTimeout(blurTimer.current);
          }}
          data-testid={`${testid}-menu`}
        >
          {isLoading && (
            <div className="px-2 py-1.5 text-[11px] text-muted italic">
              Searching…
            </div>
          )}
          {groups.map((rows) => (
            <div key={rows[0]!.name} data-testid={`${testid}-group-${rows[0]!.name}`}>
              <div
                className="px-2 pt-1.5 pb-0.5 text-[9px] font-bold uppercase tracking-wide"
                style={{ color: 'var(--color-dim)' }}
              >
                {rows[0]!.name}
              </div>
              {rows.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    onPick(b);
                    close();
                  }}
                  className="block w-full text-left px-2 py-1 text-[11px] hover:bg-s2"
                  style={{ color: 'var(--color-text)' }}
                  data-testid={`${testid}-option-${b.id}`}
                >
                  {/* ★ "Ted Chesledon — Cooper Thomas Homes, LLC": each LLC is
                      its own choice, named in full, so two rows of one person
                      are never ambiguous. */}
                  {b.name}
                  {b.company ? ` — ${b.company}` : ''}
                </button>
              ))}
            </div>
          ))}
          {!isLoading && typed !== '' && (
            <button
              type="button"
              onClick={() =>
                setAdding(
                  personMatch
                    ? { name: personMatch, company: '' }
                    : { name: typed, company: '' },
                )
              }
              className="block w-full text-left px-2 py-1.5 text-[11px] border-t font-bold"
              style={{
                borderTopColor: 'var(--color-border)',
                color: 'var(--color-de)',
              }}
              data-testid={`${testid}-add-new`}
            >
              {personMatch
                ? `Add a new LLC for ${personMatch}…`
                : `Add new builder “${typed}”…`}
            </button>
          )}
          {!isLoading && groups.length === 0 && typed === '' && (
            <div className="px-2 py-1.5 text-[11px] text-muted italic">
              Type to search the catalogue.
            </div>
          )}
        </div>
      )}

      {adding && (
        <AddBuilderInline
          initialName={adding.name}
          nameLocked={personMatch !== null}
          busy={upsert.isPending}
          onCancel={() => setAdding(null)}
          onSave={(input) => {
            upsert.mutate(input, {
              onSuccess: (row) => {
                onCreated(row);
                setAdding(null);
                close();
              },
            });
          }}
        />
      )}
    </div>
  );
}

/** ★ The AddPersonDialog shape (fix-436): a small modal, one required field,
 *  save disabled until it is filled. Name is locked when the person already
 *  exists — ruling 3's "asks only for the new LLC". */
function AddBuilderInline({
  initialName,
  nameLocked,
  busy,
  onCancel,
  onSave,
}: {
  initialName: string;
  nameLocked: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: (i: {
    name: string;
    company: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
  }) => void;
}) {
  const [name, setName] = useState(initialName);
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const inputCls = 'w-full text-[12px] px-2 py-1 border rounded';
  const inputSty = {
    borderColor: 'var(--color-border)',
    background: 'var(--color-surface)',
    color: 'var(--color-text)',
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      data-testid="builder-add-dialog"
    >
      <div
        className="rounded-xl border p-4 w-[400px] space-y-2"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-surface)',
        }}
      >
        <div className="text-[13px] font-display font-extrabold uppercase tracking-wide text-text">
          {nameLocked ? `New LLC for ${initialName}` : 'New builder / owner'}
        </div>
        <input
          value={name}
          readOnly={nameLocked}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (person)"
          className={inputCls}
          style={{ ...inputSty, opacity: nameLocked ? 0.6 : 1 }}
          data-testid="builder-add-name"
        />
        <input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Company / LLC"
          className={inputCls}
          style={inputSty}
          data-testid="builder-add-company"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className={inputCls}
          style={inputSty}
          data-testid="builder-add-email"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone"
          className={inputCls}
          style={inputSty}
          data-testid="builder-add-phone"
        />
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="LLC address"
          className={inputCls}
          style={inputSty}
          data-testid="builder-add-address"
        />
        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="text-[11px] px-2 py-1 rounded border"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            data-testid="builder-add-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={name.trim() === '' || busy}
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
            style={{
              borderColor: 'var(--color-de)',
              color: 'var(--color-de)',
            }}
            data-testid="builder-add-save"
          >
            Save & link
          </button>
        </div>
      </div>
    </div>
  );
}
