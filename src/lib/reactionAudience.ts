// ===========================================================================
// ★★★ fix-347 §1 — WHO WAS EXPECTED TO ACKNOWLEDGE THIS?
// ===========================================================================
//
// The count is arithmetic; THIS is the judgement, so it lives in lib where it
// can be asserted on its own rather than through a rendered row.
//
// ★ THE EXPECTED SET, chosen and stated rather than invented silently (the
// brief's rule):
//
//     a post that TAGGED people  →  exactly the people it notified
//                                   (project_messages.mentions — the resolved
//                                   ids fix-347 §4 stores, so a post that said
//                                   "@project" is diffed against the team it
//                                   ACTUALLY reached, not today's team)
//     an UNTAGGED post           →  this project's team (@project, resolved
//                                   now) — a reasonable default, and the UI
//                                   SAYS WHICH SET IT USED, because a silent
//                                   default is a guess presented as a fact
//     neither available          →  null. Nothing true can be said, so nothing
//                                   is said: a 0-of-0 is a worse answer than an
//                                   absent one.

export interface ReactionAudience {
  /** Everyone expected to acknowledge — user ids. */
  userIds: string[];
  /** Where that set came from, said out loud in the UI. */
  label: string;
}

export function reactionAudience(input: {
  mentions: readonly string[] | null | undefined;
  projectTeamIds: readonly string[];
}): ReactionAudience | null {
  const tagged = [...new Set((input.mentions ?? []).filter(Boolean))];
  if (tagged.length > 0) {
    return { userIds: tagged, label: 'tagged on this post' };
  }
  const team = [...new Set(input.projectTeamIds.filter(Boolean))];
  if (team.length > 0) {
    return { userIds: team, label: "this project's team" };
  }
  return null;
}
