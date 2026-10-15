import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { makeOriginState } from '../../lib/previousOrigin';
import {
  AUDIENCE_LABEL,
  groupByPart,
  hasReviewDate,
  isYourChapter,
  parseBlocks,
  sectionDomId,
  type GuideAudience,
  type GuideBlock,
  type GuideSection,
} from '../../lib/guide';
import { cardSummary, formatDay, isAppPath, type WhatsNewEntry } from '../../lib/whatsNew';
import { GuideMedia, GuideText, WhoTag } from './GuideBits';
import GuideEditor from './GuideEditor';

// ===========================================================================
// ★★★ fix-670 (P-056) — WHAT'S NEW → GUIDE
// ===========================================================================
//
// Bobby, 2026-10-14: "a complete guide for any new hires in any role so they
// can see their roles, their responsibilities." One reading column that runs
// start to finish, a sticky contents column beside it, and the viewer's own
// chapters marked — never reordered: the guide reads the same for everyone.
//
// ★★ Every step says WHO does it, in words: THE BRIDGE (it happens by itself)
//    or YOU (a person decides it). Colour backs the word up, never replaces it.
//
// ★★ It LINKS to What's New cards and never copies them: a `cards` block is a
//    list of entry ids, rendered as chips that open the existing DetailPanel.

/** The origin a "Show me →" carries, so ← Previous comes back to THIS section
 *  of the guide rather than to wherever the page happened to be. */
function guideOrigin(slug: string) {
  return makeOriginState({ pathname: '/whats-new', search: `?tab=guide&s=${encodeURIComponent(slug)}` });
}

const CALLOUT_CLASS: Record<'rule' | 'note' | 'warn', string> = {
  rule: 'border-de bg-de-bg',
  note: 'border-border bg-s2',
  warn: 'border-wa-border bg-wa-bg',
};

function ShowMe({ href, slug, testid }: { href: string; slug: string; testid: string }) {
  const navigate = useNavigate();
  if (!isAppPath(href)) return null;
  return (
    <button
      type="button"
      // ★★ DetailPanel's behaviour exactly: navigate() keeps it in the app, and
      // the origin is THIS section, so ← Previous lands back on it.
      onClick={() => navigate(href, { state: guideOrigin(slug) })}
      className="flex-none text-[11px] font-bold text-white bg-de rounded px-2.5 py-1 border-none"
      data-testid={testid}
      data-href={href}
    >
      Show me →
    </button>
  );
}

