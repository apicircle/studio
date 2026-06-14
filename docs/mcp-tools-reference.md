# MCP tool catalog reference

The `@apicircle/mcp-server` host exposes 94 tools, namespaced by capability area. The full list is canonical in [`packages/shared/src/mcp.ts`](../packages/shared/src/mcp.ts) and registered in [`packages/mcp-server/src/tools/registry.ts`](../packages/mcp-server/src/tools/registry.ts).

## Imports

| Tool              | Input                                                                    | Output                         |
| ----------------- | ------------------------------------------------------------------------ | ------------------------------ |
| `import.curl`     | `{ curl: string, name?: string, folderId?: string \| null }`             | `{ id, warnings, changedIds }` |
| `import.openapi`  | `{ spec: string, format?: 'json' \| 'yaml', folderId?: string \| null }` | `{ createdIds, warnings }`     |
| `import.postman`  | `{ collection: string, folderId?: string \| null }`                      | `{ createdIds, warnings }`     |
| `import.insomnia` | `{ export: string, folderId?: string \| null }`                          | `{ createdIds, warnings }`     |
| `import.har`      | `{ har: string, folderId?: string \| null }`                             | `{ createdIds, warnings }`     |

## Code generation

| Tool            | Input                                                                                                     | Output                 |
| --------------- | --------------------------------------------------------------------------------------------------------- | ---------------------- |
| `generate.code` | `{ requestId: string, target: 'curl' \| 'fetch' \| 'node-axios' \| 'python-requests' \| 'go' \| 'rust' }` | `{ ok, code, target }` |

## Workspace bulk read/write

| Tool              | Input                 | Output                |
| ----------------- | --------------------- | --------------------- |
| `workspace.read`  | `{}`                  | `{ synced, local }`   |
| `workspace.write` | `{ synced?, local? }` | `{ workspaceId, ok }` |

## Request CRUD

| Tool             | Input                               |
| ---------------- | ----------------------------------- |
| `request.create` | `{ name?, method, url, folderId? }` |
| `request.read`   | `{ id? }` (returns one or all)      |
| `request.update` | `{ id, patch }`                     |
| `request.delete` | `{ id }`                            |

## Folder CRUD

