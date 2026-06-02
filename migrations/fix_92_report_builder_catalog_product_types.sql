-- fix-92 hotfix: bp_get_report_builder_catalog still lists product_type
-- (singular text) as a column on the projects entity AND under permits'
-- parent-projects join, but fix-91 dropped that column and replaced it
-- with product_types (text[]). Any custom report built against the
-- projects entity (or against permits that joined the parent project's
-- Product Type column) executes a SELECT that asks for the missing
-- column and fails with:
--   "column projects.product_type does not exist"
--
-- Bobby's prod incident (2026-06-02): /draw-schedule was rendering the
-- error with query key ["projects", "<tenant_id>"]. The query key alone
-- points at useProjects (which is clean — fix-91 already updated its
-- select list), but the underlying failure originates from the catalog
-- RPC's metadata being consumed by the dynamic-query layer.
--
-- This migration is a single CREATE OR REPLACE on the catalog function.
-- Same body, same return shape — just product_type → product_types in
-- the two places it appears + 'text' type → 'text[]' so the report
-- builder UI renders the column as multi-valued.
--
-- Pre-existing latent issues that this hotfix does NOT address (already
-- broken before fix-91, out of scope):
--   - bp_insert_permit references permits.product_type (a column
--     fix-22 Mig 3 dropped from permits long before fix-91).
--   - migrate_to_relational references the same dead permits column.
--   Both are legacy/one-time helpers and aren't reachable from normal
--   app flow. Flag them for a separate cleanup if anyone wants to
--   actually call them.

