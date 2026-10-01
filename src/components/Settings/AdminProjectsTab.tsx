import PillListEditor from './PillListEditor';
import SettingsBlock, { SettingsSubBlock } from './SettingsBlock';
import JurisdictionLinksEditor from './JurisdictionLinksEditor';
import { useJurisdictions } from '../../hooks/useJurisdictions';
import { usePermitTypes } from '../../hooks/usePermitTypes';
import { useAppConfig, readAppConfigStringArray } from '../../hooks/useAppConfig';
import { useUpsertJurisdiction } from '../../hooks/useUpsertJurisdiction';
import { useDeleteJurisdiction } from '../../hooks/useDeleteJurisdiction';
import { useSetAppConfigKey } from '../../hooks/useSetAppConfigKey';
import { ZONE_OPTIONS_KEY, zoneOptions } from '../../lib/zoneOptions';
import {
  PARKING_OPTIONS_KEY,
  ROOF_DECK_OPTIONS_KEY,
  STORIES_OPTIONS_KEY,
  isStorableVocabularyEntry,
  parkingOptions,
  roofDeckOptions,
  storiesOptions,
} from '../../lib/unitVocabulary';
import { useIsTenantAdmin } from '../../hooks/useIsTenantAdmin';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';
// ★★★ fix-448 §A (P-098): the Builder/Owner registry — the sixth catalogue in
// this section, and the first one backed by a TABLE rather than an app_config
// key (see hooks/useBuilderRegistry).
import BuildersRegistryPanel from './BuildersRegistryPanel';

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
  // ★★ fix-611 §E.2: `usePermits()` and the per-owner counts are gone with the
  //    Permit Owner block. That block was the only reason this tab read every
  //    permit in the tenant — to count values for a list nothing could apply —
  //    so retiring it takes a whole-table read off the Settings page.

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

  // ★★★ fix-611 §E.1 — THE PER-ROW LEARNING-WINDOW INPUT IS GONE.
  //
  // ⚖️ Bobby, 2026-09-30: **"Learning window per city: REMOVE."**
  //
  // ★★ It drove nothing. `getLearnWindow(juris)` in lib/scheduleBenchmarks
  //    discards its argument and returns the flat default, so the number typed
  //    here never reached the estimator — and the Schedule tab's copy claiming it
  //    fed Schedule Benchmarks was simply wrong. Removing it changes no
  //    arithmetic, which is what makes it safe to do in a layout ticket.
  //
  // ★ `jurisdictions.learn_window_days` stays (no migration), and so does the
  //   `learn_window_days` argument on the add path below: the RPC takes it, the
  //   column is NOT NULL-defaulted in practice, and passing the default keeps a
  //   newly added city identical to every existing row.
  const jurisItems = (jurisQ.data ?? []).map((j) => ({
    key: j.name,
    label: j.name,
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
  // fix-167: editable Hold Reasons list — the source for the project On-Hold
  // reason dropdown. Same app_config mechanism as Product Types / Project Tags.
  const holdReasons = readAppConfigStringArray(cfgQ.map, 'holdReasonOptions');
  // fix-262: cancel reasons are a SEPARATE vocabulary from hold reasons —
  // "builder pulled out" and "waiting on survey" answer different questions.
  const cancelReasons = readAppConfigStringArray(cfgQ.map, 'cancelReasonOptions');
  // ★★★ fix-562 §A (P-268) — THE THREE UNIT VOCABULARIES, BESIDE THE ZONE
  //     REGISTRY THEY ARE MODELLED ON.
  //
  // fix-232's rule: a dropdown's options are canonical in `app_config` and the
  // control is dropdown-only. Parking, roof deck and stories were hard-coded in
  // the code until this ticket — exactly the drift P-173 is about — and each
  // falls back to its canonical list when the key has never been written, so a
  // fresh tenant gets a working dropdown rather than an empty one.
  const parking = parkingOptions(cfgQ.map);
  const roofDeck = roofDeckOptions(cfgQ.map);
  const stories = storiesOptions(cfgQ.map);

  return (
    <div className="space-y-6" data-testid="admin-projects-tab">
      {!isAdmin && (
        <div className="bg-surface-2 border border-border rounded-lg px-4 py-2 text-xs text-muted">
          Read-only — you need tenant admin to edit catalogs. Settings still
          render so you can confirm the current configuration.
        </div>
      )}

      {/* ★★★ fix-611 §B — ONE CARD. The two were adjacent Sections that people
          confused precisely because they were two: one is the permitting
          VOCABULARY (which city a permit can belong to), the other a NAVIGATION
          list (the handful worth a ribbon shortcut, and their links). Neither
          derives from the other — see the note in JurisdictionLinksEditor — so
          they are two sub-headings of one block rather than one merged list. */}
      <SettingsBlock id="jurisdictions">
        <SettingsSubBlock title="Cities a permit can belong to">
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
        </SettingsSubBlock>

      {/* ★★★ fix-485 §A3 (P-147) — THE JURISDICTION LINK REGISTRY.
          Bobby: *"a drop-down of Seattle, Kirkland, Bellevue with folders
          inside that take you to their GIS, their code, whatever."*

          ★★ IT SITS DIRECTLY UNDER "Jurisdictions" because the two will be
          confused otherwise, and the editor's own first line says which is
          which: that one is the permitting VOCABULARY (which juris a permit can
          belong to, and its learning window); this one is a NAVIGATION list
          (the handful of cities worth a ribbon shortcut, and their links).
          Neither derives from the other — see the note in the editor. */}
        <SettingsSubBlock title="Portal links">
          <JurisdictionLinksEditor readOnly={!isAdmin} />
        </SettingsSubBlock>
      </SettingsBlock>

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
      <SettingsBlock id="builders-and-owners">
        <BuildersRegistryPanel readOnly={!isAdmin} />
      </SettingsBlock>

      {/* ★★★ fix-611 §E.2 — PERMIT OWNER IS RETIRED.
          ⚖️ Bobby, 2026-09-30: **"Permit Owner list: RETIRE."**

          ★★ fix-449 built it and said in its own comment why it could not finish
             the job: *"THERE IS NO WRITE SURFACE FOR IT ANYWHERE IN THE APP"* —
             `permits.permit_owner` had three readers and zero writers, so this
             editor named a vocabulary nothing could ever apply. A list that
             cannot be used is a setting that only looks like one.

          ★ LEFT ALONE, and out of scope by §E.2: the `permits.permit_owner`
            column and PermitCard's `ent_lead || permit_owner` fallback. The 158
            values keep rendering exactly where they render today; what goes is
            the pretence that they were editable here. */}

      <SettingsBlock id="zones">
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
          historyConfigKey={ZONE_OPTIONS_KEY}
          testIdPrefix="zones-list"
        />
      </SettingsBlock>

      <SettingsBlock id="product-types">
        <PillListEditor
          label="Types"
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
          placeholder="Add type…"
          emptyState="No types yet. Used on the Project create wizard."
          readOnly={!isAdmin}
          historyConfigKey="productTypeOptions"
          testIdPrefix="product-types-list"
        />
      </SettingsBlock>

      {/* ═══════════════════════════════════════════════════════════════
          ★★★ fix-562 §A (P-268) — THE THREE UNIT-MATRIX VOCABULARIES
          ═══════════════════════════════════════════════════════════════

          Bobby, 2026-09-14: *"the main thing we're trying to identify is …
          how is parking driving that? Is it one-car, two-car, three, four, or
          surface/none?"*

          ★★★ Parking and Stories decode BY SHAPE, so `5-car garage` and `5+B`
              work with no deploy. ★★ fix-619 (gap 18): Roof Deck's three labels
              map onto a (deck, penthouse) pair, and any OTHER entry is now
              stored as its own label — so `isStorableVocabularyEntry` no
              longer marks any roof-deck pill `⚠`. */}
      {/* ★★★ fix-611 §B — ONE CARD, THREE LISTS. Parking, roof deck and
          stories are the three things a UNIT is described by, and they were
          three cards in a column of fourteen. Same three editors, same keys,
          same history links — three sub-headings instead of three titles. */}
      <SettingsBlock id="unit-options">
        <SettingsSubBlock title="Parking">
        <PillListEditor
          label="Unit Parking"
          items={parking.map((o) => ({
            key: o,
            label: o,
            badge: isStorableVocabularyEntry(PARKING_OPTIONS_KEY, o)
              ? undefined
              : '⚠ cannot be stored',
          }))}
          onAdd={(name) => {
            if (parking.includes(name)) return;
            setKey.mutate({ key: PARKING_OPTIONS_KEY, value: [...parking, name] });
          }}
          onRemove={(name) =>
            setKey.mutate({
              key: PARKING_OPTIONS_KEY,
              value: parking.filter((o) => o !== name),
            })
          }
          placeholder="Add parking option…"
          emptyState="No parking options yet. Used by the unit matrix and the Library filter."
          readOnly={!isAdmin}
          historyConfigKey={PARKING_OPTIONS_KEY}
          testIdPrefix="unit-parking-list"
        />
        <div className="text-[10px] text-dim mt-1" data-testid="unit-parking-help">
          Written as <code>N-car garage</code> or <code>Surface / None</code>.
          Anything else cannot be stored against a unit.
        </div>
        </SettingsSubBlock>

        <SettingsSubBlock title="Roof deck">
        <PillListEditor
          label="Unit Roof Deck"
          items={roofDeck.map((o) => ({
            key: o,
            label: o,
            badge: isStorableVocabularyEntry(ROOF_DECK_OPTIONS_KEY, o)
              ? undefined
              : '⚠ cannot be stored',
          }))}
          onAdd={(name) => {
            if (roofDeck.includes(name)) return;
            setKey.mutate({ key: ROOF_DECK_OPTIONS_KEY, value: [...roofDeck, name] });
          }}
          onRemove={(name) =>
            setKey.mutate({
              key: ROOF_DECK_OPTIONS_KEY,
              value: roofDeck.filter((o) => o !== name),
            })
          }
          placeholder="Add roof deck option…"
          emptyState="No roof deck options yet. Used by the unit matrix and the Library filter."
          readOnly={!isAdmin}
          historyConfigKey={ROOF_DECK_OPTIONS_KEY}
          testIdPrefix="unit-roof-deck-list"
        />
        <div className="text-[10px] text-dim mt-1" data-testid="unit-roof-deck-help">
          <code>W/ PH</code>, <code>W/O PH</code> and <code>None</code> also
          record whether there is a deck and a penthouse. Any option you add is
          saved on the unit as you wrote it.
        </div>
        </SettingsSubBlock>

        <SettingsSubBlock title="Stories">
        <PillListEditor
          label="Unit Stories"
          items={stories.map((o) => ({
            key: o,
            label: o,
            badge: isStorableVocabularyEntry(STORIES_OPTIONS_KEY, o)
              ? undefined
              : '⚠ cannot be stored',
          }))}
          onAdd={(name) => {
            if (stories.includes(name)) return;
            setKey.mutate({ key: STORIES_OPTIONS_KEY, value: [...stories, name] });
          }}
          onRemove={(name) =>
            setKey.mutate({
              key: STORIES_OPTIONS_KEY,
              value: stories.filter((o) => o !== name),
            })
          }
          placeholder="Add stories option…"
          emptyState="No stories options yet. Used by the unit matrix and the Library."
          readOnly={!isAdmin}
          historyConfigKey={STORIES_OPTIONS_KEY}
          testIdPrefix="unit-stories-list"
        />
        <div className="text-[10px] text-dim mt-1" data-testid="unit-stories-help">
          Written as a number, optionally <code>+B</code> for a basement —{' '}
          <code>3</code> or <code>3+B</code>.
        </div>
        </SettingsSubBlock>
      </SettingsBlock>

      <SettingsBlock id="project-tags">
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
          historyConfigKey="projectTagOptions"
          testIdPrefix="project-tags-list"
        />
      </SettingsBlock>

      {/* fix-167: Hold Reasons — the dropdown source for putting a project On
          Hold. Phase 1 is data + display only (no calculation effects). */}
      {/* ★★ fix-611 §B — ONE CARD. Why a thing is parked and why it is
          cancelled are the same question at two severities, and fix-262 already
          made cancel a kind of hold in the data. */}
      <SettingsBlock id="hold-and-cancel-reasons">
        <SettingsSubBlock title="Hold reasons">
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
          historyConfigKey="holdReasonOptions"
          testIdPrefix="hold-reasons-list"
        />
        </SettingsSubBlock>

      {/* fix-262: Cancel Reasons — the dropdown source for CANCELLING a project
          ("the step after hold, but before delete"). Deliberately its own list;
          a cancel reason is never a hold reason. */}
        <SettingsSubBlock title="Cancel reasons">
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
          historyConfigKey="cancelReasonOptions"
          testIdPrefix="cancel-reasons-list"
        />
        </SettingsSubBlock>
      </SettingsBlock>

      {/* fix-227: central External Team directory (firms by discipline) that
          feeds the per-project external-team picker's dropdown. */}
      {/* ★★★ fix-611 §B — THE CONSULTANT DIRECTORY MOVED to Permits & tasks,
          into one card with the Waiting-On vocabulary. It was never a project
          list: it is the set of firms a TASK can be waiting on, and fix-606 made
          it read the Waiting-On list for its disciplines. The editor is mounted
          there unchanged, with the same `readOnly` prop. */}
    </div>
  );
}

// ★ fix-611: the local `Section` helper is gone — `SettingsBlock` is the one
//   card chrome now, and it takes its title from the registry rather than from
//   a prop, so a block's name lives in exactly one place.


// ★ fix-611 §E.1: `LearnWindowInput` is deleted — it was the only caller of the
//   per-city window, and the window is retired. See the note at `jurisItems`.
