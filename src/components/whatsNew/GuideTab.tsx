import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { makeOriginState } from "../../lib/previousOrigin";
import {
  GUIDE_FILTERS,
  GUIDE_FILTER_LABEL,
  GUIDE_PARTS,
  GUIDE_PART_NUMBERS,
  clipKey,
  groupByPart,
  guideClips,
  guideCountLine,
  guideStats,
  hasReviewDate,
  highlightWords,
  inGuideFilter,
  isYourChapter,
  parseBlocks,
  sectionDomId,
  sortSections,
  type GuideAudience,
  type GuideBlock,
  type GuideFilter,
  type GuidePart,
  type GuideSection,
} from "../../lib/guide";
import { loadGuideFilter, saveGuideFilter } from "../../lib/guideFilterPref";
import { formatDay, isAppPath, type WhatsNewEntry } from "../../lib/whatsNew";
import { useGuideSearch } from "../../hooks/useGuide";
import { useAuthStore } from "../../stores/authStore";
import { ClipStill, GuideText, WhoTag } from "./GuideBits";
import { GuideHighlight } from "./guideView";
import GuideClipViewer from "./GuideClipViewer";
import GuideEditor from "./GuideEditor";

// ===========================================================================
// ★★★ fix-670 (P-056) — WHAT'S NEW → GUIDE
// ===========================================================================
//
// Bobby, 2026-10-14: "a complete guide for any new hires in any role so they
// can see their roles, their responsibilities." One reading column that runs
// start to finish, the viewer's own chapters marked — never reordered: the
// guide reads the same for everyone.
//
// ★★ Every step says WHO does it, in words: THE BRIDGE (it happens by itself)
//    or YOU (a person decides it). Colour backs the word up, never replaces it.
//
// ★★ It LINKS to What's New cards and never copies them: a `cards` block is a
//    list of entry ids, rendered as pills that open the existing DetailPanel.
//
// ===========================================================================
// ★★★ fix-673 (P-355) — …AND IT READS LIKE APPLE'S TIPS
// ===========================================================================
//
// Bobby, the same night: "Think of, like, Apple and how they've done their
// tips. This should almost be like Apple's training guide." The mockup
// (Brain/briefs/guide/fix673_mockup.html) is the spec:
//   · a quiet header, then a sticky bar: role pills · its OWN search · a count
//   · the five parts as cover tiles; a click scrolls to the part
//   · steps as white cards in a 2-column grid, a clip's still on top
//   · clips never play in a card — "▶ Watch" opens them large (GuideClipViewer)
//
// ★★ THE LEFT CONTENTS COLUMN IS GONE. A 220px column beside a 2-column card
//    grid left each card ~300px wide at 1366px with the ribbon open — the
//    cramped page the brief warned about. The part covers and the sticky bar
//    do its job: they jump, and they follow the filter.

/** The origin a "Show me →" carries, so ← Previous comes back to THIS section
 *  of the guide rather than to wherever the page happened to be. */
function guideOrigin(slug: string) {
  return makeOriginState({
    pathname: "/whats-new",
    search: `?tab=guide&s=${encodeURIComponent(slug)}`,
  });
}

/** ★ Soft tinted panels — rule = pale blue, warn = pale amber, note = white. */
const CALLOUT_CLASS: Record<"rule" | "note" | "warn", string> = {
  rule: "bg-de-bg",
  note: "bg-surface",
  warn: "bg-wa-bg",
};

/** ★ The covers, in the app's own colours, deepened toward black as the
 *  mockup does. Part 4's slate is Tailwind's slate-600 (no token exists). */
const COVER_COLOUR: Record<GuidePart, string> = {
  1: "var(--color-de)",
  2: "var(--color-ok)",
  3: "var(--color-wa)",
  4: "#475569",
  5: "var(--color-jv)",
};
function coverStyle(part: GuidePart): CSSProperties {
  const c = COVER_COLOUR[part];
  return {
    background: `linear-gradient(150deg, ${c}, color-mix(in srgb, ${c} 62%, black))`,
  };
}

function partDomId(part: GuidePart): string {
  return `guide-part-${part}`;
}

function ShowMe({
  href,
  slug,
  testid,
}: {
  href: string;
  slug: string;
  testid: string;
}) {
  const navigate = useNavigate();
  if (!isAppPath(href)) return null;
  return (
    <button
      type="button"
      // ★★ DetailPanel's behaviour exactly: navigate() keeps it in the app, and
      // the origin is THIS section, so ← Previous lands back on it.
      onClick={() => navigate(href, { state: guideOrigin(slug) })}
      className="self-start text-[14px] font-semibold text-de bg-transparent border-0 p-0 hover:underline cursor-pointer"
      data-testid={testid}
      data-href={href}
    >
      Show me →
    </button>
  );
}

