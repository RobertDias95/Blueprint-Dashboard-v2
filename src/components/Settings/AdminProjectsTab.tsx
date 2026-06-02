import { useMemo, useState } from 'react';
import PillListEditor from './PillListEditor';
import { useJurisdictions } from '../../hooks/useJurisdictions';
import { usePermitTypes } from '../../hooks/usePermitTypes';
import { useAppConfig, readAppConfigStringArray } from '../../hooks/useAppConfig';
import { useUpsertJurisdiction } from '../../hooks/useUpsertJurisdiction';
import { useDeleteJurisdiction } from '../../hooks/useDeleteJurisdiction';
import { useUpsertPermitType } from '../../hooks/useUpsertPermitType';
import { useDeletePermitType } from '../../hooks/useDeletePermitType';
import { useSetAppConfigKey } from '../../hooks/useSetAppConfigKey';
import { useIsTenantAdmin } from '../../hooks/useIsTenantAdmin';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';

// Q7.3.a: Settings → Projects tab. Four catalog editors:
//   1. Jurisdictions (table) — pill list + per-row learn_window_days input
//   2. Permit Types (table) — pill list with "built-in" badge
//   3. Product Types (app_config JSONB) — pill list
//   4. Project Tags (app_config JSONB) — pill list
//
// Admin-only writes. Read-only for non-admin members (pills render, add/×
// hide). Per Q7.3 design §3 + Q1 decision.

const DEFAULT_LEARN_WINDOW = 180;

export default function AdminProjectsTab() {
  const jurisQ = useJurisdictions();
  const typesQ = usePermitTypes();
  const cfgQ = useAppConfig();
  const isAdmin = useIsTenantAdmin();

  const upsertJuris = useUpsertJurisdiction();
  const deleteJuris = useDeleteJurisdiction();
  const upsertType = useUpsertPermitType();
  const deleteType = useDeletePermitType();
  const setKey = useSetAppConfigKey();

  const error = jurisQ.error ?? typesQ.error ?? cfgQ.error;
  if (error) {
    return (
      <QueryError
        title="Settings failed to load"
        error={error}
        onRetry={() => {
          jurisQ.refetch();
          typesQ.refetch();
          cfgQ.refetch();
        }}
      />
    );
  }
  if (jurisQ.isLoading || typesQ.isLoading || cfgQ.isLoading) {
    return <SkeletonRows count={4} rowClassName="h-20" />;
  }

  const jurisItems = (jurisQ.data ?? []).map((j) => ({
    key: j.name,
    label: j.name,
    extra: (
      <LearnWindowInput
        juris={j.name}
        value={j.learn_window_days ?? DEFAULT_LEARN_WINDOW}
        readOnly={!isAdmin}
        onChange={(days) =>
          upsertJuris.mutate({
            name: j.name,
            learn_window_days: days,
            notes: j.notes,
          })
        }
      />
    ),
  }));

  const typeItems = (typesQ.data ?? []).map((t) => ({
    key: t.name,
    label: t.name,
    badge: t.is_builtin ? 'built-in' : undefined,
    removalLocked: t.is_builtin === true,
  }));

  // fix-92: read the same key that fix-91's wizard + Library filter
  // consume (app_config.productTypeOptions, seeded by
  // migrations/fix_91_product_types_array.sql). Pre-fix-92 this was
  // 'productTypes' — a key no consumer read, so Bobby's edits never
  // reached the wizard's dropdown.
  const productTypes = readAppConfigStringArray(cfgQ.map, 'productTypeOptions');
  const projectTags = readAppConfigStringArray(cfgQ.map, 'projectTagOptions');

  return (
    <div className="space-y-6" data-testid="admin-projects-tab">
      {!isAdmin && (
        <div className="bg-surface-2 border border-border rounded-lg px-4 py-2 text-xs text-muted">
          Read-only — you need tenant admin to edit catalogs. Settings still
          render so you can confirm the current configuration.
        </div>
      )}

      <Section title="Jurisdictions">
        <PillListEditor
          label="Jurisdictions"
          items={jurisItems}
          onAdd={(name) =>
            upsertJuris.mutate({
              name,
              learn_window_days: DEFAULT_LEARN_WINDOW,
              notes: null,
            })
          }
          onRemove={(name) => deleteJuris.mutate({ name })}
          placeholder="Add jurisdiction…"
          emptyState="No jurisdictions yet. Add one to enable juris filters across the app."
          readOnly={!isAdmin}
          testIdPrefix="juris-list"
        />
      </Section>

      <Section title="Permit Types">
        <PillListEditor
          label="Permit Types"
          items={typeItems}
          onAdd={(name) =>
            upsertType.mutate({ name, is_builtin: false, notes: null })
          }
          onRemove={(name) => deleteType.mutate({ name })}
          placeholder="Add permit type…"
          emptyState="No permit types yet."
          readOnly={!isAdmin}
          testIdPrefix="permit-types-list"
        />
      </Section>

      <Section title="Product Types">
        <PillListEditor
          label="Product Types"
          items={productTypes.map((t) => ({ key: t, label: t }))}
          onAdd={(name) => {
            if (productTypes.includes(name)) return;
            setKey.mutate({
              key: 'productTypeOptions',
              value: [...productTypes, name],
            });
          }}
          onRemove={(name) =>
            setKey.mutate({
              key: 'productTypeOptions',
              value: productTypes.filter((t) => t !== name),
            })
          }
          placeholder="Add product type…"
          emptyState="No product types yet. Used on the Project create wizard."
          readOnly={!isAdmin}
          testIdPrefix="product-types-list"
        />
      </Section>

      <Section title="Project Tags">
        <PillListEditor
          label="Project Tags"
          items={projectTags.map((t) => ({ key: t, label: t }))}
          onAdd={(name) => {
            if (projectTags.includes(name)) return;
            setKey.mutate({
              key: 'projectTagOptions',
              value: [...projectTags, name],
            });
          }}
          onRemove={(name) =>
            setKey.mutate({
              key: 'projectTagOptions',
              value: projectTags.filter((t) => t !== name),
            })
          }
          placeholder="Add project tag…"
          emptyState="No project tags yet. Used across Reports + project metadata."
          readOnly={!isAdmin}
          testIdPrefix="project-tags-list"
        />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <h2 className="text-sm font-display font-bold text-text mb-3">{title}</h2>
      {children}
    </div>
  );
}

/** Inline number input for a jurisdiction's learning window. Saves on blur
 *  to avoid one save-per-keystroke when typing a multi-digit value. */
function LearnWindowInput({
  juris,
  value,
  readOnly,
  onChange,
}: {
  juris: string;
  value: number;
  readOnly: boolean;
  onChange: (days: number) => void;
}) {
  const [local, setLocal] = useState(String(value));
  const valueDirty = useMemo(() => local !== String(value), [local, value]);

  function commit() {
    if (!valueDirty) return;
    const n = Math.max(30, Math.min(730, parseInt(local, 10) || DEFAULT_LEARN_WINDOW));
    onChange(n);
    setLocal(String(n));
  }

  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted">
      <input
        type="number"
        min={30}
        max={730}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            (e.target as HTMLInputElement).blur();
          }
        }}
        disabled={readOnly}
        className="w-12 px-1 py-0 text-[10px] border border-border rounded bg-bg text-text text-center outline-none focus:border-de disabled:opacity-60"
        data-testid={`juris-window-${juris}`}
      />
      <span>d</span>
    </span>
  );
}
