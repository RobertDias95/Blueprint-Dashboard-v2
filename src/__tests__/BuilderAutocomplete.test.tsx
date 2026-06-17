import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { Builder } from '../lib/database.types';

// fix-23f: tests for the Builder/Owner autocomplete. Component itself is
// a thin wrapper around useBuilderSearch — these tests verify the UX
// contract (open/close, keyboard nav, sibling fill on select). The hook
// query path is exercised via the same supabase mock pattern used by
// useJurisPermitStats.test.tsx etc.

const T = 'test-tenant-uuid';

// Drive useBuilderSearch responses by mutating this mock. Empty default
// keeps the dropdown closed until a test sets results.
const searchResults = vi.hoisted(() => ({
  current: [] as Builder[],
}));

// Mock useBuilderSearch directly — fast, deterministic, no debounce timer
// to wrangle. The hook contract is what the component depends on.
vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: (query: string) => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return { data: [], isLoading: false };
    }
    // Filter the mock dataset by substring on any field to simulate the
    // OR ILIKE the real hook would do server-side.
    const needle = trimmed.toLowerCase();
    const data = searchResults.current.filter((b) => {
      return (
        (b.name ?? '').toLowerCase().includes(needle) ||
        (b.company ?? '').toLowerCase().includes(needle) ||
        (b.email ?? '').toLowerCase().includes(needle) ||
        (b.phone ?? '').toLowerCase().includes(needle)
      );
    });
    return { data, isLoading: false };
  },
}));

import BuilderAutocompleteField from '../components/builder/BuilderAutocompleteField';

function builder(over: Partial<Builder>): Builder {
  return {
    id: 'b-' + Math.random().toString(36).slice(2, 8),
    name: 'X',
    company: null,
    email: null,
    phone: null,
    address: null,
    notes: null,
    active: true,
    ...over,
  };
}

/** Controlled host that mirrors how Step1ProjectInfo / ProjectSettingsModal
 *  consume the component: tracks all 4 sibling values + an onSelectBuilder
 *  that fills every sibling at once. */
