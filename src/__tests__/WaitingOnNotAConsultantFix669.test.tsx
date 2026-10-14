// ===========================================================================
// fix-669 (P-350): a Waiting On answer can be marked "Not a consultant"
// ===========================================================================
//
// Lindsay and Brittani asked for Builder, MHA Payment and OH Approval. Bobby
// approved them (2026-10-14) AND a per-option switch so the next one needs no
// developer. Once on the list, all three showed as consultant disciplines in
// the firm pickers, because `NON_FIRM_WAITING_ON` was a hard-coded constant.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  NON_FIRM_WAITING_ON,
  WAITING_ON_CONFIG_KEY,
  WAITING_ON_NON_FIRM_CONFIG_KEY,
  firmDisciplineLabel,
  firmDisciplineOptions,
  isNonFirmWaitingOn,
  nonFirmWaitingOn,
} from '../lib/waitingOn';

const LIST = [
  'Civil', 'Surveyor', 'Structural', 'Architect', 'City',
  'Builder', 'MHA Payment', 'OH Approval', 'Other',
];

function cfg(entries: Record<string, unknown>): Map<string, unknown> {
  return new Map(Object.entries(entries));
}

describe('fix-669: the non-firm set comes from Settings', () => {
  it('★★★ Builder is excluded from the firm list once marked not a consultant', () => {
    const map = cfg({
      [WAITING_ON_CONFIG_KEY]: LIST,
      [WAITING_ON_NON_FIRM_CONFIG_KEY]: ['City', 'Builder', 'MHA Payment', 'OH Approval', 'Other'],
    });
    expect(firmDisciplineOptions(map)).toEqual(['Civil', 'Surveyor', 'Structural', 'Architect']);
    expect(isNonFirmWaitingOn(map, 'Builder')).toBe(true);
    expect(isNonFirmWaitingOn(map, 'Structural')).toBe(false);
  });

  it('★★ with the key absent it behaves exactly as before: City + Other only', () => {
    const map = cfg({ [WAITING_ON_CONFIG_KEY]: LIST });
    expect(nonFirmWaitingOn(map)).toEqual([...NON_FIRM_WAITING_ON]);
    expect(firmDisciplineOptions(map)).toEqual([
      'Civil', 'Surveyor', 'Structural', 'Architect', 'Builder', 'MHA Payment', 'OH Approval',
    ]);
  });

  it('★★★ Other is excluded even when the stored array omits it', () => {
    const map = cfg({ [WAITING_ON_CONFIG_KEY]: LIST, [WAITING_ON_NON_FIRM_CONFIG_KEY]: ['City'] });
    expect(firmDisciplineOptions(map)).not.toContain('Other');
    expect(isNonFirmWaitingOn(map, 'Other')).toBe(true);
    // An empty stored array still keeps Other out, and makes City a firm.
    const empty = cfg({ [WAITING_ON_CONFIG_KEY]: LIST, [WAITING_ON_NON_FIRM_CONFIG_KEY]: [] });
    expect(nonFirmWaitingOn(empty)).toEqual(['Other']);
    expect(firmDisciplineOptions(empty)).toContain('City');
  });

  it('★ a non-firm value already stored is not offered back as a firm option', () => {
    const map = cfg({ [WAITING_ON_CONFIG_KEY]: LIST, [WAITING_ON_NON_FIRM_CONFIG_KEY]: ['Builder'] });
    expect(firmDisciplineOptions(map, 'Builder')).not.toContain('Builder');
    // …but it still has a label to render under (the retired-value rule).
    expect(firmDisciplineLabel(map, 'Builder')).toContain('Builder');
  });
});

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  setKey: vi.fn(),
  map: new Map<string, unknown>(),
}));

