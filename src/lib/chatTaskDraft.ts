import { disciplineForTeam } from './taskTeam';

// fix-334 §5 — the task draft two composers share.
//
// It lives in lib rather than beside <ChatTaskFields> because a component module
// may export ONLY components (react-refresh/only-export-components) — the same
// rule that moved `inputStyle` out of TaskDetailEditor in fix-303 and the
// project-view predicates out of a page module in fix-264.
//
// ★ There are two places a task gets composed by fix-334: the post-hoc composer
// on an already-posted message (fix-330) and the send composer that creates a
// message and its task together (§5). One draft shape and one discipline rule
// between them is what stops the pair drifting.

export interface ChatTaskDraft {
  permitId: number | null;
  text: string;
  assignedTo: string;
  targetDate: string | null;
}

export function emptyTaskDraft(
  permitId: number | null,
  text = '',
): ChatTaskDraft {
  return { permitId, text, assignedTo: '', targetDate: null };
}

/** ★ fix-244: the Design-view column follows the TEAM. A named person carries no
 *  team signal, so it falls back to 'ent' — the same default the SQL twin
 *  `bp_discipline_for_team` uses for NULL. */
export function disciplineForDraft(draft: ChatTaskDraft): 'arch' | 'ent' {
  return disciplineForTeam(draft.assignedTo) ?? 'ent';
}

/** A task needs a permit to hang off and something to say. */
export function taskDraftIsReady(draft: ChatTaskDraft): boolean {
  return draft.permitId != null && draft.text.trim().length > 0;
}
