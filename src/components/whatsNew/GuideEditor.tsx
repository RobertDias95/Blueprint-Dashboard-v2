import { useMemo, useRef, useState } from 'react';
import { allRibbonRoutes } from '../../lib/ribbonNav';
import {
  AUDIENCE_LABEL,
  BLOCK_TYPE_LABEL,
  CALLOUT_TONES,
  GUIDE_AUDIENCES,
  GUIDE_BLOCK_TYPES,
  GUIDE_PARTS,
  GUIDE_PART_NUMBERS,
  GUIDE_SUMMARY_MAX,
  GUIDE_TITLE_MAX,
  emptyBlock,
  isGuideMediaPath,
  isGuideSlug,
  moveSection,
  parseBlocks,
  slugify,
  sortOrderAfter,
  tableToText,
  textToTable,
  type CalloutTone,
  type GuideAudience,
  type GuideBlock,
  type GuideBlockType,
  type GuidePart,
  type GuideSection,
} from '../../lib/guide';
import { isAppPath, type WhatsNewEntry } from '../../lib/whatsNew';
import {
  GuideConflictError,
  removeGuideMedia,
  useDeleteGuideSection,
  useReorderGuideSections,
  useSaveGuideSection,
  useUploadGuideMedia,
  type GuideSectionDraft,
} from '../../hooks/useGuide';
import { GuideMedia } from './GuideBits';

// ===========================================================================
// ★★★ fix-670 §F — THE GUIDE EDITOR: the guide stays live without a developer
// ===========================================================================
//
// EntryEditor's pattern: an inline panel beside its output, admin-only in the
// page, refused by RLS for anybody else. Blocks are edited as a list — add
// (type picker), remove, move up/down — with one small form per type.
//
// ★★ HIDDEN HERE, REFUSED IN THE DATABASE (fix-234, fix-331 §6).

const inputCls =
  'w-full px-2 py-1 text-[11px] border border-border rounded bg-bg text-text outline-none focus:border-de';
const labelCls = 'text-[9px] font-extrabold uppercase tracking-[0.06em] text-muted mt-2 mb-0.5 block';
const smallBtn =
  'text-[10px] px-1.5 py-0.5 rounded border border-border bg-surface text-muted hover:text-text disabled:opacity-40';

/** Today in the viewer's own calendar (not UTC — fix-433). */
function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function initialDraft(
  section: GuideSection | null,
  sections: GuideSection[],
  after: string | null,
): GuideSectionDraft {
  if (section) {
    return {
      id: section.id,
      part: section.part,
      sort_order: section.sort_order,
      slug: section.slug,
      title: section.title,
      summary: section.summary ?? '',
      audience: [...section.audience],
      show_me: section.show_me ?? '',
      blocks: parseBlocks(section.blocks),
      reviewed_on: section.reviewed_on,
      expected_updated_at: section.updated_at ?? null,
    };
  }
  const place = sortOrderAfter(sections, after);
  return {
    part: place.part,
    sort_order: place.sort_order,
    slug: '',
    title: '',
    summary: '',
    audience: ['everyone'],
    show_me: '',
    blocks: [],
    reviewed_on: null,
  };
}

