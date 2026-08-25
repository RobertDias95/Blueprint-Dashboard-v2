// fix-279: the project attributes the corrections corpus can be sliced by.
//
// Its own module, importing NOTHING, on purpose. correctionsReport needs the
// segment definitions to filter, and correctionsPrevalence needs them to break
// prevalence down — if they lived in either of those two, the other would close
// an import cycle. A cycle whose values are only touched inside functions
// happens to work under ES modules, which is exactly what makes it a trap to
// leave in place.
//
// Coverage across the 93 projects with corrections (production, verified):
// units 92 · corner lot 92 · lots 92 · product types 91 · zone 92 ·
// parking 91 · alley 91 · design manager 92 · ENT lead 93 · ACQ lead 89 ·
// jurisdiction 93 — and builder_company at 73, much the weakest. A project
// with nothing recorded lands in an explicit "Not recorded" bucket; it is
// never folded into a real one.

// -------------------------------------------------------------- segmentation --

/** A project attribute the corpus can be sliced by. */
export interface SegmentDef {
  key: string;
  label: string;
  /** The bucket a project falls in, or null when the project does not say.
   *  A project with no value is NEVER silently folded into another bucket —
   *  it gets an explicit "Not recorded" one. */
  valueOf: (p: SegmentProject) => string | null;
  /** Fixed display order where the values have a natural one (unit bands);
   *  omitted means sort by prevalence, then alphabetically. */
  order?: string[];
  /** True when one project can sit in several buckets (product types). Such a
   *  segment's bucket sizes deliberately sum to more than the project count. */
  multi?: boolean;
  valuesOf?: (p: SegmentProject) => string[];
}

/** The project fields segmentation reads. A narrow structural type rather than
 *  the full Project interface, so tests can build one in three lines. */
export interface SegmentProject {
  id: string;
  juris?: string | null;
  units?: number | null;
  num_lots?: number | null;
  is_corner_lot?: boolean | null;
  product_types?: string[] | null;
  zone?: string | null;
  alley?: string | null;
  builder_company?: string | null;
  design_manager?: string | null;
  entitlement_lead?: string | null;
  acq_lead?: string | null;
}

export const NOT_RECORDED = 'Not recorded';

function text(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
}

/** 1 · 2–3 · 4–5 · 6+ — the bands the business talks in. */
export function unitBand(units: number | null | undefined): string | null {
  if (units == null) return null;
  if (units <= 1) return '1';
  if (units <= 3) return '2–3';
  if (units <= 5) return '4–5';
  return '6+';
}

export const UNIT_BAND_ORDER = ['1', '2–3', '4–5', '6+'];

export function lotBand(n: number | null | undefined): string | null {
  if (n == null) return null;
  if (n <= 1) return '1';
  if (n <= 3) return '2–3';
  return '4+';
}

export const SEGMENTS: SegmentDef[] = [
  { key: 'juris', label: 'Jurisdiction', valueOf: (p) => text(p.juris) },
  {
    key: 'units', label: 'Unit band',
    valueOf: (p) => unitBand(p.units), order: UNIT_BAND_ORDER,
  },
  { key: 'num_lots', label: 'Lots', valueOf: (p) => lotBand(p.num_lots), order: ['1', '2–3', '4+'] },
  {
    key: 'is_corner_lot', label: 'Corner lot',
    valueOf: (p) => (p.is_corner_lot == null ? null : p.is_corner_lot ? 'Corner' : 'Mid-block'),
    order: ['Corner', 'Mid-block'],
  },
  {
    key: 'product_types', label: 'Product type', multi: true,
    valueOf: (p) => (p.product_types ?? []).map((t) => t.trim()).filter(Boolean)[0] ?? null,
    valuesOf: (p) => (p.product_types ?? []).map((t) => t.trim()).filter(Boolean),
  },
  { key: 'zone', label: 'Zone', valueOf: (p) => text(p.zone) },
  // ★★★ fix-402 removed the "Parking type" segment. projects.parking_type is
  // archived and cleared — parking is a PER-UNIT property now — so this
  // dimension would have grouped every project under a single "—" bucket and
  // silently made the report useless rather than erroring. That is the fix-122
  // trap in reverse, and it is why this ticket swept the readers.
  //
  // ★ It could return as a UNIT dimension (rollup kind per project), but that
  // is a reporting decision and this ticket is display + library only.
  { key: 'alley', label: 'Alley', valueOf: (p) => text(p.alley) },
  { key: 'builder_company', label: 'Builder', valueOf: (p) => text(p.builder_company) },
  { key: 'design_manager', label: 'Design manager', valueOf: (p) => text(p.design_manager) },
  { key: 'entitlement_lead', label: 'Entitlement lead', valueOf: (p) => text(p.entitlement_lead) },
  { key: 'acq_lead', label: 'ACQ lead', valueOf: (p) => text(p.acq_lead) },
];

export function segmentByKey(key: string): SegmentDef | null {
  return SEGMENTS.find((s) => s.key === key) ?? null;
}

/** Every bucket a project belongs to for this segment. Multi-valued segments
 *  return several; a project with nothing recorded returns exactly one. */
export function segmentValues(seg: SegmentDef, p: SegmentProject): string[] {
  if (seg.multi && seg.valuesOf) {
    const vals = seg.valuesOf(p);
    return vals.length > 0 ? vals : [NOT_RECORDED];
  }
  return [seg.valueOf(p) ?? NOT_RECORDED];
}

