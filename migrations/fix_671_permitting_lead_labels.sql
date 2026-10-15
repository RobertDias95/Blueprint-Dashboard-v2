-- fix-671 (P-352): the last "Entitlement" words on screen become "Permitting".
--
-- DISPLAY TEXT ONLY. Three live functions carry a user-visible string that
-- still says "entitlement lead"; each is patched by ANCHOR on its live text
-- (fix-410 style — never retyped), and each anchor must match exactly once.
--
--   bp_get_report_builder_catalog    the Report Builder column LABEL
--                                    'Entitlement Lead' -> 'Permitting Lead'.
--                                    ★ The KEY 'entitlement_lead' is unchanged:
--                                      saved reports reference it.
--   bp_acknowledge_permit_condition  its refusal sentence
--   bp_upsert_da_team_routing_row    its refusal sentence
--
-- No stored value changes: the 'Entitlements' team, the entitlement_lead
-- column and key, and every row stay exactly as they are.

DO $mig$
DECLARE
  r record;
  v_def text;
  v_new text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('bp_get_report_builder_catalog',
       $a$_rbcol('entitlement_lead','Entitlement Lead',$a$,
       $b$_rbcol('entitlement_lead','Permitting Lead',$b$),
      ('bp_acknowledge_permit_condition',
       $a$only the permit''s entitlement lead or an admin may acknowledge$a$,
       $b$only the permit''s permitting lead or an admin may acknowledge$b$),
      ('bp_upsert_da_team_routing_row',
       $a$'an entitlement lead is required'$a$,
       $b$'a permitting lead is required'$b$)
    ) AS t(fn, anchor, repl)
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO STRICT v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = r.fn;

    IF (length(v_def) - length(replace(v_def, r.anchor, ''))) / length(r.anchor) <> 1 THEN
      RAISE EXCEPTION 'fix-671: anchor not found exactly once in %', r.fn;
    END IF;

    v_new := replace(v_def, r.anchor, r.repl);
    EXECUTE v_new;
  END LOOP;
END
$mig$;