export default function GuideEditor({
  section,
  sections,
  entries,
  after = null,
  onClose,
  onNewAfter,
}: {
  /** null = a new section. */
  section: GuideSection | null;
  sections: GuideSection[];
  entries: WhatsNewEntry[];
  /** For a new section: the section it goes after. */
  after?: string | null;
  onClose: () => void;
  onNewAfter: () => void;
}) {
  const save = useSaveGuideSection();
  const reorder = useReorderGuideSections();
  const del = useDeleteGuideSection();
  const [draft, setDraft] = useState<GuideSectionDraft>(() => initialDraft(section, sections, after));
  const [blocks, setBlocks] = useState<GuideBlock[]>(() => draft.blocks as GuideBlock[]);
  const [slugTouched, setSlugTouched] = useState(!!section);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moved, setMoved] = useState(false);
  // Bucket objects uploaded in this session / taken off a step in this
  // session — tidied after a save or a cancel, never before.
  const uploaded = useRef<string[]>([]);
  const removed = useRef<string[]>([]);

  const set = <K extends keyof GuideSectionDraft>(k: K, v: GuideSectionDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const slug = slugTouched ? draft.slug : slugify(draft.title);
  const showMe = draft.show_me.trim();
  const showMeBad = showMe !== '' && !isAppPath(showMe);
  const slugBad = !isGuideSlug(slug) || sections.some((s) => s.slug === slug && s.id !== section?.id);
  const summaryLen = draft.summary.trim().length;
  const titleLen = draft.title.trim().length;
  const blockShowMeBad = blocks.some(
    (b) => b.t === 'step' && b.show_me !== null && b.show_me.trim() !== '' && !isAppPath(b.show_me.trim()),
  );
  const canSave =
    titleLen > 0 &&
    titleLen <= GUIDE_TITLE_MAX &&
    summaryLen <= GUIDE_SUMMARY_MAX &&
    !showMeBad &&
    !slugBad &&
    !blockShowMeBad &&
    draft.audience.length > 0;

  const index = section ? [...sections].sort((a, z) => a.part - z.part || a.sort_order - z.sort_order) : [];
  const pos = section ? index.findIndex((s) => s.id === section.id) : -1;

  const move = (dir: -1 | 1) => {
    if (!section) return;
    const changes = moveSection(sections, section.id, dir);
    if (changes.length === 0) return;
    const mineChange = changes.find((c) => c.id === section.id);
    if (mineChange) setDraft((d) => ({ ...d, part: mineChange.part, sort_order: mineChange.sort_order }));
    // ★ A move stamps this row's updated_at too — the save after it must not
    //   read that as somebody else's edit.
    setMoved(true);
    reorder.mutate(changes);
  };

  const onSave = () => {
    const cleanBlocks = blocks.map((b) =>
      b.t === 'step' ? { ...b, show_me: b.show_me?.trim() || null, media: b.media || null } : b,
    );
    save.mutate(
      {
        ...draft,
        slug,
        blocks: cleanBlocks,
        expected_updated_at: moved ? section?.updated_at ?? null : draft.expected_updated_at,
      },
      {
        onSuccess: () => {
          const kept = new Set(cleanBlocks.flatMap((b) => (b.t === 'step' && b.media ? [b.media] : [])));
          void removeGuideMedia(removed.current.filter((p) => !kept.has(p)));
          onClose();
        },
      },
    );
  };

  const onCancel = () => {
    void removeGuideMedia(uploaded.current);
    onClose();
  };

  const updateBlock = (i: number, b: GuideBlock) => setBlocks((bs) => bs.map((x, k) => (k === i ? b : x)));
  const moveBlock = (i: number, dir: -1 | 1) =>
    setBlocks((bs) => {
      const j = i + dir;
      if (j < 0 || j >= bs.length) return bs;
      const next = [...bs];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const [addType, setAddType] = useState<GuideBlockType>('p');

  const routes = useMemo(() => allRibbonRoutes(), []);

  return (
    <div
      className="border-2 border-de rounded-md bg-surface p-3"
      data-testid={section ? `guide-editor-${section.slug}` : 'guide-editor-new'}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-extrabold text-text">{section ? 'Edit section' : 'New section'}</span>
        {section && (
          <>
            <button
              type="button"
              className={smallBtn}
              onClick={() => move(-1)}
              disabled={pos <= 0 || reorder.isPending}
              data-testid="guide-editor-move-up"
            >
              Move up
            </button>
            <button
              type="button"
              className={smallBtn}
              onClick={() => move(1)}
              disabled={pos < 0 || pos >= index.length - 1 || reorder.isPending}
              data-testid="guide-editor-move-down"
            >
              Move down
            </button>
          </>
        )}
        <button
          type="button"
          className={smallBtn}
          onClick={() => set('reviewed_on', todayLocal())}
          data-testid="guide-editor-checked"
        >
          Mark checked today
        </button>
        {draft.reviewed_on && (
          <span className="text-[10px] text-dim" data-testid="guide-editor-reviewed">
            Last checked {draft.reviewed_on}
          </span>
        )}
      </div>

      <div className="grid gap-2 grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)] mt-1">
        <div>
          <label className={labelCls} htmlFor="guide-part">
            Part
          </label>
          <select
            id="guide-part"
            value={draft.part}
            onChange={(e) => set('part', Number(e.target.value) as GuidePart)}
            className={inputCls}
            data-testid="guide-editor-part"
          >
            {GUIDE_PART_NUMBERS.map((p) => (
              <option key={p} value={p}>
                {p} · {GUIDE_PARTS[p]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="guide-title">
            Title{' '}
            <span className={titleLen > GUIDE_TITLE_MAX ? 'text-co' : 'text-dim'}>
              {titleLen}/{GUIDE_TITLE_MAX}
            </span>
          </label>
          <input
            id="guide-title"
            value={draft.title}
            onChange={(e) => set('title', e.target.value)}
            className={inputCls}
            data-testid="guide-editor-title"
          />
        </div>
      </div>

      <label className={labelCls} htmlFor="guide-slug">
        Link name — /whats-new?tab=guide&amp;s=…
      </label>
      <input
        id="guide-slug"
        value={slug}
        onChange={(e) => {
          setSlugTouched(true);
          set('slug', e.target.value);
        }}
        className={`${inputCls} ${slugBad ? 'border-co' : ''}`}
        data-testid="guide-editor-slug"
      />
      {slugBad && (
        <div className="text-[10px] text-co mt-0.5" data-testid="guide-editor-slug-error">
          Lower-case letters, digits and dashes, up to 60 — and not one another section already uses.
        </div>
      )}

      <label className={labelCls} htmlFor="guide-summary">
        Summary{' '}
        <span
          className={summaryLen > GUIDE_SUMMARY_MAX ? 'text-co' : 'text-dim'}
          data-testid="guide-editor-summary-count"
        >
          {summaryLen}/{GUIDE_SUMMARY_MAX}
        </span>
      </label>
      <input
        id="guide-summary"
        value={draft.summary}
        onChange={(e) => set('summary', e.target.value.replace(/[\r\n]+/g, ' '))}
        className={inputCls}
        data-testid="guide-editor-summary"
      />

      <span className={labelCls}>Who it is for</span>
      <div className="flex items-center gap-3 flex-wrap" data-testid="guide-editor-audience">
        {GUIDE_AUDIENCES.map((a: GuideAudience) => (
          <label key={a} className="text-[11px] text-text flex items-center gap-1">
            <input
              type="checkbox"
              checked={draft.audience.includes(a)}
              onChange={(e) =>
                set(
                  'audience',
                  e.target.checked ? [...draft.audience, a] : draft.audience.filter((x) => x !== a),
                )
              }
              data-testid={`guide-editor-audience-${a}`}
            />
            {AUDIENCE_LABEL[a]}
          </label>
        ))}
      </div>

      <label className={labelCls} htmlFor="guide-show-me">
        “Show me” for the whole section (optional)
      </label>
      <input
        id="guide-show-me"
        value={draft.show_me}
        onChange={(e) => set('show_me', e.target.value)}
        list="guide-route-list"
        placeholder="An app path like /board?tab=tasks"
        className={`${inputCls} ${showMeBad ? 'border-co' : ''}`}
        data-testid="guide-editor-show-me"
      />
      <datalist id="guide-route-list">
        {routes.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      {showMeBad && (
        <div className="text-[10px] text-co mt-0.5" data-testid="guide-editor-show-me-error">
          Must be a path inside the app — one leading slash, no backslashes.
        </div>
      )}

      <span className={labelCls}>Blocks</span>
      <div className="flex flex-col gap-2" data-testid="guide-editor-blocks">
        {blocks.map((b, i) => (
          <div key={i} className="border border-border rounded p-2 bg-bg" data-testid={`guide-editor-block-${i}`}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[10px] font-extrabold text-muted uppercase">{BLOCK_TYPE_LABEL[b.t]}</span>
              <span className="ml-auto flex items-center gap-1">
                <button type="button" className={smallBtn} onClick={() => moveBlock(i, -1)} disabled={i === 0}>
                  ↑
                </button>
                <button
                  type="button"
                  className={smallBtn}
                  onClick={() => moveBlock(i, 1)}
                  disabled={i === blocks.length - 1}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={`${smallBtn} text-co`}
                  onClick={() => {
                    if (b.t === 'step' && b.media && isGuideMediaPath(b.media)) removed.current.push(b.media);
                    setBlocks((bs) => bs.filter((_, k) => k !== i));
                  }}
                  data-testid={`guide-editor-block-remove-${i}`}
                >
                  Remove
                </button>
              </span>
            </div>
            <BlockForm
              block={b}
              index={i}
              entries={entries}
              onChange={(nb) => updateBlock(i, nb)}
              onUploaded={(p) => uploaded.current.push(p)}
              onMediaRemoved={(p) => {
                if (isGuideMediaPath(p)) removed.current.push(p);
              }}
            />
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <select
            value={addType}
            onChange={(e) => setAddType(e.target.value as GuideBlockType)}
            className="px-2 py-1 text-[11px] border border-border rounded bg-bg text-text"
            data-testid="guide-editor-add-type"
            aria-label="Block type"
          >
            {GUIDE_BLOCK_TYPES.map((t) => (
              <option key={t} value={t}>
                {BLOCK_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={smallBtn}
            onClick={() => setBlocks((bs) => [...bs, emptyBlock(addType)])}
            data-testid="guide-editor-add-block"
          >
            + Add
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave || save.isPending}
          className="text-[11px] font-bold text-white bg-de rounded px-2.5 py-1 border-none disabled:opacity-40"
          data-testid="guide-editor-save"
        >
          {section ? 'Save' : 'Add section'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] text-muted hover:text-text bg-transparent border-none p-0"
          data-testid="guide-editor-cancel"
        >
          Cancel
        </button>
        {section && (
          <button
            type="button"
            onClick={onNewAfter}
            className="text-[11px] text-de hover:underline bg-transparent border-none p-0"
            data-testid="guide-editor-new-after"
          >
            + New section after this
          </button>
        )}
        {section && !confirmDelete && (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="ml-auto text-[11px] text-co hover:underline bg-transparent border-none p-0"
            data-testid="guide-editor-delete"
          >
            Delete section
          </button>
        )}
        {section && confirmDelete && (
          // ★ Confirmed INSIDE the page — never window.confirm (it blocks every
          //   other tab's events and the browser automation besides).
          <span className="ml-auto flex items-center gap-2" data-testid="guide-editor-delete-confirm">
            <span className="text-[11px] text-co font-bold">Delete “{section.title}” for everyone?</span>
            <button
              type="button"
              onClick={() => del.mutate(section.id, { onSuccess: onClose })}
              disabled={del.isPending}
              className="text-[11px] font-bold text-white bg-co rounded px-2 py-0.5 border-none disabled:opacity-40"
              data-testid="guide-editor-delete-yes"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="text-[11px] text-muted bg-transparent border-none p-0"
              data-testid="guide-editor-delete-no"
            >
              Keep it
            </button>
          </span>
        )}
      </div>
      {(save.isError || reorder.isError || del.isError) && (
        <div className="text-[10px] text-co mt-1.5" data-testid="guide-editor-error" role="alert">
          {save.error instanceof GuideConflictError
            ? save.error.message
            : `Could not save — ${(save.error ?? reorder.error ?? del.error)?.message ?? 'unknown error'}`}
        </div>
      )}
    </div>
  );
}

/** One small form per block type. */
function BlockForm({
  block,
  index,
  entries,
  onChange,
  onUploaded,
  onMediaRemoved,
}: {
  block: GuideBlock;
  index: number;
  entries: WhatsNewEntry[];
  onChange: (b: GuideBlock) => void;
  onUploaded: (path: string) => void;
  onMediaRemoved: (path: string) => void;
}) {
  switch (block.t) {
    case 'p':
      return (
        <textarea
          value={block.text}
          onChange={(e) => onChange({ ...block, text: e.target.value })}
          rows={3}
          placeholder="Text. **bold** is the only markup."
          className={`${inputCls} resize-y`}
          data-testid={`guide-editor-p-${index}`}
        />
      );
    case 'list':
      return (
        <textarea
          value={block.items.join('\n')}
          onChange={(e) => onChange({ ...block, items: e.target.value.split(/\r?\n/) })}
          onBlur={(e) =>
            onChange({ ...block, items: e.target.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) })
          }
          rows={3}
          placeholder="One item per line"
          className={`${inputCls} resize-y`}
          data-testid={`guide-editor-list-${index}`}
        />
      );
    case 'callout':
      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <select
              value={block.tone}
              onChange={(e) => onChange({ ...block, tone: e.target.value as CalloutTone })}
              className="px-2 py-1 text-[11px] border border-border rounded bg-bg text-text"
              aria-label="Tone"
              data-testid={`guide-editor-callout-tone-${index}`}
            >
              {CALLOUT_TONES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              value={block.title}
              onChange={(e) => onChange({ ...block, title: e.target.value })}
              placeholder="Title"
              className={inputCls}
              data-testid={`guide-editor-callout-title-${index}`}
            />
          </div>
          <textarea
            value={block.text}
            onChange={(e) => onChange({ ...block, text: e.target.value })}
            rows={2}
            className={`${inputCls} resize-y`}
            data-testid={`guide-editor-callout-text-${index}`}
          />
        </div>
      );
    case 'table':
      return <TableForm block={block} index={index} onChange={onChange} />;
    case 'step':
      return (
        <StepForm
          block={block}
          index={index}
          onChange={onChange}
          onUploaded={onUploaded}
          onMediaRemoved={onMediaRemoved}
        />
      );
    case 'cards':
      return <CardsForm block={block} index={index} entries={entries} onChange={onChange} />;
  }
}

/** ★ One row per line, cells split by " | ", the first line the header. Kept
 *  as TEXT while typing (a half-typed row is not a table yet) and parsed into
 *  the block on every change. */
function TableForm({
  block,
  index,
  onChange,
}: {
  block: Extract<GuideBlock, { t: 'table' }>;
  index: number;
  onChange: (b: GuideBlock) => void;
}) {
  const [text, setText] = useState(() => tableToText(block.head, block.rows));
  return (
    <textarea
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange({ t: 'table', ...textToTable(e.target.value) });
      }}
      rows={4}
      placeholder={'Header | Header\nCell | Cell'}
      className={`${inputCls} resize-y font-mono`}
      data-testid={`guide-editor-table-${index}`}
    />
  );
}

function StepForm({
  block,
  index,
  onChange,
  onUploaded,
  onMediaRemoved,
}: {
  block: Extract<GuideBlock, { t: 'step' }>;
  index: number;
  onChange: (b: GuideBlock) => void;
  onUploaded: (path: string) => void;
  onMediaRemoved: (path: string) => void;
}) {
  const upload = useUploadGuideMedia();
  const fileRef = useRef<HTMLInputElement>(null);
  const showMe = (block.show_me ?? '').trim();
  const showMeBad = showMe !== '' && !isAppPath(showMe);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5" role="group" aria-label="Who does this step">
        {(['tool', 'you'] as const).map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => onChange({ ...block, who: w })}
            aria-pressed={block.who === w}
            className={`text-[10px] font-extrabold px-2 py-0.5 rounded border ${
              block.who === w
                ? w === 'tool'
                  ? 'bg-ok-bg text-ok border-ok-border'
                  : 'bg-wa-bg text-wa border-wa-border'
                : 'bg-surface text-muted border-border'
            }`}
            data-testid={`guide-editor-step-who-${w}-${index}`}
          >
            {w === 'tool' ? 'The Bridge' : 'You'}
          </button>
        ))}
        <input
          value={block.title}
          onChange={(e) => onChange({ ...block, title: e.target.value })}
          placeholder="Step title"
          className={inputCls}
          data-testid={`guide-editor-step-title-${index}`}
        />
      </div>
      <textarea
        value={block.text}
        onChange={(e) => onChange({ ...block, text: e.target.value })}
        rows={2}
        placeholder="What happens / what to do"
        className={`${inputCls} resize-y`}
        data-testid={`guide-editor-step-text-${index}`}
      />
      <input
        value={block.show_me ?? ''}
        onChange={(e) => onChange({ ...block, show_me: e.target.value })}
        list="guide-route-list"
        placeholder="Show me → an app path (optional)"
        className={`${inputCls} ${showMeBad ? 'border-co' : ''}`}
        data-testid={`guide-editor-step-show-me-${index}`}
      />
      {showMeBad && (
        <div className="text-[10px] text-co">Must be a path inside the app — one leading slash, no backslashes.</div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={fileRef}
          type="file"
          accept="image/gif,image/png,image/jpeg,image/webp,video/mp4,video/webm"
          className="hidden"
          data-testid={`guide-editor-step-file-${index}`}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            upload.mutate(f, {
              onSuccess: (path) => {
                if (block.media) onMediaRemoved(block.media);
                onUploaded(path);
                onChange({ ...block, media: path });
              },
            });
          }}
        />
        <button
          type="button"
          className={smallBtn}
          onClick={() => fileRef.current?.click()}
          disabled={upload.isPending}
          data-testid={`guide-editor-step-upload-${index}`}
        >
          {upload.isPending ? 'Uploading…' : block.media ? 'Replace GIF / video' : 'Upload GIF / video'}
        </button>
        {block.media && (
          <button
            type="button"
            className={`${smallBtn} text-co`}
            onClick={() => {
              onMediaRemoved(block.media!);
              onChange({ ...block, media: null });
            }}
            data-testid={`guide-editor-step-media-remove-${index}`}
          >
            Remove
          </button>
        )}
        {upload.isError && <span className="text-[10px] text-co">{upload.error.message}</span>}
      </div>
      {block.media && (
        <div className="max-w-[320px]" data-testid={`guide-editor-step-preview-${index}`}>
          <GuideMedia media={block.media} alt={block.title || 'Step media'} />
        </div>
      )}
    </div>
  );
}

/** A searchable picker over What's New entry titles, chosen ones as chips. */
function CardsForm({
  block,
  index,
  entries,
  onChange,
}: {
  block: Extract<GuideBlock, { t: 'cards' }>;
  index: number;
  entries: WhatsNewEntry[];
  onChange: (b: GuideBlock) => void;
}) {
  const [q, setQ] = useState('');
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const needle = q.trim().toLowerCase();
  const matches = needle
    ? entries.filter((e) => !block.ids.includes(e.id) && e.title.toLowerCase().includes(needle)).slice(0, 8)
    : [];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1 flex-wrap" data-testid={`guide-editor-cards-chosen-${index}`}>
        {block.ids.map((id) => (
          <span
            key={id}
            className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-surface text-text flex items-center gap-1"
          >
            {byId.get(id)?.title ?? 'Deleted entry'}
            <button
              type="button"
              onClick={() => onChange({ ...block, ids: block.ids.filter((x) => x !== id) })}
              className="text-dim hover:text-co bg-transparent border-none p-0 leading-none"
              aria-label={`Remove ${byId.get(id)?.title ?? 'entry'}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Find a What’s New card by title…"
        className={inputCls}
        data-testid={`guide-editor-cards-search-${index}`}
      />
      {matches.length > 0 && (
        <div className="flex flex-col border border-border rounded bg-surface">
          {matches.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => {
                onChange({ ...block, ids: [...block.ids, e.id] });
                setQ('');
              }}
              className="text-left text-[11px] px-2 py-1 bg-transparent border-none hover:bg-de-bg text-text"
              data-testid={`guide-editor-cards-pick-${e.id}`}
            >
              {e.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
