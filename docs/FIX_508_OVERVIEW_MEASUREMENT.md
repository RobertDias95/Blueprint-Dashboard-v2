# fix-508 — the Project Overview, redrawn and re-measured

**Measured 2026-09-09 in Chrome against the live app** (`npm run dev`, signed
in, ribbon expanded), on `233 31st Ave E` (2 units · **6 consultants** · 6
permits) and `403 W Dravus St` (6 units · **3 consultants**). The derived half
is computed by `src/__tests__/Fix508Numbers.test.ts` from the same modules the
app renders from, so this document and the code cannot drift.

---

## 0 — the finding that makes the rest of the ticket small

Two earlier fix-508 briefs were written and **both were void**. Each was hunting
the **77px** fix-507 reported as the gap between what the Site/Dates pair needs
(475) and what the Project card gets at 1600 — one by tightening the pair, one
by narrowing the permits rail into deeper truncation.

> ★★★ **296 of that 475 was the Dates card, and the Dates card was a two-by-two
> quadrant grid.** Two label tracks and two date tracks side by side. One column
> of the same rows is **156**.

| | before | after | |
|---|---:|---:|---|
| Site data | 169 | **154** | §A drops ` derived`; the binding row changes |
| Dates card | 296 | **156** | §B makes it one column |
| **the pair** | **475** | **320** | |
| units matrix, 6 types | 332 | **267** | §C's padding |
| Project's floor | 354 | **330** | and the **pair** binds it now, not the matrix |

**The deficit was a fact about the drawing, not about the shell.** It is not
closed here; it is withdrawn. None of fix-507's three levers was spent: the rail
stays at 190, the pill floor falls out of §F1's reshape rather than being cut,
and the pair shrank by being redrawn.

→ `do-not-brief-a-layout-that-is-still-being-redesigned`

---

## 1 — the row, before and after

Heights are **natural** heights (measured with `align-items: start` and the
cells' `height:100%` released — fix-423's method). The row's height is the MAX
of the three.

### 1920 viewport, ribbon expanded — row 1385, unchanged

| | before | after |
|---|---|---|
| Plan of Record | 486 w · 428 h | **486 w · 428 h** |
| Project | 478 w · 605 h | **382 w · 617 h** |
| Team | 403 w · 763 / 611 h | **497 w · 574 h** |
| **row height** | **763 / 611** | **617 / 574** |
| Site beside Dates | ✓ (by 1px of margin) | **✓ by 60px** |
| Team's three columns | ✓ | **✓** |
| consultant band (6) | 337 — wrapped to 4 pill-lines | **213 — the ruled 3+3** |
| top of Schedule Health | 781 / 629 | **635 / 592** |

*(two figures = `233 31st Ave E` · `403 W Dravus St`; one figure = both)*

### 1600 viewport, ribbon expanded — row 1065, unchanged

| | before | after |
|---|---|---|
| Plan of Record | 371 w · 428 h | **486 w · 428 h** |
| Project | 366 w · 780 / 723 h | **328 w · 617 / 557 h** |
| Team | 308 w · 801 / 649 h | **231 w · 797 / 638 h** |
| **row height** | **801 / 723** | **797 / 638** |
| Site beside Dates | ✗ stacked | **✓ by 8px** |
| Team's three columns | ✓ | **✓ by 18px** |
| top of Schedule Health | 819 / 741 | **815 / 656** |

★ **1600 is where the Plan of Record's new floor is paid for.** It takes 115px
that used to go to Team (371 → 486), and Team absorbs it — 308 → 231 — without
losing its three-column grid, because §F4 re-derived the chat cell's minimum
(see §4). The row height barely moves on the six-consultant project and falls
85px on the other.

### Is Schedule Health above the fold?

The pane's visible height is **`viewport − 238`**, measured.

| viewport | pane | `403 W Dravus St` | `233 31st Ave E` |
|---|---:|---|---|
| **1920 × 1080** | 842 | SH top **592** → ✓ whole table (592 + 162 = 754) | SH top **635** → ✓ top visible, 207px of a 370px table |
| 1920 × 855 (maximised Chrome on a 1080 screen) | 617 | **592 → ✓ visible**, first time | 635 → ✗ by 18px |

★ `403 W Dravus St` clears the fold at the **real** maximised-Chrome viewport
for the first time — fix-507 left it 12px short. `233 31st Ave E` is 18px away,
and the 370px table it is trying to reach is six permits deep.

---

## 2 — fix-417 retired: a floor, not a rank

**D-2026-09-09-plan-of-record-keeps-a-floor-not-a-rank.**

Bobby's two constants, verified as asked:

