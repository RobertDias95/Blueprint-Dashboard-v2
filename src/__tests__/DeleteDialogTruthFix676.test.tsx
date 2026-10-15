import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Project } from '../lib/database.types';
import { PROJECT_DATA_TABS } from '../lib/projectDataTabs';
import { ARCHIVE_LABEL } from '../lib/activeProject';

// ===========================================================================
// ★★★ fix-676 (P-354 delete-dialog) — the Delete dialogs say what delete does
// ===========================================================================
//
// Since fix-557 `bp_delete_project_row` only sets `projects.archived = true`
// ("A FLAG, NOT A REMOVAL"), and an admin restores it by unticking Deleted. The
// dialogs still promised a removal and "This cannot be undone." The sentences
// are written out literally here, NOT read from the helper, so this suite fails
// against the old text rather than agreeing with whatever the helper says.

const deleteSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../hooks/useDeleteProject', () => ({
  useDeleteProject: () => ({ mutateAsync: deleteSpy, isPending: false }),
}));

import DeleteProjectDialog from '../components/ProjectDetail/DeleteProjectDialog';
import DeleteRedesignDialog from '../components/ProjectDetail/DeleteRedesignDialog';

const PROJECT_SENTENCE =
  'Deleting hides this project and everything on it from every list. ' +
  'An admin can bring it all back from Project Details → Actions by unticking Deleted.';
const REDESIGN_SENTENCE =
  'Deleting hides this redesign and everything on it from every list. ' +
  'An admin can bring it all back from Project Details → Actions by unticking Deleted.';

const PROJECT = {
  id: 'p1',
  address: '5053 25th Ave SW',
  updated_at: '2026-10-14T12:00:00Z',
} as unknown as Project;

const REDESIGN = {
  id: 'r1',
  address: '5053 25th Ave SW [Redesign 1]',
  updated_at: '2026-10-14T12:00:00Z',
  redesign_of_project_id: 'p1',
} as unknown as Project;

beforeEach(() => deleteSpy.mockClear());

describe('fix-676 · Delete Project', () => {
  function open() {
    render(
      <MemoryRouter>
        <DeleteProjectDialog project={PROJECT} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    return screen.getByTestId('delete-project-dialog').textContent ?? '';
  }

  it('★★★ says it hides, and how to bring it back', () => {
    const text = open();
    expect(text).toContain(PROJECT_SENTENCE);
    expect(text).not.toMatch(/cannot be undone/i);
    expect(text).not.toMatch(/removes all/i);
  });

  it('★★ the type-the-address confirm is still required', () => {
    open();
    const btn = screen.getByTestId('dpd-delete-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(deleteSpy).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('dpd-confirm-input'), {
      target: { value: PROJECT.address },
    });
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toMatch(/delete/i);
  });
});

describe('fix-676 · Delete Redesign', () => {
  it('★★★ says it hides, keeps the parent reassurance, no "cannot be undone"', () => {
    render(<DeleteRedesignDialog redesign={REDESIGN} label="Redesign 1" onClose={vi.fn()} />);
    const text = screen.getByTestId('delete-redesign-dialog').textContent ?? '';
    expect(text).toContain(REDESIGN_SENTENCE);
    expect(text).toMatch(/not.*affected/i);
    expect(text).not.toMatch(/cannot be undone/i);
  });
});

describe('fix-676 · the path in the sentence is the real UI', () => {
  it('★★ "Actions" is a Project Details tab and "Deleted" is its box', () => {
    expect(PROJECT_DATA_TABS.some((t) => t.label === 'Actions')).toBe(true);
    expect(ARCHIVE_LABEL.startsWith('Deleted')).toBe(true);
  });
});
