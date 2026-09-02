# fix-479 §F — the overview row, measured before and after (P-132 #4)

Bobby, 2026-09-02: *"our vertical height is really tall right now. So like
design plan record has a ton of white space above and below the PDF, and
milestones and projects have a ton of white space."*

**★★★ THE HEADLINE, AND IT IS NOT THE ONE THE BRIEF EXPECTED.** §A takes real
height out of the Team card — **51px** on the 148 projects with no external
team, **256px** on a five-firm one. But §E's seed moved those same firms into
the Consultants card, and the Consultants pill is **153px tall per firm**. So
on the ten projects with five or six consultants, **the row is now TALLER than
it was this morning**, and the brief's own gate fires:

> *"If Consultants on the 6-pill project becomes the tallest card, report the
> number and stop — do not redesign the pill in this ticket."*

**It does. The number is 993px.** Nothing was redesigned.

---

## 0 — how this was measured, and what to distrust

`harness/overview-height-479.html` → `src/harness/overviewHeight479.tsx`, run in
Chrome against `npm run dev`.

It imports the **real** `OverviewCard` / `OverviewSection` / `OverviewAction`
primitives and the **real** layout constants — `OVERVIEW_CARD_COLUMNS`,
`resolveOverviewWidths`, `overviewRowWidthAt`, `TEAM_INTERNAL_ROWS`,
`TEAM_INTERNAL_ROW_GAP`, `CONSULTANT_DATE_SLOTS` — so every card **width**, the
frame, the banner, the separators and fix-331 §1's height distribution are the
app's own. The card **interiors** are transcribed from the class strings in
`ProjectDetailHeader.tsx` and `ConsultantsCard.tsx`. That is fix-453's method,
and for fix-453's reason: the real cards are wired to fifteen hooks and a
Supabase client, and a harness that had to log in would measure nothing.

★ **The entry lives under `src/`** because `tailwind.config.js` scans
`./src/**` and nothing else. A harness outside `src` renders with none of the
utilities the interiors are built from — every number would be wrong, in the
same silent direction.

### ★★★ CALIBRATION — read this before believing anything below

| card | this harness | fix-453 in Chrome | delta |
|---|---:|---:|---:|
| **Milestones** (unchanged by fix-479) | **419** | **412** | **+7 (+1.7%)** |

The harness runs **about 2% tall**. That is the error bar on every absolute
number on this page. It does **not** move the comparisons: every "before" and
"after" pair is measured by the same transcription at the same width, so the
**deltas are exact even where the absolutes are 2% heavy.**

★ Project and Design Plan of Record are **not transcribed**. fix-479 touches
neither, and their heights enter the row max as fix-453's published Chrome
numbers, labelled below as carried forward: **Project 424 (0–1 unit types) to
544 (6 unit types)**, **Plan of Record 92**.

---

## 1 — natural card heights

Natural = the card cloned into an auto-height box at its resolved grid width,
so the row's stretch is removed and the card's own content height is read.

Widths resolve identically to fix-475's constants — `OVERVIEW_ROW_MIN_WIDTH` is
**1172**, the row gets **1350px** at 1920 and **870px** at 1440 (below the
minimum, so it has wrapped):

| viewport | row | dd | proj | team | por | consultants |
|---:|---:|---:|---:|---:|---:|---:|
| 1920 | 1350 | 222 | 296 | 217 | 370 | 204 |
| 1440 | 870 | 222 | 296 | 160 | 310 | 144 |

**★★ Every height below is IDENTICAL at 1920 and 1440.** Not one of these cards
reflows with width — the Team card's roster is one column at both, the
Consultants pill stacks its dates at both (fix-475 §3), and Milestones sits on
its 222px floor at both (fix-453). So there is one table, not two.

### Team

| shape | height | what it is |
|---|---:|---|
| BEFORE · empty External, one line | **523** | the post-fix-423 shape — 148 of 202 projects |
| BEFORE · empty External, four slots | **713** | the pre-fix-423 shape, for reference |
| BEFORE · five firms | **728** | the 3 projects with 5–6 firms |
| **AFTER (fix-479 §A)** | **472** | Builder/Owner → Internal → Chat → button |
| **AFTER, Builder/Owner panel OPEN** | **472** | §B's acceptance — see §3 |

**The External section cost 51px collapsed and 256px full.** fix-423's own
figure of 251px was for the four-slot shape it replaced, and this harness
reproduces that as 713 − 472 = **241px** (within the 2% band).

### Consultants

| pills | height | Δ per pill |
|---:|---:|---:|
| 0 | **77** | — |
| 1 | **230** | +153 |
| 3 | **535** | +153 |
| **6** | **993** | +153 |

**★★★ 153px per consultant, and it is all controls.** The pill is a discipline
label, a firm `<select>`, a status `<select>` and **two stacked native
`<input type="date">`** — the stack fix-475 §3 chose deliberately, trading
height (which a list-shaped card has) for width (which the row has none of).
Nothing here reflows and nothing collapses: six consultants is six pills.

