# APICircle YAML Format Reference

The VS Code extension projects each entity in the workspace's `workspace.json`
(under `.apicircle/workspace-<id>/`) as a **YAML document** opened in a real
VS Code text editor. The YAML is a UI-only convenience — what hits Git is
always the canonical JSON inside the per-workspace `workspace.json`. This page
documents the YAML shape so power users
can edit confidently and AI assistants (Copilot, Claude Code, Cursor) can
generate well-formed content.

> **Canonical schema:** [`apps/vscode/schemas/apicircle-request.schema.json`](../apps/vscode/schemas/apicircle-request.schema.json)
> — registered with VS Code's YAML validator so completion / validation /
> hover work out of the box.

---

## URI scheme

Every YAML document lives behind the `apicircle:` virtual filesystem provider:

| URI shape                                              | Entity                                                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `apicircle://<authority>/requests/<id>.req.yaml`       | Request (editable, Phase 1)                                                                                                                |
| `apicircle://<authority>/responses/<runId>.run.yaml`   | Captured response from the active Send (read-only, opens side-by-side; Phase 1)                                                            |
| `apicircle://<authority>/environments/<name>.env.yaml` | Environment (editable, with HoverProvider showing resolution source + mask warnings; Phase 2)                                              |
| `apicircle://<authority>/history/<runId>.run.yaml`     | History run detail — formatted RequestRun / PlanRun from `WorkspaceLocal.history` (lazy-loaded from canonical data on first read; Phase 2) |
| `apicircle://<authority>/plans/<id>.plan.yaml`         | Execution plan (editable, with ▶ Run Plan CodeLens; Phase 2)                                                                               |
| `apicircle://<authority>/mocks/<id>.mock.yaml`         | Mock server (editable name/defaultPort/cors, with ▶ Start Mock CodeLens; source + endpoints read-only; Phase 3)                            |

The `<authority>` is a base64url-encoded absolute path to the workspace's
`.apicircle/` directory. Same workspace on two machines maps to two different
authorities — that's intentional; the workspace identity for cross-surface
syncing is `WorkspaceSynced.workspaceId` (inside the file), not the URI.

---

## Request YAML

```yaml
# APICircle Request — edit fields below and save (Ctrl+S) to commit.
# Read-only system fields are intentionally not present in this projection.
# Folder moves use the TreeView; schema references are managed via the Assets view.

name: Get user by ID
method: GET
url: '{{base_url}}/users/:id'

pathParams:
  id: '123'

query:
  - { key: include, value: orders, enabled: true }

headers:
  - { key: Accept, value: 'application/json', enabled: true }

auth:
  type: bearer
  token: '{{access_token}}'

body:
  type: none

assertions:
  - { id: a1, kind: status, op: equals, expected: 200 }
  - { id: a2, kind: duration, op: lt, expected: 500 }
  - id: a3
    kind: json-path
    op: equals
    target: '$.user.id'
    expected: '123'

extractions:
  - id: e1
    variable: latest_order_id
    source: body
    path: '$.user.latestOrderId'
    enabled: true

contextVars:
  - { key: user_id, value: '123' }
```

### Required fields

| Field    | Type   | Notes                                                                                    |
| -------- | ------ | ---------------------------------------------------------------------------------------- |
| `name`   | string | Display name shown in the Editor TreeView. Min length 1.                                 |
| `method` | string | One of `GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS`. Auto-uppercased on save.    |
| `url`    | string | Full URL. May contain `{{variable}}` refs and `:pathParam` / `{pathParam}` placeholders. |

### Optional fields

All optional fields with empty values are **omitted from the YAML output** to
keep diffs minimal. Adding any of them is harmless; removing them clears the
field on save.

| Field                           | Type                           | Default when absent           |
| ------------------------------- | ------------------------------ | ----------------------------- |
| `pathParams`                    | `Record<string, string>`       | `{}`                          |
| `query` / `headers` / `cookies` | `Array<{key, value, enabled}>` | `[]`                          |
| `auth`                          | `Auth` (see below)             | `{ type: none }`              |
| `body`                          | `Body` (see below)             | `{ type: none, content: "" }` |
| `assertions`                    | `Array<Assertion>`             | `[]`                          |
| `extractions`                   | `Array<Extraction>`            | `[]`                          |
| `contextVars`                   | `Array<{key, value}>`          | `[]`                          |

### Read-only system fields

These are intentionally **not** present in the YAML projection because
editing them would break referential integrity. To change them, use the
appropriate UI:

