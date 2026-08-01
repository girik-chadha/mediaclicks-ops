# MediaClicks Ops — Design Brief

> For Claude Design. This is a complete visual direction, not a starting point. Follow the tokens exactly; the specificity is the point.

---

## 1. The product

Internal scheduling and meeting-operations software for **MediaClicks**, a social media marketing agency. 5–25 people: the owner, account managers, media buyers, designers.

**The single job of this interface:** tell someone where they need to be, when, and whether there's a link to click. Everything else is secondary.

**Who uses it:** people who live in back-to-back client calls and are usually looking at this screen for four seconds between meetings. Not power users. Not people who will read documentation. The interface has to answer "what's next and can I click into it" faster than they can form the question.

---

## 2. The design thesis

Don't design a calendar app. Design a **broadcast log**.

Media agencies already think in the vernacular of broadcast: flights, slots, dayparts, run-of-show. The traffic log is the document a station runs its day from — a dense, monospaced, unglamorous grid of what airs when, with a hard sense of *now* running through it. That's the right ancestor for this product, and it's specific to this client's world in a way a generic SaaS calendar isn't.

What that means concretely:
- Time is the primary structure, not a label on a card.
- The interface has a **heartbeat** — a live now-indicator that is always visible, in every view.
- Data is set in a monospaced, tabular face so times align into columns you can scan down.
- Density is a feature. This is a working document, not a dashboard.

**The one risk to take:** the persistent live playhead. Most calendar UIs show a now-line only in day/week grid views. Here it appears in every screen — the dashboard, the detail panel, the sidebar rail — as a thin magenta line and a monospaced clock that ticks. It gives the app a pulse and makes lateness feel physical. Justified because the entire product exists so people don't miss things.

---

## 3. Tokens

### Colour

Six values. Nothing outside this list except pure white for text on dark fills.

| Token | Hex | Use |
|---|---|---|
| `--ink` | `#14161A` | Primary text, dark surfaces, the grid's structural lines |
| `--slate` | `#5B6472` | Secondary text, labels, inactive states |
| `--paper` | `#F7F8FA` | App background. Cool grey-white, faintly blue. **Not cream.** |
| `--rule` | `#E2E5EA` | Hairlines, grid lines, borders, dividers |
| `--signal` | `#0B7B8A` | Deep teal. All interactive elements: links, buttons, focus rings, selected states |
| `--live` | `#D6216B` | Magenta. **Reserved exclusively for time-criticality.** |

**The `--live` rule is absolute.** Magenta appears in exactly four places: the now-playhead, a meeting currently in progress, a meeting starting within 30 minutes, and an overdue/missed state. It never decorates, never appears in a logo, never fills a button. Its scarcity is what makes it register as urgency. If magenta shows up anywhere else in the build, that's a bug.

Dark mode: invert `--paper` to `#101216`, surfaces to `#191C21`, rules to `#282C33`. `--signal` lightens to `#2AA5B5`, `--live` stays as-is — it reads correctly on both.

### Typography

Three faces, three jobs. All free/Google Fonts.

- **Display — `Bricolage Grotesque`.** Variable, slightly irregular, has an opinion. Used *only* at 28px and above: page titles, the big "next meeting" moment, empty-state headlines. Never in body copy, never in the grid. Its restraint is what makes it land.
- **Interface — `Instrument Sans`.** Everything readable: labels, buttons, descriptions, form fields, menus. Neutral but not anonymous.
- **Data — `Martian Mono`.** All times, dates, durations, counts, and the clock. Tabular figures, engineered, slightly wide. This is what makes the log read as a log. Set at `letter-spacing: -0.02em` and one step smaller than surrounding UI text — Martian runs large.

**Scale** (rem, 16px base):

```
display-lg   2.75rem / 1.05  Bricolage 600, -0.03em
display-sm   1.75rem / 1.15  Bricolage 600, -0.02em
title        1.125rem / 1.3  Instrument 600
body         0.9375rem / 1.5 Instrument 400
label        0.8125rem / 1.4 Instrument 500
micro        0.6875rem / 1.3 Instrument 600, 0.08em, uppercase
data         0.8125rem / 1.2 Martian 400, tabular-nums
data-lg      1.25rem / 1.1   Martian 500, tabular-nums
```

Sentence case throughout. The only uppercase is `micro`, used for column headers and section eyebrows.

### Geometry & space

- **Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64. Nothing between.
- **Radius:** `2px` on everything. Controls, cards, modals, event blocks. Nearly square — this is a log, not a consumer app. The only exception is the avatar, which is a full circle.
- **Borders:** 1px `--rule`. Structure comes from hairlines and alignment, not shadow.
- **Shadow:** exactly one, on floating layers only (modal, dropdown, detail panel): `0 8px 24px -8px rgba(20,22,26,0.16)`. Nothing else in the app casts a shadow.
- **Grid:** 12-column, 24px gutters, max content width 1440px. The calendar breaks out to full bleed.

---

## 4. The signature element: the Rail

A **56px fixed vertical strip** down the left edge of every screen, sitting inside the navigation.

It contains a compressed 24-hour scale for today, rendered as hairline ticks with hour labels in `data` at 9px. Every meeting the user has today appears on it as a small mark: a 3px `--signal` bar for meetings with a join link, a 3px hollow outline for meetings without one.

Across it, at the current time, sits a **1px `--live` line running the full width of the rail with a 4px magenta dot on the left edge**. It moves. Beneath the rail, a `data-lg` clock in `--live` shows the current time, ticking each minute.

The Rail is present on the login screen, the dashboard, the calendar, the admin pages — everywhere. It is the product's spine. When there's nothing scheduled it shows the empty scale and the clock, which is honest and still feels alive.

