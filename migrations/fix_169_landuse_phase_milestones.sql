-- fix-169 (2026-06-16): land-use phase model — middle-phase milestone columns
-- + report-builder fields (Fix B foundation).
--
-- Seattle land-use records (*-LU: ULS / LBA / short-plat; scraper fix-77 now
-- captures their review cycles) have a MIDDLE PHASE between initial reviews and
-- final reviews that the cycle layer doesn't model: after reviews complete →
-- Design Review → Decision Published → ~2-week public publication window →
-- (final reviews resume the cycle history) → Recorded/Issued.
--
-- Bobby's model: that middle phase is MILESTONE DATES + a derived phase badge,
-- NOT cycles. This migration adds the three nullable, LU-only milestone date
-- columns; the v2 deriver + badge read them (src/lib/landUsePhase.ts). The
-- columns stay NULL until the scraper populates them (fix-78, scraper repo) — the
-- badge falls back to the cycle-derived phase until then. One model, phases
-- optional per subtype (LBA's short tail just leaves later milestones null).
--
-- Storage choice: nullable date columns on `permits`, matching the existing
-- dd_start / approval_date / intake_date convention (read directly by the
-- deriver + projectedApproval/seeding). No new table — these are 1:1 with a
-- permit and sit naturally beside the other permit milestone dates.
--
-- Applied to prod via MCP. Repo-of-record backstop.

-- A. Milestone columns (nullable; non-LU permits leave them NULL).
ALTER TABLE public.permits
  ADD COLUMN IF NOT EXISTS design_review_date      date,
  ADD COLUMN IF NOT EXISTS decision_published_date date,
  ADD COLUMN IF NOT EXISTS publication_end_date    date;

COMMENT ON COLUMN public.permits.design_review_date IS
  'fix-169: land-use Design Review milestone (LU permits only; NULL otherwise).';
COMMENT ON COLUMN public.permits.decision_published_date IS
  'fix-169: land-use Decision Published milestone — opens the public publication window.';
COMMENT ON COLUMN public.permits.publication_end_date IS
  'fix-169: land-use publication-window close (~2 weeks after decision_published_date).';

-- D. Report-builder catalog — expose the 3 milestone dates as filterable
-- permit date fields. Re-emitted from the LIVE def (pg_get_functiondef — canon)
-- with only the three _rbcol() lines added to the permits entity. The DERIVED
-- land-use phase string is NOT exposed here (it would require replicating the
-- client deriver in SQL) — deferred to a later phase.
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
        _rbcol('design_review_date','Design Review','date',true,'direct'),
        _rbcol('decision_published_date','Decision Published','date',true,'direct'),
        _rbcol('publication_end_date','Publication End','date',true,'direct'),
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
