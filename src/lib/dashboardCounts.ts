// fix-178: Dashboard bucket counts. A bucket's permit count alone hides how many
// distinct sites are in play (one project can contribute several permits), so
// each bucket header also shows the distinct-project total — "N projects · M
// permits".

/** Count of distinct project_id among a bucket's permits. */
export function distinctProjectCount(
  permits: ReadonlyArray<{ project_id: string }>,
): number {
  const s = new Set<string>();
  for (const p of permits) s.add(p.project_id);
  return s.size;
}
