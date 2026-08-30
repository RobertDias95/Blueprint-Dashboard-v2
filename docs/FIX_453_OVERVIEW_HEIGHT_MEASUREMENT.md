# fix-453 — the overview row's height ceiling, measured (P-080)

**★★★ THIS TICKET SHIPS A MEASUREMENT AND NO UI CHANGE.** The brief said the
measurement might end the ticket and named a measure-only PR a good outcome,
"exactly as fix-450 was". It ended the ticket. Two of the three things the
brief's scope depended on turned out not to be true.

Everything below was measured in Chrome against a harness that imports the
**real** `OverviewCard` / `OverviewSection` primitives and the **real**
`OVERVIEW_GRID_TEMPLATE` / `OVERVIEW_GRID_AREAS` / `OVERVIEW_ROW_RESPONSIVE_CSS`,
with every interior rebuilt from the class strings in `ProjectDetailHeader.tsx`.
It was rebuilt in the style of the fix-451/452 repo-root Vite harness —
**fix-423's harness was never committed to this repo** (`git log --all
--diff-filter=A -- '*harness*'` returns nothing), so there was nothing to
restore.

---

## 0c — CONFIRMED: five cards, one grid row, height is a MAX

`ProjectDetailHeader.tsx:238-245` sets `alignItems: 'stretch'` on a container
whose `OVERVIEW_GRID_AREAS` is a **single-row** template string built from
`OVERVIEW_CARD_COLUMNS`, and every cell carries `height: '100%'`. So the row is
as tall as its tallest card and every other card is padded out to match. That is
the premise the whole ticket rests on and it holds.

## 0d — DEAD: P-080's premise is gone

P-080 was raised against a **label-above-control stack** that could be two-upped.
There is no such stack left. Every field in the PROJECT card is
`flex items-baseline gap-1.5` — the label sits **beside** the value:

```tsx
<div className="flex items-baseline gap-1.5">
  <span className="text-[9px] text-dim min-w-[36px]">Units</span>
