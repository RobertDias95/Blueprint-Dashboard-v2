import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  useCorrectionClusterDetail,
  useCorrectionClusterRanking,
  useRebuildCorrectionClusters,
  useSetCorrectionCuration,
} from '../hooks/useCorrectionClusters';
import {
  CURATION_CONTROLS,
  chipsOf,
  clusterName,
  isSingleProject,
  projectsOf,
  reachVerdict,
  wordingsOf,
  type CorrectionCluster,
} from '../lib/correctionClusters';

// ===========================================================================
// ★★★ fix-372 — the two levels underneath the corrections report
// ===========================================================================
//
// Bobby: *"let's look at category missing info. What makes up that 78%? Is it
// 42% are getting this one correction, and then it applies to 36 projects, and
// then we can just click and see all 36 projects."*
//
// ★★ THE EXISTING REPORT IS LEVEL ONE and nothing about it changes; its rows
// link here. This page is level two (the ranked recurring corrections) and
// level three (what one of them actually says), and level three is the payload
// — the report is worthless without it.
//
// ★★★ NO LEVEL DEAD-ENDS. Every row opens, every opened row shows its extracted
// sheets and codes, its verbatim wordings and its projects, and every curation
// control does the thing its description says.

const JURIS_OPTIONS = ['Seattle', 'Bellevue', 'Edmonds', 'Kirkland', 'Redmond'];