function Magnifier() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
      className="absolute left-[11px] top-1/2 -translate-y-1/2 w-[15px] h-[15px] stroke-muted pointer-events-none"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

type Step = Extract<GuideBlock, { t: "step" }>;

function StepCard({
  step,
  slug,
  index,
  wide,
  onPlay,
}: {
  step: Step;
  slug: string;
  index: number;
  wide: boolean;
  onPlay: (key: string, el: HTMLButtonElement) => void;
}) {
  return (
    <article
      className={`bg-surface rounded-[18px] overflow-hidden flex flex-col shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${
        wide ? "min-[861px]:col-span-2" : ""
      }`}
      data-testid={`guide-step-${slug}-${index}`}
      data-who={step.who}
      data-wide={wide ? "true" : "false"}
    >
      {step.media && (
        <ClipStill
          media={step.media}
          title={step.title}
          onPlay={(el) => onPlay(clipKey(slug, index), el)}
          testid={`guide-clip-${slug}-${index}`}
        />
      )}
      <div className="px-[18px] pt-4 pb-[18px] flex flex-col gap-1.5 flex-1">
        <WhoTag who={step.who} />
        <h5 className="text-[17px] font-semibold tracking-[-0.01em] text-text m-0 leading-snug">
          <GuideText text={step.title} />
        </h5>
        {step.text && (
          <p className="text-[15px] text-text/90 m-0 leading-normal">
            <GuideText text={step.text} />
          </p>
        )}
        {step.show_me && (
          <div className="mt-auto pt-1.5">
            <ShowMe
              href={step.show_me}
              slug={slug}
              testid={`guide-step-go-${slug}-${index}`}
            />
          </div>
        )}
      </div>
    </article>
  );
}

