import { useState } from 'react';
import { useUpsertTeamTask } from '../../hooks/useTeamTasks';
import BufferedDateInput from '../BufferedDateInput';
import type { TeamMember } from '../../lib/database.types';

// ===========================================================================
// ★★★ fix-460 §B5 (P-046) — CREATING A TASK THAT BELONGS TO NO PERMIT
// ===========================================================================
//
// ★★ A CONTROL, NOT A SCREEN. Bobby, 2026-08-26: *"what I get worried of is we
// have too many tabs and too many things in the ribbon and too many tabs in
// every page, and then it becomes too much. We have to find a way to make it
// simple and cohesive."* So this is a one-line composer that unfolds in place
// on My Tasks — no route, no modal, no ribbon entry, nothing to navigate to.
//
// ★ WHY MY TASKS AND NOT THE PERMIT VIEW. The two places a person creates a
// task today are `PermitDetailV2` (a permit's own task list) and the chat
// composer on a project — both are permit- or project-scoped by nature, so
// neither can host "a task with no permit" without contradicting itself. My
// Tasks is where a person's work already lives and had no create affordance at
// all; this is the smallest place the capability fits honestly.
//
// ★★★ DISCIPLINE IS THE ONLY REQUIRED CHOICE BESIDES THE WORDS, and it is
// required because it is THE BLEND POINT: it decides which of the two existing
// lanes the task lands in. There is no third option in the picker for the same
// reason there is no third lane.

interface Props {
  /** Roster names for the optional owner picker — passed in, not fetched, so
   *  this works in a provider-less suite (the fix-442 trap). */
  memberNames: readonly TeamMember[];
}

export default function TeamTaskComposer({ memberNames }: Props) {
  const upsert = useUpsertTeamTask();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [discipline, setDiscipline] = useState<'arch' | 'ent'>('ent');
  const [assignedTo, setAssignedTo] = useState('');
  const [targetDate, setTargetDate] = useState('');

  function reset() {
    setText('');
    setDiscipline('ent');
    setAssignedTo('');
    setTargetDate('');
    setOpen(false);
  }

  function submit() {
    const t = text.trim();
    if (t === '') return;
    upsert.mutate(
      {
        op: 'insert',
        patch: {
          text: t,
          discipline,
          assigned_to: assignedTo || null,
          target_date: targetDate || null,
        },
      },
      { onSuccess: reset },
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] px-2 py-1 rounded border border-dashed text-dim whitespace-nowrap"
        style={{ borderColor: 'var(--color-border)' }}
        data-testid="team-task-add"
      >
        + Task with no permit
      </button>
    );
  }

  return (
    <div
      className="flex flex-wrap items-end gap-2 rounded border px-2 py-1.5"
      style={{ borderColor: 'var(--color-de)', background: 'var(--color-s2)' }}
      data-testid="team-task-composer"
    >
      <input
        autoFocus
        value={text}
        placeholder="What needs doing?"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') reset();
        }}
        className="text-[11px] border rounded px-1.5 py-0.5 bg-surface min-w-[220px] flex-1"
        style={{ borderColor: 'var(--color-border)' }}
        data-testid="team-task-text"
      />
      {/* ★★ THE BLEND POINT — which existing lane this lands in. */}
      <label className="flex flex-col gap-0.5">
        <span className="text-[8px] font-bold uppercase tracking-wide text-dim">
          Lane
        </span>
        <select
          value={discipline}
          onChange={(e) => setDiscipline(e.target.value as 'arch' | 'ent')}
          className="text-[11px] border rounded px-1 py-0.5 bg-surface"
          style={{ borderColor: 'var(--color-border)' }}
          data-testid="team-task-discipline"
        >
          <option value="ent">Permitting</option>
          <option value="arch">Design &amp; Engineering</option>
        </select>
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-[8px] font-bold uppercase tracking-wide text-dim">
          Owner
        </span>
        {/* ★ Roster-sourced, never free text — `team_members.name` is the frozen
            join key. ★★ Leaving it blank is a REAL choice, not an oversight:
            an unassigned team task has no permit to fall back to, so it lands
            in fix-458's Unclaimed queue by construction. */}
        <select
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value)}
          className="text-[11px] border rounded px-1 py-0.5 bg-surface"
          style={{ borderColor: 'var(--color-border)' }}
          data-testid="team-task-owner"
        >
          <option value="">Unassigned</option>
          {memberNames.map((m) => (
            <option key={m.id} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-[8px] font-bold uppercase tracking-wide text-dim">
          Target
        </span>
        {/* ★ BufferedDateInput, not a raw type=date — a raw one commits
            `0002-01-01` while you type the year (the rule that shipped three
            times before it stuck). */}
        <BufferedDateInput
          value={targetDate}
          onCommit={(v) => setTargetDate(v ?? '')}
          className="text-[11px] border rounded px-1 py-0.5 bg-surface"
          testId="team-task-target"
        />
      </label>
      <button
        type="button"
        disabled={upsert.isPending || text.trim() === ''}
        onClick={submit}
        className="text-[11px] px-2 py-1 rounded border font-bold disabled:opacity-50"
        style={{ borderColor: 'var(--color-de)', color: 'var(--color-de)' }}
        data-testid="team-task-save"
      >
        Add
      </button>
      <button
        type="button"
        onClick={reset}
        className="text-[11px] px-2 py-1 rounded border"
        style={{ borderColor: 'var(--color-border)' }}
        data-testid="team-task-cancel"
      >
        Cancel
      </button>
    </div>
  );
}
