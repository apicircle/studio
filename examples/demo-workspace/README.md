# Demo Workspace

A self-contained API Circle workspace that exercises every request body
type and four assertion kinds against the local mock server.

## What's in here

- `.apicircle/workspace-<id>/workspace.json` — the canonical synced doc, with one folder
  per request body type plus a ninth folder of assertion samples
  (status, header, json-path, duration). One environment `local` whose
  `BASE_URL` points at the Hono mock server's default port (4040).
- The folder tree mirrors the body-type taxonomy: None, JSON, Text,
  XML, URL-encoded, Form-data, GraphQL, Binary, plus assertion samples.

## Run the demo

```sh
# In one terminal: start the mock backend
pnpm --filter @apicircle/example-mock-server start

# In another terminal: start the web app
pnpm dev:web
```

Then open `examples/demo-workspace/` in VS Code with the API Circle Studio
extension (it finds `.apicircle/registry.json`), or push the folder to a
GitHub repository and connect it in the web or desktop app, and send any
request. The `local`
environment is preselected so `{{BASE_URL}}` resolves to
`http://localhost:4040`.

## Notes on the BEARER_TOKEN

The plan calls for an _encrypted_ `BEARER_TOKEN` variable. Encrypted
values use a master key generated locally on first boot, so we can't
ship a pre-encrypted ciphertext that round-trips across machines. The
fixture ships the bearer in plaintext — press **Encrypt** on the
`BEARER_TOKEN` row in the Environments panel and bind it to a Secret
Vault key if you want to exercise that flow end-to-end.

## CRUD execution plan

Execution plans are part of the synced workspace (`executionPlans` in
`workspace.json`), but this fixture ships none. To create one:

1. Open the Execution panel.
2. Create a plan named "Users CRUD".
3. Add steps in order: `POST /users (JSON)` → `GET /users/:id` → `PUT
/users/:id` → `DELETE /users/:id`. (Use the Editor panel to clone
   `req-create-user` if you want path-param variants.)
4. Run with assertions enabled.

## Linked workspace

`examples/linked-pets-api/` is a second fixture for workspace linking,
which is turned off in the product (`WORKSPACE_SHARING_ENABLED`).