| Field                              | How to modify                                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`                               | Immutable. The URI carries it.                                                                                               |
| `createdAt` / `updatedAt`          | Stamped automatically by `applyMutation`.                                                                                    |
| `folderId`                         | Drag-and-drop the request in the Editor TreeView (Phase 1.5 — for now use the JSON directly via "Reveal in workspace.json"). |
| `bodySchemaId` / `graphqlSchemaId` | Pick from the Assets view (Phase 3).                                                                                         |

---

## Auth schemes

The `auth` block is a discriminated union on `type`. Phase 1 supports the
schemes; the OAuth2 "Get Token" / "Refresh" flows ship in Phase 4.

### `none` / `inherit`

```yaml
auth:
  type: none
```

`inherit` walks up the folder chain to the first explicit auth — folder-level
auth ships in Phase 4.

### `bearer`

```yaml
auth:
  type: bearer
  token: '{{access_token}}'
```

### `basic`

```yaml
auth:
  type: basic
  username: '{{user}}'
  password: '{{pass}}'
```

### `api-key`

```yaml
auth:
  type: api-key
  key: X-API-Key
  value: '{{secret_key}}'
  addTo: header # or "query" or "cookie"
```

### `custom-header`

```yaml
auth:
  type: custom-header
  key: X-Custom-Auth
  value: signed-token
```

### OAuth2 — six grant types (full editing in YAML, token acquisition in Phase 4)

`oauth2-client-credentials` / `oauth2-auth-code` / `oauth2-pkce` /
`oauth2-password` / `oauth2-implicit` / `oauth2-device`. Each carries the
relevant grant-specific fields plus the shared `OAuth2TokenState`
(`accessToken`, `tokenType`, `refreshToken`, `expiresAt`, `obtainedScope`).
See [`docs/auth.md`](auth.md) for the full grant matrix.

### `aws-sigv4` / `digest` / `ntlm` / `hawk` / `jwt-bearer`

See [`docs/auth.md`](auth.md) §AWS SigV4, §Digest, §NTLM, §Hawk, §JWT for the
full field matrix per scheme.

---

## Body types

```yaml
body:
  type: json
  content: |
    {
      "name": "Alice",
      "email": "alice@example.com"
    }
```

| `type`                                             | Notes                                                    |
| -------------------------------------------------- | -------------------------------------------------------- | ------------------------------ |
| `none`                                             | No body.                                                 |
| `json` / `text` / `xml` / `graphql` / `urlencoded` | `content` is a string (YAML's `                          | ` block scalar reads cleanly). |
| `form-data`                                        | `formRows: Array<{kind: text                             | file, key, value, enabled}>`   |
| `binary`                                           | `attachment: {slotId, filename, size, mimeType, sha256}` |

GraphQL also takes an optional `variables: string` (JSON-encoded).

---

## Assertions

```yaml
assertions:
  - id: a1
    kind: status
    op: equals
    expected: 200

  - id: a2
    kind: json-path
    op: contains
    target: '$.items[*].id'
    expected: 'u_'

  - id: a3
    kind: duration
    op: lt
    expected: 500
```

| `kind`      | `target` semantics                          |
| ----------- | ------------------------------------------- |
| `status`    | ignored — operates on `response.status`     |
| `duration`  | ignored — operates on `response.durationMs` |
| `header`    | header name (case-insensitive)              |
| `json-path` | dot/bracket JSON path into response body    |

Operators: `equals` / `not-equals` / `contains` / `lt` / `gt` / `matches`
(regex).

---

## Extractions

```yaml
extractions:
  - id: e1
    variable: access_token
    source: body
    path: '$.tokens.access'
    enabled: true
```

Sources: `body` (with JSON path) · `header` (with header name) · `cookie`
(with cookie name) · `status` (path ignored — value is the status code).

Extracted values land in `WorkspaceLocal.globalContext` (device-local) and
become available as `{{variable}}` to subsequent requests + plan steps.

---

## Variable references

Anywhere a string field appears (URL, header value, query value, body
content, etc.), you can use `{{name}}` to interpolate a value resolved at
send-time from:

1. **Per-request context** (`contextVars` in the YAML)
2. **Global context** (extracted variables in `WorkspaceLocal`)
3. **Active environment** (`WorkspaceSynced.environments.activeName`)
4. **Priority environments** (overlay order in `environments.priorityOrder`)
5. **Secret slots** via `{{secretKey:label}}` references (Phase 4)

The pre-send validation diagnostics surface unresolved refs in the Problems
panel.

---

## Round-trip discipline

The YAML projection is **lossy by design** — only fields the user can edit
appear. On save:

1. YAML parses to a `Partial<Request>` patch via
   `parseRequestFromYaml`.
2. The patch is applied through `applyMutation` against the existing
   request, preserving every read-only field.
3. The resulting `WorkspaceSynced` is written to the per-workspace
   `workspace.json` (under `.apicircle/workspace-<id>/`) with a
   `proper-lockfile` advisory lock.
4. VS Code's Git extension surfaces the JSON diff in Source Control.

This means: editing YAML can never accidentally delete an `id`, lose a
`folderId`, or break a referential field — those aren't in the YAML to
begin with.

---

## Cross-surface guarantee

Three-surface compatibility (Web / Desktop / VS Code) is enforced by an
automated test (`apps/vscode/test/integration/threeSurfaceCompat.test.ts`).
The same logical mutation (e.g. `request.create`) produces a **byte-identical
synced JSON** through both the desktop's `FileBackedWorkspaceProvider` and
the VS Code build's `GitWorkspaceProvider`, modulo apply-time timestamps.
Any future canonical-shape change must pass this gate before merging.

---

## Environment YAML

```yaml
# APICircle Environment — edit fields below and save to commit.
# Encrypted variables carry 'encrypted: true' + 'secretKeyId' — the ciphertext
# value is shared via Git; decryption happens at request-send time using the
# workspace passphrase (Phase 4 wires the unlock UX).