function Block({
  block,
  entriesById,
  onOpenCard,
}: {
  block: Exclude<GuideBlock, { t: "step" }>;
  entriesById: Map<string, WhatsNewEntry>;
  onOpenCard: (e: WhatsNewEntry) => void;
}) {
  switch (block.t) {
    case "p":
      return (
        <p className="text-[15px] text-text/90 leading-normal max-w-[68ch] m-0">
          <GuideText text={block.text} />
        </p>
      );
    case "list":
      return (
        <ul className="list-disc pl-5 text-[15px] text-text/90 leading-normal max-w-[68ch] flex flex-col gap-0.5 m-0">
          {block.items.map((it, i) => (
            <li key={i}>
              <GuideText text={it} />
            </li>
          ))}
        </ul>
      );
    case "callout":
      return (
        <div
          className={`rounded-[18px] px-[18px] py-4 ${CALLOUT_CLASS[block.tone]}`}
          data-testid={`guide-callout-${block.tone}`}
        >
          {block.title && (
            <div className="text-[15px] font-semibold text-text mb-[3px]">
              <GuideText text={block.title} />
            </div>
          )}
          {block.text && (
            <div className="text-[15px] text-text/90 leading-normal">
              <GuideText text={block.text} />
            </div>
          )}
        </div>
      );
    case "table":
      return (
        <div className="overflow-x-auto bg-surface rounded-[18px] p-1.5">
          <table
            className="text-[14px] border-collapse w-full"
            data-testid="guide-table"
          >
            {block.head.length > 0 && (
              <thead>
                <tr>
                  {block.head.map((h, i) => (
                    <th
                      key={i}
                      className="text-left text-[12px] font-semibold text-muted px-3 py-2.5 border-b border-border"
                    >
                      <GuideText text={h} />
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {block.rows.map((r, i) => (
                <tr key={i} className="border-b border-s2 last:border-b-0">
                  {r.map((c, k) => (
                    <td
                      key={k}
                      className={`px-3 py-2.5 align-top ${k === 0 ? "text-text font-medium" : "text-text/90"}`}
                    >
                      <GuideText text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "cards": {
      // ★ An id that no longer exists is skipped silently — the entry was
      //   deleted, and a hole is better than a broken pill.
      const found = block.ids
        .map((id) => entriesById.get(id))
        .filter((e): e is WhatsNewEntry => !!e);
      if (found.length === 0) return null;
      return (
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="guide-cards"
        >
          <span className="text-[13px] text-muted mr-0.5">Related tips</span>
          {found.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => onOpenCard(e)}
              className="text-[13px] text-text/90 bg-surface border border-border rounded-full px-3 py-[5px] hover:border-de cursor-pointer"
              data-testid={`guide-card-${e.id}`}
            >
              {e.title}
            </button>
          ))}
        </div>
      );
    }
  }
}

/** A chapter's blocks: runs of steps become a card grid; everything else sits
 *  between them at reading width. One clip in a chapter spans both columns;
 *  several share the row (the mockup's rule). */
function ChapterBody({
  section,
  blocks,
  entriesById,
  onOpenCard,
  onPlay,
}: {
  section: GuideSection;
  blocks: GuideBlock[];
  entriesById: Map<string, WhatsNewEntry>;
  onOpenCard: (e: WhatsNewEntry) => void;
  onPlay: (key: string, el: HTMLButtonElement) => void;
}) {
  const clipCount = blocks.filter((b) => b.t === "step" && b.media).length;
  const out: ReactNode[] = [];
  let run: ReactNode[] = [];
  const flush = (k: number) => {
    if (run.length === 0) return;
    out.push(
      <div
        key={`grid-${k}`}
        className="grid grid-cols-1 min-[861px]:grid-cols-2 gap-3.5"
      >
        {run}
      </div>,
    );
    run = [];
  };
  blocks.forEach((b, i) => {
    if (b.t === "step") {
      run.push(
        <StepCard
          key={i}
          step={b}
          slug={section.slug}
          index={i}
          wide={!!b.media && clipCount === 1}
          onPlay={onPlay}
        />,
      );
      return;
    }
    flush(i);
    out.push(
      <Block
        key={i}
        block={b}
        entriesById={entriesById}
        onOpenCard={onOpenCard}
      />,
    );
  });
  flush(blocks.length);
  return <div className="flex flex-col gap-3.5">{out}</div>;
}

function SectionView({
  section,
  mine,
  isAdmin,
  entriesById,
  onOpenCard,
  onEdit,
  onPlay,
}: {
  section: GuideSection;
  mine: boolean;
  isAdmin: boolean;
  entriesById: Map<string, WhatsNewEntry>;
  onOpenCard: (e: WhatsNewEntry) => void;
  onEdit: () => void;
  onPlay: (key: string, el: HTMLButtonElement) => void;
}) {
  const blocks = useMemo(() => parseBlocks(section.blocks), [section.blocks]);
  const titleId = `${sectionDomId(section.slug)}-title`;
  return (
    <section
      id={sectionDomId(section.slug)}
      className="scroll-mt-[120px]"
      data-testid={`guide-section-${section.slug}`}
      data-mine={mine ? "true" : "false"}
      aria-labelledby={titleId}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
        <h4
          id={titleId}
          className="text-[24px] font-bold tracking-[-0.015em] text-text m-0 leading-tight"
        >
          <GuideText text={section.title} />
        </h4>
        {mine && (
          <span
            className="text-[11px] font-bold text-white bg-de rounded-full px-[9px] py-0.5"
            data-testid={`guide-mine-${section.slug}`}
          >
            Your chapter
          </span>
        )}
        {section.show_me && (
          <ShowMe
            href={section.show_me}
            slug={section.slug}
            testid={`guide-go-${section.slug}`}
          />
        )}
        {isAdmin && (
          <button
            type="button"
            onClick={onEdit}
            className="text-[13px] text-de hover:underline bg-transparent border-none p-0 cursor-pointer"
            data-testid={`guide-edit-${section.slug}`}
          >
            Edit
          </button>
        )}
      </div>
      {section.summary && (
        <p className="text-[16px] text-muted mt-1 mb-4 max-w-[62ch]">
          <GuideText text={section.summary} />
        </p>
      )}
      <ChapterBody
        section={section}
        blocks={blocks}
        entriesById={entriesById}
        onOpenCard={onOpenCard}
        onPlay={onPlay}
      />
      {hasReviewDate(section.reviewed_on) && (
        <div
          className="text-[11px] text-dim mt-3"
          data-testid={`guide-reviewed-${section.slug}`}
        >
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
  onOpenCard,
}: {
  sections: GuideSection[];
  /** The viewer's chapters (audiencesForRoles). */
  mine: GuideAudience[];
  isAdmin: boolean;
  entries: WhatsNewEntry[];
  /** The section to scroll to (the `s=` of a deep link or a search hit). */
  focusSlug: string | null;
  onOpenCard: (e: WhatsNewEntry) => void;
}) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const entriesById = useMemo(
    () => new Map(entries.map((e) => [e.id, e])),
    [entries],
  );
  // The section being edited, or `new:<after id>` for a new one.
  const [editing, setEditing] = useState<string | null>(null);

  // ★★ §A: the role filter. Opens on All (Bobby's ruling), or on this
  //    session's last pick. A deep link to a section the pick hides widens it
  //    to All — a link that scrolls to nothing is a broken link.
  const [filter, setFilterState] = useState<GuideFilter>(() => {
    const stored = loadGuideFilter(userId);
    const target = focusSlug
      ? sections.find((s) => s.slug === focusSlug)
      : undefined;
    return target && !inGuideFilter(target, stored) ? "all" : stored;
  });
  const setFilter = (f: GuideFilter) => {
    setFilterState(f);
    saveGuideFilter(userId, f);
  };

  // ★★ §B: the Guide's OWN search — the guide only, inside the filter.
  const [query, setQuery] = useState("");
  const search = useGuideSearch(query);
  const searching = search.active;

  // A new deep link (a top-search hit, ← Previous) clears this search and
  // widens a filter that would hide it. React's adjust-during-render pattern.
  const [seenFocus, setSeenFocus] = useState(focusSlug);
  if (focusSlug !== seenFocus) {
    setSeenFocus(focusSlug);
    if (focusSlug) {
      setQuery("");
      const target = sections.find((s) => s.slug === focusSlug);
      if (target && !inGuideFilter(target, filter)) setFilterState("all");
    }
  }

  const filtered = useMemo(
    () => sortSections(sections.filter((s) => inGuideFilter(s, filter))),
    [sections, filter],
  );
  const hitIds = useMemo(
    () =>
      searching && !search.isError
        ? new Set((search.data ?? []).map((h) => h.id))
        : null,
    [searching, search.isError, search.data],
  );
  const shown = useMemo(
    () => (searching ? filtered.filter((s) => hitIds?.has(s.id)) : filtered),
    [searching, filtered, hitIds],
  );
  const marks = useMemo(
    () =>
      searching
        ? highlightWords(
            (search.data ?? []).map((h) => h.snippet),
            query,
          )
        : [],
    [searching, search.data, query],
  );
  const parts = useMemo(() => groupByPart(shown), [shown]);
  const stats = useMemo(() => guideStats(shown), [shown]);
  const clips = useMemo(() => guideClips(shown), [shown]);
  const searchPending =
    searching && search.data === undefined && !search.isError;

  // ★★ §D: the viewer, and the still that opened it (focus goes back there).
  const [viewing, setViewing] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const play = (key: string, el: HTMLButtonElement) => {
    const i = clips.findIndex((c) => c.key === key);
    if (i < 0) return;
    opener.current = el;
    setViewing(i);
  };
  const closeViewer = useCallback(() => {
    setViewing(null);
    opener.current?.focus();
  }, []);

  // ★★ The deep link: scroll once the section is on screen. Re-runs when the
  //    sections arrive, so a cold load of /whats-new?tab=guide&s=… still lands.
  const present = shown.some((s) => s.slug === focusSlug);
  useEffect(() => {
    if (!focusSlug || !present) return;
    const el = document.getElementById(sectionDomId(focusSlug));
    el?.scrollIntoView?.({ block: "start" });
  }, [focusSlug, present]);

  const coverCounts = new Map(parts.map((p) => [p.part, p.sections.length]));

  return (
    <div className="bg-bg min-h-full" data-testid="guide-tab">
      <div className="max-w-[1080px] mx-auto px-4 pb-24">
        <header className="pt-8 pb-1">
          <p className="text-[13px] font-semibold text-de m-0 mb-1.5">
            What&rsquo;s New · Guide
          </p>
          <h2
            className="text-[clamp(30px,5vw,46px)] leading-[1.05] font-bold tracking-[-0.025em] text-text m-0 mb-2.5"
            data-testid="guide-heading"
          >
            The Bridge Guide
          </h2>
          <p className="text-[18px] leading-snug text-muted max-w-[56ch] m-0">
            Everything a project goes through, from its first day to its last
            permit, and what your role does at each step.
          </p>
        </header>

        {/* ★★ §A + §B: the bar that sticks while you scroll. */}
        <div
          className="sticky top-0 z-20 -mx-4 px-4 py-3 mt-5 flex flex-wrap items-center gap-x-3.5 gap-y-2.5 bg-bg/[0.86] backdrop-blur-[18px] backdrop-saturate-[1.8] border-b border-border/60"
          data-testid="guide-controls"
        >
          <div
            className="flex flex-wrap gap-1.5 min-w-0"
            role="group"
            aria-label="Show the guide for"
          >
            {GUIDE_FILTERS.map((f) => {
              const on = filter === f;
              const yours = f !== "all" && f !== "everyone" && mine.includes(f);
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFilter(f)}
                  className={`text-[13.5px] font-medium rounded-full px-3.5 py-1.5 border cursor-pointer ${
                    on
                      ? "bg-text border-text text-white"
                      : "bg-surface border-border text-text/85 hover:border-muted"
                  }`}
                  data-testid={`guide-filter-${f}`}
                >
                  {GUIDE_FILTER_LABEL[f]}
                  {yours && (
                    <span
                      className={`ml-1.5 text-[10px] font-bold rounded-full px-1.5 py-px align-[1px] ${
                        on ? "bg-surface text-text" : "bg-de text-white"
                      }`}
                      data-testid={`guide-filter-you-${f}`}
                    >
                      You
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <label className="relative flex-[1_1_240px] min-w-0 max-[860px]:max-w-none max-w-[340px] min-[861px]:ml-auto">
            <Magnifier />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the guide"
              autoComplete="off"
              aria-label="Search the guide"
              className="w-full text-[14px] pl-[34px] pr-8 py-2 rounded-[10px] border border-border bg-surface text-text outline-none focus:border-de [&::-webkit-search-cancel-button]:hidden"
              data-testid="guide-search"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear the search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[13px] leading-none text-muted hover:text-text bg-transparent border-0 p-1 cursor-pointer"
                data-testid="guide-search-clear"
              >
                ✕
              </button>
            )}
          </label>
          <div
            className="w-full text-[13px] text-muted"
            data-testid="guide-count"
            aria-live="polite"
          >
            {searchPending
              ? "Searching…"
              : guideCountLine(stats, searching ? query : "")}
          </div>
        </div>

        {/* ★★ §C: the five parts as covers — they follow the filter, and a
            part with nothing left is not drawn. */}
        {parts.length > 0 && (
          <div
            className="grid grid-cols-2 min-[861px]:grid-cols-5 gap-3 mt-6 mb-2"
            data-testid="guide-covers"
          >
            {GUIDE_PART_NUMBERS.filter((p) => coverCounts.has(p)).map((p) => {
              const n = coverCounts.get(p)!;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() =>
                    document
                      .getElementById(partDomId(p))
                      ?.scrollIntoView?.({ block: "start" })
                  }
                  className="border-0 text-left rounded-[18px] px-4 pt-4 pb-3.5 min-h-[132px] text-white flex flex-col justify-between cursor-pointer"
                  style={coverStyle(p)}
                  data-testid={`guide-cover-${p}`}
                >
                  <span className="text-[12px] font-semibold opacity-85">
                    Part {p}
                  </span>
                  <span className="text-[19px] font-bold leading-[1.15] tracking-[-0.01em]">
                    {GUIDE_PARTS[p]}
                  </span>
                  <span className="text-[12px] opacity-85">
                    {n} {n === 1 ? "chapter" : "chapters"}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {searching && search.isError && (
          <div
            className="bg-surface rounded-[18px] px-5 py-10 text-center text-muted mt-7"
            data-testid="guide-search-error"
          >
            The guide search didn&rsquo;t answer. Try again in a moment.
          </div>
        )}
        {shown.length === 0 &&
          !searchPending &&
          !(searching && search.isError) && (
            <div
              className="bg-surface rounded-[18px] px-5 py-10 text-center text-muted mt-7"
              data-testid="guide-no-match"
            >
              Nothing in the guide matches that. Try a shorter word, or switch
              to <strong className="text-text">All</strong>.
            </div>
          )}

        <GuideHighlight.Provider value={marks}>
          <div data-testid="guide-reading">
            {parts.map((p) => (
              <div
                key={p.part}
                id={partDomId(p.part)}
                className="mt-14 scroll-mt-[120px]"
                data-testid={partDomId(p.part)}
              >
                <div className="flex items-baseline gap-3 mb-1">
                  <span className="text-[13px] font-semibold text-muted">
                    Part {p.part}
                  </span>
                  <h3 className="text-[32px] font-bold tracking-[-0.02em] text-text m-0">
                    {p.name}
                  </h3>
                </div>
                {p.sections.map((s) => (
                  <div key={s.id} className="mt-7 flex flex-col gap-3">
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
                        onPlay={play}
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
        </GuideHighlight.Provider>
      </div>

      {viewing !== null && clips[viewing] && (
        <GuideClipViewer
          clips={clips}
          index={viewing}
          onIndex={setViewing}
          onClose={closeViewer}
        />
      )}
    </div>
  );
}
