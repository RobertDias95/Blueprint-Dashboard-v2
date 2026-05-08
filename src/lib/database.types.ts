// Q2: Hand-typed row shapes for the tables v2 reads. Narrow on purpose —
// we type the columns the read paths actually consume. Write paths in Q3+
// will tighten unknown[] payloads to typed mutation inputs.
//
// Field names mirror the Supabase schema exactly (snake_case). UI helpers
// translate to camelCase where useful, but the wire format stays canonical.

export type Stage = 'de' | 'pm' | 'co' | 'ap' | 'is';

export interface Project {
  id: string;
  address: string;
  juris: string | null;
  archived: boolean;
  notes: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PermitCycle {
  id: number;
  permit_id: number;
  cycle_index: number;
  submitted: string | null;
  city_target: string | null;
  corr_issued: string | null;
  resubmitted: string | null;
  intake_accepted: string | null;
}

export interface Permit {
  id: number;
  project_id: string;
  type: string | null;
  stage: string | null;
  stage_override: string | null;
  status: string | null;
  num: string | null;
  da: string | null;
  dm: string | null;
  ent_lead: string | null;
  dual_da: string | null;
  go_date: string | null;
  target_submit: string | null;
  dd_start: string | null;
  dd_end: string | null;
  expected_issue: string | null;
  actual_issue: string | null;
  approval_date: string | null;
  intake_date: string | null;
  units: number | null;
  notes: string | null;
  cycle_model: string | null;
  view_cycle: number | null;
  kickoff_date: string | null;
  zone: string | null;
  product_type: string | null;
  project_tags: unknown;
  unit_types: unknown;
  parking_type: string | null;
  parking_stalls: number | null;
  corr_rounds: number | null;
  permit_owner: string | null;
  architect: string | null;
  nickname: string | null;
  struct_address: string | null;
  portal_url: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Permit with cycles attached via Supabase nested select. */
export interface PermitWithCycles extends Permit {
  permit_cycles: PermitCycle[];
}

export interface PermitTask {
  id: number;
  permit_id: number;
  bucket: string | null;
  text: string | null;
  cat: string | null;
  start_date: string | null;
  due_date: string | null;
  target_date: string | null;
  done: boolean;
  completion_status: string | null;
  assigned_to: string | null;
  stage: string | null;
  cycle_idx: number | null;
  sort_order: number | null;
}

export interface DrawScheduleRow {
  project_id: string;
  da_assigned: string | null;
  start_week: string | null;
  end_week: string | null;
  status: string | null;
  manual_status: string | null;
  manually_placed: boolean | null;
  dd_start: string | null;
  dd_end: string | null;
  notes: string | null;
  color_override: string | null;
  status_override: string | null;
}

export interface IntakeRecord {
  id: number;
  juris: string | null;
  permit_num: string | null;
  address: string | null;
  applicant: string | null;
  intake_date: string | null;
  status: string | null;
  notes: string | null;
  raw: unknown;
  created_at?: string | null;
  updated_at?: string | null;
}
