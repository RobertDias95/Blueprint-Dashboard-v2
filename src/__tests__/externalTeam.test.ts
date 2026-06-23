import { describe, it, expect } from 'vitest';
import {
  resolveExternalFirm,
  asExternalTeamBlob,
} from '../lib/externalTeam';
import { WAITING_ON_OPTIONS } from '../lib/database.types';

// fix-190d: the single resolver from a project's external_team blob to the firm
// working a discipline — the one source both My Tasks → Waiting and the per-task
// Waiting-On sub-label read. Canonical survey term is "Surveyor".

describe('resolveExternalFirm (fix-190d single source)', () => {
  it('224 2nd Ave N: a Surveyor task resolves to "Emerald"', () => {
    expect(resolveExternalFirm({ Surveyor: 'Emerald' }, 'Surveyor')).toBe('Emerald');
  });

  it('13515 27th Ave NE: a Civil task resolves to "Facet"', () => {
    expect(resolveExternalFirm({ Civil: 'Facet' }, 'Civil')).toBe('Facet');
  });

  it('a discipline with no firm on the project → null (correct "no firm assigned")', () => {
    expect(resolveExternalFirm({ Surveyor: 'Emerald' }, 'Civil')).toBeNull();
    expect(resolveExternalFirm({}, 'Surveyor')).toBeNull();
    expect(resolveExternalFirm(null, 'Surveyor')).toBeNull();
  });

  it('the OLD "Survey" term never matches the canonical "Surveyor" blob key', () => {
    // The migration flips tasks to "Surveyor"; a stray "Survey" must not resolve.
    expect(resolveExternalFirm({ Surveyor: 'Emerald' }, 'Survey')).toBeNull();
  });

  it('null / empty / blank discipline or firm → null', () => {
    expect(resolveExternalFirm({ Surveyor: '' }, 'Surveyor')).toBeNull();
    expect(resolveExternalFirm({ Surveyor: '   ' }, 'Surveyor')).toBeNull();
    expect(resolveExternalFirm({ Surveyor: 'Emerald' }, null)).toBeNull();
    expect(resolveExternalFirm({ Surveyor: 'Emerald' }, '')).toBeNull();
  });
});

describe('asExternalTeamBlob', () => {
  it('passes a plain object through, rejects arrays/null/primitives', () => {
    expect(asExternalTeamBlob({ Civil: 'Facet' })).toEqual({ Civil: 'Facet' });
    expect(asExternalTeamBlob(null)).toBeNull();
    expect(asExternalTeamBlob(undefined)).toBeNull();
    expect(asExternalTeamBlob([])).toBeNull();
    expect(asExternalTeamBlob('x')).toBeNull();
  });
});

describe('canonical vocabulary (fix-190d)', () => {
  it('WAITING_ON_OPTIONS uses "Surveyor", never "Survey"', () => {
    expect(WAITING_ON_OPTIONS).toContain('Surveyor');
    expect(WAITING_ON_OPTIONS).not.toContain('Survey');
  });
});