```
POR_CARD_WIDTH_AT_REFERENCE   485
  − PROJECT_CARD_CHROME        22
  = image                     463
  ÷ 1.54525   (1400×906, 159 of 164 indexed plans)
  = 299.63    → POR_IMAGE_MAX_HEIGHT 300          ✓ as fix-507b shipped it

inverting: 300 × 1.54525 + 22 = 485.6            → PLAN_OF_RECORD_CARD_MIN 486
```

★ **The floor comes back 486, one pixel above the 485 reference**, because the
cap rounded up. Reported rather than smoothed: the floor takes the derived
number, so the two constants now check each other.

★★ **Confirmed in Chrome at eight card widths from 380 to 620: the image box is
300px at every one of them.** So 485 is the only width where the sheet exactly
fills it — below, the drawing shrinks inside a fixed box; above, `object-fit:
contain` letterboxes it and the extra width is white space.

**The three widths at 1920: Plan of Record 486 · Project 382 · Team 497.** Team
is the widest card. That is the ruling, not a violation.

| | before | after |
|---|---|---|
| shares | 35.5 / 35 / 29.5 | **35.5 / 28 / 36.5** |
| floors | 368 / 354 / 162 | **486 / 330 / 160** |
| row minimum | 904 | **996** |
| unwrapped from | 1439 | **1531** |

★ **1440 wraps again.** fix-507 won it by a single pixel; this spends it and 91
more. 1600 and 1920 both still run on one line.

★ **Team's floor is 160 again**, not 162 — §F1 takes the pill floor to 96, so
`CONSULTANT_BAND_MIN_WIDTH + chrome` (118) no longer beats fix-423's 160.

---

## 3 — the re-derived floors, and the row that binds each

| constant | before | after | what binds it now |
|---|---:|---:|---|
| `SITE_DATA_MIN_WIDTH` | 169 | **154** | `Lot 100 × varies` — 134 |
| `DATES_CARD_MIN_WIDTH` | 296 | **156** | `Estimated intake` + a mono date — 136 |
| `UNIT_MATRIX_TYPE_COL` | 45 | **36** | `Unit` — the wrapped ordinal, 28 |
| `UNIT_MATRIX_LABEL_COL` | 62 | **51** | `Roof deck` — 47 |
| `PROJECT_CARD_MIN_WIDTH` | 354 | **330** | the **pair** (320 + border + 8 margin) |
| `CONSULTANT_PILL_COMPACT_MIN` | 140 | **96** | the two printed dates — 78 |
| `TEAM_GRID_CHAT_MIN` | 150 | **103** | the `Chat · N →` button — 83 |
| `PLAN_OF_RECORD_CARD_MIN` | 368 (a pin) | **486** | its own capped sheet |

### Site — the row that binds changes, and the one that would

Measured with ` derived` gone, at each row's widest **realisable** content:

```
Lot        100 × varies      134   ← binds
Zone       MIO-37-LR3        119   ← the widest that EXISTS on prod today
Lot        100 × 125         116
Lot size   11,504 sf         116
Tags · Corner · Alley · Units  ≤ 80
```

★ **`100 × varies` is reachable but unoccupied**: `lotSizeView` prints `varies`
when a project has a typed lot size and exactly one of width/depth, and
**measured on prod, zero projects are in that state**. The floor covers it
anyway (fix-422: the widest content the card *can* hold) and the 15px it costs
is recorded rather than argued.

### The units matrix — the ordinal may wrap, and may never truncate

Measured at the `normal` 10px face:

```
value, widest (1,850 · 31.75)       24
Unit 6, whole                       38
Unit 6, wrapped — widest line Unit  28   ← what the floor holds
Roof deck                           47
```

★★ **That one decision is the difference between a 36px column and a 50px one**
— 84px of Project card at six units. Two short lines reading `Unit` / `6`
identify the column exactly as well as one line does; `Uni…` would not. Above
the floor — every width from a 1600 viewport up — the table stretches and the
header sits on one line.

### The consultant pill — the floor is what cannot reflow

§F1 splits the pill into three lines, so the firm no longer shares line 2 with a
58px status button. fix-506's `status + gap + firm` term disappears and only the
two printed dates are incompressible.

★★ **The alternative was measured and refused**: flooring at line 1 — the widest
in-use discipline (`Landscape`, 91) un-truncated, plus the status button — is
**171**, which puts three pills at 513 against the 475 the Team card gets even
after this ticket's re-share. The band would wrap at every width and the reshape
would cost the height it exists to save.

---

## 4 — the residual Bobby asked me to report

**There isn't one.** With the Plan of Record on its 486 floor, Team gets **231**
at 1600, and its three-column grid needs **213** — clear by 18px.

★★★ **It only clears because §F4 changed what the chat cell's floor IS.**
fix-507 §C set `TEAM_GRID_CHAT_MIN = 150` as a judgement about a *preview*.
§F4 moves the `Chat · N →` button into that cell, and the button is
`whitespace-nowrap` inside an `overflow-hidden` card — it clips rather than
reflowing. Measured at its widest possible face (`Chat · 128`) it needs **83**,
plus the section's `px-2.5` = **103**.

