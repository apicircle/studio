# MCP tool catalog reference

The `@apicircle/mcp-server` host exposes 40 tools, namespaced by capability area. The full list is canonical in [`packages/shared/src/mcp.ts`](../packages/shared/src/mcp.ts) and registered in [`packages/mcp-server/src/tools/registry.ts`](../packages/mcp-server/src/tools/registry.ts).

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

| Tool                 | Input                 |
| -------------------- | --------------------- |
| `environment.create` | `{ name, variables }` |
| `environment.read`   | `{ name? }`           |
| `environment.update` | `{ name, variables }` |
| `environment.delete` | `{ name }`            |

## Plan CRUD

| Tool          | Input                                                                       |
| ------------- | --------------------------------------------------------------------------- |
| `plan.create` | `{ name, steps, envPriorityOrder }`                                         |
| `plan.read`   | `{ id? }`                                                                   |
| `plan.update` | `{ id, patch }`                                                             |
| `plan.delete` | `{ id }`                                                                    |
| `plan.run`    | `{ id, withAssertions }` _(returns not-implemented marker outside Desktop)_ |

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

These tools accept LLM-shaped JSON envelopes and validate before persisting.

| Tool                        | Input                                                                         |
| --------------------------- | ----------------------------------------------------------------------------- |
| `prompt.create_environment` | `{ name, variables: [{ key, value, encrypted? }] }`                           |
| `prompt.create_assertion`   | `{ requestId, assertion: { kind, op, target?, expected } }`                   |
| `prompt.create_plan`        | `{ name, stepRequestIds, envPriorityOrder }` _(validates all step ids exist)_ |

## Mock server lifecycle

| Tool                                  | Input                                       |
| ------------------------------------- | ------------------------------------------- |
| `mock.create_from_openapi`            | `{ name, spec, format?: 'json' \| 'yaml' }` |
| `mock.create_from_postman`            | `{ name, collection }`                      |
| `mock.create_from_insomnia`           | `{ name, export }`                          |
| `mock.import_postman_mock_collection` | `{ name, collection }`                      |
| `mock.list`                           | `{}`                                        |
| `mock.start`                          | `{ id, port? }`                             |
| `mock.stop`                           | `{ id }`                                    |
| `mock.delete`                         | `{ id }` _(stops first if running)_         |

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
