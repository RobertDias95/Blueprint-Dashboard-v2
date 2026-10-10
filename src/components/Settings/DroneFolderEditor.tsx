import { useState } from 'react';
import { useAppConfig } from '../../hooks/useAppConfig';
import { useSetAppConfigKey } from '../../hooks/useSetAppConfigKey';
import { droneFolderUrl, isWebUrl } from '../../lib/siteLinks';

// ===========================================================================
// fix-632 (P-328) — the shared drone-footage folder
// ===========================================================================
//
// Bobby, 10-10: the footage lives in a SharePoint/OneDrive folder ("Drone
// Photos" in Blake's OneDrive) while its final home is settled. Site Data
// offers this folder on every project that has no link of its own, so moving
// the footage later is one edit here, not one per project.

export default function DroneFolderEditor({ readOnly }: { readOnly: boolean }) {
  const saved = droneFolderUrl(useAppConfig().map) ?? '';
  const setKey = useSetAppConfigKey();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const value = draft ?? saved;

  function save() {
    if (draft === null) return;
    const v = draft.trim();
    if (v !== '' && !isWebUrl(v)) {
      setError('Paste the folder’s web link — it starts with https:// (a server path will not open in a browser).');
      return;
    }
    setError(null);
    setDraft(null);
    if (v === saved) return;
    setKey.mutate({ key: 'droneFootageFolderUrl', value: v === '' ? null : v });
  }

  return (
    <div className="flex flex-col gap-1" data-testid="settings-drone-folder">
      <div className="text-[10px] text-dim">
        Shown on every project’s Site Data as “Drone footage folder ↗” until the project has a
        drone link of its own.
      </div>
      <input
        type="url"
        value={value}
        readOnly={readOnly}
        disabled={readOnly}
        placeholder="https://…sharepoint.com/… (the Drone Photos folder)"
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        aria-invalid={error ? true : undefined}
        className="w-full text-[11px] border rounded px-2 py-1 bg-surface disabled:opacity-60"
        style={{ borderColor: error ? 'var(--color-er)' : 'var(--color-border)' }}
        data-testid="settings-drone-folder-input"
      />
      {error && (
        <div role="alert" className="text-[10px]" style={{ color: 'var(--color-er)' }} data-testid="settings-drone-folder-error">
          {error}
        </div>
      )}
      {saved && (
        <a href={saved} target="_blank" rel="noopener noreferrer" className="text-[10px] text-de hover:underline self-start">
          Open the folder ↗
        </a>
      )}
    </div>
  );
}