| Tool            | Input                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `folder.create` | `{ name?, parentId? }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `folder.read`   | `{ id? }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `folder.update` | `{ id, parentId?, name?, auth?, clearAuth? }` — patch any combination of move (`parentId`), rename (`name`), and folder-level auth (`auth` to set, `clearAuth: true` to unset). `auth` accepts the same LLM-friendly subset as `prompt.create_request` (`none`, `inherit`, `bearer`, `basic`, `api-key`, `custom-header`). Passing both `auth` and `clearAuth` is a Zod-refine error. Folder-level `auth` is what descendant requests with `auth.type === 'inherit'` resolve to via the inherit walk in [`docs/auth.md`](auth.md#folder-level-auth--the-inherit-walk). |
| `folder.delete` | `{ id }` (children reparented)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Folder exchange (`apicircle.folder/v1`)

Self-contained portable JSON for a folder + its subtree. JSON Schema + GraphQL dependencies travel embedded; global-file metadata travels without bytes (re-attach after import). Credentials are **redacted by default**.

| Tool                 | Input                                                                                          | Output                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `folder.export_json` | `{ folderId: string, includeCredentialIds?: string[] }`                                        | `{ envelope, json, filename, report }` — or `{ error: 'folder_not_found', message }`         |
| `folder.import_json` | `{ json?: string, envelope?: object, parentFolderId?: string \| null }` (one of json/envelope) | `{ rootFolderId, rootFolderName, counts, filesRequiringReattachment, warnings, changedIds }` |

**Credential ids** use the form `<scope>:<ownerId>.<authType>.<field>` — e.g. `request:r-1.bearer.token` or `folder:f-root.basic.password`. Surface the full set from `folder.export_json`'s `report.credentials` (each entry carries `{ id, label, scope, authType, field, ownerName, ownerId }`), then pass the ids the caller wants kept verbatim in `includeCredentialIds`. Anything omitted is blanked while identity fields (`clientId`, `username`, `tokenUrl`, …) are preserved so the importer still knows which IdP each request belonged to.

Import routes through the `folder.import_apicircle` patch in `applyMutation`, so name-uniquify + dependency dedupe semantics match the UI / CLI exactly. Dependency dedupe is name + content for schemas and GraphQL definitions, and name + filename + size for file assets.

## Environment CRUD

| Tool                       | Input                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environment.create`       | `{ name, variables }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `environment.read`         | `{ name? }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `environment.update`       | `{ name, variables }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `environment.delete`       | `{ name }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `environment.set_active`   | `{ name: string \| null }` — `null` deactivates the current environment                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `environment.set_priority` | `{ order }` — highest-priority first; strings are local env names, or `{ kind: 'linked', linkedWorkspaceId, envName }`                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `environment.export`       | `{ name }` → portable JSON (envelope **v2**). Encrypted rows travel with their ciphertext + per-slot salt + label so a matching destination slot decrypts at request-execute time; a non-matching destination mints a fresh slot from the source's salt + label and surfaces it via `mintedSlots`. v1 envelopes (ciphertext-less) still parse for back-compat; the parser exposes `payloadVersion: 1 \| 2`.                                                                                                                                          |
| `environment.import`       | `{ json, overwrite? }` — `json` is the `environment.export` shape. Returns `{ name, changedIds, pendingBindings, mintedSlots, warnings }`. `mintedSlots: [{ id, label }]` lists vault slots minted from a v2 envelope whose salt didn't match any local slot — the caller can prompt the user for the plaintext, then call `secret.addLocal`. `pendingBindings: [{ varKey, label, labelFromFallback }]` is the v1 fallback for rows whose only hint was the slot label — same prompt-and-bind flow via `secret.addLocal` + `environment.bindSecret`. |

## Plan CRUD

| Tool                 | Input                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `plan.create`        | `{ name, steps, envPriorityOrder }`                                                            |
| `plan.read`          | `{ id? }`                                                                                      |
| `plan.update`        | `{ id, patch }`                                                                                |
| `plan.delete`        | `{ id }`                                                                                       |
| `plan.run`           | `{ id, withAssertions }` _(returns not-implemented marker outside Desktop)_                    |
| `plan.add_step`      | `{ planId, requestId, linkedWorkspaceId?, position? }` — `position` inserts at a 0-based index |
| `plan.remove_step`   | `{ planId, index }` (0-based)                                                                  |
| `plan.reorder_steps` | `{ planId, order: number[] }` — a permutation of current step indices                          |
| `plan.set_variables` | `{ planId, variables: [{ key, value }] }` — replaces plan-scoped variables                     |

## History

Local request/plan run buffers — `WorkspaceLocal.history`.

| Tool                   | Input                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `history.list_runs`    | `{ requestId?, ok?, since?, until?, limit? }` — reverse-chronological; `limit` default 100, max 500 |
| `history.get_run`      | `{ id }` → full row (headers, body preview, assertion results)                                      |
| `history.delete_run`   | `{ id }`                                                                                            |
| `history.purge_by_age` | `{ olderThanDays }` — drops runs older than N days; `0` clears all history                          |

## Assertion CRUD

| Tool               | Input                         |
| ------------------ | ----------------------------- |
| `assertion.create` | `{ requestId, assertion }`    |
| `assertion.read`   | `{ requestId, assertionId? }` |
| `assertion.update` | `{ requestId, assertion }`    |
| `assertion.delete` | `{ requestId, assertionId }`  |

## Global File Assets

Workspace-wide file library. Every file you drop in the UI (Global Assets sidebar, form-data row, binary body, mock-response body) becomes a `GlobalFileAsset`. These tools expose the catalog over MCP for AI clients that need to enumerate, claim, rename, or delete file slots.

Each `list` entry carries the asset's **provenance state**, derived from `workingBranchRef` + `baseBranchRef` plus the local `pendingFileUploads` buffer:

- `uploading` — bytes are in IDB but not on any Git ref yet.
- `workingOnly` — pushed to the working branch.
- `merged` — both refs hold the same blob (transient post-merge state).
- `baseOnly` — on the base branch only (steady-state after cleanup invariant fires).
- `missing` — both refs dropped, no local copy.
- `diverged` — both refs hold different blob shas (audit before pushing).

| Tool                 | Input                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assets.list_files`  | `{}` → `{ count, files: [{ id, name, filename, size, mimeType, sha256, state, workingBranchRef, baseBranchRef, usage: { requests, mockEndpoints, total } }] }`                                                                                                                                                                                                                                                                                                                                                                        |
| `assets.create_file` | `{ name, description?, filename, size, mimeType?, sha256? }` — metadata only; MCP cannot carry bytes. Returns `{ id, slotId }`. Asset starts in `missing` state until the desktop / web supplies bytes on the next foreground reconciliation.                                                                                                                                                                                                                                                                                         |
| `assets.update_file` | `{ id, patch: { name?, description? } }` — rename / re-describe. Provenance refs preserved.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `assets.delete_file` | `{ id }` — cascade. Returns `{ found, id, filename, unbound: { requests, mockEndpoints, total } }` describing every consumer that was cleared. If the asset had any push provenance (`workingBranchRef` or `baseBranchRef`), the slotId is queued for remote-blob deletion; the next desktop push emits a `{path: '.apicircle/attachments/<slotId>', sha: null}` tree entry so the orphan blob is removed from the working branch and (after PR merge) from the base branch. Local-only assets that were never pushed skip the queue. |

## Codebase scanning

| Tool                          | Input                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `codebase.extract_collection` | `{ source: string, frameworks?: ['express' \| 'fastapi' \| 'nest' \| 'spring'] }` |

Returns `{ count, candidates: [{ method, path, framework, line }] }`. Use it to walk a chunk of source code and extract candidate requests for the user to confirm before importing.

## Prompt-driven authoring

These tools accept LLM-shaped JSON envelopes — flat, sensible defaults, ids auto-generated server-side — and validate before persisting. Mirrors every authoring workflow in the catalog so an AI client has a uniform NL → JSON entry point regardless of which surface area it's writing to.

| Tool                                   | Input                                                                                                                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt.create_environment`            | `{ name, variables: [{ key, value, encrypted? }] }`                                                                                                                                                   |
| `prompt.create_assertion`              | `{ requestId, assertion: { kind, op, target?, expected } }`                                                                                                                                           |
| `prompt.create_plan`                   | `{ name, stepRequestIds, envPriorityOrder }` _(validates all step ids exist)_                                                                                                                         |
| `prompt.create_request`                | `{ name?, method, url, folderId?, headers?, queryParams?, pathParams?, body?: { type, content?, variables? }, auth?, assertions? }` — auth defaults to `inherit`; nested assertion ids auto-generated |
| `prompt.update_request`                | `{ id, patch: { name?, method?, url?, folderId?, headers?, queryParams?, pathParams?, body?, auth?, assertions? } }` — replace-on-supplied; returns `{ ok: false, error }` when the id is unknown     |
| `prompt.create_folder_tree`            | `{ parentId?, tree: { name, children?: [...] } }` — recursive; one call seeds the whole hierarchy in pre-order                                                                                        |
| `prompt.add_plan_steps`                | `{ planId, requestIds: [...] }` — append-only; validates every request id before any step is added                                                                                                    |
| `prompt.set_plan_variables`            | `{ planId, variables: [{ key, value }] }` — replaces the plan-scoped variables; empty array clears                                                                                                    |
| `prompt.create_mock_server`            | `{ name, defaultPort?, endpoints?: [{ method, pathPattern, name?, response?, validationRules?, responseRules?, multipliers? }] }` — manual-mode mock with inline endpoints + rules in one shot        |
| `prompt.add_mock_endpoint`             | `{ mockId, method, pathPattern, name?, description?, response?, validationRules?, responseRules?, multipliers? }` — appends to an existing mock; all nested ids auto-generated                        |
| `prompt.set_endpoint_validation_rules` | `{ mockId, endpointId, rules: [{ kind, target, expected?, message?, enabled?, failResponse? }] }` — replaces the endpoint's validation rules; ids regenerated; empty array clears                     |
| `prompt.set_endpoint_response_rules`   | `{ mockId, endpointId, rules: [{ name, enabled?, when: [...], response }] }` — replaces conditional response rules; ids regenerated; empty array falls back to defaultResponse                        |
| `prompt.set_endpoint_multipliers`      | `{ mockId, endpointId, multipliers: [{ source, targetJsonPath, defaultCount, min?, max? }] }` — replaces defaultResponse multipliers; capped at MAX_RESPONSE_MULTIPLIERS (1); empty array clears      |

## Mock server lifecycle

| Tool                                  | Input                                                                                                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mock.create_from_openapi`            | `{ name, spec, format?: 'json' \| 'yaml' }`                                                                                                                                                    |
| `mock.create_from_postman`            | `{ name, collection }`                                                                                                                                                                         |
| `mock.create_from_insomnia`           | `{ name, export }`                                                                                                                                                                             |
| `mock.create_manual`                  | `{ name, defaultPort? }` — empty manual-mode mock; populate via `mock.add_endpoint`                                                                                                            |
| `mock.import_postman_mock_collection` | `{ name, collection }`                                                                                                                                                                         |
| `mock.list`                           | `{}`                                                                                                                                                                                           |
| `mock.start`                          | `{ id, port? }` — `port` 1024-65535 overrides the saved `defaultPort` for this run only                                                                                                        |
| `mock.stop`                           | `{ id }`                                                                                                                                                                                       |
| `mock.delete`                         | `{ id }` _(stops first if running)_                                                                                                                                                            |
| `mock.set_default_port`               | `{ id, defaultPort: number \| null }` — pin a 1024-65535 default port (persists across runs) or pass `null` to fall back to "pick a free port at next start". Does NOT restart a running mock. |

## Mock endpoints (manual-mode)

Endpoint-level editing for manual-mode mock servers. Validation- and
response-rule shapes mirror the `prompt.set_endpoint_*` tools above.

| Tool                        | Input                                                                                                                                                                                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mock.list_endpoints`       | `{ mockId }` → `[{ id, method, path, name }]`                                                                                                                                                                                                                        |
| `mock.add_endpoint`         | `{ mockId, method, pathPattern, name?, description?, response? }` — defaults to a `200` JSON `{}` response                                                                                                                                                           |
| `mock.update_endpoint`      | `{ mockId, endpointId, method?, pathPattern?, name?, description?, ... }` — patches only the supplied fields                                                                                                                                                         |
| `mock.delete_endpoint`      | `{ mockId, endpointId }`                                                                                                                                                                                                                                             |
| `mock.set_validation_rules` | `{ mockId, endpointId, rules: [{ kind, target, expected?, message?, enabled?, failResponse? }] }` — empty array clears                                                                                                                                               |
| `mock.set_response_rules`   | `{ mockId, endpointId, rules: [{ name, enabled?, when: [...], response }] }` — first match wins; empty array falls back to `defaultResponse`                                                                                                                         |
| `mock.set_multipliers`      | `{ mockId, endpointId, multipliers: [{ source, targetJsonPath, defaultCount, min?, max? }] }` — capped at MAX_RESPONSE_MULTIPLIERS (1); empty array clears                                                                                                           |
| `mock.set_request_schema`   | `{ mockId, endpointId, pathParams?, queryParams?, headers?, cookies?: [{ name, typeHint?, required?, description?, example? }], body?: { description?, example? } }` — declares the endpoint's expected inputs (documentation + OpenAPI export); omitted lists clear |

Prompt-shaped (LLM-friendly, fresh ids) authoring variants live alongside the `prompt.*` tools, including **`prompt.set_endpoint_request_schema`** (same fields, every param re-id'd).

## Release ledger

The workspace-self release ledger (`synced.releases.self`) — the published
versions that linked consumers pin to. `release.publish` fingerprints the
release with a SHA-256 of the workspace contents at publish time. Tagging a
release on GitHub + managing marketplace topics are separate Git operations,
not MCP tools.

| Tool                | Input                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release.list`      | `{}` → `{ currentVersion, count, versions: [{ version, publishedAt, notes, workspaceSnapshot, deprecated, yanked, sha?, tagName? }] }` (newest first)                                                 |
| `release.publish`   | `{ version, notes?, sha?, tagName? }` — appends a semver version + markdown notes, bumps `currentVersion`. Rejects invalid semver / a duplicate version. Does NOT create a Git tag or GitHub Release. |
| `release.deprecate` | `{ version }` — soft signal; consumers see a warning but the version stays installable                                                                                                                |
| `release.yank`      | `{ version }` — hard signal (withdraw); consumers are warned to move off this version. The entry stays in the ledger.                                                                                 |

## Linked workspaces

The workspaces this one consumes, one level deep (`synced.linkedWorkspaces`).
Config edits route through `applyMutation`; linking + refresh additionally fetch
the source repo's `.apicircle/workspace.json` over the GitHub API.

| Tool                | Input                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `linked.list`       | `{}` → `{ count, links: [{ id, name, kind, source, scope, pinnedVersion, requiredSecretKeyIds, marketplace?, cachedCurrentVersion }] }`                                 |
| `linked.get`        | `{ id }` → `{ ok, link, ledger }` (the cached release ledger to pin against)                                                                                            |
| `linked.set_config` | `{ id, name?, description?, pinnedVersion?: string \| null, scope?, sessionMode?, requiredSecretKeyIds?, marketplace?: {…} \| null }` — pin must exist in cached ledger |
| `linked.unlink`     | `{ id }` — drops the link + cached ledger + overrides + local snapshot + per-link session                                                                               |

## GitHub network operations

These reach the GitHub REST API and need a token — pass `token`, or set the
`GITHUB_TOKEN` env var on the MCP process. (In the Desktop / VS Code hosts the
same operations use the app's GitHub session; over stdio the token is explicit.)

| Tool              | Input                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `linked.link`     | `{ repoFullName, branch?, pinnedVersion?, kind?, token? }` — fetches the source workspace.json, caches its ledger + collections/environments snapshot |
| `linked.refresh`  | `{ id, token? }` — re-pulls the cached ledger (+ bootstrap snapshot)                                                                                  |
| `release.tag`     | `{ owner, name, version, createGitHubRelease?, notes?, overrideExisting?, token? }` — tags `v<version>` on the repo's default branch HEAD             |
| `repo.set_topics` | `{ owner, name, topics, token? }` — replaces repo topics (keeps `apicircle`, which drives marketplace discovery)                                      |

## Marketplace discovery

Search the API Circle marketplace — public workspaces tagged with `apicircle`
on GitHub. Token is optional (anonymous browsing supported; token lifts rate
limits).

| Tool                 | Input                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marketplace.search` | `{ query?, sort?: 'best-match' \| 'stars' \| 'updated', token? }` → `{ ok, count, results: [{ fullName, owner, name, description, topics, stargazers, defaultBranch }] }` |

## Error handling

Every handler is wrapped in a try/catch. Validation failures return:

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "Validation failed: <field>: <message>" }]
}
```

Domain-level "not found" / "conflict" / etc returns shape `{ ok: false, error: '...' }` inside a normal `content[0].text` payload — the AI client decides whether to retry.

## Tool dispatch model

All write tools route through `applyMutation(state, patch)` in `@apicircle/core`. This is the single semantic source of truth — the same code path is used by the desktop UI and the CLI. AI-driven workflows therefore can never produce workspace state that the UI couldn't have produced.