export default function CorrectionPatterns() {
  const [params, setParams] = useSearchParams();
  const juris = params.get('juris');
  const tier = params.get('tier') === 'body' ? 'body' : 'subject';
  const includeVerbatim = params.get('verbatim') === '1';
  const openKey = params.get('open');
  const subjectFilter = params.get('subject');

  const rankingQ = useCorrectionClusterRanking(juris, tier, includeVerbatim);
  const rebuild = useRebuildCorrectionClusters();

  const rows = useMemo(() => {
    const all = rankingQ.data ?? [];
    // ★ The RPC already orders by project reach; the subject filter is the only
    // thing applied here, and it never re-sorts.
    return subjectFilter ? all.filter((r) => r.subject === subjectFilter) : all;
  }, [rankingQ.data, subjectFilter]);

  // ★ Hidden by the verbatim default, counted out loud. "N hidden" is the
  // fix-298 / fix-370 pattern: never a silent filter.
  const verbatimQ = useCorrectionClusterRanking(juris, tier, true);
  const hiddenVerbatim = (verbatimQ.data ?? []).filter((r) => r.is_verbatim).length;

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    if (key !== 'open') next.delete('open');
    setParams(next, { replace: true });
  };

  const scope = rows[0]?.scope_projects ?? 0;

  return (
    <div className="space-y-3" data-testid="correction-patterns">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-extrabold text-text">Recurring corrections</h1>
        <span className="text-[11px] text-muted" data-testid="patterns-scope">
          {rows.length} pattern{rows.length === 1 ? '' : 's'} ·{' '}
          {scope} project{scope === 1 ? '' : 's'} with corrections in scope
        </span>
        <Link
          to="/reports/corrections"
          className="text-[11px] text-de hover:underline no-underline"
          data-testid="patterns-back"
        >
          ← Corrections report
        </Link>
      </div>

      {/* ★★★ RANKED BY SHARE OF PROJECTS, and the header says so where somebody
          will read it. Measured: Bellevue sends 31.8 items per letter against
          Seattle's 3.1, so `(no subject)` is the largest bucket in the corpus
          (484 items) and ONE project. Ranking on items would put it first; it
          comes 183rd. */}
      <p className="text-[10.5px] text-dim" data-testid="patterns-ranking-note">
        Ranked by the share of projects hit, never by how many comments there are.
        One Bellevue letter carries ten times the rows of a Seattle one, so a
        count would put two Bellevue projects above a pattern hitting seventy-five.
      </p>

      <div className="flex flex-wrap items-center gap-2" data-testid="patterns-filters">
        <label className="text-[11px] text-muted flex items-center gap-1.5">
          Jurisdiction
          <select
            value={juris ?? ''}
            onChange={(e) => setParam('juris', e.target.value || null)}
            className="text-[11px] bg-surface border border-border rounded-md px-1.5 py-1 text-text"
            data-testid="patterns-juris"
          >
            <option value="">All</option>
            {JURIS_OPTIONS.map((j) => (
              <option key={j} value={j}>{j}</option>
            ))}
          </select>
        </label>

        <div className="flex gap-1" data-testid="patterns-tier">
          {(['subject', 'body'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setParam('tier', t)}
              className="text-[10.5px] font-bold px-2.5 py-1 rounded-md border transition"
              style={{
                background: tier === t ? 'var(--color-de)' : 'var(--color-surface)',
                color: tier === t ? '#fff' : 'var(--color-muted)',
                borderColor: tier === t ? 'var(--color-de)' : 'var(--color-border)',
              }}
              title={
                t === 'subject'
                  ? 'Where the city gives a coded subject, the subject IS the correction. No matching, nothing to curate.'
                  : 'Inside a subject, comments grouped by how similarly they are written. Needed mostly for the General junk drawer.'
              }
              data-testid={`patterns-tier-${t}`}
            >
              {t === 'subject' ? 'By city subject' : 'By wording'}
            </button>
          ))}
        </div>

        {subjectFilter && (
          <button
            type="button"
            onClick={() => setParam('subject', null)}
            className="text-[10.5px] text-de hover:underline bg-transparent border-none p-0"
            data-testid="patterns-clear-subject"
          >
            Inside “{subjectFilter}” — show all ×
          </button>
        )}

        <label className="ml-auto text-[10.5px] text-muted flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={includeVerbatim}
            onChange={(e) => setParam('verbatim', e.target.checked ? '1' : null)}
            data-testid="patterns-verbatim-toggle"
          />
          Show boilerplate
        </label>

        <button
          type="button"
          onClick={() => rebuild.mutate()}
          disabled={rebuild.isPending}
          className="text-[10.5px] font-bold px-2.5 py-1 rounded-md border border-border text-muted bg-surface hover:bg-s2 transition disabled:opacity-40"
          title="Re-derives every pile from the indexed letters. Your merges, renames, fix notes and addressed dates are keyed to the pile and survive it."
          data-testid="patterns-rebuild"
        >
          {rebuild.isPending ? 'Re-indexing…' : 'Re-index'}
        </button>
      </div>

      {/* ★ Never a silent filter: what the default hid, and how to see it. */}
      {!includeVerbatim && hiddenVerbatim > 0 && (
        <div className="text-[10.5px] text-dim" data-testid="patterns-verbatim-hidden">
          {hiddenVerbatim} pile{hiddenVerbatim === 1 ? '' : 's'} of verbatim city
          boilerplate hidden — the same paragraph pasted into every letter, which
          would otherwise top this list for ever.
        </div>
      )}

      {rankingQ.isLoading ? (
        <div className="text-[11px] text-muted" data-testid="patterns-loading">Loading…</div>
      ) : rows.length === 0 ? (
        <div
          className="rounded-lg border border-border bg-surface px-4 py-10 text-center"
          data-testid="patterns-empty"
        >
          <div className="text-sm font-bold text-text mb-1">Nothing indexed yet</div>
          <div className="text-xs text-muted mb-3">
            The piles are derived from the indexed correction letters. Build them
            once and they stay until you re-index.
          </div>
          <button
            type="button"
            onClick={() => rebuild.mutate()}
            disabled={rebuild.isPending}
            className="text-[11px] font-bold px-3 py-1.5 rounded border border-de text-de bg-de/5 hover:bg-de/10 transition"
            data-testid="patterns-build"
          >
            {rebuild.isPending ? 'Building…' : 'Build the index'}
          </button>
        </div>
      ) : (
        <div className="rounded-md border border-border overflow-hidden" data-testid="patterns-list">
          {rows.map((c) => (
            <PatternRow
              key={c.cluster_key}
              cluster={c}
              open={openKey === c.cluster_key}
              juris={juris}
              onToggle={() =>
                setParam('open', openKey === c.cluster_key ? null : c.cluster_key)
              }
              onDrillSubject={() => {
                const next = new URLSearchParams(params);
                next.set('tier', 'body');
                next.set('subject', c.subject);
                next.delete('open');
                setParams(next, { replace: true });
              }}
              siblings={rows}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PatternRow({
  cluster,
  open,
  juris,
  onToggle,
  onDrillSubject,
  siblings,
}: {
  cluster: CorrectionCluster;
  open: boolean;
  juris: string | null;
  onToggle: () => void;
  onDrillSubject: () => void;
  siblings: CorrectionCluster[];
}) {
  const verdict = reachVerdict(cluster);
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-3 py-2 hover:bg-s2 transition bg-transparent border-none"
        data-testid={`pattern-row-${cluster.cluster_key}`}
        aria-expanded={open}
      >
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[12px] font-bold text-text">{clusterName(cluster)}</span>
          {cluster.display_name && (
            <span className="text-[9px] text-dim" title={`Machine name: ${cluster.label}`}>
              renamed
            </span>
          )}
          {cluster.is_verbatim && (
            <span className="text-[9px] px-1 rounded bg-s2 text-dim" data-testid="pattern-verbatim">
              boilerplate
            </span>
          )}
          {/* ★ The Bellevue shape, named rather than hidden. */}
          {isSingleProject(cluster) && (
            <span className="text-[9px] px-1 rounded bg-s2 text-dim" data-testid="pattern-single-project">
              one project — not a cross-project pattern
            </span>
          )}
          {cluster.addressed_on && (
            <span className="text-[9px] px-1 rounded bg-de-bg text-de" data-testid="pattern-addressed">
              addressed {cluster.addressed_on}
              {cluster.occurrences_after_addressed > 0
                ? ` · ${cluster.occurrences_after_addressed} since`
                : ' · none since'}
            </span>
          )}
          <span className="ml-auto text-[12px] font-extrabold text-de tabular-nums">
            {cluster.project_share}%
          </span>
          <span className="text-[10.5px] text-muted tabular-nums w-20 text-right">
            {cluster.project_count} project{cluster.project_count === 1 ? '' : 's'}
          </span>
          <span className="text-[10px] text-dim tabular-nums w-20 text-right">
            {cluster.item_count} comment{cluster.item_count === 1 ? '' : 's'}
          </span>
        </div>
        {verdict && (
          <div className="text-[10px] text-dim mt-0.5" data-testid="pattern-verdict">
            {verdict}
          </div>
        )}
      </button>
      {open && (
        <PatternDetail
          cluster={cluster}
          juris={juris}
          onDrillSubject={onDrillSubject}
          siblings={siblings}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ★★★ LEVEL THREE — the payload
// ---------------------------------------------------------------------------
//
// Bobby, on why the label alone fails: *"right now when it just says heat
// recovery ventilator detail missing, we need a little bit more information so
// we can accurately address that on our sheet."*
//
// ★★ Three things, and they have DIFFERENT reliability, so they look different:
//   (a) extracted mechanically — pattern matches, no inference;
//   (b) the fix note — written by a person, once, and it persists;
//   (c) the verbatim wordings — never paraphrased.

function PatternDetail({
  cluster,
  juris,
  onDrillSubject,
  siblings,
}: {
  cluster: CorrectionCluster;
  juris: string | null;
  onDrillSubject: () => void;
  siblings: CorrectionCluster[];
}) {
  const detailQ = useCorrectionClusterDetail(cluster.cluster_key, juris);
  const items = detailQ.data ?? [];
  const sheets = useMemo(() => chipsOf(items, 'sheets'), [items]);
  const codes = useMemo(() => chipsOf(items, 'codes'), [items]);
  const wordings = useMemo(() => wordingsOf(items), [items]);
  const projects = useMemo(() => projectsOf(items), [items]);

  return (
    <div className="px-3 pb-3 bg-s2/40" data-testid={`pattern-detail-${cluster.cluster_key}`}>
      {/* (a) ★★ EXTRACTED MECHANICALLY. `Sheet A6.1` across five reviewers is the
          single most actionable fact here: it says where the change goes. */}
      <div className="pt-2">
        <div className="text-[8px] font-extrabold uppercase tracking-wide text-muted mb-1">
          Found in the text — sheets and codes they name
        </div>
        {sheets.length === 0 && codes.length === 0 ? (
          // ★ No sheet reference means NO CHIP, never a guess.
          <div className="text-[10px] text-dim italic" data-testid="pattern-no-chips">
            No sheet or code reference in any of these comments.
          </div>
        ) : (
          <div className="flex flex-wrap gap-1" data-testid="pattern-chips">
            {sheets.map((s) => (
              <span
                key={`s-${s.value}`}
                className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border text-text"
                title={`${s.reviewers} reviewer${s.reviewers === 1 ? '' : 's'} named this sheet, ${s.items} time${s.items === 1 ? '' : 's'}`}
                data-testid={`pattern-chip-sheet-${s.value}`}
              >
                {s.value}
                <span className="text-dim"> · {s.reviewers} rev</span>
              </span>
            ))}
            {codes.map((c) => (
              <span
                key={`c-${c.value}`}
                className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border text-muted"
                title={`${c.reviewers} reviewer${c.reviewers === 1 ? '' : 's'} cited this, ${c.items} time${c.items === 1 ? '' : 's'}`}
                data-testid={`pattern-chip-code-${c.value}`}
              >
                {c.value}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* (b) ★★★ THE FIX NOTE — a person writes it once and it shows every time
          thereafter, with who wrote it. NOT auto-summarised: a summary that
          invented a requirement would drive a wrong change to the plan set. */}
      <FixNote cluster={cluster} />

      {/* ★★ CURATION, each control with the description Bobby asked for. */}
      <CurationBar cluster={cluster} siblings={siblings} />

      <div className="grid gap-3 md:grid-cols-2 pt-3">
        <div>
          <div className="text-[8px] font-extrabold uppercase tracking-wide text-muted mb-1">
            How it gets asked — {wordings.length} wording
            {wordings.length === 1 ? '' : 's'}, word for word
          </div>
          <div className="space-y-1.5 max-h-72 overflow-y-auto" data-testid="pattern-wordings">
            {wordings.slice(0, 12).map((w, i) => (
              <div
                key={`${w.reviewer}-${i}`}
                className="text-[10px] bg-surface border border-border rounded p-1.5"
                data-testid="pattern-wording"
              >
                <div className="text-dim mb-0.5">
                  {w.reviewer} · {w.projects} project{w.projects === 1 ? '' : 's'}
                </div>
                {/* ★★ THE STORED BODY, UNCHANGED — including the OCR bleed the
                    two-column read leaves behind. Nothing repairs it. */}
                <div className="text-text whitespace-pre-wrap">{w.body}</div>
              </div>
            ))}
            {wordings.length > 12 && (
              <div className="text-[10px] text-dim">
                {wordings.length - 12} more wording{wordings.length - 12 === 1 ? '' : 's'} not listed.
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="text-[8px] font-extrabold uppercase tracking-wide text-muted mb-1">
            {projects.length} project{projects.length === 1 ? '' : 's'}
          </div>
          {/* ★ Names only — Bobby chose that over letter links. */}
          <div className="space-y-0.5 max-h-72 overflow-y-auto" data-testid="pattern-projects">
            {projects.map((p) => (
              <div
                key={p.projectId}
                className="text-[10px] text-text flex items-baseline gap-2"
                data-testid="pattern-project"
              >
                <span className="truncate flex-1">{p.address}</span>
                <span className="text-dim flex-none">{p.lastSeen ?? ''}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ★★★ NO LEVEL DEAD-ENDS. A subject pile with real internal variety opens
          into its wordings; that is level three of three, and it is built. */}
      {cluster.tier === 'subject' && cluster.item_count >= 5 && (
        <button
          type="button"
          onClick={onDrillSubject}
          className="mt-2 text-[10.5px] text-de hover:underline bg-transparent border-none p-0"
          data-testid="pattern-drill-subject"
        >
          Break “{cluster.subject}” down by wording →
        </button>
      )}
    </div>
  );
}

function FixNote({ cluster }: { cluster: CorrectionCluster }) {
  const setCuration = useSetCorrectionCuration();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cluster.fix_note ?? '');

  return (
    <div className="pt-3" data-testid="pattern-fix-note">
      <div className="text-[8px] font-extrabold uppercase tracking-wide text-muted mb-1">
        What we change on our sheets
      </div>
      {editing ? (
        <div className="space-y-1">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full text-[11px] bg-surface border border-border rounded p-1.5 text-text"
            placeholder="e.g. Add the HRV detail and the AHRI efficiency note to A6.1 in the standard set."
            data-testid="pattern-fix-note-input"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => {
                setCuration.mutate({
                  clusterKey: cluster.cluster_key,
                  fixNote: draft.trim() === '' ? null : draft,
                  fields: ['fix_note'],
                });
                setEditing(false);
              }}
              className="text-[10.5px] font-bold px-2 py-1 rounded border border-de text-de bg-surface"
              data-testid="pattern-fix-note-save"
            >
              Save note
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(cluster.fix_note ?? '');
                setEditing(false);
              }}
              className="text-[10.5px] px-2 py-1 rounded border border-border text-muted bg-surface"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : cluster.fix_note ? (
        <div className="text-[11px] bg-surface border border-border rounded p-2">
          {/* ★★ RENDERED VERBATIM. Nothing generates or rewrites this. */}
          <div className="text-text whitespace-pre-wrap" data-testid="pattern-fix-note-body">
            {cluster.fix_note}
          </div>
          <div className="text-[9.5px] text-dim mt-1">
            {cluster.fix_note_by_name ?? 'Someone'}
            {cluster.fix_note_at ? ` · ${cluster.fix_note_at.slice(0, 10)}` : ''}
            {' · '}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-de hover:underline bg-transparent border-none p-0"
              data-testid="pattern-fix-note-edit"
            >
              edit
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[10.5px] text-de hover:underline bg-transparent border-none p-0"
          title="One person writes this once. It shows to everyone, every time, with their name on it — nothing summarises the reviewer's text for you."
          data-testid="pattern-fix-note-add"
        >
          + Write the fix for this
        </button>
      )}
    </div>
  );
}

function CurationBar({
  cluster,
  siblings,
}: {
  cluster: CorrectionCluster;
  siblings: CorrectionCluster[];
}) {
  const setCuration = useSetCorrectionCuration();
  const [action, setAction] = useState<string | null>(null);
  const [value, setValue] = useState('');

  const control = CURATION_CONTROLS.find((c) => c.action === action);

  return (
    <div className="pt-2" data-testid="pattern-curation">
      <div className="flex flex-wrap gap-1.5">
        {CURATION_CONTROLS.map((c) => (
          <button
            key={c.action}
            type="button"
            // ★ Every control carries its description, on hover and in the DOM.
            title={c.description}
            aria-description={c.description}
            onClick={() => {
              setAction(action === c.action ? null : c.action);
              setValue(c.action === 'rename' ? clusterName(cluster) : '');
            }}
            className="text-[10px] px-2 py-0.5 rounded border border-border text-muted bg-surface hover:bg-s2 transition"
            data-testid={`curation-${c.action}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {control && (
        <div className="mt-1.5 text-[10.5px] bg-surface border border-border rounded p-2 space-y-1.5">
          <div className="text-dim" data-testid="curation-description">
            {control.description}
          </div>

          {control.action === 'rename' && (
            <div className="flex gap-1.5">
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="flex-1 bg-surface border border-border rounded px-1.5 py-1 text-text"
                data-testid="curation-rename-input"
              />
              <button
                type="button"
                onClick={() => {
                  setCuration.mutate({
                    clusterKey: cluster.cluster_key,
                    displayName: value.trim() === '' ? null : value.trim(),
                    fields: ['display_name'],
                  });
                  setAction(null);
                }}
                className="font-bold px-2 py-1 rounded border border-de text-de"
                data-testid="curation-rename-save"
              >
                Rename
              </button>
            </div>
          )}

          {control.action === 'merge' && (
            <div className="flex gap-1.5">
              <select
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="flex-1 bg-surface border border-border rounded px-1.5 py-1 text-text"
                data-testid="curation-merge-target"
              >
                <option value="">Choose the pile this belongs to…</option>
                {siblings
                  .filter((s) => s.cluster_key !== cluster.cluster_key)
                  .slice(0, 40)
                  .map((s) => (
                    <option key={s.cluster_key} value={s.cluster_key}>
                      {clusterName(s)} · {s.project_count} projects
                    </option>
                  ))}
              </select>
              <button
                type="button"
                disabled={value === ''}
                onClick={() => {
                  setCuration.mutate({
                    clusterKey: cluster.cluster_key,
                    mergedIntoKey: value,
                    fields: ['merged_into_key'],
                  });
                  setAction(null);
                }}
                className="font-bold px-2 py-1 rounded border border-de text-de disabled:opacity-40"
                data-testid="curation-merge-save"
              >
                Merge
              </button>
            </div>
          )}

          {control.action === 'split' && (
            <button
              type="button"
              disabled={!cluster.merged_into_key}
              onClick={() => {
                setCuration.mutate({
                  clusterKey: cluster.cluster_key,
                  mergedIntoKey: null,
                  fields: ['merged_into_key'],
                });
                setAction(null);
              }}
              className="font-bold px-2 py-1 rounded border border-de text-de disabled:opacity-40"
              data-testid="curation-split-save"
            >
              {cluster.merged_into_key
                ? 'Undo the merge'
                : 'Nothing merged into this pile'}
            </button>
          )}

          {control.action === 'addressed' && (
            <div className="flex gap-1.5">
              <input
                type="date"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="bg-surface border border-border rounded px-1.5 py-1 text-text"
                data-testid="curation-addressed-date"
              />
              <button
                type="button"
                onClick={() => {
                  setCuration.mutate({
                    clusterKey: cluster.cluster_key,
                    addressedOn: value === '' ? null : value,
                    fields: ['addressed_on'],
                  });
                  setAction(null);
                }}
                className="font-bold px-2 py-1 rounded border border-de text-de"
                data-testid="curation-addressed-save"
              >
                {value === '' ? 'Clear' : 'Mark addressed'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
