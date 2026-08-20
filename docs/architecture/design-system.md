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
- HTTP methods: `text-http-get` … `text-http-options` for method chips.

## Primitives — what to reach for

| Need                  | Use                      | Notes                                                                                                                                                                                                                                                                              |
| --------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A button              | `Button`                 | `variant` primary/ghost/danger/subtle × `size`. Defaults to `type="button"` so it can't submit a form by accident.                                                                                                                                                                 |
| A text field          | `Input`                  | Shares the size scale; `invalid` wires `aria-invalid` + the danger border.                                                                                                                                                                                                         |
| A labelled field      | `Field`                  | Owns the label↔control association, required marker, and hint/error slot with `aria-describedby`. Pass the control as a render-prop to get the wired `id`. **Use this instead of a bare label + input** — a visible label that isn't bound to its control is an accessibility gap. |
| Just a label          | `Label`                  | The one uppercase micro-label style; pair with `htmlFor`.                                                                                                                                                                                                                          |
| A checkbox / radio    | `Checkbox` / `Radio`     | Themed, but real inputs underneath (keyboard + native grouping intact). ≥24px row target.                                                                                                                                                                                          |
| Tabbed sections       | `Tabs` + `tabPanelProps` | A real ARIA tablist with ←/→/Home/End roving focus; `variant` pill (default) or underline. The request + response editors adopt the underline variant, so their bottom-border strips are no longer hand-rolled buttons.                                                            |
| A hint on hover/focus | `Tooltip`                | Replaces native `title=`. Keyboard- and touch-reachable, and links via `aria-describedby` so it _describes_ rather than _renames_ its control.                                                                                                                                     |
| A status/label chip   | `Badge`                  | Tone scale; `uppercase` for micro-caps. Replaces the per-panel chip classes.                                                                                                                                                                                                       |
| A loading placeholder | `Skeleton`               | Content-shaped; holds layout instead of reflowing when data lands.                                                                                                                                                                                                                 |
| A dialog              | `Modal`                  | Focus trap + Escape + focus restore.                                                                                                                                                                                                                                               |
| A destructive confirm | `ConfirmDialog`          | Optional typed-confirm gate.                                                                                                                                                                                                                                                       |
| A row-action menu     | `KebabMenu`              | Full arrow/Home/End/Escape menu semantics.                                                                                                                                                                                                                                         |

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
