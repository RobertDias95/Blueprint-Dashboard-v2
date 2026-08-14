// fix-303: shared input styling for the task detail editor.
//
// Lives here rather than in TaskDetailEditor.tsx because a component module may
// export ONLY components — react-refresh/only-export-components, the same rule
// fix-264 ran into. MyTasks still uses it for its own field rows, so it has two
// consumers and belongs in lib either way.
export function inputStyle() {
  return {
    borderColor: 'var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
  };
}
