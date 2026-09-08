import { useState } from 'react';
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
  DEFAULT_JURISDICTIONS,
  JURISDICTION_LINKS_KEY,
  NO_LINKS_YET,
  isSafeJurisdictionUrl,
  readJurisdictions,
  type Jurisdiction,
  type JurisdictionLink,
} from '../../lib/jurisdictionLinks';
import { useAppConfig } from '../../hooks/useAppConfig';
import { useSetAppConfigKey } from '../../hooks/useSetAppConfigKey';

// ===========================================================================
// ★★★ fix-485 §A3 (P-147) — THE JURISDICTION LINK REGISTRY, EDITED
// ===========================================================================
//
// Bobby: *"a drop-down of Seattle, Kirkland, Bellevue with folders inside that
// take you to their GIS, their code, whatever."*
//
// ★★ THE fix-415 PATTERN: an `app_config` key, edited in Settings → Lists &
// Catalogs, read by the surface that renders it. A fourth city needs no deploy
// and a URL a city changes needs no deploy either.
//
// ---------------------------------------------------------------------------
// ★★★ THIS IS NOT THE "Jurisdictions" SECTION ABOVE IT, AND THAT IS DELIBERATE
// ---------------------------------------------------------------------------
// That one edits `public.jurisdictions` — the permitting VOCABULARY: which
// juris a permit can belong to, and its learning window. This edits a
// NAVIGATION convenience: the handful of cities worth a shortcut, and where
// their GIS and code live.
//
// They will overlap and they are not the same list. The app tracks
// jurisdictions the team has one project in; Bobby named three worth a folder.
// Deriving this from that would put every juris in the ribbon; deriving that
// from this would let a nav shortcut invent a permitting jurisdiction. So: two
// registries, one sentence each saying which is which.
//
// ★ A row with NO links is a first-class state, not an empty one — the three
//   seeded cities are exactly that until Bobby supplies URLs, and the ribbon
//   says `NO_LINKS_YET` rather than hiding the city.
//
// ---------------------------------------------------------------------------
// ★★★ fix-503 §B (P-165) — ORDER IS A DECISION, AND A TYPO IS NOT A REBUILD
// ---------------------------------------------------------------------------
//
// Bobby, 2026-09-04: *"being able to drag or reorganize the links so we can…
// rearrange their priority, or being able to click into the name of the link so
// that we can rename it if we spelled it wrong."*
//
// ★★★ THE STORED VALUE WAS ALREADY AN ORDERED ARRAY and the ribbon already
//     rendered it in order — so "priority" needed no schema, only a way to say
//     it. Drag writes the same key through the same `setKey.mutate`, and the
//     ribbon follows with no deploy.
//
// ★★ RENAME CHANGES THE LABEL AND NOTHING ELSE. Bobby's word was "if we spelled
//    it wrong": a typo fix, not a re-point. Changing where a link GOES is still
//    remove + add, deliberately — a URL edited in place is a link that silently
//    leads somewhere new under a name people already trust, which is the
//    fix-306 defect class from the inside.
//
// ★★★ AN EMPTY LABEL IS REJECTED, AND IT HAS TO BE. `readJurisdictions` DROPS a
//     row whose label is blank — so committing one would not save an unnamed
//     link, it would DELETE the link on the next read, with a rename gesture. A
//     rename that can destroy the row is the worst possible shape for this
//     control.
//
// ★ ROWS ARE KEYED BY `url`, NOT `label|url`. The old key changed the moment a
//   label did, so React would unmount the row mid-edit and the input would lose
//   focus and its draft. `url` is unique within a city (a second link to the
//   same page is the same link) and is the one field a rename cannot touch.