function Block({
  block,
  slug,
  index,
  entriesById,
  onOpenCard,
}: {
  block: GuideBlock;
  slug: string;
  index: number;
  entriesById: Map<string, WhatsNewEntry>;
  onOpenCard: (e: WhatsNewEntry) => void;
}) {
  switch (block.t) {
    case 'p':
      return (
        <p className="text-[12.5px] text-text leading-relaxed">
          <GuideText text={block.text} />
        </p>
      );
    case 'list':
      return (
        <ul className="list-disc pl-5 text-[12.5px] text-text leading-relaxed flex flex-col gap-0.5">
          {block.items.map((it, i) => (
            <li key={i}>
              <GuideText text={it} />
            </li>
          ))}
        </ul>
      );
    case 'callout':
      return (
        <div
          className={`border-l-[3px] rounded px-3 py-2 ${CALLOUT_CLASS[block.tone]}`}
          data-testid={`guide-callout-${block.tone}`}
        >
          {block.title && (
            <div className="text-[12px] font-extrabold text-text mb-0.5">
              <GuideText text={block.title} />
            </div>
          )}
          {block.text && (
            <div className="text-[12px] text-text leading-relaxed">
              <GuideText text={block.text} />
            </div>
          )}
        </div>
      );
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="text-[11.5px] border-collapse w-full" data-testid="guide-table">
            {block.head.length > 0 && (
              <thead>
                <tr>
                  {block.head.map((h, i) => (
                    <th
                      key={i}
                      className="text-left font-extrabold text-muted bg-s2 border border-border px-2 py-1"
                    >
                      <GuideText text={h} />
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {block.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, k) => (
                    <td key={k} className="border border-border px-2 py-1 text-text align-top">
                      <GuideText text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'step':
      return (
        <div
          className="rounded border border-border bg-bg px-3 py-2"
          data-testid={`guide-step-${slug}-${index}`}
          data-who={block.who}
        >
          <div className="flex items-start gap-2 flex-wrap">
            <WhoTag who={block.who} />
            <div className="text-[12.5px] font-bold text-text flex-1 min-w-[160px]">
              <GuideText text={block.title} />
            </div>
            {block.show_me && (
              <ShowMe href={block.show_me} slug={slug} testid={`guide-step-go-${slug}-${index}`} />
            )}
          </div>
          {block.text && (
            <div className="text-[12px] text-text leading-relaxed mt-1">
              <GuideText text={block.text} />
            </div>
          )}
          {block.media && <GuideMedia media={block.media} alt={block.title} />}
        </div>
      );
    case 'cards': {
      // ★ An id that no longer exists is skipped silently — the entry was
      //   deleted, and a hole is better than a broken chip.
      const found = block.ids.map((id) => entriesById.get(id)).filter((e): e is WhatsNewEntry => !!e);
      if (found.length === 0) return null;
      return (
        <div className="flex flex-col gap-1" data-testid="guide-cards">
          <div className="text-[9px] font-extrabold uppercase tracking-[0.06em] text-muted">Tips for this</div>
          {found.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => onOpenCard(e)}
              className="text-left px-2.5 py-1.5 rounded border border-border bg-bg hover:border-de"
              data-testid={`guide-card-${e.id}`}
            >
              <div className="text-[11.5px] font-bold text-text">{e.title}</div>
              <div className="text-[10.5px] text-muted line-clamp-1">{cardSummary(e)}</div>
            </button>
          ))}
        </div>
      );
    }
  }
}

function SectionView({
  section,
  mine,
  isAdmin,
  entriesById,
  onOpenCard,
  onEdit,
  children,
}: {
  section: GuideSection;
  mine: boolean;
  isAdmin: boolean;
  entriesById: Map<string, WhatsNewEntry>;
  onOpenCard: (e: WhatsNewEntry) => void;
  onEdit: () => void;
  children?: ReactNode;
}) {
  const blocks = useMemo(() => parseBlocks(section.blocks), [section.blocks]);
  const chips = section.audience.filter((a) => a !== 'everyone');
  return (
    <section
      id={sectionDomId(section.slug)}
      className={`scroll-mt-2 rounded-md border px-4 py-3 ${mine ? 'border-de border-2' : 'border-border'}`}
      data-testid={`guide-section-${section.slug}`}
      data-mine={mine ? 'true' : 'false'}
      aria-labelledby={`${sectionDomId(section.slug)}-title`}
    >
      <div className="flex items-start gap-2 flex-wrap">
        <h2
          id={`${sectionDomId(section.slug)}-title`}
          className="text-[15px] font-extrabold text-text flex-1 min-w-[200px]"
        >
          {section.title}
        </h2>
        {section.show_me && (
          <ShowMe href={section.show_me} slug={section.slug} testid={`guide-go-${section.slug}`} />
        )}
        {isAdmin && (
          <button
            type="button"
            onClick={onEdit}
            className="flex-none text-[11px] text-de hover:underline bg-transparent border-none p-0"
            data-testid={`guide-edit-${section.slug}`}
          >
            Edit
          </button>
        )}
      </div>
      {(chips.length > 0 || mine) && (
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {mine && (
            <span className="text-[9px] font-extrabold uppercase px-1.5 rounded bg-de text-white">Your chapter</span>
          )}
          {chips.map((a: GuideAudience) => (
            <span
              key={a}
              className="text-[9.5px] px-1.5 rounded border border-border text-muted"
              data-testid={`guide-audience-${section.slug}-${a}`}
            >
              {AUDIENCE_LABEL[a]}
            </span>
          ))}
        </div>
      )}
      {section.summary && <p className="text-[12.5px] text-muted mt-1.5 leading-snug">{section.summary}</p>}
      {children}
      <div className="flex flex-col gap-2.5 mt-2.5">
        {blocks.map((b, i) => (
          <Block
            key={i}
            block={b}
            slug={section.slug}
            index={i}
            entriesById={entriesById}
            onOpenCard={onOpenCard}
          />
        ))}
      </div>
      {hasReviewDate(section.reviewed_on) && (
        <div className="text-[10px] text-dim mt-3" data-testid={`guide-reviewed-${section.slug}`}>
          Last checked {formatDay(section.reviewed_on)}
        </div>
      )}
    </section>
  );
}

export default function GuideTab({
  sections,
  mine,
  isAdmin,
  entries,
  focusSlug,
  onFocusSlug,
  onOpenCard,
}: {
  sections: GuideSection[];
  /** The viewer's chapters (audiencesForRoles). */
  mine: GuideAudience[];
  isAdmin: boolean;
  entries: WhatsNewEntry[];
  /** The section to scroll to (the `s=` of a deep link, a search hit, a
   *  contents click). */
  focusSlug: string | null;
  onFocusSlug: (slug: string) => void;
  onOpenCard: (e: WhatsNewEntry) => void;
}) {
  const parts = useMemo(() => groupByPart(sections), [sections]);
  const entriesById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  // The section being edited, or `new:<after id>` for a new one.
  const [editing, setEditing] = useState<string | null>(null);

  // ★★ The deep link: scroll once the section is on screen. Re-runs when the
  //    sections arrive, so a cold load of /whats-new?tab=guide&s=… still lands.
  const present = sections.some((s) => s.slug === focusSlug);
  useEffect(() => {
    if (!focusSlug || !present) return;
    const el = document.getElementById(sectionDomId(focusSlug));
    el?.scrollIntoView?.({ block: 'start' });
  }, [focusSlug, present]);

  return (
    <div
      className="grid grid-cols-1 min-[761px]:grid-cols-[220px_minmax(0,1fr)] gap-3 p-3"
      data-testid="guide-tab"
    >
      <nav
        aria-label="Guide contents"
        className="min-[761px]:sticky min-[761px]:top-0 min-[761px]:self-start min-[761px]:max-h-[calc(100vh-220px)] overflow-y-auto"
        data-testid="guide-contents"
      >
        {parts.map((p) => (
          <div key={p.part} className="mb-2.5">
            <div className="text-[9px] font-extrabold uppercase tracking-[0.06em] text-muted mb-0.5">
              Part {p.part} · {p.name}
            </div>
            <ul className="flex flex-col">
              {p.sections.map((s) => {
                const isMine = isYourChapter(s, mine);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => onFocusSlug(s.slug)}
                      className={`w-full text-left text-[11.5px] px-1.5 py-0.5 rounded bg-transparent border-none hover:bg-de-bg ${
                        focusSlug === s.slug ? 'text-de font-bold' : 'text-text'
                      }`}
                      data-testid={`guide-toc-${s.slug}`}
                      aria-current={focusSlug === s.slug ? 'location' : undefined}
                    >
                      {s.title}
                      {isMine && (
                        <span
                          className="ml-1.5 text-[8.5px] font-extrabold uppercase px-1 rounded bg-de text-white whitespace-nowrap"
                          data-testid={`guide-toc-mine-${s.slug}`}
                        >
                          Your chapter
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-3 min-w-0" data-testid="guide-reading">
        {parts.map((p) => (
          <div key={p.part} className="flex flex-col gap-3">
            <div
              className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-muted border-b border-border pb-1"
              data-testid={`guide-part-${p.part}`}
            >
              Part {p.part} · {p.name}
            </div>
            {p.sections.map((s) => (
              <div key={s.id} className="flex flex-col gap-3">
                {editing === s.id && isAdmin ? (
                  <GuideEditor
                    section={s}
                    sections={sections}
                    entries={entries}
                    onClose={() => setEditing(null)}
                    onNewAfter={() => setEditing(`new:${s.id}`)}
                  />
                ) : (
                  <SectionView
                    section={s}
                    mine={isYourChapter(s, mine)}
                    isAdmin={isAdmin}
                    entriesById={entriesById}
                    onOpenCard={onOpenCard}
                    onEdit={() => setEditing(s.id)}
                  />
                )}
                {editing === `new:${s.id}` && isAdmin && (
                  <GuideEditor
                    section={null}
                    after={s.id}
                    sections={sections}
                    entries={entries}
                    onClose={() => setEditing(null)}
                    onNewAfter={() => undefined}
                  />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
