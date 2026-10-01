// ===========================================================================
// ★★★ fix-611 §B — ONE REGISTRY OF SETTINGS BLOCKS
// ===========================================================================
//
// Every block on every Settings category, declared once: which category it
// belongs to, what it is called, the one line that describes it collapsed, the
// screens it feeds, and the words that should find it in search.
//
// ---------------------------------------------------------------------------
// ★★★ WHAT THIS REGISTRY DOES *NOT* HOLD, AND WHY
// ---------------------------------------------------------------------------
// It does not hold the component. The brief's §B sketch listed one, and the
// brief's ONE RULE is louder: *"Move and group the existing editors. Change none
// of them inside."*
//
// Pulling 35 editors out of five tab components would have meant re-homing the
// shared data each tab loads at its top (`useTeamMembers`, `useJurisdictions`,
// `useAppConfig`) and the helpers built on it (`addMember`, `hardDelete`,
// `renameSimple`, `softDeleteDa`) — that is rewriting the containers, and every
// rewritten line is a chance for one of 35 editors to lose a prop.
//
// ★★ SO THE CONTENT STAYS WHERE IT ALREADY RENDERS. Each tab now wraps its
// blocks in `<SettingsBlock id="…">` instead of its own local `Section`, and the
// accordion decides what is open. The tab keeps its hooks, its helpers and its
// early returns; the editors keep their props verbatim.
//
// ★★★ THE LOOP IS STILL CLOSED, in `SettingsCategoriesFix611.test.tsx`: every id
// below must be rendered by exactly one `<SettingsBlock>` in the source, and
// every `<SettingsBlock>` in the source must be in this registry. A metadata
// registry nobody renders would be a lie that passes, so that test is the thing
// that stops it being one.

import type { SettingsSectionId } from './settingsSections';

export interface SettingsBlock {
  /** Stable id. Also the URL hash (`/settings/lists#jurisdictions`), so it is a
   *  permalink and must not be renamed casually. */
  id: string;
  category: SettingsSectionId;
  title: string;
  /** One line, shown collapsed. Truncates. */
  summary: string;
  /** ★ Plain screen names, from the fix-607 census "every screen that reads it"
   *  column. These are what somebody checks before changing a list. */
  feeds: readonly string[];
  /** Extra search terms beyond the title and summary. The VALUES inside a list
   *  are matched separately, from live data — see `searchSettings`. */
  keywords: string;
  /** A read-out: it shows something and changes nothing. */
  readOut?: true;
  /** "3 → 1" when this block absorbed several of the old ones. */
  merged?: string;
}

// ---------------------------------------------------------------------------
// ★ THE SUMMARIES ARE STATIC TEXT, deliberately.
//   The mock computes several of them from live counts ("19 cities", "59 active
//   builders"). A count in a collapsed row is the kind of thing that goes stale
//   and then lies, and making every row wait on a query to render its own label
//   would put five spinners on a page that is mostly text. Where a count is the
//   point, the editor shows it when the block is open — which is the only place
//   it can be right.
// ---------------------------------------------------------------------------