On mobile it collapses to a horizontal strip pinned beneath the header.

---

## 5. Encoding rules

These carry meaning and must be applied consistently — they're not styling choices.

**Link vs no link is the primary distinction, not platform.** Google Meet and WhatsApp have nearly identical brand greens, so brand colour is useless for encoding. Use fill instead:

- **Meeting with a join link** (Meet, Zoom) → solid `--signal` at 12% opacity, 2px solid `--signal` left border, title in `--ink`
- **Meeting with no link** (WhatsApp, none) → `--paper` fill, 1px `--rule` border, 2px `--slate` dashed left border, title in `--ink`
- **Currently live** → `--live` at 12% fill, 2px solid `--live` left border, and the magenta dot
- **Cancelled** → 40% opacity, title struck through, no left border

Platform is communicated by a **12px monochrome glyph** in the top-right of the block, in `--slate`. Never in brand colour.

**Client vs team**: client meetings show the client's company name in `micro` above the title. Team meetings show nothing there. The absence *is* the signal — no badge, no pill.

---

## 6. Screens to design

Priority order. Each at desktop 1440px and mobile 390px.

**1. Today (landing screen after login)**
The most important screen in the product. Above the fold: the next meeting rendered large — `display-sm` title, `data-lg` countdown in `--live` if within 30 minutes, join button if there's a link. Below it, the rest of the day as a vertical log, each row a hairline-separated line with time in `data` on the left, title and attendees to the right. Past meetings dim to 45%. The day should be readable in one glance without scrolling.

**2. Calendar — week view**
Seven columns, hourly rows, hairline grid. The `--live` playhead runs horizontally across today's column. Filter bar above: type, platform, attendee, client, search. Event blocks per the encoding rules in §5. Overlapping meetings split the column width. This screen should feel dense and confident, like a real working schedule.

**3. Create meeting modal**
Progressive disclosure — meeting type first, everything else reveals after. Fields appear with a 120ms fade-and-rise, staggered 40ms, so the form visibly builds itself. Before the save button, a single line in `label` weight stating exactly what will happen: *"Zoom link will be created and emailed to 4 people."* or *"No link. Reminders only."* Design both variants.

**4. Meeting detail panel**
Slides in from the right, 480px. Join link as the primary action, large and unmissable. Below: attendees with response state, client, description, and the audit trail of who changed what. For no-link meetings, the join area shows the client's phone number in `data` — the absence of a button should look deliberate, not broken.

**5. Team & permissions**
A matrix: people down the left, permission toggles across the top. This is the owner's control surface and should feel precise and slightly administrative. Role presets sit above as selectable chips that fill the matrix.

**6. Assistant panel**
Right-side panel, same 480px as detail. Conversational but not a chat toy. Confirmation cards render as bordered blocks in `--signal`, showing exactly what the assistant is about to do, with "Confirm" and "Cancel". The card is the design's promise that nothing happens silently — make it look consequential.

**7. Login**
Single centred field group on `--paper`, the Rail already visible on the left with the live clock ticking. Someone who hasn't logged in yet can already see the app has a pulse. `display-lg` wordmark, nothing else. No hero image, no marketing copy — this is internal software and pretending otherwise is embarrassing.

**8. Empty and error states**
Empty week: *"Nothing scheduled this week."* with a `+ New meeting` action. Failed link creation: *"Zoom link couldn't be created. The meeting is saved."* with a `Retry` button. Errors state what happened and what to do. They don't apologise.

---

## 7. Motion

Sparse and purposeful.

- Playhead: continuous, smooth, never animated on load
- Modal: 160ms ease-out, scale from 0.98
- Detail panel: 200ms slide, ease-out
- Form field reveal: 120ms fade + 4px rise, 40ms stagger
- Hover: 80ms background transition only. No lift, no scale, no shadow change.
- Clock digits: no flip, no odometer. They just change.

Respect `prefers-reduced-motion`: kill everything except the playhead position, which updates without transition.

---

## 8. Copy voice

Plain, active, specific. Written from the user's side of the screen.

- `Create meeting`, not `Submit`
- `Meeting created` — the toast uses the button's verb
- `Emma can't edit other people's meetings`, not `Insufficient permissions`
- `Starts in 12 minutes`, not `Upcoming`
- Never `Oops`, never `Something went wrong`, never an exclamation mark

Times always render in the viewer's own timezone with the zone abbreviated in `micro` beside it. Never make someone do timezone maths.

---

## 9. Quality floor

Non-negotiable, and don't announce it in the design:

- Responsive to 390px. The calendar becomes a single-day scroll on mobile; the week grid does not survive that width and shouldn't try.
- Visible keyboard focus on every interactive element — 2px `--signal` outline, 2px offset.
- All text meets WCAG AA against its background. Check `--slate` on `--paper` specifically.
- Colour is never the only carrier of meaning — that's why link-state uses fill *and* border style, not just hue.
- `--live` magenta and `--signal` teal are distinguishable under the common forms of colour blindness. Verify.

---

## 10. What this must not look like

Avoid, specifically:

- Cream backgrounds with a serif display and a terracotta accent
- Near-black with a single acid-green accent
- Purple-to-blue gradients, glassmorphism, floating cards on a gradient mesh
- Rounded-2xl cards with drop shadows and a pastel palette
- Numbered `01 / 02 / 03` section markers — the content here isn't a sequence
- Brand-coloured platform badges (and Meet/WhatsApp green collide anyway)
- Any hero illustration or marketing polish. This is a tool people open sixty times a day.

The reference points are Linear's density, a broadcast traffic log's structure, and the discipline of a well-set timetable. Not a startup landing page.
