import { useMemo } from 'react';
import { useDmDaGroups } from '../../hooks/useDmDaGroups';
import { useUpsertDmDaGroup } from '../../hooks/useUpsertDmDaGroup';
import { useDeleteDmDaGroup } from '../../hooks/useDeleteDmDaGroup';
import type { TeamMember, DmDaGroupRow } from '../../lib/database.types';

// Q7.3.b: DM/DA grouping editor. Each DM gets a card showing the DAs
// currently assigned, with a "move to..." dropdown per DA + remove button.
// Also a free DA picker at the bottom of each card. Mirrors v1's
// renderTeamStructureAdmin (index.html 6752-6827).
//
// Unassigned DAs (warning row) and former-DA cleanup live in AdminTeamTab,
// not here — this component is just the (DM × DAs) matrix.

interface Props {
  dms: TeamMember[];
  activeDas: TeamMember[];
  readOnly?: boolean;
}

export default function TeamStructureEditor({
  dms,
  activeDas,
  readOnly = false,
}: Props) {
  const groupsQ = useDmDaGroups();
  const upsert = useUpsertDmDaGroup();
  const remove = useDeleteDmDaGroup();

  // index: dm_name → DA assignments (rows from dm_da_groups)
  const rowsByDm = useMemo(() => {
    const m = new Map<string, DmDaGroupRow[]>();
    for (const row of groupsQ.rows) {
      const list = m.get(row.dm_name) ?? [];
      list.push(row);
      m.set(row.dm_name, list);
    }
    return m;
  }, [groupsQ.rows]);

  // index: da_name → DmDaGroupRow (so a single DA only appears in ONE DM's
  // card; if data has dupes, the first row wins and the rest are ignored).
  const rowByDa = useMemo(() => {
    const m = new Map<string, DmDaGroupRow>();
    for (const row of groupsQ.rows) {
      if (!m.has(row.da_name)) m.set(row.da_name, row);
    }
    return m;
  }, [groupsQ.rows]);

  const assignedDaNames = useMemo(
    () => new Set(rowByDa.keys()),
    [rowByDa],
  );

  const unassigned = useMemo(
    () => activeDas.filter((da) => !assignedDaNames.has(da.name)),
    [activeDas, assignedDaNames],
  );

  function moveDa(da: string, toDm: string) {
    const existing = rowByDa.get(da);
    if (!existing) return;
    if (existing.dm_name === toDm) return;
    upsert.mutate({
      op: 'update',
      row: existing,
      patch: { dm_name: toDm },
    });
  }
  function removeDa(da: string) {
    const existing = rowByDa.get(da);
    if (!existing) return;
    remove.mutate({ id: existing.id, updated_at: existing.updated_at });
  }
  function addDa(toDm: string, da: string) {
    if (!da) return;
    if (assignedDaNames.has(da)) {
      // Move existing assignment instead of adding a dupe.
      moveDa(da, toDm);
      return;
    }
    upsert.mutate({ op: 'insert', dm_name: toDm, da_name: da });
  }

  return (
    <div className="space-y-3" data-testid="team-structure-editor">
      <div className="text-[10px] uppercase tracking-wide text-muted font-display font-bold">
        Team Structure — Draw Schedule Groups
      </div>
      <p className="text-xs text-muted">
        Assign DAs to DMs. Drives draw-schedule column grouping + automatic
        project assignment for new permits.
      </p>

      {dms.map((dm) => {
        const dmRows = rowsByDm.get(dm.name) ?? [];
        const addableDas = activeDas.filter(
          (da) => !dmRows.some((r) => r.da_name === da.name),
        );
        return (
          <div
            key={dm.id}
            className="bg-surface-2 border border-border rounded-lg p-3"
            data-testid={`team-dm-card-${dm.name}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="font-display font-bold text-xs text-text">
                {dm.name}
              </span>
              <span className="text-[10px] text-dim">
                {dmRows.length} DA{dmRows.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {dmRows.length === 0 && (
                <span className="text-[11px] text-dim italic">
                  No DAs assigned
                </span>
              )}
              {dmRows.map((row) => (
                <span
                  key={row.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-co-bg border border-co-border text-[11px]"
                  data-testid={`team-da-chip-${row.da_name}`}
                >
                  <span className="text-co font-semibold">{row.da_name}</span>
                  {!readOnly && dms.length > 1 && (
                    <select
                      value={dm.name}
                      onChange={(e) => moveDa(row.da_name, e.target.value)}
                      className="text-[10px] bg-transparent border-none text-dim outline-none cursor-pointer"
                      title="Move to different DM"
                      data-testid={`team-da-move-${row.da_name}`}
                    >
                      {dms.map((d) => (
                        <option key={d.name} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {!readOnly && (
                    <button
                      onClick={() => removeDa(row.da_name)}
                      className="text-dim hover:text-text text-sm leading-none pl-0.5"
                      title="Remove DA from group"
                      data-testid={`team-chip-remove-${row.da_name}`}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
            {!readOnly && addableDas.length > 0 && (
              <div className="flex gap-1.5">
                <select
                  className="text-xs px-2 py-1 border border-border rounded bg-bg text-text flex-1"
                  data-testid={`team-add-da-select-${dm.name}`}
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) {
                      addDa(dm.name, v);
                      e.currentTarget.value = '';
                    }
                  }}
                >
                  <option value="">Add DA to {dm.name}…</option>
                  {addableDas.map((da) => (
                    <option key={da.id} value={da.name}>
                      {da.name}
                      {assignedDaNames.has(da.name) ? ' (move)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        );
      })}

      {unassigned.length > 0 && (
        <div
          className="px-3 py-2 text-[11px] text-co bg-co-bg/40 border border-co-border rounded-md"
          data-testid="team-unassigned-warning"
        >
          ⚠ Unassigned DAs (not on draw schedule):{' '}
          {unassigned.map((d) => d.name).join(', ')}
        </div>
      )}
    </div>
  );
}
