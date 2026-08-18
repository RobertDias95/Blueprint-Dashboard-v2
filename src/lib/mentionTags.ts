import { isCurrentMember } from './roster';
import { projectInternalTeam, projectTagNames } from './projectTeam';
import type {
  MentionablePerson,
  PermitWithCycles,
  Project,
  TeamMember,
} from './database.types';

// ===========================================================================
// ★★★ fix-347 §2–§4 — two kinds of tag, one rule
// ===========================================================================
//
// ★★ THE RULE THAT MAKES THEM AUDITABLE (§4): a tag DISPLAYS as its name and
// STORES the people it resolved to. `project_messages.mentions` holds resolved
// user ids — the same column fix-330 fills for `@person` — because the bell, My
// Board and fix-336's live stream all key off ids, and a tag that stored its own
// name would notify nobody.
//
// ★★★ AND SIX MONTHS LATER "who was notified?" IS STILL ANSWERABLE. The DA will
// change; a custom tag will be edited or deleted. The message records who it
// ACTUALLY REACHED, at the moment it was sent, and nothing in this file ever
// re-resolves an old message. That is asserted.
//
// ---------------------------------------------------------------------------
// The two kinds
// ---------------------------------------------------------------------------
//
//   CUSTOM  a name + a stored membership list (mention_tags). Admin-owned:
//           "we could have one group tag, we could have 30 group tags, and it
//           could be a different combination of anyone in the tool."
//
//   SMART   a name + a QUERY. `@project` resolves through projectTeam.ts —
//           the same computation the Team card renders — so it cannot go stale
//           when a DA changes. That is the whole reason it beats a hand-built
//           group.

/** The smart tag's token. One today; see the note on SMART_TAGS. */
export const PROJECT_TAG = 'project';

/**
 * ★ ONE smart tag, and it stays one. fix-347 proposed `@design` (SD · DM · DA)
 * and ★★ fix-344 CLOSED IT: *"don't create the design tag, we can create it if
 * needed. I'll think of custom tags if needed."* A custom tag (§2 of fix-347)
 * covers the case the day somebody wants it, which is the whole reason custom
 * tags exist. This is a decision, not an omission — do not re-propose it.
 */
export const SMART_TAGS = [PROJECT_TAG] as const;

/** A custom tag as the database stores it. */
export interface MentionTag {
  id: string;
  name: string;
  member_ids: string[];
  updated_at?: string;
}

/** ★ What the parser scans for: a token you type after `@`, and everyone it
 *  notifies. A person is the one-id case, which is why the same scanner can
 *  handle both without a second walk of the string. */
export interface MentionTarget {
  /** The text typed after `@` — a person's roster name, or a tag's name. */
  name: string;
  /** Everyone this target notifies. Empty is legal and is WARNED about. */
  userIds: string[];
  kind: 'person' | 'tag' | 'smart';
  /** A short line for the picker: a role, or "6 people". */
  hint?: string;
}

/** A person, as a target. */
export function personTarget(p: MentionablePerson): MentionTarget {
  return {
    name: (p.name ?? '').trim(),
    userIds: p.user_id ? [p.user_id] : [],
    kind: 'person',
  };
}

/**
 * ★★ `@project` for THIS project, resolved now.
 *
 * The names come from the Team card's own computation (projectTeam.ts); this
 * turns them into login ids, which is the only form a notification can use.
 *
 * ★ FORMER STAFF ARE NEVER RESOLVED IN — fix-321's rule. A permit that still
 * records Nidhi as its DA keeps showing Nidhi (that is fix-308's honesty), but
 * a tag is a thing you SEND to, and sending to somebody who has left is the
 * same category of mistake as offering them in a picker.
 *
 * ★ A role nobody fills simply contributes nobody. The tag resolving to FEWER
 * people is correct; resolving to nobody is reported to the sender before they
 * post (see emptyTargetsIn), because "@project notified no one" discovered
 * afterwards is worse than being told the team is empty.
 */