name: production

variables:
  - { key: base_url, value: 'https://api.example.com' }
  - { key: api_version, value: 'v1' }

  # Encrypted slot — value travels via Git as ciphertext;
  # the device decrypts using the workspace passphrase.
  - key: api_key
    value: 'enc:v1:zXq...K3='
    encrypted: true
    secretKeyId: ck_abc123
```

### Required fields

| Field       | Type   | Notes                                                        |
| ----------- | ------ | ------------------------------------------------------------ |
| `name`      | string | Environment name, unique within the workspace. Min length 1. |
| `variables` | array  | Per-variable rows; may be empty.                             |

### Variable rows

| Field         | Type               | Notes                                                                                          |
| ------------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| `key`         | string             | The variable name (referenced as `{{key}}` in requests).                                       |
| `value`       | string             | Either the plaintext value or the `enc:v1:<iv>:<ct>` ciphertext when encrypted.                |
| `encrypted`   | boolean (optional) | Defaults to `false`. When `true`, `value` is treated as ciphertext and decrypted at send time. |
| `secretKeyId` | string (optional)  | Slot id in `WorkspaceSynced.secretKeys`. Required when `encrypted: true`.                      |

### Language support

The VS Code extension registers `apicircle-environment` as a language id for
`.env.yaml` files. With the Red Hat YAML extension installed, the schema
([`apps/vscode/schemas/apicircle-environment.schema.json`](../apps/vscode/schemas/apicircle-environment.schema.json))
provides on-save validation. The extension itself contributes:

- **Completion** on `encrypted:` → `true / false`
- **Completion** on `secretKeyId:` → slot ids registered in the workspace
- **CodeLens** above the `name:` line → `▶ Set Active · ✕ Delete`

### Encryption discipline

Encrypted variables travel through Git as ciphertext, never as plaintext.
Two pieces of information matter:

- **`value` is the ciphertext** — `enc:v1:<iv>:<ct>` format produced by
  `encryptString` from `@apicircle/core/secrets/crypto`. The same workspace
  passphrase encrypts on one machine and decrypts on another.
- **`secretKeyId` is the per-slot id** in `WorkspaceSynced.secretKeys`. The
  slot's `salt` (also synced via Git) plus the user's local plaintext value
  combine via PBKDF2 to derive the AES-GCM key.

Phase 4 ships the vault-unlock UX (passphrase prompt, `vscode.SecretStorage`
cache, auto-lock timer). Phase 2 ships the data shape only — encrypted
variables stay encrypted in the YAML projection and never go through any
decryption path before vault arrival.

### Environment HoverProvider

Hovering on a `key:` line inside a `.env.yaml` document surfaces a panel with:

- The variable name + env name.
- For **plaintext** variables: the resolved value (truncated past 80 chars).
- For **encrypted** variables: the bound `secretKeyId` slot, plus the slot's
  `SecretKeyMeta.label` if found in `synced.secretKeys`. Missing slot →
  `⚠️ Slot id not found in 'secretKeys' — vault entry missing.`
- **Mask warnings** when a higher-priority env in
  `synced.environments.priorityOrder` defines the same key — listed in the
  order they'd override at resolve time.
- **"Not in active priority order"** note when the env isn't part of the
  active resolution chain, so users know edits won't change behaviour at
  send time.

Only `kind: 'local'` `EnvPriorityRef` entries are considered for masking;
linked-workspace env resolution lands with Phase 8.

---

## Plan YAML

`apicircle://<authority>/plans/<id>.plan.yaml` projects an `ExecutionPlan` from
`WorkspaceLocal.executionPlans[id]`. Click a plan in the Execution view or use
the **▶ Run Plan** CodeLens at the top of the YAML to invoke `apicircle.runPlan`
against that specific plan.

