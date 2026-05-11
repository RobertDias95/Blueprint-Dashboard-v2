import { useMemo, useState } from 'react';
import { useAppConfig } from '../../hooks/useAppConfig';
import { useSetAppConfigKey } from '../../hooks/useSetAppConfigKey';
import { useIsTenantAdmin } from '../../hooks/useIsTenantAdmin';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';
import PillListEditor from './PillListEditor';

// Q7.3.d: Consultants tab. Editor for app_config.consultantTypes —
// a JSONB array of {type, firms[]} per Q5 design decision (stays JSONB,
// 3 types × 2-4 firms doesn't justify normalization). Each call to
// bp_set_app_config_key rewrites the whole array.
//
// UX mirrors v1's renderConsultantsAdmin (index.html 5794-5822):
// stacked cards, one per type, with a firm pill-list nested inside +
// a "Remove Type" button. Bottom row lets the user add a new type.

interface ConsultantType {
  type: string;
  firms: string[];
}

function parseConsultantTypes(v: unknown): ConsultantType[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((entry): ConsultantType | null => {
      if (!entry || typeof entry !== 'object') return null;
      const o = entry as Record<string, unknown>;
      const type = typeof o.type === 'string' ? o.type : null;
      if (!type) return null;
      const firms = Array.isArray(o.firms)
        ? o.firms.filter((f): f is string => typeof f === 'string')
        : [];
      return { type, firms };
    })
    .filter((x): x is ConsultantType => x !== null);
}

export default function AdminConsultantsTab() {
  const cfgQ = useAppConfig();
  const setKey = useSetAppConfigKey();
  const isAdmin = useIsTenantAdmin();
  const [newType, setNewType] = useState('');

  const types = useMemo(
    () => parseConsultantTypes(cfgQ.map.get('consultantTypes')),
    [cfgQ.map],
  );

  if (cfgQ.error) {
    return (
      <QueryError
        title="Consultants failed to load"
        error={cfgQ.error}
        onRetry={() => cfgQ.refetch()}
      />
    );
  }
  if (cfgQ.isLoading) {
    return <SkeletonRows count={3} rowClassName="h-24" />;
  }

  function save(next: ConsultantType[]) {
    setKey.mutate({ key: 'consultantTypes', value: next });
  }

  function addType(name: string) {
    if (!name || types.some((t) => t.type === name)) return;
    save([...types, { type: name, firms: [] }]);
  }
  function removeType(name: string) {
    save(types.filter((t) => t.type !== name));
  }
  function addFirm(typeName: string, firm: string) {
    if (!firm) return;
    save(
      types.map((t) =>
        t.type === typeName && !t.firms.includes(firm)
          ? { ...t, firms: [...t.firms, firm] }
          : t,
      ),
    );
  }
  function removeFirm(typeName: string, firm: string) {
    save(
      types.map((t) =>
        t.type === typeName
          ? { ...t, firms: t.firms.filter((f) => f !== firm) }
          : t,
      ),
    );
  }

  function handleAddTypeSubmit() {
    const v = newType.trim();
    if (!v) return;
    addType(v);
    setNewType('');
  }

  return (
    <div className="space-y-3" data-testid="admin-consultants-tab">
      {!isAdmin && (
        <div className="bg-surface-2 border border-border rounded-lg px-4 py-2 text-xs text-muted">
          Read-only — you need tenant admin to edit consultant types.
        </div>
      )}
      <div className="bg-surface border border-border rounded-lg p-4">
        <h2 className="text-sm font-display font-bold text-text mb-1">
          Consultants
        </h2>
        <p className="text-[11px] text-muted mb-4">
          Consultant types + firms that show up in External Team picks on each
          project. Edits replace the whole consultantTypes JSONB blob on save.
        </p>

        <div className="space-y-3">
          {types.length === 0 && (
            <div className="text-xs text-dim italic px-3 py-4 bg-surface-2 border border-border rounded text-center">
              No consultant types yet. Add one below.
            </div>
          )}
          {types.map((t) => (
            <div
              key={t.type}
              className="bg-surface-2 border border-border rounded-lg p-3"
              data-testid={`consultant-card-${t.type}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-display font-bold text-text">
                  {t.type}
                </span>
                {isAdmin && (
                  <button
                    onClick={() => removeType(t.type)}
                    className="text-[10px] px-2 py-0.5 rounded border border-co-border bg-co-bg text-co"
                    data-testid={`consultant-remove-type-${t.type}`}
                  >
                    Remove Type
                  </button>
                )}
              </div>
              <PillListEditor
                label="Firms"
                items={t.firms.map((f) => ({ key: f, label: f }))}
                onAdd={(name) => addFirm(t.type, name)}
                onRemove={(name) => removeFirm(t.type, name)}
                placeholder={`Add firm to ${t.type}…`}
                emptyState="No firms yet."
                readOnly={!isAdmin}
                testIdPrefix={`consultant-firms-${t.type}`}
              />
            </div>
          ))}
        </div>

        {isAdmin && (
          <div className="mt-4 flex gap-2 items-center bg-surface-2 border border-border rounded p-2">
            <input
              type="text"
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddTypeSubmit();
                }
              }}
              placeholder="New consultant type (e.g. Landscape Architect)…"
              className="flex-1 px-2 py-1 text-xs border border-border rounded bg-bg text-text outline-none focus:border-de"
              data-testid="consultant-add-type"
            />
            <button
              onClick={handleAddTypeSubmit}
              className="px-3 py-1 text-xs font-display font-semibold bg-de text-white rounded border border-de hover:bg-de/90"
              data-testid="consultant-add-type-btn"
            >
              + Add Type
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