export function projectTagTarget(input: {
  project: Pick<
    Project,
    'acq_lead' | 'entitlement_lead' | 'design_manager' | 'schematic_designer'
  > | null;
  bp?: Pick<PermitWithCycles, 'ent_lead' | 'dm' | 'da'> | null;
  people: readonly MentionablePerson[];
  members: readonly TeamMember[];
}): MentionTarget {
  // ★★ fix-344 §3: ACQ · ENT · DM · DA — the schematic designer is on the Team
  // card but not on this list. See projectTagNames for why the filter lives
  // there rather than in projectInternalTeam.
  const names = input.project
    ? projectTagNames(projectInternalTeam(input.project, input.bp))
    : [];
  const userIds = resolveRosterNames(names, input.people, input.members);
  return {
    name: PROJECT_TAG,
    userIds,
    kind: 'smart',
    hint:
      userIds.length === 0
        ? 'nobody on this project yet'
        : `${userIds.length} on this project`,
  };
}

/**
 * ★ Roster NAMES → login ids. The bridge is the mentionable-people list, whose
 * `name` is `team_members.name` — the same join key permits and projects store
 * (fix-343 verified all 29 logins resolve through it, and that profiles.name is
 * NULL for every one of them, so this is the ONLY bridge that works).
 *
 * ★ A name with no login resolves to nobody rather than to a guess. Half the
 * roster (Jason, Dom, Scott…) has no account; tagging a project they are on
 * must not invent a recipient for them.
 */
export function resolveRosterNames(
  names: readonly string[],
  people: readonly MentionablePerson[],
  members: readonly TeamMember[],
): string[] {
  const departed = new Set(
    members
      .filter((m) => !isCurrentMember(m))
      .map((m) => (m.name ?? '').trim().toLowerCase()),
  );
  const current = new Set(
    members
      .filter(isCurrentMember)
      .map((m) => (m.name ?? '').trim().toLowerCase()),
  );
  const byName = new Map<string, string>();
  for (const p of people) {
    const key = (p.name ?? '').trim().toLowerCase();
    if (key && p.user_id && !byName.has(key)) byName.set(key, p.user_id);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const key = raw.trim().toLowerCase();
    if (!key) continue;
    // ★ Departed unless a live roster row says otherwise — one live role is
    // enough (roster.formerMemberNames' rule), and a name the roster has never
    // heard of is unknown, not departed.
    if (departed.has(key) && !current.has(key)) continue;
    const id = byName.get(key);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** A custom tag as a target. */
export function customTagTarget(tag: MentionTag): MentionTarget {
  return {
    name: tag.name,
    userIds: [...new Set(tag.member_ids ?? [])],
    kind: 'tag',
    hint: `${(tag.member_ids ?? []).length} ${
      (tag.member_ids ?? []).length === 1 ? 'person' : 'people'
    }`,
  };
}

/**
 * ★ Everything `@` can offer, in ONE list: people, then the smart tag, then the
 * custom tags.
 *
 * ★★ TAGS FIRST WHEN THEY TIE. The scanner matches longest-first, so a custom
 * tag called "Miles" would never shadow the person — but the PICKER's order is
 * a choice, and a tag is the rarer, more deliberate thing to reach for, so it
 * is offered above the person it collides with. Bobby's ask was that they be
 * "visibly distinguished", which the kind + hint do.
 */
export function mentionTargets(input: {
  people: readonly MentionablePerson[];
  tags?: readonly MentionTag[];
  projectTag?: MentionTarget | null;
}): (MentionablePerson | MentionTarget)[] {
  const out: (MentionablePerson | MentionTarget)[] = [];
  if (input.projectTag) out.push(input.projectTag);
  for (const t of input.tags ?? []) out.push(customTagTarget(t));
  // ★ THE PEOPLE STAY PEOPLE. Converting them to targets here would have cost
  // the picker their email and their user id — the two things it uses to tell
  // two "Matt"s apart and to key a row — and would have made every option look
  // like a tag. The scanner normalises them itself (projectChat.asTarget), so
  // nothing downstream needs them flattened.
  for (const p of input.people) {
    if ((p.name ?? '').trim() === '') continue;
    out.push(p);
  }
  return out;
}

/** ★ Is this target one nobody would receive? The composer warns before send —
 *  the same courtesy fix-330 extends to an unresolved `@word`, for the same
 *  reason: a mention that silently notifies nobody is the paperclip that does
 *  nothing. */
export function isEmptyTarget(t: MentionTarget): boolean {
  return t.userIds.length === 0;
}
