// ===========================================================================
// ★★★ fix-670 (P-056) — THE TRAINING GUIDE: the pure half
// ===========================================================================
//
// Bobby, 2026-10-14: "i want the training guide to be a live document in the
// bridge. i want it to flow from start to finish, and be a complete guide for
// any new hires in any role so they can see their roles, their
// responsibilities." It lives in What's New → Guide, one row per section in
// `public.guide_sections`, its body an ordered array of BLOCKS.
//
// ★★★ NO RENDERER. Text carries one piece of markup — `**bold**` — split into
//     runs here and rendered as <strong>. fix-387's rule: a markdown renderer
//     is a dependency plus an injection surface, bought for formatting nobody
//     asked for. Everything else is plain text React escapes.
//
// ★★ TOLERANT BY CONSTRUCTION. `blocks` is JSON an admin edits; one bad block
//    must cost that block, never the section, and never the page. parseBlocks
//    drops what it does not understand and keeps the rest. It never throws.

import { isAppPath, isSafeMediaUrl } from './whatsNew';

/** The five parts, in reading order. The database CHECKs 1–5. */
export const GUIDE_PARTS: Readonly<Record<GuidePart, string>> = {
  1: 'Start here',
  2: 'How a project moves',
  3: 'Your role',
  4: 'The screens',
  5: 'Words we use',
};
export type GuidePart = 1 | 2 | 3 | 4 | 5;
export const GUIDE_PART_NUMBERS: readonly GuidePart[] = [1, 2, 3, 4, 5];

/** ★ The closed audience set — mirrors the `guide_sections_audience_known`
 *  CHECK (a test reads the migration and asserts the two agree). */
export const GUIDE_AUDIENCES = [
  'everyone',
  'permitting',
  'design',
  'acquisitions',
  'construction_admin',
  'leadership',
] as const;
export type GuideAudience = (typeof GUIDE_AUDIENCES)[number];

export const AUDIENCE_LABEL: Record<GuideAudience, string> = {
  everyone: 'Everyone',
  permitting: 'Permitting',
  design: 'Design',
  acquisitions: 'Acquisitions',
  construction_admin: 'Construction Admin',
  leadership: 'Leadership & viewers',
};

export function isGuideAudience(v: unknown): v is GuideAudience {
  return typeof v === 'string' && (GUIDE_AUDIENCES as readonly string[]).includes(v);
}

export const GUIDE_MEDIA_BUCKET = 'guide-media';
export const GUIDE_SUMMARY_MAX = 240;
export const GUIDE_TITLE_MAX = 120;

/** The slug rule, the client half of `guide_sections_slug_shape`. */
export function isGuideSlug(s: string): boolean {
  return /^[a-z0-9-]{1,60}$/.test(s);
}

/** "Stage review & corrections" → "stage-review-corrections". */
export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return s || 'section';
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export type CalloutTone = 'rule' | 'note' | 'warn';
export const CALLOUT_TONES: readonly CalloutTone[] = ['rule', 'note', 'warn'];

/** Who does a step: `tool` = THE BRIDGE does it by itself; `you` = a person. */
export type StepWho = 'tool' | 'you';

export type GuideBlock =
  | { t: 'p'; text: string }
  | { t: 'list'; items: string[] }
  | { t: 'callout'; tone: CalloutTone; title: string; text: string }
  | { t: 'table'; head: string[]; rows: string[][] }
  | {
      t: 'step';
      who: StepWho;
      title: string;
      text: string;
      show_me: string | null;
      media: string | null;
    }
  | { t: 'cards'; ids: string[] };

