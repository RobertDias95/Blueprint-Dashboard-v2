import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import SaveFailureBanner from '../components/SaveFailureBanner';
import { useSaveFailureStore } from '../stores/saveFailureStore';
import { isNetworkFailure } from '../lib/saveFailure';

// ===========================================================================
// fix-372 §6 — a save that died on the wire, rendered
// ===========================================================================
//
// LOGGED IN PROD: `TypeError: Failed to fetch`, mutation on
// /project/d6599dd4-…, 3 occurrences across 2 users on 14 / 17 / 20 August.
// Nothing on the screen said anything. This suite is the part that has to be
// watched rather than read.

function wrap(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  useSaveFailureStore.setState({ failure: null });
});

describe('fix-372 §6: the banner', () => {
  it('★ renders nothing at all until a save fails', () => {
    wrap(<SaveFailureBanner />);
    expect(screen.queryByTestId('save-failure-banner')).toBeNull();
  });

  it('★★★ the real logged failure surfaces, and says MAY not have saved', () => {
    // ★★ The request left; the answer is what went missing. Saying "not saved"
    // when it may well have saved is how somebody redoes work already done —
    // which on a date field overwrites the newer value with the older one.
    const err = new TypeError('Failed to fetch');
    expect(isNetworkFailure(err)).toBe(true);
    useSaveFailureStore.getState().report({
      kind: 'network',
      what: 'upsert permit cycle',
      message: err.message,
      at: Date.now(),
      newBuildAvailable: false,
    });
    wrap(<SaveFailureBanner />);
    expect(screen.getByTestId('save-failure-banner')).toBeInTheDocument();
    expect(screen.getByTestId('save-failure-headline').textContent).toContain(
      'may not have been saved',
    );
    expect(screen.getByTestId('save-failure-detail').textContent).toContain(
      'may have gone through',
    );
  });

  it('★★ a refusal from the server is stated plainly instead', () => {
    useSaveFailureStore.getState().report({
      kind: 'rejected',
      what: 'add note',
      message: 'permission denied',
      at: Date.now(),
      newBuildAvailable: false,
    });
    wrap(<SaveFailureBanner />);
    expect(screen.getByTestId('save-failure-headline').textContent).toContain(
      'was not saved',
    );
    expect(screen.getByTestId('save-failure-detail').textContent).toContain(
      'Nothing was written',
    );
  });

  it('★★★ the retry RE-READS and cannot double-write', () => {
    // ★★ Most mutations here are not idempotent: a duplicated note is a real
    // artefact. So the control refetches and the person decides.
    const client = new QueryClient();
    const refetch = vi.spyOn(client, 'refetchQueries').mockResolvedValue(undefined);
    useSaveFailureStore.getState().report({
      kind: 'network',
      what: 'add note',
      message: 'Failed to fetch',
      at: Date.now(),
      newBuildAvailable: false,
    });
    render(
      <QueryClientProvider client={client}>
        <SaveFailureBanner />
      </QueryClientProvider>,
    );
    const button = screen.getByTestId('save-failure-recheck');
    expect(button.textContent).toBe('Check what saved');
    expect(button.getAttribute('title')).toContain('does not re-send');
    fireEvent.click(button);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch.mock.calls[0][0]).toEqual({ type: 'active' });
  });

  it('★★ it stays until dismissed — it is not a toast', () => {
    vi.useFakeTimers();
    useSaveFailureStore.getState().report({
      kind: 'network',
      what: 'save',
      message: 'Failed to fetch',
      at: Date.now(),
      newBuildAvailable: false,
    });
    wrap(<SaveFailureBanner />);
    // ★★★ toastStore auto-dismisses after six seconds, deliberately (fix-86).
    // That is right for "copied" and wrong for this: somebody who looked away
    // would come back to a screen showing their edit and nothing saying it
    // might not be on the server.
    vi.advanceTimersByTime(60_000);
    expect(screen.getByTestId('save-failure-banner')).toBeInTheDocument();
    vi.useRealTimers();
    fireEvent.click(screen.getByTestId('save-failure-dismiss'));
    expect(screen.queryByTestId('save-failure-banner')).toBeNull();
  });

  it('★ a deploy is named when fix-371 says a new build is live', () => {
    useSaveFailureStore.getState().report({
      kind: 'network',
      what: 'save',
      message: 'Failed to fetch',
      at: Date.now(),
      newBuildAvailable: true,
    });
    wrap(<SaveFailureBanner />);
    const detail = screen.getByTestId('save-failure-detail').textContent ?? '';
    expect(detail).toContain('new version');
    expect(detail).toContain('Reload');
  });

  it('★ newest wins — two failures are one problem, not two banners', () => {
    const store = useSaveFailureStore.getState();
    store.report({ kind: 'network', what: 'first', message: '', at: 1, newBuildAvailable: false });
    store.report({ kind: 'network', what: 'second', message: '', at: 2, newBuildAvailable: false });
    wrap(<SaveFailureBanner />);
    expect(screen.getAllByTestId('save-failure-banner')).toHaveLength(1);
    expect(screen.getByTestId('save-failure-headline').textContent).toContain('second');
  });
});