export const SETTINGS_BLOCKS: readonly SettingsBlock[] = [
  // ═══════════════════════════════════════════════════════════ My account ══
  {
    id: 'your-picture',
    category: 'account',
    title: 'Your picture',
    summary: 'Shows on chat, mentions and the project header',
    feeds: ['Chat', 'Mentions', 'Project header'],
    keywords: 'avatar photo headshot profile picture upload',
  },
  {
    id: 'sign-in-info',
    category: 'account',
    title: 'Sign-in info',
    summary: 'Who you are signed in as, your access level, and the app build',
    feeds: [],
    keywords: 'login email role build sign out account tenant membership',
    readOut: true,
  },

  // ══════════════════════════════════════════════════════════════ People ══
  //
  // ★★★ fix-613 §A FINISHED WHAT fix-611 STAGED. fix-611 kept the nine roster
  //     editors as nine blocks and said the follow-up would replace them; the
  //     mock's own map always pointed here. ⚖️ Bobby, 2026-09-30: **People = one
  //     table.** So Design Associates · Design Managers · Entitlement leads ·
  //     Acquisition leads · Schematic · Construction admin · Names and emails ·
  //     Departments · Agenda members are ONE block, and Former & inactive is a
  //     list inside it rather than a tenth — it is the same people, answered the
  //     other way round.
  //
  // ★★ People is now THREE blocks: Add person · Everyone · (the retired list,
  //    inside Everyone). That is the mock's People panel exactly.
  {
    id: 'add-person',
    category: 'people',
    title: 'Add person',
    summary: 'Create a login and a roster row in one step',
    feeds: ['Every assignee picker', 'Sign-in'],
    keywords: 'add person new user invite login create bridge account',
  },
  {
    id: 'everyone',
    category: 'people',
    title: 'Everyone',
    summary: 'One row per person · roles, email, department and agenda',
    feeds: [
      'Every assignee picker',
      'Draw Schedule',
      'New project',
      'My Tasks',
      'Agenda',
      'Weekly update',
      'Sign-in matching',
    ],
    keywords:
      'people person roster everyone team member role da dm ent acq schematic ' +
      'ca director viewer name email department agenda retire restore goes by ' +
      // ★ the old names, kept findable: somebody looking for the alumni list
      //   types "alumni" or "former", not "Everyone" — fix-520's `terms:` rule,
      //   which is why search keywords exist at all.
      'alumni former inactive names and emails departments agenda members',
    // ★★ ELEVEN, not nine — and the fix-611 map test caught me writing nine. The
    //    nine roster editors PLUS Former DAs (alumni) PLUS Inactive (other
    //    roles), because the retired list is now a list inside this table rather
    //    than a block of its own. A badge a reader trusts instead of counting
    //    has to be right.
    merged: '11 → 1',
  },

  // ══════════════════════════════════════════════════════ Teams & routing ══
  {
    id: 'team-structure',
    category: 'teams',
    title: 'Team Structure',
    // ★★★ fix-617 — "THE one list", not "a list". ⚖️ Bobby, 2026-10-01:
    //     **"Settings decides; the Draw Schedule follows."** The summary says
    //     THE because the Draw Schedule Layout block below no longer offers the
    //     same choice; a reader comparing the two entries should be able to see
    //     which one answers the question.
    summary: 'THE one list of which DAs sit under each design manager',
    feeds: [
      // ★ fix-617 added the first entry: a move here now writes this quarter's
      //   and every later quarter's Draw Schedule groups too, which is the
      //   reach a reader most needs to know about before clicking.
      'Draw Schedule groups (this quarter on)',
      'New project',
      'My Tasks',
      'My Board',
      'Task ownership',
      'DM on a permit',
    ],
    keywords:
      'dm da group manager structure mapping reports to move reassign ' +
      // ★ fix-520's rule: somebody looking for this types what they want to
      //   DO. "who manages" and "move a da" are the two real searches, and
      //   "group label" is what they would have typed when the answer was in
      //   the other editor.
      'who manages move a da group label draw schedule group',
  },
  {
    id: 'da-routing',
    category: 'teams',
    title: 'DA Routing',
    summary: 'Which ENT leads permitting for each DA, per city',
    feeds: ['New project', 'Draw Schedule', 'ENT cascade', 'My Board'],
    keywords: 'ent lead routing permitting city per-da',
  },
  {
    id: 'draw-schedule-layout',
    category: 'teams',
    title: 'Draw Schedule Layout',
    // ★★★ fix-617 — "group labels" IS GONE FROM THE SUMMARY, because the
    //     block no longer offers them for a DA column. Leaving the old wording
    //     would send the one person looking for "where do I change who manages
    //     Erick" to the block that stopped answering it — the exact confusion
    //     P-006 was about, re-created in the search index.
    summary: 'Lane order, labels and OPEN lanes, per quarter',
    feeds: ['Draw Schedule'],
    keywords:
      'quarter lanes board layout restore deleted column order top label ' +
      'open lane ' +
      // ★ "group label" stays SEARCHABLE here on purpose: it is still the word
      //   on the screen, and the block shows the group read-only with a link to
      //   Team Structure. Finding the place that explains where it moved is
      //   better than finding nothing.
      'group label set in team structure',
  },
  {
    id: 'active-quarters',
    category: 'teams',
    title: 'Active Quarters',
    summary: 'Which quarters each DA has a lane on the board — former DAs too',
    feeds: ['Draw Schedule', 'New project DA picker'],
    // ★ fix-617 (gap 38): the block now also edits the FORMER & inactive DAs,
    //   who hold every window prod actually has. Somebody correcting a departed
    //   teammate's dates searches "former", "alumni" or their own name for it.
    keywords:
      // ★ 'alumni' is DELIBERATELY NOT HERE. fix-611's search test pins that
      //   word to the Everyone table — the block that LISTS the alumni and the
      //   only one that can restore them. A second hit for the same word is
      //   not a richer index; it is a reader having to choose between two rows
      //   when one of them is the answer. 'former', 'inactive' and 'departed'
      //   are what somebody fixing a departed teammate's DATES types.
      'start end quarter lane active former inactive departed left ' +
      'offboarded history past quarter',
  },
  {
    id: 'chat-tags',
    category: 'teams',
    title: 'Chat Tags',
    summary: '@groups for project chat',
    feeds: ['Project chat @mentions'],
    keywords: 'mention at group tag chat',
  },

  // ═══════════════════════════════════════════════════════ Project lists ══
  {
    id: 'jurisdictions',
    category: 'lists',
    title: 'Jurisdictions',
    summary: 'The cities a permit can belong to, and their portal links',
    feeds: [
      'New project',
      'Project details',
      'DA routing',
      'Task templates',
      'Target formulas',
      'Ribbon city links',
      'Library',
    ],
    keywords: 'city cities juris jurisdiction link portal gis code',
    merged: '2 → 1',
  },
  {
    id: 'builders-and-owners',
    category: 'lists',
    title: 'Builders & Owners',
    summary: 'The builder catalogue · add, rename, merge duplicates, deactivate',
    feeds: ['Project header builder', 'New project'],
    keywords: 'builder owner llc client contact',
  },
  {
    id: 'product-types',
    category: 'lists',
    title: 'Product Types',
    summary: 'The product a project is · the single source every picker reads',
    feeds: ['New project', 'Project details', 'Unit editor', 'Library'],
    keywords: 'product type townhome sfr duplex unit',
  },
  {
    id: 'zones',
    category: 'lists',
    title: 'Zones',
    summary: 'The zoning codes a project can carry',
    feeds: ['New project', 'Project data', 'Library filter'],
    keywords: 'zone zoning code lr nr sf rsl',
  },
  {
    id: 'unit-options',
    category: 'lists',
    title: 'Unit options',
    summary: 'Parking · Roof deck · Stories',
    feeds: ['New project', 'Unit editor', 'Library'],
    keywords: 'parking garage roof deck stories unit option',
    merged: '3 → 1',
  },
  {
    id: 'project-tags',
    category: 'lists',
    title: 'Project Tags',
    summary: 'Free labels a project can be tagged with',
    feeds: ['New project', 'Project data'],
    keywords: 'tag label project',
  },
  {
    id: 'hold-and-cancel-reasons',
    category: 'lists',
    title: 'Hold & cancel reasons',
    summary: 'Why a project or permit is parked, and why one is cancelled',
    feeds: ['Project hold', 'Permit hold', 'Cancel project'],
    keywords: 'hold cancel reason parked paused stopped',
    merged: '2 → 1',
  },

  // ═══════════════════════════════════════════════════════ Permits & tasks ══
  {
    id: 'permit-types',
    category: 'permits',
    title: 'Permit Types',
    summary: 'The permit types, with descriptions',
    feeds: [
      'New project',
      'Intake tracker',
      'Project details',
      'Trends',
      'Task templates',
      'Schedule',
    ],
    keywords: 'permit type bp uls sepa mup ppr vault wac catalogue',
  },
  {
    id: 'task-templates',
    category: 'permits',
    title: 'Task Templates',
    summary: 'The tasks a new permit starts with · Base plus per-city rows',
    feeds: ['New project (step 4)', 'Add template tasks on a permit'],
    keywords: 'task template subtask default stage bucket',
  },
  {
    id: 'waiting-on-and-consultants',
    category: 'permits',
    title: 'Waiting On & consultants',
    summary: 'Who a task can wait on, and the consultant firms by discipline',
    feeds: [
      'Task pickers',
      'Waiting On report',
      'Consultant band',
      'Vendor forecast',
    ],
    keywords: 'waiting on consultant firm directory vendor discipline external team',
    merged: '2 → 1',
  },

  // ═══════════════════════════════════════════════════════ Dates & targets ══
  {
    id: 'per-type-schedule',
    category: 'dates',
    title: 'Per-type schedule',
    summary: 'Target submit, and intake → approval, per permit type',
    feeds: [
      'Target submit dates',
      'Projected approval',
      'Schedule health',
      'Trends',
    ],
    keywords:
      'target submit formula default intake approval days offset learner ' +
      'per-type schedule benchmark',
    merged: '2 → 1',
  },

  // ════════════════════════════════════════════════════════ Health & tools ══
  {
    id: 'who-is-running-what',
    category: 'health',
    title: 'Who is running what',
    summary: 'The app build each person last ran',
    feeds: [],
    keywords: 'build version stale app client installed browser last seen',
    readOut: true,
  },
  {
    id: 'who-the-work-data-means',
    category: 'health',
    title: 'Who the work data means',
    summary: 'Names in project data that match no login',
    feeds: [],
    keywords: 'unmatched names login work data mapping',
    readOut: true,
  },
  {
    id: 'permits-with-no-lead',
    category: 'health',
    title: 'Permits with no permitting lead',
    summary: 'A worklist with a fixer on each row',
    feeds: [],
    keywords: 'ent lead missing worklist permitting unassigned',
    readOut: true,
  },
  {
    id: 'phase-durations',
    category: 'health',
    title: 'Phase Durations',
    summary: 'How long each phase has actually taken · history only',
    feeds: [],
    keywords: 'phase duration history median city review turnaround',
    readOut: true,
  },
  {
    id: 'export-backup',
    category: 'health',
    title: 'Export backup',
    summary: 'Download the main tables',
    feeds: [],
    keywords: 'db tools backup export download csv json',
    readOut: true,
  },
];