export type GuideBlockType = GuideBlock['t'];
export const GUIDE_BLOCK_TYPES: readonly GuideBlockType[] = [
  'p',
  'list',
  'callout',
  'table',
  'step',
  'cards',
];
export const BLOCK_TYPE_LABEL: Record<GuideBlockType, string> = {
  p: 'Paragraph',
  list: 'List',
  callout: 'Callout',
  table: 'Table',
  step: 'Step',
  cards: 'What’s New cards',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ★★ A `guide-media` OBJECT PATH: `<tenant uuid>/<file>`. The first segment is
 * what the storage policies read, so a path without it could never be signed
 * anyway. No leading slash (that would be an app path), no `..`, no backslash.
 */
export function isGuideMediaPath(s: string): boolean {
  const m = /^([^/]+)\/([^\\]+)$/.exec(s);
  if (!m) return false;
  if (!UUID_RE.test(m[1]!)) return false;
  return !m[2]!.split('/').some((seg) => seg === '' || seg === '.' || seg === '..');
}

/** Media a step may carry: a bucket path, or what What's New already allows
 *  (https, or an in-app path). */
export function isGuideMedia(s: string): boolean {
  return isGuideMediaPath(s) || isSafeMediaUrl(s);
}

/** A `guide-media` path for a new upload — tenant first (the policies' rule),
 *  then a time-stamped, cleaned file name so two uploads never collide. */
export function guideMediaObjectPath(tenantId: string, fileName: string, now = Date.now()): string {
  const dot = fileName.lastIndexOf('.');
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'media';
  return `${tenantId}/${now}-${base}${ext ? `.${ext}` : ''}`;
}

export const GUIDE_MEDIA_TYPES: readonly string[] = [
  'image/gif',
  'image/png',
  'image/jpeg',
  'image/webp',
  'video/mp4',
  'video/webm',
];
export const GUIDE_MEDIA_MAX_BYTES = 15 * 1024 * 1024;

/** Why a picked file cannot be uploaded, or null when it can. */
export function refuseGuideMedia(file: { name: string; type: string; size: number }): string | null {
  if (!GUIDE_MEDIA_TYPES.includes(file.type)) {
    return `${file.name} is not a GIF, PNG, JPEG, WebP, MP4 or WebM.`;
  }
  if (file.size > GUIDE_MEDIA_MAX_BYTES) {
    return `${file.name} is over 15 MB.`;
  }
  return null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function strArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter((x): x is string => typeof x === 'string');
}

/** One block, or null when it cannot be rendered. */
function parseBlock(raw: unknown): GuideBlock | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  switch (b.t) {
    case 'p': {
      const text = str(b.text);
      return text === null ? null : { t: 'p', text };
    }
    case 'list': {
      const items = strArray(b.items);
      return items === null ? null : { t: 'list', items };
    }
    case 'callout': {
      const text = str(b.text) ?? '';
      const title = str(b.title) ?? '';
      if (!text && !title) return null;
      const tone = CALLOUT_TONES.includes(b.tone as CalloutTone) ? (b.tone as CalloutTone) : 'note';
      return { t: 'callout', tone, title, text };
    }
    case 'table': {
      const head = strArray(b.head) ?? [];
      const rows = Array.isArray(b.rows)
        ? b.rows.map(strArray).filter((r): r is string[] => r !== null)
        : [];
      if (head.length === 0 && rows.length === 0) return null;
      return { t: 'table', head, rows };
    }
    case 'step': {
      const title = str(b.title);
      if (title === null) return null;
      // ★ A bad FIELD costs the field, not the step.
      const showMe = str(b.show_me)?.trim() || null;
      const media = str(b.media)?.trim() || null;
      return {
        t: 'step',
        who: b.who === 'tool' ? 'tool' : 'you',
        title,
        text: str(b.text) ?? '',
        show_me: showMe && isAppPath(showMe) ? showMe : null,
        media: media && isGuideMedia(media) ? media : null,
      };
    }
    case 'cards': {
      const ids = (strArray(b.ids) ?? []).filter((id) => UUID_RE.test(id));
      return ids.length === 0 ? null : { t: 'cards', ids };
    }
    default:
      return null;
  }
}

/**
 * ★★★ THE TOLERANT PARSER. Anything that is not an array is an empty guide; an
 * unknown `t`, a missing field, or a block that is not an object is dropped; a
 * bad `show_me` or `media` on a step drops THAT FIELD. Never throws.
 */
export function parseBlocks(json: unknown): GuideBlock[] {
  if (!Array.isArray(json)) return [];
  const out: GuideBlock[] = [];
  for (const raw of json) {
    const b = parseBlock(raw);
    if (b) out.push(b);
  }
  return out;
}