function Host({
  initial,
}: {
  initial?: Partial<{ name: string; company: string; email: string; phone: string }>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [company, setCompany] = useState(initial?.company ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');

  function fill(b: Builder) {
    setName(b.name ?? '');
    setCompany(b.company ?? '');
    setEmail(b.email ?? '');
    setPhone(b.phone ?? '');
  }

  return (
    <div>
      <BuilderAutocompleteField
        field="name"
        label="Builder Name"
        value={name}
        onChange={setName}
        onSelectBuilder={fill}
        testid="ac-name"
      />
      <BuilderAutocompleteField
        field="company"
        label="Company"
        value={company}
        onChange={setCompany}
        onSelectBuilder={fill}
        testid="ac-company"
      />
      <BuilderAutocompleteField
        field="email"
        label="Email"
        value={email}
        onChange={setEmail}
        onSelectBuilder={fill}
        testid="ac-email"
      />
      <BuilderAutocompleteField
        field="phone"
        label="Phone"
        value={phone}
        onChange={setPhone}
        onSelectBuilder={fill}
        testid="ac-phone"
      />
      {/* Sentinel readback so tests can assert each sibling's current value. */}
      <span data-testid="state-name">{name}</span>
      <span data-testid="state-company">{company}</span>
      <span data-testid="state-email">{email}</span>
      <span data-testid="state-phone">{phone}</span>
    </div>
  );
}

function renderHost(
  initial?: Partial<{ name: string; company: string; email: string; phone: string }>,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<Host initial={initial} />, { wrapper });
}

beforeEach(() => {
  searchResults.current = [];
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('<BuilderAutocompleteField />', () => {
  it('returns no suggestions for empty query', () => {
    searchResults.current = [
      builder({ name: 'Boyd Livek', company: 'Crafted Design Build' }),
    ];
    renderHost();
    // Field is empty, no menu rendered.
    expect(screen.queryByTestId('ac-name-menu')).toBeNull();
  });

  it('matches builders by name substring across name/company/email/phone', () => {
    searchResults.current = [
      builder({ id: 'b1', name: 'Boyd Livek', company: 'Crafted Design Build' }),
      builder({ id: 'b2', name: 'Marc Smith', company: 'Boyd Realty Group' }),
      builder({ id: 'b3', name: 'Jenny Ng', company: 'Northern Homes', email: 'jenny@boyd-co.com' }),
      builder({ id: 'b4', name: 'Aaron Cole', company: 'Cole Building', email: 'unrelated@x.com' }),
    ];
    renderHost();
    fireEvent.change(screen.getByTestId('ac-name'), {
      target: { value: 'Boyd' },
    });
    // Dropdown opens; three of four builders match Boyd somewhere.
    expect(screen.getByTestId('ac-name-menu')).toBeInTheDocument();
    expect(screen.getByTestId('ac-name-option-b1')).toBeInTheDocument(); // name match
    expect(screen.getByTestId('ac-name-option-b2')).toBeInTheDocument(); // company match
    expect(screen.getByTestId('ac-name-option-b3')).toBeInTheDocument(); // email match
    expect(screen.queryByTestId('ac-name-option-b4')).toBeNull();
  });

  it('selecting a suggestion fills all 4 builder fields on the parent form', () => {
    const pick = builder({
      id: 'b-pick',
      name: 'Boyd Livek',
      company: 'Crafted Design Build',
      email: 'boyd@crafted.test',
      phone: '(206) 555-0199',
    });
    searchResults.current = [pick];
    renderHost();
    fireEvent.change(screen.getByTestId('ac-name'), {
      target: { value: 'Boyd' },
    });
    fireEvent.click(screen.getByTestId('ac-name-option-b-pick'));

    // All four siblings now reflect the picked builder.
    expect(screen.getByTestId('state-name').textContent).toBe('Boyd Livek');
    expect(screen.getByTestId('state-company').textContent).toBe('Crafted Design Build');
    expect(screen.getByTestId('state-email').textContent).toBe('boyd@crafted.test');
    expect(screen.getByTestId('state-phone').textContent).toBe('(206) 555-0199');
    // Menu closes after selection.
    expect(screen.queryByTestId('ac-name-menu')).toBeNull();
  });

  it('typing without selecting preserves the typed value', () => {
    searchResults.current = []; // no matches at all
    renderHost();
    fireEvent.change(screen.getByTestId('ac-name'), {
      target: { value: 'Brand New Builder' },
    });
    // Name reflects what the user typed; sibling fields stay empty —
    // entering a new builder is a valid path (we do NOT auto-insert
    // into the builders table on save in this fix).
    expect(screen.getByTestId('state-name').textContent).toBe('Brand New Builder');
    expect(screen.getByTestId('state-company').textContent).toBe('');
    expect(screen.getByTestId('state-email').textContent).toBe('');
    expect(screen.getByTestId('state-phone').textContent).toBe('');
    // No matches → no menu.
    expect(screen.queryByTestId('ac-name-menu')).toBeNull();
  });

  it('fix-24c "boyd" smoke: typing the lowercase fragment surfaces Boyd Lybeck across name/company match paths', async () => {
    // Pins Bobby's regression: prior bundle returned nothing when he
    // typed "boyd". Two of three suggestions should appear here — the
    // name-match on Boyd Lybeck and the company-match on Boyd Realty.
    // The plain "Aaron" row is filtered out.
    searchResults.current = [
      builder({
        id: 'boyd-lybeck',
        name: 'Boyd Lybeck',
        company: "Jake'sD Corporation",
        email: 'jakesbd@comcast.net',
        phone: '(206) 387-6534',
      }),
      builder({
        id: 'b-realty',
        name: 'Maria Hayes',
        company: 'Boyd Realty Group',
      }),
      builder({
        id: 'b-aaron',
        name: 'Aaron Cole',
        company: 'Cole Building',
      }),
    ];
    renderHost();
    fireEvent.change(screen.getByTestId('ac-name'), {
      target: { value: 'boyd' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('ac-name-option-boyd-lybeck')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ac-name-option-b-realty')).toBeInTheDocument();
    expect(screen.queryByTestId('ac-name-option-b-aaron')).toBeNull();
  });

  it('dropdown closes on Esc and on outside click', async () => {
    searchResults.current = [
      builder({ id: 'b1', name: 'Boyd Livek', company: 'Crafted Design Build' }),
    ];
    renderHost();
    const input = screen.getByTestId('ac-name');
    fireEvent.change(input, { target: { value: 'Boyd' } });
    expect(screen.getByTestId('ac-name-menu')).toBeInTheDocument();

    // Esc dismisses.
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('ac-name-menu')).toBeNull();

    // Re-open by typing a different value (RTL skips the change event
    // when the new value matches the current one).
    fireEvent.change(input, { target: { value: 'Boyd Livek' } });
    expect(screen.getByTestId('ac-name-menu')).toBeInTheDocument();
    // Document-level mousedown outside the autocomplete container.
    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(screen.queryByTestId('ac-name-menu')).toBeNull();
    });
  });
});
