# Design system — primitives, tokens, and the layout scale

The de-facto design system is `packages/ui-components/src/primitives/` composed
with the Tailwind theme tokens in `apps/web/src/styles/global.css`. This document
records the decisions those primitives encode, so screens stop re-inventing them.

Historically they _did_ re-invent them: `Button` and `Input` had **zero call
sites** while ~384 raw `<button>` and ~162 raw `<input>` elements were styled
inline, and each panel privately re-declared its own label / field / chip
classes. The root cause was `cn()` — a plain string join that could not resolve
Tailwind conflicts, so a primitive's base class and a call-site override both
survived and the cascade picked the winner by source order. `cn()` now merges via
`tailwind-merge`, which is what makes everything below adoptable.

## Control-height scale

One scale, shared by `Button`, `Input`, and the field controls. Size names map to
heights so a field and the button beside it line up:

| Size | Height       | Use                                                                                                                                    |
| ---- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `xs` | `h-6` (24px) | Dense toolbars, inline chips. **This is the floor** — 24px is the WCAG 2.5.8 AA minimum target size; nothing interactive goes smaller. |
| `sm` | `h-7` (28px) | **Default.** The height the panels overwhelmingly use.                                                                                 |
| `md` | `h-8` (32px) | Comfortable forms, primary editor controls.                                                                                            |
| `lg` | `h-9` (36px) | Prominent actions (the request Send row).                                                                                              |

Do not hand-write `h-5`/20px on anything clickable — that fails AA.

## Type scale

Tailwind steps only, with a floor: **text read as a sentence is 12px or more.**

| Class              | px  | Use                                                                                           |
| ------------------ | --- | --------------------------------------------------------------------------------------------- |
| `text-sm`          | 14  | Body copy, primary labels, anything a non-developer reads at length. Prefer this in new work. |
| `text-xs`          | 12  | Dense control labels, secondary text, and the floor for any sentence: a hint, a note, a line. |
| `text-[0.6875rem]` | 11  | Uppercase micro-labels (`Label`, `SectionHeading size="sm"`) and chips. Never a sentence.     |
| `text-[0.625rem]`  | 10  | Badges and counts only.                                                                       |

Nothing is smaller: the 9px step and the pixel sizes (`text-[10px]`,
`text-[11px]`) are gone. `packages/ui-components/src/typeScale.test.ts` reads
every source file and fails on a `<p>` under 12px, a size under 10px, or a
section heading styled by hand instead of through `SectionHeading`.

## Semantic tone tokens

Colour by meaning, never by raw hue. Each tone has border / bg / text token
variants (`border-<tone>`, `bg-<tone>`, `text-<tone>`) that resolve per theme:

- `accent` — emphasis / active / selected (the theme's `--purple`).
- `success` `warning` `danger` `info` — status only; don't use `danger` for a
  merely-emphasised control.
- Neutrals: `surface` `card` `border` `border-strong` `border-subtle`,
  `text-primary` `text-muted` `text-dim` `text-faint`.
- HTTP methods: `text-http-get` … `text-http-options` for method chips. They
  name a method, never a status — a "warning" is `warning`, not `http-put`.

### Tone-coloured text uses the `-fg` twin

`text-accent-fg` `text-success-fg` `text-warning-fg` `text-danger-fg`
`text-info-fg`. Use these for **text** in a tone — a chip label, a tinted
button's label, the active tab, a coloured count. Keep the bare tone for
borders, tints and icons (`border-warning/40 bg-warning/10`).

Why two: a chip is small text on a tint of its own colour, and the raw tone is
unreadable there in most light themes (amber on a pale amber tint measures under
2:1). No single adjustment fixes all 60 themes without washing out the ones that
were fine, so each theme gets its own foreground per tone — the tone itself
where that already meets WCAG AA, otherwise the tone mixed toward the theme's
`text-primary` by the least that gets there. AA is held on the bare `surface` and
`card` and on the 10% and 15% tints of the tone over each.

The values are **generated**: `node scripts/gen-status-fg.mjs` rewrites them in
`apps/web/src/styles/global.css`, and `theme-contrast.test.ts` fails if a theme
was added or edited without running it. Every theme must set its own `success`
`warning` `danger` `info` — none are inherited from the default theme.

Two tones can share a colour in a theme (`info` equals `accent` in thirteen), so
a status never rests on hue alone: give it a label or an icon as well.

### The one main action is a solid accent button

`Button variant="solid"` is a fill of the accent itself, for the single main
action on a screen (Send, Run, the branch card's Push or Create PR). The rest
stay `primary` (the tinted button), `ghost` or `subtle`: two solid buttons on
one screen is no main action at all.

Its label is `text-on-accent` and its hover `bg-accent-hover`, two tokens
**generated** per theme by the same script as the `-fg` twins:

- `--on-accent` — of the theme's `surface` and `text-primary`, whichever stands
  out more on the accent, when it reads there at AA (4.5:1); where neither
  does, pure black or white, whichever reads better (one of them always reaches
  4.58:1). No fixed colour works for all 60 accents: white on Solarized Light's
  blue is 3.7:1, black on GitHub Light's 4.0:1.
- `--accent-hover` — the accent mixed away from the label (toward black under a
  light label, toward white under a dark one) from 10%, by the least that is 6
  from the accent in OKLab ×100: a step anyone can see. Away from the label
  only raises the contrast, so a label that reads on the fill reads on its
  hover.

`theme-contrast.test.ts` holds both at AA in every theme and the hover at its
step. A busy solid button (`loading`) wears the tinted look, so the brand mark,
drawn in the theme's own colours, shows on it.

### A line of a diff uses the diff-row classes

An added or a removed line is marked with the classes in
`primitives/diffRow.ts` (`DIFF_ROW`, `DIFF_ROW_TONE`, `DIFF_ROW_NUMBER`,
`DIFF_ROW_MARKER`, exported from `@apicircle/ui-components`). Do not write
`bg-success/10` on a row of code.

Why not a tint: a tint is the tone painted thin over the page, and over a page
of the opposite hue the two cancel. 10% of Solarized Dark's red over its teal
page lands 2.0 from the page in OKLab ×100, where about 2 is the least an eye
can tell apart, and 49 of the 120 added/removed rows across the 60 themes sat
under 5. A WCAG contrast ratio cannot see this, because it compares lightness
alone. No single share of the tone fixes it either: 20% leaves that row at 5.3,
and 25% takes the code on a row under AA in Everforest Dark.

So a marked line carries four things:

| Part   | Class                                  | What it is for                                                                                            |
| ------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Tint   | `bg-diff-add` / `bg-diff-del`          | The theme's own backdrop for the line. Says "not the page".                                               |
| Edge   | `border-l-success` / `border-l-danger` | Two pixels of the tone itself. Says **which** of the two, where the tint of each is nearly the same grey. |
| Number | `text-text-muted`                      | A step stronger than an unchanged line's `text-text-dim`, which falls to 2.4:1 on a tint.                 |
| Sign   | `+` / `−`                              | The mark that does not depend on colour at all.                                                           |

An unchanged line has the edge's width in `border-l-transparent`, so the code
starts at the same column on every row.

`--diff-add` and `--diff-del` are **generated** per theme by the same script as
the `-fg` tokens. Each is a solid colour: the tone (`success` / `danger`) over
`surface`, by this rule:

- Start at 20% of the tone.
- Where that is under 10 from the surface (OKLab ×100), take the least more that
  reaches 10.
- Never take a share at which `text-primary` on it drops under AA (4.5:1) or
  `text-muted` under 3:1. Readable text comes before the target.
- Never go under 20% to reach the target sooner. On a black page 2% of a green
  is `2 5 2`, which the measure scores at 10 and no display shows.

Today 70 of the 120 rows keep 20% and 50, in 37 themes, are raised, to 33% at
most (Nord, removed). The weakest of each measure: tint from page 10.0, code on
tint 4.51:1 (Kanagawa Lotus), number on tint 3.27:1, edge from page 31, added
edge from removed edge 19.

The tokens are solved for a row on `surface`. Draw a diff on `bg-surface`: on
`card` the same colour can sit as little as 3.8 from its backdrop.

Two tests hold this. `theme-contrast.test.ts` measures a row made of those parts
on every theme and holds the five measures (10, 4.5:1, 3:1, 25, 15). It fails,
naming the theme and the measure, when a theme is added or a tone changed that a
diff no longer shows on. `primitives/diffRow.test.ts` fails when a class in
`diffRow.ts` stops being one of the parts the themes were measured for.

## Stacking

One scale, exported as `Z` from the primitives (`primitives/floating.ts`), lowest
first: `paneSticky` 10 · `panelCard` 20 · `panelPopover` 30 · `dock` 30 ·
`banner` 40 · `modal` 50 · `menu` 55 · `toast` 60 · `tooltip` 70. Take a level
from it instead of writing a `z-*` class; two layers choosing the same number in
different files is how a dropdown ended up painted over the inspector. The first
three are for layers inside a panel — make the panel root `isolate` and nothing
in it is ever compared with the dock beside it.

## Primitives — what to reach for

| Need                  | Use                      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A button              | `Button`                 | `variant` solid/primary/ghost/danger/subtle × `size`; `solid` for the one main action. Defaults to `type="button"` so it can't submit a form by accident. `loading` for an action in flight; `disabledReason` says why it is disabled.                                                                                                                                                                                                                          |
| Why it is disabled    | `DisabledReason`         | Wraps any one control and says, on hover and on keyboard focus, why it is disabled (a `Tooltip` that explains a disabled trigger). Shows only while the control is disabled, so the reason expression can be passed in every state. **Every disabled action says why** — a greyed-out button with no reason leaves the user guessing.                                                                                                                           |
| A section's title     | `SectionHeading`         | The small uppercase title over a section, as a real `h2`–`h4`. `md` (12px) for a panel's sections, `sm` (11px) inside a dense card.                                                                                                                                                                                                                                                                                                                             |
| A text field          | `Input`                  | Shares the size scale; `invalid` wires `aria-invalid` + the danger border.                                                                                                                                                                                                                                                                                                                                                                                      |
| A labelled field      | `Field`                  | Owns the label↔control association, required marker, and hint/error slot with `aria-describedby`. Pass the control as a render-prop to get the wired `id`. **Use this instead of a bare label + input** — a visible label that isn't bound to its control is an accessibility gap.                                                                                                                                                                              |
| Just a label          | `Label`                  | The one uppercase micro-label style; pair with `htmlFor`.                                                                                                                                                                                                                                                                                                                                                                                                       |
| A checkbox / radio    | `Checkbox` / `Radio`     | Themed, but real inputs underneath (keyboard + native grouping intact). ≥24px row target.                                                                                                                                                                                                                                                                                                                                                                       |
| Tabbed sections       | `Tabs` + `tabPanelProps` | A real ARIA tablist with ←/→/Home/End roving focus; `variant` pill (default) or underline. The request + response editors adopt the underline variant, so their bottom-border strips are no longer hand-rolled buttons.                                                                                                                                                                                                                                         |
| A hint on hover/focus | `Tooltip`                | Replaces native `title=`. Keyboard- and touch-reachable, and links via `aria-describedby` so it _describes_ rather than _renames_ its control. Drawn on the floating layer, so nothing clips it. It also explains a **disabled** control (the wrapper takes the pointer and a tab stop in its place), stays shut while the popup its trigger opens is showing (`aria-haspopup` + `aria-expanded`), and takes `disabled` for a hint that only applies sometimes. |
| Reading a JSON Schema | `SchemaView`             | Renders a schema as the fields it describes — name · type · required · constraints, nested and collapsible — instead of raw JSON. Read-only on purpose: editing stays with the JSON editor, so there is one way to read a schema and one way to change it. Use it wherever a contract shape is shown to someone who should not have to parse JSON Schema keywords.                                                                                              |
| A status/label chip   | `Badge`                  | Tone scale; `uppercase` for micro-caps. Replaces the per-panel chip classes.                                                                                                                                                                                                                                                                                                                                                                                    |
| A loading placeholder | `Skeleton`               | Content-shaped; holds layout instead of reflowing when data lands.                                                                                                                                                                                                                                                                                                                                                                                              |
| A dialog              | `Modal`                  | Focus trap + Escape + focus restore.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A destructive confirm | `ConfirmDialog`          | Optional typed-confirm gate.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A row-action menu     | `KebabMenu`              | Full arrow/Home/End/Escape menu semantics.                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Rules

- **Never hand-roll a control that a primitive covers.** If the primitive is
  close but not quite, extend the primitive — don't fork it inline. That is how
  the drift started.
- **Style through tokens, never raw hex.** A raw colour breaks in most of the 60
  themes.
- **Label every field.** Prefer `Field`; at minimum bind a `Label` with
  `htmlFor`. A placeholder is not a label — it vanishes on input.
- **Respect the height floor.** 24px minimum for anything clickable.
- **Respect the text floor.** 12px for any sentence (see the type scale).
- **Say why a control is disabled** — `DisabledReason`, or `Button
disabledReason`. A reason that only lives in a native `title` reaches a mouse
  and nothing else.
- Tests are co-located and role/name-driven; changing a control's role or
  accessible name is a breaking change to its tests by design — update both
  together.
