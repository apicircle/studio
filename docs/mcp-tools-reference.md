# MCP tool catalog reference

The `@apicircle/mcp-server` host exposes 71 tools, namespaced by capability area. The full list is canonical in [`packages/shared/src/mcp.ts`](../packages/shared/src/mcp.ts) and registered in [`packages/mcp-server/src/tools/registry.ts`](../packages/mcp-server/src/tools/registry.ts).

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

| Tool            | Input                          |
| --------------- | ------------------------------ |
| `folder.create` | `{ name?, parentId? }`         |
| `folder.read`   | `{ id? }`                      |
| `folder.update` | `{ id, parentId }` (move)      |
| `folder.delete` | `{ id }` (children reparented) |

## Environment CRUD

| Tool                       | Input                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `environment.create`       | `{ name, variables }`                                                                                                  |
| `environment.read`         | `{ name? }`                                                                                                            |
| `environment.update`       | `{ name, variables }`                                                                                                  |
| `environment.delete`       | `{ name }`                                                                                                             |
| `environment.set_active`   | `{ name: string \| null }` — `null` deactivates the current environment                                                |
| `environment.set_priority` | `{ order }` — highest-priority first; strings are local env names, or `{ kind: 'linked', linkedWorkspaceId, envName }` |
| `environment.export`       | `{ name }` → portable JSON (encrypted variables drop their value, keep `secretKeyId`)                                  |
| `environment.import`       | `{ json, overwrite? }` — `json` is the `environment.export` shape                                                      |

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
| `prompt.set_endpoint_multipliers`      | `{ mockId, endpointId, multipliers: [{ source, targetJsonPath, defaultCount, min?, max? }] }` — replaces defaultResponse multipliers; empty array clears                                              |

## Mock server lifecycle

| Tool                                  | Input                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| `mock.create_from_openapi`            | `{ name, spec, format?: 'json' \| 'yaml' }`                                         |
| `mock.create_from_postman`            | `{ name, collection }`                                                              |
| `mock.create_from_insomnia`           | `{ name, export }`                                                                  |
| `mock.create_manual`                  | `{ name, defaultPort? }` — empty manual-mode mock; populate via `mock.add_endpoint` |
| `mock.import_postman_mock_collection` | `{ name, collection }`                                                              |
| `mock.list`                           | `{}`                                                                                |
| `mock.start`                          | `{ id, port? }`                                                                     |
| `mock.stop`                           | `{ id }`                                                                            |
| `mock.delete`                         | `{ id }` _(stops first if running)_                                                 |

## Mock endpoints (manual-mode)

Endpoint-level editing for manual-mode mock servers. Validation- and
response-rule shapes mirror the `prompt.set_endpoint_*` tools above.

| Tool                        | Input                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `mock.list_endpoints`       | `{ mockId }` → `[{ id, method, path, name }]`                                                                                                |
| `mock.add_endpoint`         | `{ mockId, method, pathPattern, name?, description?, response? }` — defaults to a `200` JSON `{}` response                                   |
| `mock.update_endpoint`      | `{ mockId, endpointId, method?, pathPattern?, name?, description?, ... }` — patches only the supplied fields                                 |
| `mock.delete_endpoint`      | `{ mockId, endpointId }`                                                                                                                     |
| `mock.set_validation_rules` | `{ mockId, endpointId, rules: [{ kind, target, expected?, message?, enabled?, failResponse? }] }` — empty array clears                       |
| `mock.set_response_rules`   | `{ mockId, endpointId, rules: [{ name, enabled?, when: [...], response }] }` — first match wins; empty array falls back to `defaultResponse` |
| `mock.set_multipliers`      | `{ mockId, endpointId, multipliers: [{ source, targetJsonPath, defaultCount, min?, max? }] }` — empty array clears                           |

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
