import { useState } from 'react';
import { useAppConfig } from '../../hooks/useAppConfig';
import { useSetAppConfigKey } from '../../hooks/useSetAppConfigKey';
import { ALLOWED_SHARE_PREFIX, SHARE_ROOT_CONFIG_KEY, shareRoot } from '../../lib/bridgeOpen';

// ===========================================================================
// fix-654 (P-149) — the Building Permits share root
// ===========================================================================
//
// Site Data's "Project folder ↗" is this root + the project's `share_folder`
// (a folder NAME the indexer keeps filled, fix-655). One value, so a move of
// the share is one edit here, not one per project. It must sit under
// \\bpc-file\SoleilData\ — the only tree the Bridge opener will open.

export default function ShareRootEditor({ readOnly }: { readOnly: boolean }) {
  const saved = shareRoot(useAppConfig().map) ?? '';
  const setKey = useSetAppConfigKey();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const value = draft ?? saved;

  function save() {
    if (draft === null) return;
    const v = draft.trim().replace(/\\+$/, '');
    if (v !== '' && shareRoot(new Map([[SHARE_ROOT_CONFIG_KEY, v]])) === null) {
      setError(`The folder must be on ${ALLOWED_SHARE_PREFIX} — e.g. ${ALLOWED_SHARE_PREFIX}--- Blueprint Services ---\\Building Permits`);
      return;
    }
    setError(null);
    setDraft(null);
    if (v === saved) return;
    setKey.mutate({ key: SHARE_ROOT_CONFIG_KEY, value: v === '' ? null : v });
  }

  return (
    <div className="flex flex-col gap-1" data-testid="settings-share-root">
      <div className="text-[10px] text-dim">
        The server folder that holds every project’s folder. Site Data shows “Project folder ↗”
        for each project the file indexer has matched to a folder in here.
      </div>
      <input
        type="text"
        value={value}
        readOnly={readOnly}
        disabled={readOnly}
        placeholder={`${ALLOWED_SHARE_PREFIX}--- Blueprint Services ---\\Building Permits`}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        aria-invalid={error ? true : undefined}
        className="w-full font-mono text-[11px] border rounded px-2 py-1 bg-surface disabled:opacity-60"
        style={{ borderColor: error ? 'var(--color-er)' : 'var(--color-border)' }}
        data-testid="settings-share-root-input"
      />
      {error && (
        <div role="alert" className="text-[10px]" style={{ color: 'var(--color-er)' }} data-testid="settings-share-root-error">
          {error}
        </div>
      )}
    </div>
  );
}
