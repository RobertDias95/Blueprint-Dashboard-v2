import { useState } from 'react';
import {
  DEFAULT_JURISDICTIONS,
  JURISDICTION_LINKS_KEY,
  NO_LINKS_YET,
  isSafeJurisdictionUrl,
  readJurisdictions,
  type Jurisdiction,
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

  const inputCls =
    'text-[11px] px-2 py-1 border border-border rounded bg-surface text-text outline-none focus:border-de';

  return (
    <div className="space-y-3" data-testid="jurisdiction-links-editor">
      <p className="text-[11px] text-muted">
        Cities in the ribbon&apos;s <strong>Links → Jurisdictions</strong>{' '}
        folder, and where each one&apos;s GIS, code and portal live. Separate
        from the permitting <em>Jurisdictions</em> list above — this one is
        navigation.
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
            <ul className="space-y-1">
              {c.links.map((l, i) => (
                <li
                  key={`${l.label}|${l.url}`}
                  className="flex items-center gap-2 text-[11px]"
                  data-testid={`juris-links-link-${c.city}-${l.label}`}
                >
                  <span className="font-semibold text-text w-24 flex-none truncate">
                    {l.label}
                  </span>
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-de truncate flex-1 min-w-0"
                  >
                    {l.url}
                  </a>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => removeLink(c.city, i)}
                      className="text-muted hover:text-er flex-none"
                      title={`Remove ${l.label}`}
                      data-testid={`juris-links-remove-${c.city}-${l.label}`}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
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
