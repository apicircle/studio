# Demo Workspace

A self-contained API Circle workspace that exercises every feature of
the studio against the local mock server. Plan §10.1.

## What's in here

- `.apicircle/workspace.json` — the canonical synced doc, with one folder
  per request body type plus a fourth folder of assertion-flavor requests
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

Then open the studio in your browser, point it at this
`.apicircle/workspace.json`, and send any request. The `local`
environment is preselected so `{{BASE_URL}}` resolves to
`http://localhost:4040`.

## Notes on the BEARER_TOKEN

The plan calls for an _encrypted_ `BEARER_TOKEN` variable. Encrypted
values use a master key generated locally on first boot, so we can't
ship a pre-encrypted ciphertext that round-trips across machines. The
fixture ships the bearer in plaintext — toggle the **encrypted**
checkbox in the Environments panel after loading the workspace if you
want to exercise the master-key flow end-to-end.

## CRUD execution plan

Plans live in `WorkspaceLocal` (browser IDB), not in the synced
`.apicircle/workspace.json` — so the demo plan isn't shipped here.
To recreate it:

1. Open the Execution panel.
2. Create a plan named "Users CRUD".
3. Add steps in order: `POST /users (JSON)` → `GET /users/:id` → `PUT
/users/:id` → `DELETE /users/:id`. (Use the Editor panel to clone
   `req-create-user` if you want path-param variants.)
4. Run with assertions enabled.

## Linked workspace

`examples/linked-pets-api/.apicircle/workspace.json` ships as a sibling
that this demo can link to. Use the **Link a private workspace** flow with the
`apicircle-studio` repo + the path `examples/linked-pets-api/` — when
the studio resolves a path-relative link in a future revision, this
workflow gets one click. Today, push the linked-pets-api fixture to
its own GitHub repo first, then link it the normal way.
