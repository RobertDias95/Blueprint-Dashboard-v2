import { useMemo, useState } from 'react';
import PillListEditor from './PillListEditor';
import ExternalTeamDirectoryEditor from './ExternalTeamDirectoryEditor';
import { useJurisdictions } from '../../hooks/useJurisdictions';
import { usePermitTypes } from '../../hooks/usePermitTypes';
import { useAppConfig, readAppConfigStringArray } from '../../hooks/useAppConfig';
import { useUpsertJurisdiction } from '../../hooks/useUpsertJurisdiction';
import { useDeleteJurisdiction } from '../../hooks/useDeleteJurisdiction';
import { useSetAppConfigKey } from '../../hooks/useSetAppConfigKey';
import { ZONE_OPTIONS_KEY, zoneOptions } from '../../lib/zoneOptions';
import { useIsTenantAdmin } from '../../hooks/useIsTenantAdmin';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';
// ★★★ fix-448 §A (P-098): the Builder/Owner registry — the sixth catalogue in
// this section, and the first one backed by a TABLE rather than an app_config
// key (see hooks/useBuilderRegistry).
import BuildersRegistryPanel from './BuildersRegistryPanel';
import { usePermits } from '../../hooks/usePermits';
import {
  PERMIT_OWNER_KEY,
  isRetiredPermitOwner,
  permitOwnerOptions,
} from '../../lib/permitOwnerOptions';

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
  const setKey = useSetAppConfigKey();

  const error = jurisQ.error ?? typesQ.error ?? cfgQ.error;
  // ★★ fix-449 §B: the registry, and what the permits actually carry. The
  //    counts come from the app-wide permits cache — no new request.
  //
  // ★ ABOVE the loading/error early returns: hooks must run in the same order
  //   on every render, and lint catches it (rules-of-hooks) — which it did.
  const permitsQ = usePermits();
  const ownerCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of permitsQ.data ?? []) {
      const v = (p.permit_owner ?? '').trim();
      if (v) m.set(v, (m.get(v) ?? 0) + 1);
    }
    return m;
  }, [permitsQ.data]);

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


  // fix-92 / fix-232: 'productTypeOptions' is the CANONICAL, single-source
  // product-type registry — this editor writes it, and every product-type option
  // list in the app (project field, wizard, unit-row label source, Library
  // filter) reads it. The legacy app_config 'productTypes' key is orphaned (no
  // code reads it) and can be deleted server-side.
  const productTypes = readAppConfigStringArray(cfgQ.map, 'productTypeOptions');
  const projectTags = readAppConfigStringArray(cfgQ.map, 'projectTagOptions');
  // ★★★ fix-415 A1/A2: the zone registry, read exactly like its neighbours.
  //   `zoneOptions()` supplies the shipped 21 when the key has never been
  //   written, so a fresh tenant gets a working dropdown rather than an empty
  //   one — but what this editor WRITES is always the app_config key.
  const zones = zoneOptions(cfgQ.map);
  const permitOwners = permitOwnerOptions(cfgQ.map);
  const offListOwners = [...ownerCounts.keys()].filter((v) =>
    isRetiredPermitOwner(cfgQ.map, v),
  );
  // fix-167: editable Hold Reasons list — the source for the project On-Hold
  // reason dropdown. Same app_config mechanism as Product Types / Project Tags.
  const holdReasons = readAppConfigStringArray(cfgQ.map, 'holdReasonOptions');
  // fix-262: cancel reasons are a SEPARATE vocabulary from hold reasons —
  // "builder pulled out" and "waiting on survey" answer different questions.
  const cancelReasons = readAppConfigStringArray(cfgQ.map, 'cancelReasonOptions');

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

      {/* fix-288 moved the Permit Types editor to Settings → Permits &
          Templates and left a signpost here saying so. It is deliberately NOT
          duplicated: two editors for one catalogue would mean the delete guard
          could be walked around by using the other tab. That reasoning stands —
          only the signpost is gone.

          ★★ fix-401: Bobby — *"it says, oh, it's not a part of projects, it's
          now in permits. It's like we don't need to say that, just delete it."*
          A relocation note is a message to whoever remembers the old location,
          and it outlives them: months later it is a tab telling everybody about
          a move they never saw. The field lives where it lives. */}

      {/* ★★★ fix-415 SCOPE A2 — THE ZONE REGISTRY EDITOR.
          Same component, same key mechanism, same admin gating as Product
          Types below it. fix-326's rule: a fifth catalogue is a fifth entry in
          an existing pattern, not a fifth pattern.

          ★★ IT SITS FIRST because zone is the field that just cost a migration:
          196 projects had produced 33 spellings of 21 zones through a free-text
          box, and this list is now the only way a new one enters the app. */}
      {/* ★★★ fix-448 §A (P-098) — BUILDERS & OWNERS.
          Bobby, 2026-08-29: *"in our settings, we should have a builder/owner
          database. and builders could have different llcs per project too."*

          ★★ IT SITS FIRST because it is the only catalogue here that had NO
          editor at all: 61 rows arrived from the May import and fix-425 and
          nothing in the app could touch them since. Every other list in this
          section has been editable for tickets.

          ★ Unlike its neighbours it is not an app_config key — `public.builders`
          is a real table with a FK from `projects.builder_id`, so it needs
          RPCs, an OCC token and a merge. See migrations/fix_448_builder_registry.sql. */}
      <Section title="Builders & Owners">
        <BuildersRegistryPanel readOnly={!isAdmin} />
      </Section>

      {/* ★★★ fix-449 §B (P-077) — PERMIT OWNER.
          Bobby's rule: *"is the set of valid answers fixed? → list."* Which
          side of the house owns a permit has three answers.

          ★★★ AND THERE IS NO WRITE SURFACE FOR IT ANYWHERE IN THE APP —
          measured on origin/main, `permits.permit_owner` has three READERS
          (PermitCard's `ent_lead || permit_owner` fallback and two search
          haystacks) and ZERO writers. The 158 values arrived with the import.
          So this editor does the half that is useful today: it names the
          vocabulary and COUNTS the permits carrying each value, including any
          the list no longer offers. It deliberately does not invent an editing
          surface for a field nothing currently displays as itself. */}
      <Section title="Permit Owner">
        <PillListEditor
          label="Permit Owner"
          items={permitOwners.map((o) => ({
            key: o,
            // ★★ The count is what makes retiring one a decision rather than a
            //    guess — the same reason fix-448's registry shows it.
            label: `${o}${ownerCounts.get(o) ? ` · ${ownerCounts.get(o)}` : ''}`,
          }))}
          onAdd={(name) => {
            if (permitOwners.includes(name)) return;
            setKey.mutate({
              key: PERMIT_OWNER_KEY,
              value: [...permitOwners, name],
            });
          }}
          onRemove={(name) =>
            setKey.mutate({
              key: PERMIT_OWNER_KEY,
              value: permitOwners.filter((o) => o !== name),
            })
          }
          placeholder="Add permit owner…"
          emptyState="No permit owners yet."
          readOnly={!isAdmin}
          testIdPrefix="permit-owner-list"
        />
        {/* ★★ RETIRING ONE REWRITES NOTHING (§B2). The permits keep the text
            they carry; it simply stops being offered. This line names the ones
            in that state so a retired value is visible here, not only on the
            permit that holds it — fix-415's rule, applied to the editor as
            well as to the field. */}
        {offListOwners.length > 0 && (
          <div
            className="text-[11px] text-muted mt-2"
            data-testid="permit-owner-offlist"
          >
            Not in the list, still on permits:{' '}
            {offListOwners
              .map((o) => `${o} (${ownerCounts.get(o) ?? 0})`)
              .join(' · ')}
          </div>
        )}
      </Section>

      <Section title="Zones">
        <PillListEditor
          label="Zones"
          items={zones.map((z) => ({ key: z, label: z }))}
          onAdd={(name) => {
            if (zones.includes(name)) return;
            setKey.mutate({ key: ZONE_OPTIONS_KEY, value: [...zones, name] });
          }}
          onRemove={(name) =>
            setKey.mutate({
              key: ZONE_OPTIONS_KEY,
              value: zones.filter((z) => z !== name),
            })
          }
          placeholder="Add zone…"
          emptyState="No zones yet. Used by the Project Overview, the setup wizard and the Library filter."
          readOnly={!isAdmin}
          testIdPrefix="zones-list"
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

      {/* fix-167: Hold Reasons — the dropdown source for putting a project On
          Hold. Phase 1 is data + display only (no calculation effects). */}
      <Section title="Hold Reasons">
        <PillListEditor
          label="Hold Reasons"
          items={holdReasons.map((r) => ({ key: r, label: r }))}
          onAdd={(name) => {
            if (holdReasons.includes(name)) return;
            setKey.mutate({
              key: 'holdReasonOptions',
              value: [...holdReasons, name],
            });
          }}
          onRemove={(name) =>
            setKey.mutate({
              key: 'holdReasonOptions',
              value: holdReasons.filter((r) => r !== name),
            })
          }
          placeholder="Add hold reason…"
          emptyState="No hold reasons yet. Used when putting a project On Hold."
          readOnly={!isAdmin}
          testIdPrefix="hold-reasons-list"
        />
      </Section>

      {/* fix-262: Cancel Reasons — the dropdown source for CANCELLING a project
          ("the step after hold, but before delete"). Deliberately its own list;
          a cancel reason is never a hold reason. */}
      <Section title="Cancel Reasons">
        <PillListEditor
          label="Cancel Reasons"
          items={cancelReasons.map((r) => ({ key: r, label: r }))}
          onAdd={(name) => {
            if (cancelReasons.includes(name)) return;
            setKey.mutate({
              key: 'cancelReasonOptions',
              value: [...cancelReasons, name],
            });
          }}
          onRemove={(name) =>
            setKey.mutate({
              key: 'cancelReasonOptions',
              value: cancelReasons.filter((r) => r !== name),
            })
          }
          placeholder="Add cancel reason…"
          emptyState="No cancel reasons yet. Used when cancelling a project."
          readOnly={!isAdmin}
          testIdPrefix="cancel-reasons-list"
        />
      </Section>

      {/* fix-227: central External Team directory (firms by discipline) that
          feeds the per-project external-team picker's dropdown. */}
      <Section title="External Team Directory">
        <ExternalTeamDirectoryEditor readOnly={!isAdmin} />
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