Against the unmeasured 150, the threshold would have been 260, Team's 231 would
have fallen short, the grid would have collapsed and fix-507 §C's 276px win at
1600 would have gone with it — **on the strength of a number nobody had
checked**. The pill's re-derivation does not bear on this: the band spans the
card below the grid, so the two are independent.

---

## 5 — the permits rail (§E), reported as a fact, not a change

**The rail is NOT narrowed by this ticket.** It stays at 190; §E changes what a
card says, not how wide it is.

Three lines with a real hierarchy — type (heading) · number + `↗` (subheading) ·
structure address (subheading) — and the stage suffix becomes a phase **group
header with a count**, in the Pipeline's own words. The per-card colour dot goes
with it; the colour moves to the header.

**The new longest line**, measured in Chrome:

| | needs | at 190 (161 of row) |
|---|---:|---|
| `Building Permit` (the type alone) | 118 | ✓ |
| `SDOTTRLA0002500 ↗` | 102 | ✓ |
| `SFR 1` / a structure address | ≤ 60 | ✓ |
| the group header `Design & Engineering (4)` | 152 | ✓ (spans the rail, 161) |

★ **Nothing truncates at 190 any more.** fix-507 reported that 190 clipped the
stage word — `Building Permit · Corrections` needed 173 and `Grading / Clearing
· Corrections` 188, against 161 — and named **217** as the no-truncation width.
§E removes that line from the card entirely, so **the no-truncation width is now
161**, i.e. the rail could go to **190** and does. Recorded as a fact for later:
the rail has ~9px of slack at its widest content and the group header is what
would bind first.

---

## 6 — §G's contrast, measured

fix-407's standing contract is **≥ 4.5:1, measured**. Everything §G touched:

| | ratio | |
|---|---:|---|
| card banner (`SITE DATA`, `DATES`, …) | **12.90** | `text-muted` → `text-text` |
| section heading | **15.19** | `text-dim` → `text-text` |
| field label | **15.19** | `text-dim` → `text-text` |
| consultant status chip | 5.00 | untouched, re-checked |
| tag chip | ≥ 4.5 | untouched, re-checked |

★★★ **And one failure found rather than introduced.** The four new phase headers
would have shipped at **3.32:1** using `--color-<stage>` on
`--color-<stage>-bg` — and **the `✓ ISSUED` divider fix-65 shipped in May has
been at that ratio ever since**. The headers use fix-407's own recipe (65% token
+ 35% `#1a2540`), which is where `STAGE_CHIP` comes from; two of the five hexes
come out identical to the ones `lib/planOfRecord` publishes, which is the check
that the recipe was applied rather than approximated.

| | ink | on tint |
|---|---|---:|
| Design & Engineering | `#214daf` | **6.27** |
| Permitting | `#0c6e5b` | **5.45** |
| Corrections | `#965a1a` | **5.00** |
| Approved | `#5a33b0` | **6.98** |
| Issued | `#0e6b8a` | **5.38** |

---

## 7 — the two diagnoses §F2 and §I asked for, before building

### §F2 — the firm dropdown **never shipped**, it did not regress

fix-506 ruled *"type and firm do not [edit on the overview]"*. STEP 0 opened
`233 31st Ave E` and found **six live, enabled `<select>` elements**, one per
consultant — the control fix-475 built and nothing ever removed. Not a
regression: an unimplemented ruling.

★ It is not deleted. `ConsultantBand` takes a `manage` prop: `false` (the
overview) renders the firm as read-only text at the pill's full width; `true`
(Project Data's Consultants tab) renders the picker. The modal's own caption has
claimed *"type and firm are chosen here"* since fix-506 — this is the prop that
makes the sentence true.

### §I — **case (a): six render, no add button**

Project Data's Consultants tab renders `<ConsultantBand>`, the *same* component
as the overview, so all six of `233 31st Ave E`'s consultants are there. Nothing
is hidden. **The control is missing**, and the reason is exact: `+ Add
consultant` lived only inside `EmptySlot`, so it existed only while one of the
fixed four (Surveyor · Arborist · Structural · Civil) was unfilled. Fill all four
and the only way to add a fifth disappears — which is the state every mature
project reaches. Shipped here, in `manage` mode.

★★ **Remove was NOT shipped, and this is the one thing the ticket leaves
undone.** §I asks for *"add / remove, writing through `bp_set_consultant_*`"* —
there is no remove RPC. The set is `bp_add_project_consultant`,
`bp_set_consultant_date` / `_firm` / `_phase` / `_status`. A remove needs either
a new RPC (a migration — the brief says stop) or a direct `DELETE` on
`project_consultants`, which would be the first non-RPC write in this feature
and would sit outside the grants model fix-273 audited. Reported, not built.
