# Changesets

Changesets is installed (`pnpm changeset`, `pnpm release`) but is not how
Studio ships, and nothing has been added here since the initial public
release.

## How to add one

```sh
pnpm changeset
```

Pick the packages your change touches, the version bump (patch / minor
/ major), and write a one-line summary. The CLI writes a markdown file
under this directory; commit it alongside your code change.

## How releases happen

A release bumps every package to one version
(`node .claude/skills/release-manager/scripts/bump-version.mjs <version>`),
adds a hand-written entry to `CHANGELOG.md`, and tags `v<version>` for
`desktop-release.yml`. Studio publishes nothing to npm:
`@apicircle/{shared,core,mock-server-core}` are published from the private
API Circle repository at the version checked in here.

## Ignored packages

Apps and example fixtures in `apps/web`, `apps/desktop`, and
`examples/mock-server` are private (`"private": true`) and don't get
published, but Changesets still wants to know about them. They're
listed under `config.ignore` in `config.json` so adding a changeset
doesn't fail when those packages are picked.