vi.mock('../hooks/useAppConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useAppConfig')>();
  return {
    ...actual,
    useAppConfig: () => ({ data: [], isLoading: false, error: null, map: mocks.map }),
  };
});
vi.mock('../hooks/useSetAppConfigKey', () => ({
  useSetAppConfigKey: () => ({ mutate: mocks.setKey }),
}));
vi.mock('../hooks/useTaskTree', () => ({
  useAllTasks: () => ({ data: [] }),
}));

import WaitingOnOptionsEditor from '../components/Settings/WaitingOnOptionsEditor';

describe('fix-669: Settings → Permits → Waiting On', () => {
  beforeEach(() => {
    mocks.setKey.mockReset();
    mocks.map = cfg({ [WAITING_ON_CONFIG_KEY]: LIST });
  });

  it('★★★ toggling the switch writes waitingOnNonFirm', () => {
    render(<WaitingOnOptionsEditor />);
    const builder = screen.getByTestId('waiting-on-nonfirm-Builder') as HTMLInputElement;
    expect(builder.checked).toBe(false);
    fireEvent.click(builder);
    expect(mocks.setKey).toHaveBeenCalledWith({
      key: WAITING_ON_NON_FIRM_CONFIG_KEY,
      value: ['City', 'Other', 'Builder'],
    });
  });

  it('★★ turning one off removes it', () => {
    render(<WaitingOnOptionsEditor />);
    fireEvent.click(screen.getByTestId('waiting-on-nonfirm-City'));
    expect(mocks.setKey).toHaveBeenCalledWith({
      key: WAITING_ON_NON_FIRM_CONFIG_KEY,
      value: ['Other'],
    });
  });

  it('★★★ deleting an option prunes it from the non-firm list', () => {
    mocks.map = cfg({
      [WAITING_ON_CONFIG_KEY]: LIST,
      [WAITING_ON_NON_FIRM_CONFIG_KEY]: ['City', 'Builder', 'Other'],
    });
    render(<WaitingOnOptionsEditor />);
    fireEvent.click(screen.getByTestId('waiting-on-options-remove-Builder'));
    expect(mocks.setKey).toHaveBeenCalledWith({
      key: WAITING_ON_CONFIG_KEY,
      value: LIST.filter((o) => o !== 'Builder'),
    });
    expect(mocks.setKey).toHaveBeenCalledWith({
      key: WAITING_ON_NON_FIRM_CONFIG_KEY,
      value: ['City', 'Other'],
    });
  });

  it('★ deleting a consultant writes only the list', () => {
    render(<WaitingOnOptionsEditor />);
    fireEvent.click(screen.getByTestId('waiting-on-options-remove-Civil'));
    expect(mocks.setKey).toHaveBeenCalledTimes(1);
  });

  it('★★ a new option starts as a consultant (switch off)', () => {
    mocks.map = cfg({ [WAITING_ON_CONFIG_KEY]: [...LIST.slice(0, -1), 'Acoustics', 'Other'] });
    render(<WaitingOnOptionsEditor />);
    expect((screen.getByTestId('waiting-on-nonfirm-Acoustics') as HTMLInputElement).checked).toBe(false);
  });

  it('★★ Other is shown locked on', () => {
    render(<WaitingOnOptionsEditor />);
    const other = screen.getByTestId('waiting-on-nonfirm-Other') as HTMLInputElement;
    expect(other.checked).toBe(true);
    expect(other.disabled).toBe(true);
  });

  it('★★ a non-admin sees the switch disabled', () => {
    render(<WaitingOnOptionsEditor readOnly />);
    const city = screen.getByTestId('waiting-on-nonfirm-City') as HTMLInputElement;
    expect(city.checked).toBe(true);
    expect(city.disabled).toBe(true);
    expect((screen.getByTestId('waiting-on-nonfirm-Builder') as HTMLInputElement).disabled).toBe(true);
  });

  it('★ the helper line says what the switch does', () => {
    render(<WaitingOnOptionsEditor />);
    expect(screen.getByTestId('waiting-on-nonfirm-note').textContent).toBe(
      "Choices marked Not a consultant don't appear when adding a firm.",
    );
  });
});