```

The brief anticipated this: *"If they are, say so plainly — P-080's premise dies
there and the remaining candidates are row PADDING, the section headers, and
Milestones."* Measured below, row padding is not the problem either: a PROJECT
row is **20px** and a Milestones row is **23px**, which is this app's normal
line, not padding.

## 0e — prod shape distribution, re-derived 2026-08-30

The brief's 143-of-196 figure is from 08-27. Prod now holds **202** projects and
the proportion is unchanged:

| | projects | share |
|---|---:|---:|
| no external team | **149** | 74% |
| has external team | 53 | 26% |
| 0–1 unit types | **114** | 56% |
| 2–3 unit types | 78 | 39% |
| 4–6 unit types | 10 | 5% |

Joint, which is what actually sets a row height:

| | 0–1 types | 2–3 types | 4–6 types |
|---|---:|---:|---:|
| **no external** | **92** | 50 | 7 |
| **has external** | 22 | 28 | 3 |

Max unit types = 6, max external roles = 6. The modal project is
**no-external / 0–1 unit types — 92 of 202.**

---

## 0a — natural card heights (the row is the MAX of these)

Natural = each card cloned into an auto-height box of its own resolved width, so
the stretch is removed and the card's own content height is what is read.

### At 1920px (row 1350px, one line — `OVERVIEW_ROW_MIN_WIDTH` is 1218)

| shape | Milestones | **PROJECT** | Team | Plan of Record | Builder | **row** |
|---|---:|---:|---:|---:|---:|---:|
| A · no ext / 1 type | 412 | **424** | 159 | 92 | 305 | **424** |
| B · no ext / 6 types | 412 | **544** | 159 | 92 | 305 | **544** |
| C · 5 ext / 3 types | 412 | **472** | 237 | 92 | 305 | **472** |

### At 1440px (row 870px — below 1218, so the row has WRAPPED)

Plan of Record and Builder drop to line two; the three cards on line one still
set the tall line.

| shape | Milestones | **PROJECT** | Team | line 2 | **line 1** |
|---|---:|---:|---:|---:|---:|
| A | 412 | **424** | 159 | 305 | **424** |
| B | 412 | **544** | 159 | 305 | **544** |
| C | 412 | **472** | 237 | 305 | **472** |

**PROJECT is still the ceiling, in every shape, at both widths.** That half of
the brief is confirmed. Milestones is second in every shape, and at the modal
shape it is **12px** behind.

## 0b — bands, which is the number that decides the scope

### PROJECT (424 at shape A)

| band | px |
|---|---:|
| banner | 27 |
| Proposal | 112 |
| **Site** | **148** |
| Unit dimensions | 93 (1 type) · 213 (6 types) |
| Connect | 42 |

Site is the biggest fixed band: five rows of 20px with 4px gaps = 116px of body,
plus a 21px heading and 10px of section padding. Unit dimensions costs
**+24px per unit type** — 93px at one type, 213px at six.

### Milestones (412, identical in every shape)

| band | px |
|---|---:|
| banner | 27 |
| Key dates (2 rows) | 83 |
| **DD window (5 rows + divider)** | **175** |
| Permit intake (2 rows) | 83 |
| Draw schedule link | 42 |

Nine date rows at 23px each and four 21px headings. Milestones does not vary
with the data at all — it is 412 on every project.

---

## ★★★ THE FINDING THAT ENDS THE TICKET: MILESTONES CANNOT BE COMPRESSED

The brief's scope was gated on taking PROJECT **and** Milestones together. Only
one of them can move.

A Milestones row is a label plus a date box, and its minimum is declared, not
guessed — `MILESTONE_ROW_MIN_WIDTH` in `lib/overviewCardLayout`:

```
80 (label) + 6 (gap) + 14 (box chrome) + 100 (date input) = 200px
```

A two-column Milestones therefore needs **≥ 408px** of card. The Milestones card
never gets close, at any viewport this app supports:

| viewport | row width | Milestones card | two-up needs |
|---:|---:|---:|---:|
| 1920 | 1350 | **222** | 408 |
| 1600 | 1030 | **222** | 408 |
| 1440 | 870 | **222** (272 wrapped) | 408 |
| 1280 | 710 | **222** | 408 |

It sits on its 222px floor everywhere below a 1788px viewport
(`overviewMinViewport()`), and 222 is barely above one row's own 200px minimum.
**There is no width at which a second column fits.** The only other way to
shorten the card is to delete a date field, and all nine are live.

So Milestones' **412px is a floor**, and no work on the PROJECT card can take the
row below it.

## What PROJECT could still lose, measured

The one compressible band is Site, using fix-423's own proven pattern — two
wrapping flex columns with a declared minimum, which sit side by side when the
card can hold them and stack when it cannot. Measured, applied to the Site body
only:

| shape | Site before | Site after | PROJECT before | PROJECT after | **row before** | **row after** |
|---|---:|---:|---:|---:|---:|---:|
| A · 1 type | 148 | **100** | 424 | 376 | 424 | **412** |
| B · 6 types | 148 | **100** | 544 | 496 | 544 | **496** |
| C · 3 types | 148 | **100** | 472 | 424 | 472 | **424** |

The columns resolve **side by side at both 1920 and 1440** (measured: 133px each
at 1920, 168px each at 1440 — against a 110px declared minimum).

Read the last two columns honestly:

- The **PROJECT card** reliably loses **48px** in every shape.
- The **row** loses 48px only where PROJECT stays above 412 — i.e. projects with
  **≥ 2 unit types, 88 of 202**.
- For the **114 projects with 0–1 unit types**, including the modal 92, the row
  drops **424 → 412 and stops**, because Milestones is waiting there. **12px.**

## Recommendation for Bobby

**Nothing shipped, because the brief's own threshold is not met.** Its clause E
says to ship the measurement when *"the two are within ~20px of each other and
neither can lose 50px without removing a field"*. Measured: the two are **12px**
apart at the modal shape; Milestones can lose **nothing** without deleting a
date; and PROJECT's single available cut is **48px** — under the 50px bar, and
worth only 12px of row on the majority of projects.

The Site two-up above is measured, structurally safe and reuses a pattern
already shipped in the Team card. It is offered as a ruling, not taken as one —
P-080's premise died with 0d, so there is no standing decision behind a change to
the Site band. If Bobby wants it, the honest description is: **the PROJECT card
gets 48px shorter everywhere, and the overview row gets 48px shorter on the 88
projects with two or more unit types and 12px shorter on the rest.**

The real ceiling after any such change is **Milestones at 412px**, and that
number cannot move while the card is 222px wide and holds nine dates.