```yaml
# APICircle Execution Plan — edit fields below and save to commit.

name: Smoke test
stopOnAssertionFailure: true
steps:
  - requestId: req-abc
  - requestId: req-def
    enabled: false # skipped at run time; default is true
variables:
  - key: api_base
    value: https://api.example.com
envPriorityOrder:
  - local: prod
  - linked:
      workspaceId: ws-123
      envName: shared
```

| Field                       | Type     | Notes                                                                                                                                                           |
| --------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                      | string   | Plan name shown in the Execution view and run notifications. Min length 1.                                                                                      |
| `stopOnAssertionFailure`    | boolean? | When true, runPlan halts at the first failed-assertion step. Only consulted when launched `withAssertions`. Omitted = false.                                    |
| `steps`                     | array    | Run sequentially in this order.                                                                                                                                 |
| `steps[].requestId`         | string   | Must exist in `synced.collections.requests`. Reference-only — the plan doesn't copy the request body.                                                           |
| `steps[].enabled`           | boolean? | Default true. Set to false to skip the step temporarily without removing it.                                                                                    |
| `steps[].linkedWorkspaceId` | string?  | Phase 8 — execute against a linked workspace's request.                                                                                                         |
| `variables`                 | array?   | Plan-level overlay between context vars and env priority list.                                                                                                  |
| `envPriorityOrder`          | array?   | Plan-scoped overlay for `synced.environments.priorityOrder`. Empty inherits workspace order. Mixes `{local: name}` and `{linked: {workspaceId, envName}}` refs. |

---

## History run YAML

`apicircle://<authority>/history/<runId>.run.yaml` projects a `RequestRun`
or `PlanRun` from `WorkspaceLocal.history`. Lazy-loaded — clicking a run in
the History view, opening from MRU, or visiting via Go-to-File all hit the
canonical history record (no in-memory cache requirement).

Request runs render `summary / requestHeaders / requestBody / responseHeaders /
responseBody / assertions`. Plan runs render `steps[]` joined to each step's
RequestRun for method/URL/status context.

History documents are **read-only by convention** — the FS provider accepts
writes into the in-memory store so VS Code doesn't surface save errors, but
the on-disk record stays canonical. Treat them like a database SELECT result.

---

## Mock server YAML

`apicircle://<authority>/mocks/<id>.mock.yaml` projects a `MockServer` from
`WorkspaceSynced.mockServers[id]`. Click a mock in the Mock view, or use the
**▶ Start Mock** CodeLens at the top of the YAML to launch it on
`defaultPort` (or a free port when null).

```yaml
# APICircle Mock Server — edit name / defaultPort / cors below and save.

name: Pet Store mock
defaultPort: 3000
cors:
  enabled: false

# Read-only — re-import the spec via 'APICircle: New Mock' to change.
# Spec content is deliberately NOT shown — it can contain bearer tokens / API
# keys in security examples and would otherwise leak into Git. The raw spec
# stays in workspace.json and is read by the mock runtime directly.
source:
  kind: openapi
  format: json
  bytes: 4521

# Read-only — derived from source.
endpoints:
  - id: ep-abc
    method: GET
    pathPattern: /pets
    name: list pets
    defaultStatus: 200
```

| Field           | Editable? | Notes                                                                                                                                                                                                                     |
| --------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`          | ✅        | Display name (required, min length 1).                                                                                                                                                                                    |
| `defaultPort`   | ✅        | `null` picks a free port at start. Otherwise 1024-65535.                                                                                                                                                                  |
| `cors.enabled`  | ✅        | Toggle CORS on responses.                                                                                                                                                                                                 |
| `cors.origins`  | ✅        | Allowed origins. Empty + enabled = reflect any.                                                                                                                                                                           |
| `source.kind`   | ❌        | One of `openapi` / `postman` / `insomnia` / `manual`. Re-import via "New Mock" to change.                                                                                                                                 |
| `source.format` | ❌        | For `kind: openapi` only — `json` or `yaml`.                                                                                                                                                                              |
| `source.bytes`  | ❌        | Byte length of the raw spec stored in `workspace.json`. The spec content itself is deliberately omitted from this YAML projection to prevent bearer tokens / API keys in `security.example` blocks from leaking into Git. |
| `endpoints`     | ❌        | Derived from source. Per-endpoint editing lives in the desktop app.                                                                                                                                                       |

The runtime state — port + pid + requestCount — lives in
`WorkspaceLocal.mockRuntime.active` and is **never** persisted to YAML.
That's the data the Mock view + status bar read to render running state.

## See also

- [`docs/vscode-extension.md`](vscode-extension.md) — user + dev guide
- [`packages/shared/src/types.ts`](../packages/shared/src/types.ts) — canonical TypeScript schema
- [`docs/auth.md`](auth.md) — the 17 auth schemes
- [`docs/mcp-tools-reference.md`](mcp-tools-reference.md) — the AI tool surface
