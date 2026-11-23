# Linked Pets API

A second workspace fixture, kept for tests
(`packages/shared/src/demoWorkspace.test.ts`,
`packages/core/src/git/scanWorkspaceForSecrets.test.ts`). It was built for
linking one workspace into another. Workspace sharing, linking and releases
are turned off in the product (`WORKSPACE_SHARING_ENABLED` in
`packages/shared/src/types.ts`), so there is no Link Workspace flow to try it
with.

## What's in here

- `.apicircle/registry.json` and
  `.apicircle/workspace-linked-pets-api-fixture/workspace.json`: two requests
  against an imaginary `/pets` API and a `local` environment at
  `http://localhost:4041`.
- `releases.self` with versions 0.1.0 and 0.2.0, which no shipped surface
  reads while sharing is off.