/** A new, empty block of a type — what "+ Add" inserts. */
export function emptyBlock(t: GuideBlockType): GuideBlock {
  switch (t) {
    case 'p':
      return { t, text: '' };
    case 'list':
      return { t, items: [] };
    case 'callout':
      return { t, tone: 'note', title: '', text: '' };
    case 'table':
      return { t, head: [], rows: [] };
    case 'step':
      return { t, who: 'you', title: '', text: '', show_me: null, media: null };
    case 'cards':
      return { t, ids: [] };
  }
}

// ---------------------------------------------------------------------------
// Text: **bold** only
// ---------------------------------------------------------------------------

/**
 * ★★ `**a** b **c**` → [a(bold), " b ", c(bold)]. An UNMATCHED `**` is shown
 * literally. Nothing is ever parsed as HTML — the runs are rendered as text.
 */
export function boldRuns(text: string): { text: string; bold: boolean }[] {
  const parts = text.split('**');
  // An even number of parts means an odd number of markers: the last one has
  // no partner, so it goes back into the text it split.
  if (parts.length % 2 === 0) {
    const tail = parts.pop()!;
    parts[parts.length - 1] = `${parts[parts.length - 1]}**${tail}`;
  }
  const out: { text: string; bold: boolean }[] = [];
  parts.forEach((p, i) => {
    if (p !== '') out.push({ text: p, bold: i % 2 === 1 });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Table ⇄ textarea (the editor): one row per line, cells split by " | ",
// the first line is the header.
// ---------------------------------------------------------------------------

export function tableToText(head: string[], rows: string[][]): string {
  return [head, ...rows].map((r) => r.join(' | ')).join('\n');
}

export function textToTable(text: string): { head: string[]; rows: string[][] } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((l) => l.split(/\s*\|\s*/).map((c) => c.trim()));
  return { head: lines[0] ?? [], rows: lines.slice(1) };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export interface GuideSection {
  id: string;
  part: GuidePart;
  sort_order: number;
  slug: string;
  title: string;
  summary: string | null;
  audience: GuideAudience[];
  show_me: string | null;
  /** RAW — always read it through parseBlocks. */
  blocks: unknown;
  reviewed_on: string | null;
  updated_at?: string | null;
}

/** The guide reads start to finish: part, then sort_order, then title. */
export function sortSections<T extends Pick<GuideSection, 'part' | 'sort_order' | 'title'>>(
  sections: ReadonlyArray<T>,
): T[] {
  return [...sections].sort(
    (a, z) => a.part - z.part || a.sort_order - z.sort_order || a.title.localeCompare(z.title),
  );
}

/** Sections under their part, in order; parts with no section are left out. */
export function groupByPart<T extends Pick<GuideSection, 'part' | 'sort_order' | 'title'>>(
  sections: ReadonlyArray<T>,
): { part: GuidePart; name: string; sections: T[] }[] {
  const sorted = sortSections(sections);
  return GUIDE_PART_NUMBERS.map((part) => ({
    part,
    name: GUIDE_PARTS[part],
    sections: sorted.filter((s) => s.part === part),
  })).filter((g) => g.sections.length > 0);
}

/**
 * ★★ MOVE UP / MOVE DOWN. Swapping two sort_order values breaks when they are
 * equal (or a section moves across a part boundary), so the whole guide is
 * renumbered 10, 20, 30… in its new order and only the rows whose number
 * changed are returned. A move that would leave the guide is a no-op ([]).
 *
 * ★ "Move up" from the top of Part 3 does not jump a Part 2 section — it
 *   becomes the LAST section of Part 2, which is what reading order means.
 */
export function moveSection(
  sections: ReadonlyArray<Pick<GuideSection, 'id' | 'part' | 'sort_order' | 'title'>>,
  id: string,
  dir: -1 | 1,
): { id: string; part: GuidePart; sort_order: number }[] {
  const order = sortSections(sections);
  const i = order.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return [];
  const moving = order[i]!;
  const other = order[j]!;
  const swapped = [...order];
  if (other.part !== moving.part) {
    // Crossing a part boundary: keep the place, change the part.
    swapped[i] = { ...moving, part: other.part };
  } else {
    swapped[i] = other;
    swapped[j] = moving;
  }
  const changes: { id: string; part: GuidePart; sort_order: number }[] = [];
  swapped.forEach((s, k) => {
    const sort = (k + 1) * 10;
    const orig = sections.find((x) => x.id === s.id)!;
    if (orig.sort_order !== sort || orig.part !== s.part) {
      changes.push({ id: s.id, part: s.part as GuidePart, sort_order: sort });
    }
  });
  return changes;
}

/** The sort_order a new section takes to land straight after `after` (or at
 *  the very end). Renumbering happens on the next move; a gap of 5 is enough. */
export function sortOrderAfter(
  sections: ReadonlyArray<Pick<GuideSection, 'id' | 'part' | 'sort_order' | 'title'>>,
  afterId: string | null,
): { part: GuidePart; sort_order: number } {
  const order = sortSections(sections);
  if (order.length === 0) return { part: 1, sort_order: 10 };
  const i = afterId ? order.findIndex((s) => s.id === afterId) : order.length - 1;
  const at = order[i < 0 ? order.length - 1 : i]!;
  const next = order[(i < 0 ? order.length - 1 : i) + 1];
  if (next && next.part === at.part) {
    return { part: at.part as GuidePart, sort_order: Math.floor((at.sort_order + next.sort_order) / 2) };
  }
  return { part: at.part as GuidePart, sort_order: at.sort_order + 5 };
}

// ---------------------------------------------------------------------------
// Your chapter
// ---------------------------------------------------------------------------

const ROLE_AUDIENCE: Record<string, GuideAudience> = {
  ent: 'permitting',
  ent_lead: 'permitting',
  director: 'design',
  dm: 'design',
  da: 'design',
  schematic: 'design',
  acq: 'acquisitions',
  acq_lead: 'acquisitions',
  ca: 'construction_admin',
};

/**
 * ★★ The viewer's roster roles → the chapters marked "Your chapter".
 * Several roles → several chapters, each once. `viewer` → leadership ONLY when
 * it is the person's only role (Lucas holds ent + viewer: he is Permitting).
 * No roster row → no marking. Never `everyone` — that chapter is everybody's.
 */
export function audiencesForRoles(roles: ReadonlyArray<string>): GuideAudience[] {
  const out = new Set<GuideAudience>();
  for (const r of roles) {
    const a = ROLE_AUDIENCE[r];
    if (a) out.add(a);
  }
  if (out.size === 0 && roles.includes('viewer')) out.add('leadership');
  return GUIDE_AUDIENCES.filter((a) => out.has(a));
}

/** Is this section one of the viewer's chapters? */
export function isYourChapter(
  section: Pick<GuideSection, 'audience'>,
  mine: ReadonlyArray<GuideAudience>,
): boolean {
  return section.audience.some((a) => a !== 'everyone' && mine.includes(a));
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/** The DOM id of a section — what a deep link scrolls to. */
export function sectionDomId(slug: string): string {
  return `guide-section-${slug}`;
}

/** ★ THE one format for every in-app link to the guide. */
export function guideHref(slug?: string | null): string {
  return slug ? `/whats-new?tab=guide&s=${encodeURIComponent(slug)}` : '/whats-new?tab=guide';
}

/** "2026-10-14" → "14 Oct 2026" is formatDay in whatsNew; this only decides
 *  whether a reviewed_on is worth showing. */
export function hasReviewDate(d: string | null | undefined): d is string {
  return !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

// ===========================================================================
// ★★★ fix-673 (P-355) — the role filter, the counts, the clips, the highlight
// ===========================================================================
//
// Bobby, 2026-10-14, on his first read of the live Guide: "maybe there's, like,
// different categories of, like, everyone, design, permitting … and maybe you
// can filter the view a little bit … Think of, like, Apple and how they've done
// their tips."

/** The pills above Part 1: All, then the audiences in their CHECK order. */
export type GuideFilter = 'all' | GuideAudience;
export const GUIDE_FILTERS: readonly GuideFilter[] = ['all', ...GUIDE_AUDIENCES];

/** ★ The pill's word. The editor's checkboxes keep "Leadership & viewers";
 *  a pill row reads in single words (the mockup). */
export const GUIDE_FILTER_LABEL: Record<GuideFilter, string> = {
  all: 'All',
  ...AUDIENCE_LABEL,
  leadership: 'Leadership',
};

/** ★★ Bobby's ruling: the filter opens on All. */
export const GUIDE_FILTER_DEFAULT: GuideFilter = 'all';

export function isGuideFilter(v: unknown): v is GuideFilter {
  return v === 'all' || isGuideAudience(v);
}

/**
 * ★★★ THE FILTER RULE.
 *   · All      → every section.
 *   · Everyone → only sections written for everybody (role chapters hidden).
 *   · A role   → that role's sections AND everybody's, so the story still runs
 *                start to finish with the role's chapter in its place.
 */
export function inGuideFilter(section: Pick<GuideSection, 'audience'>, filter: GuideFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'everyone') return section.audience.includes('everyone');
  return section.audience.includes(filter) || section.audience.includes('everyone');
}

/** One step that carries a clip, flattened in guide order for the viewer. */
export interface GuideClip {
  /** `<slug>:<block index>` — stable across renders, unique in the guide. */
  key: string;
  slug: string;
  chapter: string;
  title: string;
  text: string;
  media: string;
}

export function clipKey(slug: string, blockIndex: number): string {
  return `${slug}:${blockIndex}`;
}

/** ★★ Every clip in these sections, in reading order. The viewer's Previous /
 *  Next walk THIS list, so they stay inside the current filter and search. */
export function guideClips(sections: ReadonlyArray<GuideSection>): GuideClip[] {
  const out: GuideClip[] = [];
  for (const s of sortSections(sections)) {
    parseBlocks(s.blocks).forEach((b, i) => {
      if (b.t === 'step' && b.media) {
        out.push({
          key: clipKey(s.slug, i),
          slug: s.slug,
          chapter: s.title,
          title: b.title,
          text: b.text,
          media: b.media,
        });
      }
    });
  }
  return out;
}

/** Chapters, steps and clips in these sections — the line under the pills. */
export function guideStats(sections: ReadonlyArray<GuideSection>): { chapters: number; steps: number; clips: number } {
  let steps = 0;
  let clips = 0;
  for (const s of sections) {
    for (const b of parseBlocks(s.blocks)) {
      if (b.t !== 'step') continue;
      steps += 1;
      if (b.media) clips += 1;
    }
  }
  return { chapters: sections.length, steps, clips };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "13 chapters · 44 steps · 10 clips", or while searching
 *  "4 chapters match “resubmit”". */
export function guideCountLine(stats: { chapters: number; steps: number; clips: number }, query = ''): string {
  const q = query.trim();
  if (q) return `${plural(stats.chapters, 'chapter matches', 'chapters match')} “${q}”`;
  return [
    plural(stats.chapters, 'chapter', 'chapters'),
    plural(stats.steps, 'step', 'steps'),
    plural(stats.clips, 'clip', 'clips'),
  ].join(' · ');
}

/**
 * ★★ The words to highlight: what bp_search_guide marked with « » (the REAL
 * words — "corectons" finds "corrections", and it is "corrections" that must
 * light up), plus the typed words themselves. Lower-cased, 2+ letters, unique.
 */
export function highlightWords(snippets: ReadonlyArray<string>, query: string): string[] {
  const out = new Set<string>();
  for (const s of snippets) {
    for (const m of s.matchAll(/«([^»]*)»/g)) {
      for (const w of m[1]!.split(/\s+/)) if (w.length >= 2) out.add(w.toLowerCase());
    }
  }
  for (const w of query.trim().split(/\s+/)) if (w.length >= 2) out.add(w.toLowerCase());
  return [...out];
}

/** ★★ Split text into plain and marked runs — a <mark> is rendered by React
 *  from these, never by building HTML (fix-387). Longest word first, so
 *  "resubmittal" wins over "resubmit". */
export function highlightRuns(text: string, words: ReadonlyArray<string>): { text: string; mark: boolean }[] {
  const ws = words.filter((w) => w.length >= 2);
  if (ws.length === 0 || !text) return [{ text, mark: false }];
  const esc = [...ws].sort((a, z) => z.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${esc.join('|')})`, 'gi');
  const out: { text: string; mark: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), mark: false });
    out.push({ text: m[0], mark: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), mark: false });
  return out.length > 0 ? out : [{ text, mark: false }];
}
