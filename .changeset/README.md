# Changesets

This directory holds release intents that become CHANGELOG entries.
Plan §10.5 + §7.5.6 — every PR that lands a user-visible change drops
a changeset file here describing the change and the affected packages.

## How to add one

```sh
pnpm changeset
```

Pick the packages your change touches, the version bump (patch / minor
/ major), and write a one-line summary. The CLI writes a markdown file
under this directory; commit it alongside your code change.

## How releases happen

`pnpm changeset version` consumes every pending changeset, bumps the
affected packages, regenerates the CHANGELOG, and clears this
directory. Run it on a `release/*` branch, open a PR, and merge.

## Ignored packages

Apps and example fixtures in `apps/web`, `apps/desktop`, and
`examples/mock-server` are private (`"private": true`) and don't get
published, but Changesets still wants to know about them. They're
listed under `config.ignore` in `config.json` so adding a changeset
doesn't fail when those packages are picked.
