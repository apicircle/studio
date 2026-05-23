# Contributing to API Circle Studio

Thank you for considering a contribution. API Circle Studio is a
solo-maintained project, and contributions are genuinely appreciated.

Before you start, please read this short document end to end — it
covers the license terms that apply to your contribution, how to set
up the repo, the coding conventions we expect, and the pull request
flow.

---

## 1. License of your contribution

API Circle Studio is **not** under a standard open-source license. It
is published under the [API Circle Studio License, Custom
Source-Available License v1.0](LICENSE). Read it before contributing.

The two clauses that matter most for contributors:

- **Section 3 — Contributions.** By submitting any contribution
  (code, documentation, assets, translations, anything) to this
  repository, you grant the maintainer a perpetual, worldwide,
  irrevocable, royalty-free, sublicensable license to use, modify,
  distribute, and **relicense** your contribution under any terms,
  including the terms of this license or any future version of it.
  This is a built-in contributor license grant — no separate CLA or
  DCO sign-off is required. Submitting a pull request is your
  acceptance of Section 3.
- **Section 4 — Trademarks.** You may not use the names "API Circle"
  or "API Circle Studio" or any related logos except as required for
  accurate attribution. Please do not include unauthorized branding,
  logos, or trademark uses in your contribution.

If your employer owns the IP in your work, please confirm with them
that you have the right to contribute under Section 3 **before** you
open a pull request.

---

## 2. Code of Conduct

This project follows the
[Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By
participating, you agree to uphold it. Concerns can be reported in
private to **apicircle365@gmail.com**.

---

## 3. Reporting bugs and proposing features

- **Security vulnerabilities** — do not open a public issue. Follow
  the [Security Policy](SECURITY.md) and email
  `apicircle365@gmail.com`.
- **Bugs** — open a GitHub issue with a minimal reproduction:
  version, OS, channel (npm / desktop / web), expected vs. actual,
  steps. Screenshots help.
- **Feature ideas** — open a GitHub discussion (preferred) or issue
  describing the use case before you write code. The project has
  scope opinions; a quick conversation upfront saves rework.

---

## 4. Development setup

Requirements:

- **Node.js ≥ 20**
- **pnpm ≥ 9** (`corepack enable` will give you a managed copy)
- A modern browser (Chromium-based is the test target for the web app)

Clone and install:

```bash
git clone https://github.com/<your-fork>/studio.git
cd studio
pnpm install
```

Common commands:

| Command         | What it does                                  |
| --------------- | --------------------------------------------- |
| `pnpm dev:web`  | Web dev server → http://localhost:5174        |
| `pnpm dev`      | Turbo dev across all apps                     |
| `pnpm build`    | Turbo build                                   |
| `pnpm check`    | Typecheck (tsc --noEmit per package)          |
| `pnpm lint`     | ESLint (type-checked rules — must pass)       |
| `pnpm test`     | Vitest run across all packages                |
| `pnpm test:e2e` | Playwright E2E against the web app (Chromium) |
| `npx knip`      | Dead-code / unused-dependency scan            |

Desktop work: `pnpm --filter @apicircle/desktop build` then
`pnpm --filter @apicircle/desktop start`.

Repo layout, architecture, and the load-bearing design ideas are
documented in [`CLAUDE.md`](CLAUDE.md) and
[`docs/context/api-circle.md`](docs/context/api-circle.md). Read at
least one of them before submitting a non-trivial change.

---

## 5. Coding conventions

- **TypeScript strict.** ESLint runs with `recommendedTypeChecked`.
  `no-floating-promises`, `consistent-type-imports`, `prefer-const`,
  and `eqeqeq` are errors. Do not use `any` or
  `as unknown as X` to silence the checker — model the type properly.
- **Styling.** Tailwind CSS utilities composed via the `cn()` helper
  (`packages/ui-components/src/primitives/cn.ts`). `var(--purple)` is
  the accent, exposed through the `text-accent` / `bg-accent` /
  `border-accent` tokens.
- **Icons.** `lucide-react`. Don't introduce a second icon library.
- **IDs.** Always use `generateId()` from `@apicircle/shared` — never
  hand-roll IDs.
- **Tests are co-located.** `foo.ts` ↔ `foo.test.ts` (Vitest).
  Accessibility is covered by axe assertions in the Playwright suite
  — keep them green.
- **Pre-launch freedom.** This project has zero installed users. If
  the change you're making is fighting the existing shape of a type,
  store, or persisted JSON, prefer reshaping it over bolting on
  fields. No migration shims, no `// legacy` branches.

---

## 6. Commits

Commits must follow [Conventional Commits](https://www.conventionalcommits.org/)
— this is enforced by commitlint via a Husky `commit-msg` hook. Use
the imperative mood; type prefixes you'll most commonly need:

- `feat:` — new user-visible feature
- `fix:` — bug fix
- `refactor:` — no behavior change
- `docs:` — documentation only
- `test:` — test changes only
- `chore:` — tooling / housekeeping

A `lint-staged` pre-commit hook will format and lint your staged
files. If a hook fails, fix the underlying issue rather than
bypassing it — `--no-verify` is reserved for the maintainer.

---

## 7. Pull request checklist

Before requesting review, please confirm:

- [ ] `pnpm lint` passes.
- [ ] `pnpm check` passes (typecheck).
- [ ] `pnpm test` passes (Vitest, all packages).
- [ ] If you touched UI or e2e-covered behavior, `pnpm test:e2e`
      passes locally.
- [ ] Tests have been added or updated for behavior changes —
      tests are part of the change, not a follow-up.
- [ ] If you renamed or removed a public symbol, you searched for
      callers and updated them in the same PR.
- [ ] PR description explains **why**, not just **what** — link
      to the issue or discussion that motivated the change.

Small, focused PRs are reviewed faster than large ones. If a change
needs more than ~500 lines of diff, consider splitting it.

---

## 8. After your PR is merged

By Section 3 of the LICENSE, your contribution becomes part of the
work the maintainer can redistribute and relicense. You retain your
copyright in the code you wrote, but the maintainer holds the
sublicensable rights described in Section 3.

If you'd like to be credited beyond the git commit history (e.g., in
release notes for a meaningful contribution), say so in your PR
description.

---

Thanks again — and welcome.
