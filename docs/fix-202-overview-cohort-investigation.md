# fix-202 — Reports Overview comparison cohort: Step-0 investigation

Status: **investigation + report only.** No cohort change in this PR — the fix
shifts every Overview comparison number, so it waits for Bobby's sign-off. The
maturity-guard treatment (caveat badge vs suppress vs "n=" label) is also a
sign-off decision.

Probed against prod (`eibnmwthkcuumyclyxoe`) on 2026-06-24, reproducing Bobby's
case: **Building Permit + Seattle**, current `2026-03-01 … 2026-06-30` vs
comparison `2025-09-30 … 2025-12-31`.

---

## 1. The real current basis — and the 14/25 reconciliation

The Reports Overview comparison cohort is built by **`filterEnrichedPermits`**
(`src/lib/reportMetrics.ts`), called twice from `ReportsOverviewTab.tsx` — once
for the current window, once for the comparison window (same function, different
`dateFrom/dateTo`). Its date gate is **already `go_date`** (the project's GO date,
carried on the enriched permit as `e.goDate`):

```ts
// reportMetrics.ts — filterEnrichedPermits
if (from && e.goDate) {
  if (new Date(`${e.goDate}T00:00:00`) < from) return false;
}
if (to && e.goDate) {
  if (new Date(`${e.goDate}T00:00:00`) > to) return false;
}
```

**The bug:** the exclusion is gated on `e.goDate` being truthy. A permit whose
project has **NO go_date is never excluded** — it passes *every* window. So the
same null-go_date permits land in BOTH the current and the comparison cohort.

Prod reconciliation (BP + Seattle, non-sub permits):

| | count |
|---|---|
| go_date in current window (Mar–Jun 2026) | **9** |
| go_date in comparison window (Sep–Dec 2025) | **20** |
| **null go_date (leak — appears in every window)** | **5** |
| current as shown = 9 + 5 | **14** ✓ |
| comparison as shown = 20 + 5 | **25** ✓ |

So the page's **14 / 25 is "go_date-in-window OR go_date-null."** It matches
neither submitted-/intake-/approval-in-window because the intended basis *is*
go_date — it's just polluted by the 5 null-go_date permits.

> Contrast: Trends (`perfTrends.filterPermits`, fix-200) gates the SAME way but
> **excludes** null-go_date (`const go = …; if (!go) return false`). The Overview
> selector was never given that exclusion.

The 5 leaked permits are real, finished BP permits whose projects carry no
go_date (e.g. `7093595-CN` 6505 21st Ave NW, approved 2025-12-22; `7121097-CN`
4120 49th Ave S **[Redesign 1]**, approved 2026-06-22 — redesigns commonly have
no go_date). They are the **same 5 rows added to both periods**.

## 2. Per-metric denominators + the maturity bias

`computeMetrics`'s `avg()` helper filters out `null` per-permit values before
averaging — so each completion metric **silently drops permits that haven't
reached its end date**, shrinking that metric's denominator independently of
Total Permits. The gates:

- **Avg Permit Timeline** (`intake_accepted → approval`): needs `c0.intake_accepted`
  AND `(approval_date ?? actual_issue)`, span ≥ 0.
- **Avg Approval → Issue**: needs `approval_date` AND `actual_issue`.
- **Avg City Review / Response Time** (`cityCourtTimeDays` / `responseCourtTimeDays`):
  need complete review-cycle arcs (City Review needs ≥1 closed review cycle;
  Response needs ≥2 with completed round-trips).

Sample sizes for the two windows (BP + Seattle; "proper" = go_date-in-window,
excluding the leak; "as shown" = current behaviour incl. the leak):

| cohort | permits | reached approval | timeline n | **avg timeline** | approval→issue n |
|---|---|---|---|---|---|
| **CURRENT proper** (GO Q1–Q2 2026) | 9 | **0** | **0** | **— (no data)** | 0 |
| CURRENT as shown (GO \| null) | 14 | 5 | 5 | **139d** | 4 |
| **COMPARISON proper** (GO Q3–Q4 2025) | 20 | 5 | 5 | 118d | 3 |
| COMPARISON as shown (GO \| null) | 25 | 10 | 10 | **129d** | 7 |

**This is the whole story behind "the recent quarter reads slower":**

- The **real recent GO cohort (9 permits) has 0 reaching approval** → Avg Permit
  Timeline's real recent sample is **n = 0**. The recent quarter has produced no
  completed-timeline data yet (those projects are still in flight).
- The page's "current = **139d**" is therefore computed **entirely from the 5
  leaked null-go_date stragglers** (old permits that finally got approved — hence
  slow). It is NOT the recent GO cohort at all.
- The page's "comparison = 129d (n=10)" = 5 proper-Q4 permits (118d) **+ the same
  5 leaked stragglers (~139d)**, blended.

So "current 139d slower than comparison 129d" is an artifact of (a) the null-leak
injecting the same slow stragglers into both periods and (b) the recent cohort
being too immature to have any real completion data. It contradicts Bobby's sense
the team sped up because **there is no recent-cohort signal to read** — and the
number shown is borrowed from undated old permits.

## 3. Scope — is the cohort logic shared?

`filterEnrichedPermits` is called **only** by `ReportsOverviewTab.tsx` (current +
comparison) and its test. No other surface uses it; Trends uses its own
`perfTrends.filterPermits`. So a fix is **scoped to the Reports Overview** — it
won't touch Trends, Benchmarks, Team Performance, or anything else.

---

## Proposed change — FOR SIGN-OFF (not built here)

**A. Fix the null-go_date leak → make the Overview properly GO-anchored.**
Exclude permits whose project has no go_date from a windowed cohort (match Trends
fix-200): when a date window is active, `go_date === null` ⇒ out. Effect on the
reproduced case: current **14 → 9**, comparison **25 → 20**, and the timeline
metrics stop borrowing the 5 undated stragglers. The recent quarter would then
honestly show **n = 0** for completion metrics (no finished permits yet) rather
than a misleading 139d.

> Caveat to confirm: this is GO-anchoring + null-exclusion in one. It shifts
> EVERY Overview comparison number (and the single-period numbers when a date
> range is active). That's why it needs sign-off.

**B. Maturity / small-sample guard.** On each completion metric, surface the
**sample size feeding it** (n of cohort) and flag/caveat when a period's sample is
too small or too immature to compare — so "139d on n=5" (or "118d on n=5 of 20")
isn't read as a trend, and "n=0" reads as "no data yet," not "0d." Treatment
options to pick with Bobby:

1. **`n=` label** on each metric card (smallest change, non-behavioral — could
   ship on its own ahead of the cohort fix; it just exposes the denominator).
2. **Caveat badge** ("low sample" / "immature cohort") when `n < threshold` or
   when the cohort is recent and mostly unfinished.
3. **Suppress** the number (show "—, n too low") below a threshold.

Recommendation: ship **A + B(1)** together once signed off — the leak fix makes
the cohort honest, and the n= label makes the remaining small-sample reality
visible. B(2)/B(3) are a follow-up polish.

**Why not shipped now:** A is behavioral (shifts every comparison number) and B's
exact treatment is a Bobby decision — both explicitly gated on sign-off. This PR
is report-only.
