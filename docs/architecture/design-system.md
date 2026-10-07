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

Tailwind steps only; the three custom micro-sizes below exist but are being pushed
up because they fail the business-analyst / contract-author readers:

| Class              | px  | Use                                                                                           |
| ------------------ | --- | --------------------------------------------------------------------------------------------- |
| `text-sm`          | 14  | Body copy, primary labels, anything a non-developer reads at length. Prefer this in new work. |
| `text-xs`          | 12  | Dense control labels, secondary text.                                                         |
| `text-[0.6875rem]` | 11  | Micro-labels (uppercase field labels), chips.                                                 |
| `text-[0.625rem]`  | 10  | Badges only. Avoid for anything read as a sentence.                                           |
| `text-[0.5625rem]` | 9   | **Deprecated.** Do not add new uses.                                                          |

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
| A button              | `Button`                 | `variant` primary/ghost/danger/subtle × `size`. Defaults to `type="button"` so it can't submit a form by accident.                                                                                                                                                                                                                                                                                                                                              |
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
- Tests are co-located and role/name-driven; changing a control's role or
  accessible name is a breaking change to its tests by design — update both
  together.