CREATE OR REPLACE FUNCTION public.bp_get_report_builder_catalog()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object('version',1,'entities', jsonb_build_array(
    jsonb_build_object('key','permits','label','Permits',
      'default_sort', jsonb_build_object('column','target_submit','dir','asc'),
      'columns', jsonb_build_array(
        _rbcol('num','Permit #','text',true,'direct'),
        _rbcol('type','Type','text',true,'direct'),
        _rbcol('ent_lead','Ent Lead','text',true,'direct'),
        _rbcol('da','DA','text',true,'direct'),
        _rbcol('stage','Stage','text',true,'direct'),
        _rbcol('status','Status','text',true,'direct'),
        _rbcol('corr_rounds','Corr Rounds','number',true,'direct'),
        _rbcol('expected_issue','ACQ Target','date',true,'direct'),
        _rbcol('target_submit','Target Submit','date',true,'direct'),
        _rbcol('actual_issue','Actual Issue','date',true,'direct'),
        _rbcol('approval_date','Approval Date','date',true,'direct'),
        _rbcol('intake_date','Intake Date','date',true,'direct'),
        _rbcol('dd_start','DD Start','date',true,'direct'),
        _rbcol('dd_end','DD End','date',true,'direct'),
        _rbcol('nickname','Nickname','text',true,'direct'),
        _rbcol('struct_address','Structure Address','text',true,'direct'),
        _rbcol('portal_url','Portal URL','text',false,'direct'),
        _rbcol('project.address','Project Address','text',true,'parent.projects'),
        _rbcol('project.juris','Jurisdiction','text',true,'parent.projects'),
        _rbcol('project.acq_lead','ACQ Lead','text',true,'parent.projects'),
        _rbcol('project.go_date','GO Date','date',true,'parent.projects'),
        _rbcol('project.units','Units','number',true,'parent.projects'),
        -- fix-92 hotfix: was product_type (text). fix-91 dropped that
        -- column in favor of product_types (text[]).
        _rbcol('project.product_types','Product Types','text[]',true,'parent.projects'))),
    jsonb_build_object('key','projects','label','Projects',
      'default_sort', jsonb_build_object('column','go_date','dir','desc'),
      'columns', jsonb_build_array(
        _rbcol('address','Address','text',true,'direct'),
        _rbcol('juris','Jurisdiction','text',true,'direct'),
        _rbcol('acq_lead','ACQ Lead','text',true,'direct'),
        _rbcol('entitlement_lead','Entitlement Lead','text',true,'direct'),
        _rbcol('design_manager','Design Manager','text',true,'direct'),
        _rbcol('go_date','GO Date','date',true,'direct'),
        _rbcol('units','Units','number',true,'direct'),
        _rbcol('zone','Zone','text',true,'direct'),
        _rbcol('lot_width','Lot Width','number',true,'direct'),
        _rbcol('lot_depth','Lot Depth','number',true,'direct'),
        _rbcol('parking_type','Parking Type','text',true,'direct'),
        _rbcol('parking_stalls','Parking Stalls','number',true,'direct'),
        -- fix-92 hotfix: was product_type (text). fix-91 dropped that
        -- column in favor of product_types (text[]).
        _rbcol('product_types','Product Types','text[]',true,'direct'),
        _rbcol('builder_name','Builder','text',true,'direct'),
        _rbcol('archived','Archived','boolean',true,'direct'),
        _rbcol('created_at','Created','date',true,'direct'))),
    jsonb_build_object('key','permit_cycles','label','Permit Cycles',
      'default_sort', jsonb_build_object('column','corr_issued','dir','desc'),
      'columns', jsonb_build_array(
        _rbcol('cycle_index','Cycle #','number',true,'direct'),
        _rbcol('submitted','Submitted','date',true,'direct'),
        _rbcol('intake_accepted','Intake Accepted','date',true,'direct'),
        _rbcol('resubmitted','Resubmitted','date',true,'direct'),
        _rbcol('city_target','City Target','date',true,'direct'),
        _rbcol('corr_issued','Corr Issued','date',true,'direct'),
        _rbcol('permit.num','Permit #','text',true,'parent.permits'),
        _rbcol('permit.type','Permit Type','text',true,'parent.permits'),
        _rbcol('permit.ent_lead','Ent Lead','text',true,'parent.permits'),
        _rbcol('permit.da','DA','text',true,'parent.permits'),
        _rbcol('project.address','Project Address','text',true,'parent.projects'),
        _rbcol('project.juris','Jurisdiction','text',true,'parent.projects'))),
    jsonb_build_object('key','permit_cycle_reviewers','label','Permit Cycle Reviewers',
      'default_sort', jsonb_build_object('column','last_event_date','dir','desc'),
      'columns', jsonb_build_array(
        _rbcol('discipline','Discipline','text',true,'direct'),
        _rbcol('reviewer_name','Reviewer','text',true,'direct'),
        _rbcol('current_status','Status','text',true,'direct'),
        _rbcol('last_event_date','Last Event','date',true,'direct'),
        _rbcol('cycle_index','Cycle #','number',true,'direct'),
        _rbcol('permit.num','Permit #','text',true,'parent.permits'),
        _rbcol('permit.type','Permit Type','text',true,'parent.permits'),
        _rbcol('project.address','Project Address','text',true,'parent.projects'),
        _rbcol('project.juris','Jurisdiction','text',true,'parent.projects'))),
    jsonb_build_object('key','draw_schedule','label','Draw Schedule',
      'default_sort', jsonb_build_object('column','dd_start','dir','asc'),
      'columns', jsonb_build_array(
        _rbcol('da_assigned','DA Assigned','text',true,'direct'),
        _rbcol('status','Status','text',true,'direct'),
        _rbcol('start_week','Start Week','text',true,'direct'),
        _rbcol('end_week','End Week','text',true,'direct'),
        _rbcol('dd_start','DD Start','date',true,'direct'),
        _rbcol('dd_end','DD End','date',true,'direct'),
        _rbcol('notes','Notes','text',true,'direct'),
        _rbcol('project.address','Project Address','text',true,'parent.projects'),
        _rbcol('project.juris','Jurisdiction','text',true,'parent.projects')))));
$function$;
