import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Project } from '../lib/database.types';

// fix-193 Part B: delete + edit a redesign from the parent's Redesigns section.
// DeleteRedesignDialog reuses useDeleteProject (bp_delete_project_row cascade);
// EditRedesignModal patches the redesign's metadata/scope via useUpdateProject
// and delegates the DD phase to the embedded ReuseRedesignDdEditor.

const deleteSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const updateSpy = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock('../hooks/useDeleteProject', () => ({
  useDeleteProject: () => ({ mutateAsync: deleteSpy, isPending: false }),
}));
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: updateSpy, isPending: false }),
}));
// Stub the embedded DD-phase editor so this test doesn't need the
// draw-schedule / team hooks — it has its own coverage (fix-145).
vi.mock('../components/ProjectDetail/ReuseRedesignDdEditor', () => ({
  default: () => <div data-testid="stub-redesign-dd-editor" />,
}));

import DeleteRedesignDialog from '../components/ProjectDetail/DeleteRedesignDialog';
import EditRedesignModal from '../components/ProjectDetail/EditRedesignModal';

const REDESIGN = {
  id: 'd6599dd4',
  address: '5053 25th Ave SW [Redesign 1]',
  updated_at: '2026-05-14T12:00:00Z',
  redesign_of_project_id: 'parent-uuid',
  redesign_trigger: 'acquisitions',
  redesign_reuses_original_permit: true,
  units: 3,
  num_lots: 2,
  redesign_notes: 'original note',
} as unknown as Project;

beforeEach(() => {
  deleteSpy.mockClear();
  updateSpy.mockClear();
});

describe('DeleteRedesignDialog (fix-193)', () => {
  it('confirms then deletes the redesign by its OWN id (parent untouched)', async () => {
    const onClose = vi.fn();
    render(
      <DeleteRedesignDialog redesign={REDESIGN} label="Redesign 1" onClose={onClose} />,
    );
    // Reassures the user the parent is safe.
    expect(screen.getByTestId('delete-redesign-dialog').textContent).toMatch(
      /not.*affected/i,
    );
    fireEvent.click(screen.getByTestId('delete-redesign-confirm-btn'));
    await waitFor(() =>
      expect(deleteSpy).toHaveBeenCalledWith({
        projectId: 'd6599dd4',
        expectedUpdatedAt: '2026-05-14T12:00:00Z',
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('Cancel closes without deleting', () => {
    const onClose = vi.fn();
    render(
      <DeleteRedesignDialog redesign={REDESIGN} label="Redesign 1" onClose={onClose} />,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

describe('EditRedesignModal (fix-193)', () => {
  it('pre-fills from the redesign and persists edited fields via useUpdateProject', async () => {
    const onClose = vi.fn();
    render(
      <EditRedesignModal redesign={REDESIGN} label="Redesign 1" onClose={onClose} />,
    );
    // Pre-filled from the existing redesign.
    expect((screen.getByTestId('edit-redesign-trigger') as HTMLSelectElement).value).toBe('acquisitions');
    expect((screen.getByTestId('edit-redesign-reuses') as HTMLSelectElement).value).toBe('yes');
    expect((screen.getByTestId('edit-redesign-units') as HTMLInputElement).value).toBe('3');
    expect((screen.getByTestId('edit-redesign-lots') as HTMLInputElement).value).toBe('2');

    // Revise scope + trigger.
    fireEvent.change(screen.getByTestId('edit-redesign-trigger'), { target: { value: 'market' } });
    fireEvent.change(screen.getByTestId('edit-redesign-units'), { target: { value: '5' } });
    fireEvent.change(screen.getByTestId('edit-redesign-lots'), { target: { value: '4' } });
    fireEvent.change(screen.getByTestId('edit-redesign-reuses'), { target: { value: 'no' } });
    fireEvent.change(screen.getByTestId('edit-redesign-notes'), { target: { value: 'revised' } });
    fireEvent.click(screen.getByTestId('edit-redesign-save-meta'));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'd6599dd4',
          expectedUpdatedAt: '2026-05-14T12:00:00Z',
          patch: {
            redesign_trigger: 'market',
            redesign_reuses_original_permit: false,
            units: 5,
            num_lots: 4,
            redesign_notes: 'revised',
          },
        }),
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('renders the embedded DD-phase editor (separate save path)', () => {
    render(
      <EditRedesignModal redesign={REDESIGN} label="Redesign 1" onClose={vi.fn()} />,
    );
    expect(screen.getByTestId('stub-redesign-dd-editor')).toBeTruthy();
  });
});