/** The blocks of one category, in registry order. */
export function blocksForCategory(
  category: SettingsSectionId,
): SettingsBlock[] {
  return SETTINGS_BLOCKS.filter((b) => b.category === category);
}

/** One block by id, or null. */
export function blockById(id: string): SettingsBlock | null {
  return SETTINGS_BLOCKS.find((b) => b.id === id) ?? null;
}

// ===========================================================================
// ★★★ §E — THE TWO BLOCKS BOBBY RETIRED, NAMED RATHER THAN DELETED SILENTLY
// ===========================================================================
//
// A block that vanishes with no record is indistinguishable from one that was
// lost, which is exactly what the 43-row map test exists to catch. So the two
// removals are declared, and the map test treats them as legitimate
// destinations.
export interface RetiredSettingsBlock {
  /** The block's title as the old tab showed it. */
  was: string;
  /** Why it is gone, in one line a person can act on. */
  reason: string;
}

export const RETIRED_SETTINGS_BLOCKS: readonly RetiredSettingsBlock[] = [
  {
    was: 'Permit Owner',
    reason:
      'Nothing reads it as a setting: `permits.permit_owner` had three readers ' +
      'and zero writers, so the editor named a vocabulary that nothing could ' +
      'apply. The column and PermitCard’s fallback are untouched.',
  },
  {
    was: 'Learning windows',
    reason:
      'It drove nothing. `getLearnWindow(juris)` discards its argument and ' +
      'returns the flat default, so the per-city number has never reached the ' +
      'estimator — the copy claiming it fed Schedule Benchmarks was wrong. ' +
      'The column stays; no migration.',
  },
];
