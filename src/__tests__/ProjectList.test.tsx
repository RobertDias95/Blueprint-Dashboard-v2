import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Q2: ProjectList search/filter behavior. Mock the data hooks so the test
// renders synchronously with a fixed dataset; verify search + juris
// filter narrow the visible rows.

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: [
      {
        id: 'a',
        address: '123 Main St',
        juris: 'Seattle',
        archived: false,
        notes: null,
      },
      {
        id: 'b',
        address: '456 Oak Ave',
        juris: 'Bellevue',
        archived: false,
        notes: null,
      },
      {
        id: 'c',
        address: '789 Pine Way',
        juris: 'Seattle',
        archived: false,
        notes: null,
      },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import ProjectList from '../pages/ProjectList';

describe('<ProjectList />', () => {
  function renderIt() {
    // Wrap with QueryClientProvider — Q5 added NewProjectWizard to the page,
    // and its mutation hook calls useQueryClient().
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ProjectList />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('renders all three projects with no filters applied', () => {
    renderIt();
    const items = screen.getAllByTestId('project-list-item');
    expect(items.length).toBe(3);
    expect(screen.getByText('123 Main St')).toBeInTheDocument();
    expect(screen.getByText('456 Oak Ave')).toBeInTheDocument();
    expect(screen.getByText('789 Pine Way')).toBeInTheDocument();
  });

  it('narrows the list by search token', () => {
    renderIt();
    const input = screen.getByPlaceholderText(/Search projects/i);
    fireEvent.change(input, { target: { value: 'pine' } });
    const items = screen.getAllByTestId('project-list-item');
    expect(items.length).toBe(1);
    expect(screen.getByText('789 Pine Way')).toBeInTheDocument();
  });

  it('narrows the list by jurisdiction filter', () => {
    renderIt();
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'Seattle' } });
    const items = screen.getAllByTestId('project-list-item');
    expect(items.length).toBe(2);
    expect(screen.queryByText('456 Oak Ave')).not.toBeInTheDocument();
  });
});