export default function JurisdictionLinksEditor({
  readOnly = false,
}: {
  readOnly?: boolean;
}) {
  const cfg = useAppConfig();
  const setKey = useSetAppConfigKey();
  const cities = readJurisdictions(cfg.map);

  const [cityDraft, setCityDraft] = useState('');
  const [linkDraft, setLinkDraft] = useState<Record<string, { label: string; url: string }>>({});

  /** ★ Every write replaces the whole key — `bp_set_app_config_key` is a
   *  single-key JSONB upsert and the client builds the next value, which is how
   *  every other catalogue on this tab writes. */
  function save(next: Jurisdiction[]) {
    setKey.mutate({ key: JURISDICTION_LINKS_KEY, value: next });
  }

  function addCity() {
    const name = cityDraft.trim();
    if (!name) return;
    // ★ Case-insensitive, because "seattle" and "Seattle" are one city and two
    //   folders in the ribbon would be the fix-415 zone-spelling problem again.
    if (cities.some((c) => c.city.toLowerCase() === name.toLowerCase())) {
      setCityDraft('');
      return;
    }
    save([...cities, { city: name, links: [] }]);
    setCityDraft('');
  }

  function removeCity(city: string) {
    save(cities.filter((c) => c.city !== city));
  }

  function addLink(city: string) {
    const d = linkDraft[city];
    const label = (d?.label ?? '').trim();
    const url = (d?.url ?? '').trim();
    if (!label || !isSafeJurisdictionUrl(url)) return;
    save(
      cities.map((c) =>
        c.city === city ? { ...c, links: [...c.links, { label, url }] } : c,
      ),
    );
    setLinkDraft((p) => ({ ...p, [city]: { label: '', url: '' } }));
  }

  function removeLink(city: string, index: number) {
    save(
      cities.map((c) =>
        c.city === city
          ? { ...c, links: c.links.filter((_, i) => i !== index) }
          : c,
      ),
    );
  }

  /** ★ One place builds the next `links` array for a city, so drag, the arrows
   *  and rename cannot disagree about how a write is shaped. */
  function saveLinks(city: string, links: JurisdictionLink[]) {
    save(cities.map((c) => (c.city === city ? { ...c, links } : c)));
  }

  /** Move the link at `from` to `to`, clamped. Used by BOTH the drag and the
   *  ▲/▼ buttons — one reorder, two gestures. */
  function moveLink(city: string, from: number, to: number) {
    const c = cities.find((x) => x.city === city);
    if (!c) return;
    if (to < 0 || to >= c.links.length || from === to) return;
    const next = [...c.links];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    saveLinks(city, next);
  }

  /** ★★ Label only. `url` is carried through untouched — see the note above on
   *  why re-pointing a link is remove + add rather than an edit. */
  function renameLink(city: string, index: number, label: string) {
    const name = label.trim();
    // ★★★ An empty label would be DROPPED by readJurisdictions, turning a
    //     rename into a silent delete. Reject rather than save.
    if (!name) return;
    const c = cities.find((x) => x.city === city);
    if (!c) return;
    const cur = c.links[index];
    if (!cur || cur.label === name) return;
    saveLinks(
      city,
      c.links.map((l, i) => (i === index ? { ...l, label: name } : l)),
    );
  }

  // ★ The same sensors TaskTemplateEditor and QuarterLayoutEditor use — a 4px
  //   activation distance so a click on the label is a click, not a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(city: string, e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const c = cities.find((x) => x.city === city);
    if (!c) return;
    const from = c.links.findIndex((l) => l.url === String(active.id));
    const to = c.links.findIndex((l) => l.url === String(over.id));
    if (from < 0 || to < 0) return;
    moveLink(city, from, to);
  }

  const inputCls =
    'text-[11px] px-2 py-1 border border-border rounded bg-surface text-text outline-none focus:border-de';

  return (
    <div className="space-y-3" data-testid="jurisdiction-links-editor">
      {/* ★ fix-503: the ribbon no longer has a "Jurisdictions" folder — the
          cities are rows in the Links section — so the caption stops naming
          one, and it says out loud that order and names take effect
          immediately, because that is the question somebody dragging a row
          will have. */}
      <p className="text-[11px] text-muted">
        Cities in the ribbon&apos;s <strong>Links</strong> section, and where
        each one&apos;s GIS, code and portal live. Drag a link to set its
        priority, or click its name to fix a typo — the ribbon reads this same
        list, so both show there straight away. Separate from the permitting{' '}
        <em>Jurisdictions</em> list above — this one is navigation.
      </p>

      {cities.length === 0 && (
        <div className="text-[11px] text-dim italic" data-testid="juris-links-empty">
          No cities yet. Add one to give it a folder in the ribbon.
        </div>
      )}

      {cities.map((c) => (
        <div
          key={c.city}
          className="border border-border rounded-lg p-3 space-y-2"
          data-testid={`juris-links-city-${c.city}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-display font-bold text-text">
              {c.city}
            </span>
            {!readOnly && (
              <button
                type="button"
                onClick={() => removeCity(c.city)}
                className="text-[11px] text-muted hover:text-er"
                title={`Remove ${c.city}`}
                data-testid={`juris-links-remove-city-${c.city}`}
              >
                ×
              </button>
            )}
          </div>

          {c.links.length === 0 ? (
            <div
              className="text-[11px] text-dim italic"
              data-testid={`juris-links-none-${c.city}`}
            >
              {NO_LINKS_YET}
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(e) => handleDragEnd(c.city, e)}
            >
              <SortableContext
                items={c.links.map((l) => l.url)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="space-y-1">
                  {c.links.map((l, i) => (
                    <LinkRow
                      // ★★ KEYED BY `url`. A `label|url` key changes the instant
                      //    a rename does, unmounting the row mid-edit and taking
                      //    the input's focus and draft with it.
                      key={l.url}
                      city={c.city}
                      link={l}
                      index={i}
                      count={c.links.length}
                      readOnly={readOnly}
                      onRename={(label) => renameLink(c.city, i, label)}
                      onMove={(to) => moveLink(c.city, i, to)}
                      onRemove={() => removeLink(c.city, i)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}

          {!readOnly && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={linkDraft[c.city]?.label ?? ''}
                onChange={(e) =>
                  setLinkDraft((p) => ({
                    ...p,
                    [c.city]: { label: e.target.value, url: p[c.city]?.url ?? '' },
                  }))
                }
                placeholder="Label (GIS, Code…)"
                className={`${inputCls} w-32 flex-none`}
                data-testid={`juris-links-label-${c.city}`}
              />
              <input
                type="url"
                value={linkDraft[c.city]?.url ?? ''}
                onChange={(e) =>
                  setLinkDraft((p) => ({
                    ...p,
                    [c.city]: { label: p[c.city]?.label ?? '', url: e.target.value },
                  }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addLink(c.city);
                }}
                placeholder="https://…"
                className={`${inputCls} flex-1 min-w-0`}
                data-testid={`juris-links-url-${c.city}`}
              />
              {/* ★★ THE BUTTON IS DISABLED UNTIL THE URL IS ONE. `http(s)` only
                  — a stored value reaches an `href`, and fix-387's finding
                  ("starts with /" is not a safe URL rule) is the same problem
                  from the other end. The reader drops an unsafe row too; this
                  is the half that stops one being written. */}
              <button
                type="button"
                onClick={() => addLink(c.city)}
                disabled={
                  !(linkDraft[c.city]?.label ?? '').trim() ||
                  !isSafeJurisdictionUrl(linkDraft[c.city]?.url ?? '')
                }
                className="text-[11px] font-bold px-2 py-1 rounded border border-border bg-surface text-muted disabled:opacity-40"
                data-testid={`juris-links-add-${c.city}`}
              >
                Add link
              </button>
            </div>
          )}
        </div>
      ))}

      {!readOnly && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={cityDraft}
            onChange={(e) => setCityDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addCity();
            }}
            placeholder="Add city…"
            className={`${inputCls} w-48`}
            data-testid="juris-links-add-city-input"
          />
          <button
            type="button"
            onClick={addCity}
            className="text-[11px] font-bold px-2 py-1 rounded border border-border bg-surface text-muted"
            data-testid="juris-links-add-city"
          >
            Add city
          </button>
          {/* ★ The seeded three, restorable. Somebody who clears the list and
              wants it back should not have to remember which cities were in it
              — and the constant is the same one the reader falls back to. */}
          <button
            type="button"
            onClick={() => save([...DEFAULT_JURISDICTIONS])}
            className="text-[11px] text-muted hover:text-text ml-auto"
            title="Restore Seattle, Kirkland and Bellevue (links are not touched on cities that already exist)"
            data-testid="juris-links-restore-defaults"
          >
            Restore the three defaults
          </button>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// ★★★ fix-503 §B — ONE LINK ROW: drag handle · name · url · ▲▼ · ×
// ===========================================================================
//
// ★★ THE ARROWS ARE NOT A CONSOLATION PRIZE. They are the keyboard path AND the
//    touch path: `@dnd-kit`'s pointer sensor needs a drag gesture that a phone
//    gives grudgingly and a keyboard cannot give at all, and Settings is a
//    screen people do open on a tablet. Both gestures call the SAME `moveLink`,
//    so there is one reorder with two ways in rather than two reorders.
//
// ★ The handle carries `touch-none`, matching TaskTemplateEditor: without it a
//   touch-drag scrolls the page instead of moving the row.
function LinkRow({
  city,
  link,
  index,
  count,
  readOnly,
  onRename,
  onMove,
  onRemove,
}: {
  city: string;
  link: JurisdictionLink;
  index: number;
  count: number;
  readOnly: boolean;
  onRename: (label: string) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: link.url, disabled: readOnly });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(link.label);

  function start() {
    if (readOnly) return;
    setDraft(link.label);
    setEditing(true);
  }
  function commit() {
    // ★★★ Empty is REJECTED, not saved: readJurisdictions drops a label-less
    //     row, so committing one would delete the link. Falling back to the
    //     current label makes the gesture a no-op instead.
    onRename(draft);
    setEditing(false);
  }

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="flex items-center gap-2 text-[11px]"
      data-testid={`juris-links-link-${city}-${link.label}`}
    >
      {!readOnly && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="text-dim hover:text-text cursor-grab active:cursor-grabbing leading-none px-1 flex-none touch-none"
          title="Drag to reorder"
          aria-label={`Drag ${link.label} to reorder`}
          data-testid={`juris-links-drag-${city}-${link.label}`}
        >
          ⠿
        </button>
      )}

      {editing && !readOnly ? (
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setDraft(link.label);
              setEditing(false);
            }
          }}
          className="w-24 flex-none text-[11px] px-1 py-0 border border-de rounded bg-bg text-text outline-none"
          data-testid={`juris-links-rename-${city}-${link.url}`}
        />
      ) : (
        <span
          onClick={start}
          className={`font-semibold text-text w-24 flex-none truncate ${
            readOnly ? '' : 'cursor-text hover:underline'
          }`}
          title={readOnly ? link.label : `${link.label} — click to rename`}
          data-testid={`juris-links-label-text-${city}-${link.label}`}
        >
          {link.label}
        </span>
      )}

      {/* ★ The URL is NOT editable here — see the note at the top of the file.
          Renaming fixes a spelling; re-pointing is remove + add. */}
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-de truncate flex-1 min-w-0"
      >
        {link.url}
      </a>

      {!readOnly && (
        <>
          <button
            type="button"
            onClick={() => onMove(index - 1)}
            disabled={index === 0}
            className="text-muted hover:text-text flex-none disabled:opacity-30"
            title={`Move ${link.label} up`}
            aria-label={`Move ${link.label} up`}
            data-testid={`juris-links-up-${city}-${link.label}`}
          >
            ▲
          </button>
          <button
            type="button"
            onClick={() => onMove(index + 1)}
            disabled={index === count - 1}
            className="text-muted hover:text-text flex-none disabled:opacity-30"
            title={`Move ${link.label} down`}
            aria-label={`Move ${link.label} down`}
            data-testid={`juris-links-down-${city}-${link.label}`}
          >
            ▼
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="text-muted hover:text-er flex-none"
            title={`Remove ${link.label}`}
            data-testid={`juris-links-remove-${city}-${link.label}`}
          >
            ×
          </button>
        </>
      )}
    </li>
  );
}
