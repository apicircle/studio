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
  This relicensing grant is **built into the license itself**, so the
  rights the project relies on do not depend on a separate signed CLA.
  To keep an explicit, auditable record that each contributor
  affirmatively agreed and has the right to contribute, we additionally
  require a **Developer Certificate of Origin (DCO) sign-off on every
  commit** — see [§1a](#1a-developer-certificate-of-origin-dco) below.
  Opening a pull request signifies acceptance of Section 3; the
  per-commit sign-off records it.
- **Section 4 — Trademarks.** You may not use the names "API Circle"
  or "API Circle Studio" or any related logos except as required for
  accurate attribution. Please do not include unauthorized branding,
  logos, or trademark uses in your contribution.

If your employer owns the IP in your work, please confirm with them
that you have the right to contribute under Section 3 **before** you
open a pull request.

---

## 1a. Developer Certificate of Origin (DCO)

We use the **Developer Certificate of Origin** — a lightweight, per-commit
certification (the same mechanism the Linux kernel and GitLab use) instead of a
separate signed CLA. It does two things: it certifies you have the **right** to
submit the contribution, and it records your **affirmative agreement** to the
contribution terms in [Section 3 of the LICENSE](LICENSE) (the relicensing
grant). The license already provides the substantive grant; the DCO provides the
auditable record that you agreed to it.

**How to sign off.** Add a `Signed-off-by` line to every commit by committing
with `-s`:

```bash
git commit -s -m "feat: add ..."
```

Git appends a line using the real name and email from your Git config:

```
Signed-off-by: Jane Doe <jane@example.com>
```

Use your real name and a reachable email — anonymous or fake sign-offs are not
accepted. A PR cannot be merged unless **every** commit is signed off. To fix
missing sign-offs, use `git commit --amend -s` (a single commit) or
`git rebase --signoff main` (a whole branch).

By adding the sign-off you certify the statement below. **For this project, the
DCO's references to "the open source license indicated in the file" mean the
[API Circle Studio License v1.0](LICENSE)**, whose Section 3 governs
contributions — including the maintainer's right to relicense (e.g. to bundle
your contribution into commercial API Circle products). The DCO certifies origin
and assent; Section 3 grants the rights.

> **Developer Certificate of Origin 1.1**
>
> By making a contribution to this project, I certify that:
>
> (a) The contribution was created in whole or in part by me and I have the
> right to submit it under the open source license indicated in the file; or
>
> (b) The contribution is based upon previous work that, to the best of my
> knowledge, is covered under an appropriate open source license and I have the
> right under that license to submit that work with modifications, whether
> created in whole or in part by me, under the same open source license (unless
> I am permitted to submit under a different license), as indicated in the file;
> or
>
> (c) The contribution was provided directly to me by some other person who
> certified (a), (b) or (c) and I have not modified it.
>
> (d) I understand and agree that this project and the contribution are public
> and that a record of the contribution (including all personal information I
> submit with it, including my sign-off) is maintained indefinitely and may be
> redistributed consistent with this project or the open source license(s)
> involved.

The canonical DCO text lives at <https://developercertificate.org>; the version
above is reproduced verbatim. _(Optional, heavier alternative: if a future
investor or acquirer requires it, a formal click-through CLA can be layered on
top via a CLA-assistant bot — but the DCO + Section 3 grant already cover the
project's needs.)_

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

**Sign off every commit** with `-s` (`git commit -s`) — this is the DCO
requirement from [§1a](#1a-developer-certificate-of-origin-dco). A PR cannot
merge without a `Signed-off-by` line on each commit.

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
- [ ] Every commit is signed off (`git commit -s`) per the
      [DCO](#1a-developer-certificate-of-origin-dco).

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