### Carried forward, unchanged by this ticket

| card | height |
|---|---:|
| Milestones | 412 (fix-453) |
| Project | 424 at 0–1 unit types · 544 at 6 |
| Design Plan of Record | 92 |

---

## 2 — the row, which is a MAX over its five cells (fix-423)

Using the carried-forward Project/PoR numbers and this harness's Team and
Consultants, with the harness's +2% left in so the columns are comparable:

| project shape (prod count) | Team before | Cons. before | **row before** | Team after | Cons. after | **row after** | Δ |
|---|---:|---:|---:|---:|---:|---:|---:|
| no external, 0–1 unit types (**148**) | 523 | 77 | **523** | 472 | 77 | **472** | **−51** |
| 3 firms → 3 consultants (**13**) | 646 | 77 | **646** | 472 | 535 | **535** | **−111** |
| 4 firms → 4 consultants (**11**) | 687 | 77 | **687** | 472 | 689 | **689** | **+2** |
| 5 firms → 5 consultants (**8**) | 728 | 77 | **728** | 472 | 842 | **842** | **+114** |
| **6 firms → 6 consultants (2)** | 769 | 77 | **769** | 472 | **993** | **993** | **+226** |

*(Team's intermediate 3/4/6-firm heights are interpolated at the measured
41px per firm between the 0-firm 523 and the 5-firm 728. The 0-, 5- and
6-consultant Consultants figures are measured; 2, 4 and 5 use the measured
153px per pill.)*

**Prod distribution after §E's seed** (2026-09-02, `project_consultants`):

| consultants | projects |
|---:|---:|
| 0 | 148 |
| 1 | 11 |
| 2 | 9 |
| 3 | 13 |
| 4 | 11 |
| 5 | 8 |
| 6 | 2 |

So: **173 of 202 projects get a shorter row or an unchanged one. 10 get a taller
one**, and the two six-consultant projects (233 31st Ave E, 5623 44th Ave SW)
get a **993px** card in a row whose next-tallest cell is 544.

---

## 3 — §B's acceptance, measured

> *"the Team card's `offsetHeight` and the overview row's height are
> byte-identical before and after opening"*

| | Team card |
|---|---:|
| Builder/Owner collapsed | **472** |
| Builder/Owner **expanded** | **472** |

Identical, at both viewports. The mechanism is that the expanded card is
`position: fixed` — a fixed box's containing block is the viewport, so it
contributes nothing to any ancestor's layout and it is not clipped by
`OverviewCard`'s `overflow-hidden`.

★★★ **AND THAT CLIP IS WHY IT IS `fixed` RATHER THAN `absolute`.** The brief
allowed an absolutely-positioned layer *"if the Team cell (or its card) has
position: relative and does not overflow: hidden — if it does, say so"*. **It
does**: `OverviewCard` renders `border rounded-md overflow-hidden`, and that
clip is load-bearing in the other direction — fix-422's finding is that a card
narrower than its content **truncates silently** rather than pushing the page
sideways, which is the scroll fix-423 was closing. Turning it off for one card
so a panel could escape downwards would let that card's content escape
sideways. `position: fixed` needs no such trade, and it is the pattern
`ReviewerRollupChip` already uses (`useViewportAwarePopover`) for exactly this
reason. **No portal** — the panel is still a child of the Team card, so
`OVERVIEW_CELL_ATTR` measurements and fix-423's row logic see the same tree.

---

## ★★★ WHAT THIS LEAVES FOR BOBBY

**The width was not taken.** The brief's standing offer — *"if you need any
horizontal width, we can take that out of permits"* — was not needed:
`OVERVIEW_ROW_MIN_WIDTH` is unchanged at **1172** and the permits rail is
untouched. Nothing in §A–§E asked for width.

**The Consultants pill is the row's new ceiling on 34 projects** (three or more
consultants), and on ten of them the row is taller than it was before this
ticket. That is a direct consequence of the seed Bobby approved this morning —
the firms did not appear from nowhere; they moved from a section that listed
them in **41px** each to one that lists them in **153px** each.

Three things could move it, none of them in this ticket's scope:

1. **Collapse the pill to its two lines** (discipline + firm + status) and open
   the dates on click, the way Builder/Owner now works. Worth roughly 100px per
   pill — a 6-consultant card would fall from 993 to about 400.
2. **Put the two dates side by side.** fix-475 §3 measured this and refused it:
   side by side costs **252px of floor** against the 190 Builder/Owner vacated,
   and `OVERVIEW_ROW_MIN_WIDTH` must not rise. It would need the width from the
   permits rail that this ticket did not take.
3. **Let the Consultants card scroll internally** at a declared max height,
   rather than setting the row.

**Recommendation: (1).** It is the same disclosure pattern §B just shipped
eight lines away, it needs no width from anybody, and the collapsed pill still
answers the question the column exists for — *"are the consultants complete?
are we waiting on consultants?"* — because the discipline, the firm and the
status are the three things that answer it. The dates are what you open.
