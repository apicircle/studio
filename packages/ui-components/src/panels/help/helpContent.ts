// Help Center content. One section per top-level concept. Sections are
// reference material — each explains what a surface does, the options it
// offers, the behaviour that isn't obvious, and shows worked examples.
//
// Bodies use a small markup subset rendered by `HelpPanel`:
//   - blank lines separate blocks
//   - a block that is a single `## ` line is a sub-heading
//   - a block whose every line starts with `- ` is a bullet list
//   - a block whose every line is indented by four spaces is a verbatim
//     code / example block (indent stripped, no inline markup, no blank
//     lines inside it)
//   - inline `**bold**` and `` `code` `` spans
//
// Keep the prose accurate to the shipping app — when a feature changes,
// the matching section is part of the change.

export interface HelpSection {
  /** Stable id used for anchor links and search-result jump targets. */
  id: string;
  title: string;
  /** Marked-up body; see the module comment for the supported subset. */
  body: string;
  /** Search keywords that aren't in the body — used to widen substring matches. */
  keywords?: string[];
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'welcome',
    title: 'Welcome',
    body: `API Circle Studio is a workspace for designing, running, sharing, and mocking HTTP request collections. It runs in the browser and as a desktop app, and ships a companion command-line tool.

## The two-document workspace model

Every workspace is split into two JSON documents, and knowing which is which explains most of the app's behaviour:

- **Synced** — the team-shared half, pushed to Git as \`workspace.json\`. Requests, folders, environments, mock-server definitions, execution plans, releases, linked workspaces, global assets, and secret metadata.
- **Local** — the per-device half, kept in IndexedDB and never sent anywhere. Run history, your GitHub session, decrypted secret values, workspace snapshots, and UI state.

A quick rule: if a teammate should see it, it is synced; if it is private to this machine, it is local. Example — you build a request and push:

    Synced  -> the request definition travels to GitHub in workspace.json
    Local   -> every Send you ran, and the response bodies, stay local

## Finding your way around

- **Top navigation** — nine panels. Switch with a click or with **Ctrl/Cmd + 1-9** (1 = Workspace ... 9 = Help Center).
- **Inspector dock** — a resizable right-side dock with three tabs: Variables, Vault, and Assets. **Ctrl/Cmd + K** jumps to the Vault tab.
- **Workspace switcher** — the \`/ name\` chip in the top bar. One browser can hold several independent workspaces.
- **Settings** — the gear in the top bar: theme, font, text size, and behaviour toggles.

First time here? An onboarding tour runs on first launch — replay it any time from the button at the bottom of this Help Center.`,
    keywords: ['intro', 'about', 'overview', 'getting started', 'panels', 'dock', 'two document'],
  },
  {
    id: 'workspace-and-git',
    title: 'Workspace & Git',
    body: `The Workspace panel connects your workspace to a GitHub repository and runs the working-branch sync model. With no GitHub session it stays in local-only mode — fully usable, nothing leaves your machine.

## Connecting

- Open Secret Vault → Sessions and sign in (device flow) or paste a personal access token. A token needs the \`repo\` scope to read and push, and \`pull_request\` to open PRs.
- Point the workspace at a repository. The status chip moves "Local Workspace" → "Repo connected" → "Branch ready".
- Create a working branch — every push targets it, never the default branch directly.

## You always have exactly one working branch

The app tracks one working branch at a time — there is no multi-branch switcher. The branch card shows Push, Refresh, Create PR, and **Discard working branch**.

## Switching to another branch without losing local data

To move to a different branch, **discard** the current one and **create** a new one from a different base:

    Branch card        ->  Discard working branch
    Create branch form ->  base branch: release/2.x  ->  Create working branch

Discarding only clears the branch pointer. It does **not** touch your local document — run history, request drafts, decrypted secrets, snapshots, and UI state all survive — and it does not delete the branch on GitHub. So switching branches is safe: nothing local is lost. Whether you then Push your current synced doc to the new branch, or Refresh to pull that branch's \`workspace.json\`, decides the content you work against.

## Replacing your local workspace with what is on Git

When you want to discard local edits and take the remote copy:

- **Refresh** runs a 3-way diff (last-pulled base vs. your local vs. remote). With no conflict it merges automatically. On conflict the resolver opens — choose **Accept theirs** on every entry to take the remote version wholesale.
- **First-pull "Overwrite"** — point a working branch at a branch that already holds a \`workspace.json\` you have never pulled and a banner asks whether to overwrite. Pull (do not overwrite) to adopt the remote content.
- **Restore a snapshot** — History → Snapshots can roll the synced doc back to any captured state.

## Moving to another machine

The synced half travels through Git; the local half does not. On a second machine:

    1. Sign in to GitHub (Secret Vault -> Sessions) -- sessions never sync
    2. Connect the same repository
    3. Create a working branch and Refresh -- workspace.json loads

**Comes back automatically:** every request, folder, environment, mock-server definition, execution plan, global asset, and release — plus the metadata for your encrypted values.

**Does NOT transfer (per-device):** run history, workspace snapshots, the GitHub session, UI state, and the decrypted values in your Secret Vault. Encrypted environment variables travel as ciphertext and decrypt once you re-enter the workspace passphrase; Secret Vault values and the GitHub token must be re-added on the new machine.

## When a branch ends

If the branch's PR is merged or the branch is deleted on GitHub, Refresh retires it and shows a banner ("PR #12 was merged"). Create a fresh working branch to keep going.`,
    keywords: [
      'github',
      'pat',
      'token',
      'push',
      'pull',
      'refresh',
      'branch',
      'switch branch',
      'sync',
      'pr',
      'conflict',
      'machine',
      'first pull',
    ],
  },
  {
    id: 'link-workspace',
    title: 'Link Workspace',
    body: `Linking lets one workspace consume another workspace's published releases — a dependency relationship, one level deep (links are not transitive).

## Adding a link

- **Private link** — enter \`owner/name\` or \`owner/name@branch\`. Needs a GitHub session with access to that repo.
- **Marketplace link** — search the public marketplace and link a result. No session needed for public repos.

Example — linking a shared "Payments API" workspace:

    Link Workspace  ->  Link a private workspace
    owner/name:  acme/payments-workspace@main

## Marketplace discovery

The public marketplace is GitHub itself. Every API Circle workspace repo carries the \`apicircle\` topic (the Releases & Topics dialog locks it on), and marketplace search scopes to repos that have it. A workspace becomes discoverable simply by being a public repository.

Within that set, discovery runs on **GitHub repository topics** — free-form category labels the publisher picks, such as \`payments\`, \`graphql\`, or \`billing\`. Searching "payments" matches every public workspace tagged or described for payments.

## Working with a linked card

Each linked workspace shows a card with its source \`repo@branch\`, its pinned version, and how many versions are cached:

    acme/payments-workspace@main
    Pinned: v2.3.0   .   5 versions cached
    [Refresh]  [Review update -> v2.4.0]  [Changelog]  [Unlink]

- **Refresh** — pull the latest **release history** from the source.
- **Review update** — when a newer version exists, opens a 3-way preview so you adopt / keep / pick per entity.
- **Changelog** — every cached version with its notes.
- **Discard mods** — drop your local overrides on the linked content.
- **Unlink** — remove the link and its cached copy.

Pinning, unpinning, and unlinking always route through a confirmation dialog.

## Overrides and required secrets

You can override a linked request's headers, context variables, extractions, and assertions without touching the source — overrides live in your synced doc and sync via Git. A linked workspace can declare required secret keys; those become inputs that write through to your Secret Vault tagged origin "linked".`,
    keywords: [
      'link',
      'connection',
      'marketplace',
      'consume',
      'dependency',
      'pin',
      'changelog',
      'linked',
      'topic',
      'release history',
      'public',
    ],
  },
  {
    id: 'release-management',
    title: 'Release Management',
    body: `A workspace owns its **release history** inside \`workspace.json\`, under \`releases.self.versions\`. There is no GitHub Actions integration and no tag automation — the workspace document is the source of truth.

## Publishing — worked example

Your collection is stable and you want to cut v1.4.0:

    1. Workspace panel -> Releases -> Publish
    2. Version: 1.4.0   Notes: "Add /refunds endpoints; fix header casing"
    3. Publish -> the version is written into workspace.json and pushed
    4. Merge the PR, then Workspace -> Release & topics -> Tag release

Publishing stamps a SHA-256 of the pre-publish workspace into the version record, so a consumer can verify the contents are intact. The typical order is **publish → merge PR → tag**.

Duplicate versions and invalid semver are rejected:

    1.4.0   accepted
    1.4     rejected -- not a full semver
    1.4.0   rejected on a second try -- already published

## Lifecycle — deprecate and withdraw

A published version moves through states:

    v1.4.0   published    normal, recommended
    v1.3.0   deprecated   still usable; consumers see "advised against"
    v1.2.0   withdrawn    broken/unsafe; consumers warned to move off it

- **Deprecate** routes through a confirm dialog.
- **Withdraw** needs typed confirmation — you type \`WITHDRAW v1.2.0\` exactly. Withdrawn versions show a "withdrawn" badge.

## Tag & Topics

The Releases & Topics dialog cuts a Git tag for the latest untagged version (optionally a GitHub Release with notes), and edits the repo's topics:

    Tag:     v1.4.0  ->  refs/tags/v1.4.0 @ <default-branch HEAD sha>
    Topics:  apicircle (locked), payments, rest, billing

Tags always point at the default branch's HEAD, never at unmerged working-branch commits. The \`apicircle\` topic is locked because it makes the repo discoverable in the marketplace.

## How consumers see it

A workspace that links yours caches your release history under \`releases.perLink\` and refreshes it on demand — that cache is what a linked card's Changelog and "Review update" read from.`,
    keywords: [
      'release',
      'publish',
      'version',
      'semver',
      'deprecate',
      'withdraw',
      'yank',
      'tag',
      'topics',
    ],
  },
  {
    id: 'editor',
    title: 'Editor',
    body: `The Editor panel builds and sends requests. The sidebar is a searchable tree of folders and requests; the main pane is the request editor; the response opens in a split pane after a Send.

## The collection tree

- **New request / New folder** — from the sidebar header menu, or a folder's row menu to nest inside it.
- **Search** filters by name or method and keeps matches' ancestors visible.
- **Row menu (⋮)** — requests offer Rename, Duplicate, Delete; folders add New request, New folder, Set/Edit auth. Deleting a folder needs a typed \`DELETE\` confirmation.

## Anatomy of a request

A request is a method, a URL, and six tabs. Worked example — a request that creates a user:

    POST   {{BASE_URL}}/v1/users

- **Params** — query parameters, path placeholders, and cookies, across three sub-tabs. Query becomes \`?key=value\`; Path fills \`{...}\` placeholders in the URL (URL \`.../users/{id}\` + Path \`id = 42\`); Cookie sends request cookies.
- **Headers** — custom headers, with key autocomplete and value suggestions, e.g. \`Content-Type: application/json\` and \`X-Request-Id: {{RUN_ID}}\`.
- **Auth** — the authentication scheme; see Auth types.
- **Body** — the request payload; see Request body.
- **Context** — per-request variables and response extractors; see Context & extractors.
- **Assertions** — pass/fail checks on the response; see Assertions.

Tab labels show counts ("Params (2)", "Headers (3)") and the Auth tab shows the active scheme.

## Method, URL, and Send

Methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS. The URL bar composes the base URL with query params and shows an effective-URL preview with variables resolved:

    URL bar:        {{BASE_URL}}/v1/users?role={{ROLE}}
    Effective URL:  https://api.example.com/v1/users?role=admin

**Send** runs the request through the resolver, applies the active environment, and shows the response with assertion verdicts inline. The shortcut is **Ctrl/Cmd + Enter** — it works from inside the body editor too.

## Pre-send validation

With "Validate before sending" on (Settings → Behavior), a pre-send panel lists **blockers** (red — Send is disabled, e.g. a missing URL) and **warnings** (yellow — non-blocking). Studio auto-injects a few headers — \`X-Client-Name\`, \`X-Client-Version\`, the W3C \`traceparent\` — which you override by adding a header of the same name.`,
    keywords: [
      'request',
      'send',
      'sidebar',
      'folder',
      'tree',
      'kebab',
      'method',
      'url',
      'params',
      'headers',
      'anatomy',
    ],
  },
  {
    id: 'request-body',
    title: 'Request body',
    body: `Pick a body type on the Body tab. The \`Content-Type\` header auto-syncs with the type, so you rarely set it by hand.

## Body types — with examples

- **none** — no body. Used for most GET requests.
- **json** — a Monaco editor, JSON-validated, with a prettify action.
- **text** — a plain editor for raw text payloads.
- **xml** — a Monaco editor with XML highlighting.
- **graphql** — a split pane: the query on the left, JSON variables on the right.
- **urlencoded** — key/value rows encoded as \`application/x-www-form-urlencoded\`.
- **form-data** — multipart rows, each a text field or a file field. "Add text" / "Add file" create rows.
- **binary** — one file from disk, sent as the raw body (e.g. an image upload).

A json body:

    {
      "name": "Ada Lovelace",
      "role": "admin"
    }

A graphql body — query plus variables:

    query ($id: ID!) { user(id: $id) { name role } }
    variables:  { "id": "42" }

A urlencoded body — rows become an encoded string:

    grant_type = client_credentials   ->   grant_type=client_credentials
    scope      = reports:read         ->   scope=reports%3Aread

## Files and limits

Files attached via form-data or binary bodies are stored locally as blobs. Files over 100 MB are refused (GitHub's blob limit); 10-100 MB warn and recommend Git LFS.

The Monaco editors (json, xml, text, the graphql query) support fullscreen — press the maximize control, **Esc** to exit.`,
    keywords: [
      'body',
      'json',
      'text',
      'xml',
      'graphql',
      'urlencoded',
      'form-data',
      'binary',
      'content-type',
      'file',
      'attachment',
    ],
  },
  {
    id: 'auth-types',
    title: 'Auth types',
    body: `The Auth tab sets a request's authentication scheme. Folder-level auth applies to every descendant request set to "Inherit"; a request opts out with "None".

## Shared-secret schemes

- **None / Inherit** — no auth, or take the nearest ancestor folder's auth.
- **Bearer Token** — sends \`Authorization: Bearer <token>\`. Example: paste \`{{API_TOKEN}}\`.
- **Basic Auth** — username + password, base64-encoded into \`Authorization: Basic ...\`.
- **API Key** — a key in a header, query parameter, or cookie, e.g. header \`X-Api-Key: {{KEY}}\`.
- **Custom Header** — any header name and value.

## How OAuth 2.0 works here

Six grants are supported: Client Credentials, Authorization Code, PKCE, Password (ROPC), Implicit, and Device Code. The Auth tab shows **Get token / Refresh / Clear** actions under the form.

Worked example — Client Credentials:

    Token URL:      https://id.example.com/oauth/token
    Client ID:      svc-reporting
    Client secret:  {{OAUTH_SECRET}}
    Scope:          reports:read
    Get token   ->  access token stored on the request, expiry tracked

Once a token is on file, Send injects it as \`Authorization: Bearer ...\`. When the token is near expiry and a refresh token exists, Studio refreshes it automatically before the request goes out — you rarely press Refresh by hand. (Implicit grants have no refresh token, per the spec.) Authorization Code and PKCE need a browser redirect: on desktop a loopback callback server catches it; on the web a popup window relays the result back over a BroadcastChannel.

## OAuth and the CLI — the limitation

Browser-redirect grants need an interactive browser, so they **cannot complete from the \`apicircle\` CLI** — there is no window to host the consent screen:

    Client Credentials   works -- CLI can fetch the token (no browser)
    Password (ROPC)      works -- CLI can fetch the token (no browser)
    Device Code          works -- CLI prints a code + URL to open elsewhere
    Authorization Code   no    -- needs an interactive browser
    PKCE                 no    -- needs an interactive browser
    Implicit             no    -- needs an interactive browser

For a redirect grant in a headless context, acquire the token interactively in the app, then reference it through an environment variable (\`{{MY_TOKEN}}\`) the CLI can read.

## Signing and challenge schemes

- **AWS SigV4** — signs with access key, secret, region, and service.
- **Digest** — challenge-response; Studio handles the 401 retry and nonce rotation.
- **NTLM** — the Type 1/2/3 handshake.
- **Hawk** — a Hawk MAC with SHA-256 or SHA-1.
- **JWT Bearer** — signs a JWT on the fly (HS256/384/512, RS256/384/512, ES256).

## Token storage

OAuth tokens are written into the same Git-pushed JSON as the rest of the request. For per-user tokens, reference an environment variable (\`{{MY_TOKEN}}\`) instead of pasting the token directly.`,
    keywords: [
      'auth',
      'oauth',
      'oauth2',
      'pkce',
      'sigv4',
      'ntlm',
      'digest',
      'hawk',
      'jwt',
      'bearer',
      'basic',
      'api key',
      'cli',
      'token',
    ],
  },
  {
    id: 'assertions',
    title: 'Assertions',
    body: `Assertions are checks that run against the response after every Send. A request can carry any number; their pass/fail verdicts show inline on the response.

## Kinds and operators

- **Status** — the HTTP status code.
- **Duration (ms)** — how long the request took.
- **Header** — a named response header (you give the header name as the target).
- **JSON path** — a value inside a JSON body (you give the path; a picker can build it from the last response).

Status and Duration support \`=\`, \`≠\`, \`<\`, \`>\`; Header and JSON path support \`=\`, \`≠\`, \`contains\`, \`matches\` (regex).

## Examples

    Kind           Operator   Expected            Target
    Status         =          200
    Duration (ms)  <          800
    Header         contains   application/json    Content-Type
    JSON path      =          admin               $.user.role
    JSON path      matches    ^usr_[a-z0-9]+$     $.user.id

After a Send each row shows a green **Pass** or red **Fail** badge. Run a request inside an execution plan "with assertions" and the verdicts fold into a per-step pass/fail flag.

Inside the table, **Enter** appends a row and **Backspace** on an empty row removes it.`,
    keywords: [
      'assertion',
      'assert',
      'test',
      'verdict',
      'pass',
      'fail',
      'status',
      'duration',
      'json path',
      'matches',
    ],
  },
  {
    id: 'context-variables',
    title: 'Context & extractors',
    body: `The Context tab gives a request its own variables and pulls values out of responses for later requests to use. This is how you chain requests.

## Manual context variables

Name/value pairs that resolve as \`{{NAME}}\`. They sit at the top of the resolver order — above environments and secrets — so they are the place for per-request overrides:

    pageSize = 50    ->    used in the URL as ?limit={{pageSize}}

## Response extractors — the login-then-call pattern

An extractor captures a value from one response and writes it into the local context, where the next request reads it as \`{{NAME}}\`. Each extractor has an enabled toggle, a target name, and a source.

Worked example — log in, then call a protected endpoint:

    Request 1   POST /auth/login
      Extractor:  name   = AUTH_TOKEN
                  source = Body / JSON path
                  path   = $.data.accessToken

    Request 2   GET /me
      Auth = Bearer Token,  token = {{AUTH_TOKEN}}

    Send request 1, then request 2 -- the token flows across automatically.

## Extractor sources

- **Body / JSON path** — a value at a JSON path, e.g. \`$.data.accessToken\`.
- **Response header** — a named header, e.g. \`Location\` or \`X-Request-Id\`.
- **Cookie** — a cookie the response set, e.g. \`session\`.
- **Status code** — the numeric status, useful for branching assertions.

Extracted values are local-only — they live in this machine's context, never in the synced doc. A JSON path picker helps build the path once a JSON response exists.`,
    keywords: [
      'context',
      'variable',
      'extractor',
      'extraction',
      'chain',
      'json path',
      'capture',
      'login',
      'token',
    ],
  },
  {
    id: 'importing',
    title: 'Importing requests',
    body: `Bring requests in from other tools instead of building them by hand.

## Import in the app

The Editor sidebar's Import action opens a modal that takes pasted text or an uploaded file and auto-detects the format — Postman v2.1 collections, Postman environments (keys import as context variables), Insomnia v4 exports, and pasted cURL commands:

    curl -X POST https://api.example.com/v1/users \\
      -H "Content-Type: application/json" \\
      -d '{"name":"Ada"}'

Pasting a command that begins with \`curl \` straight into the URL bar also offers a one-step import. The modal previews the folder structure and request count before you confirm.

## Import on the command line

\`apicircle import <type> <input>\` writes one request per operation into a workspace folder's \`workspace.json\`:

    apicircle import openapi  ./petstore.yaml
    apicircle import postman  ./team-collection.json
    apicircle import curl     -  < request.txt

\`<type>\` is \`openapi\`, \`postman\`, \`insomnia\`, or \`curl\`; \`<input>\` is a file path or \`-\` for stdin.

## Bringing in another API Circle workspace

API Circle workspaces are not shared as loose files — they live in Git. To use another API Circle workspace's collections you have two paths:

- **Link it** (Link Workspace) — consume its published releases read-only, with optional per-request overrides. Best when you depend on someone else's API.
- **Connect its repo** (Workspace panel) — open the workspace directly to edit it. Best when it is your own workspace on another machine.

A workspace snapshot can also be downloaded as a \`WorkspaceSynced\` JSON file from History → Snapshots — a portable, offline copy of the whole workspace state.`,
    keywords: ['import', 'curl', 'openapi', 'postman', 'insomnia', 'har', 'spec', 'collection'],
  },
  {
    id: 'response-viewer',
    title: 'Response viewer',
    body: `After a Send, the response opens in a pane beside the request editor.

## The status bar

A colour-coded badge plus timing and size. Green is success, yellow a warning, red an error. Example readouts:

    200 OK            124 ms   1.8 KB
    404 Not Found      88 ms   312 B
    500 Server Error   2.1 s   4.0 KB

A fullscreen control expands the viewer.

## Response tabs

**Body** — syntax-highlighted with the format detected from \`Content-Type\`. An empty body shows a clear "Empty response body" state:

    {
      "id": "usr_8a1",
      "name": "Ada Lovelace",
      "role": "admin"
    }

**Headers** — every response header as a key/value table:

    content-type   application/json
    x-request-id   req_5f2c9
    cache-control  no-store

**Assertions** — each assertion's verdict:

    Status = 200       Pass
    Duration < 800     Pass
    $.role = admin     Fail  (got "viewer")

## Transformations

For large JSON the viewer suggests more compact forms — TOON, YAML, CSV — and shows the saving, measured against minified JSON so the number is honest:

    Original (minified)   41.2 KB
    As TOON               22.7 KB   (-45%)

Every response is also recorded in History, where you can reopen it later.`,
    keywords: [
      'response',
      'status',
      'duration',
      'size',
      'headers',
      'body',
      'transformation',
      'toon',
      'viewer',
    ],
  },
  {
    id: 'environments',
    title: 'Environments',
    body: `Environments are named key/value sets that resolve \`{{NAME}}\` placeholders in URLs, headers, query params, and bodies.

## The resolver order

Placeholders resolve in a fixed order; the first match wins:

    1. Context variables     (per-request + extracted values)
    2. The environment layer (the environments in the priority list, in order)
    3. Secret Vault          (encrypted secrets, by label)

Example — \`{{BASE_URL}}\` with a "Staging" and a "Prod" environment:

    Staging   BASE_URL = https://staging.api.example.com
    Prod      BASE_URL = https://api.example.com

Whichever environment sits higher in the priority list wins.

## Managing environments

Create environments from the sidebar; rename inline. Each variable is a key/value row, and duplicate keys are flagged. A "Layer position N of M" badge shows where an environment sits in the global priority list. Environments can be duplicated, exported as JSON, and deleted.

## Encrypted variables — and how the encryption works

Toggle a variable to **encrypted** to bind it to the Secret Vault. The plaintext never goes to Git — only ciphertext does.

The cipher is **AES-GCM** with a 256-bit key and a fresh 12-byte IV per value. The key is derived from your workspace passphrase with **PBKDF2-HMAC-SHA-256 at 1,200,000 iterations** over a per-workspace random salt — so a weak passphrase still costs an attacker dearly, and the same passphrase on two machines derives the same key.

What actually travels in \`workspace.json\`:

    PUBLISHED_KEY = enc:v1:<base64 IV>:<base64 ciphertext>

— never the plaintext. The salt and iteration count are stored alongside as crypto parameters (not secrets), plus a verifier that lets the app reject a wrong passphrase up front.

## Web vs. Desktop — where the key lives

The encryption is identical; only how the master key is protected differs:

- **Desktop** — the key is wrapped by the OS keychain through Electron \`safeStorage\` (macOS Keychain, Windows Credential Manager, Linux libsecret). It never sits unprotected on disk, and a payload encrypted by one machine/user will not decrypt on another.
- **Web** — there is no OS keychain, so a workspace passphrase model is used: you set a passphrase of 12+ characters, the app derives the key from it, and holds the key in memory only for the session. After a reload you re-enter the passphrase.

In both cases the passphrase and key are never written to Git and never persisted in plaintext. The trade-off: there is **no recovery** — lose the passphrase and the encrypted values cannot be read; teammates need the same passphrase to decrypt shared encrypted variables.`,
    keywords: [
      'env',
      'environment',
      'variable',
      'placeholder',
      'encrypted',
      'priority',
      'resolver',
      'aes',
      'encryption',
      'passphrase',
    ],
  },
  {
    id: 'secret-vault',
    title: 'Secret Vault',
    body: `The Secret Vault holds encrypted credentials, keyed by label. It opens as the Vault tab in the right-side inspector dock — **Ctrl/Cmd + K** jumps straight to it. Your GitHub sign-in lives next door under Sessions — see the Sessions section.

## What a vault entry is

Each entry is a label and a value. Saving encrypts the value with AES-256-GCM under your workspace master key (see Environments → how the encryption works). Example entries:

    STRIPE_KEY      ............   origin: workspace   used in 2 places
    PARTNER_TOKEN   ............   origin: linked      used in 1 place

- Values are masked; reveal them briefly, or copy to clipboard.
- An **origin** badge marks each key "workspace" (you created it) or "linked" (a linked workspace asked for it).
- A **"where used"** list tracks the environments, requests, and link cards that consume the key — and delete is blocked while a key is still in use, so you cannot strand a reference.
- After cloning a workspace a **missing-slots gate** prompts you to fill any keys that have no local value yet.

## How it is stored

The encrypted values live in this machine's IndexedDB and are never pushed to Git — only the key labels and crypto parameters sync. A teammate therefore sees which secrets a workspace needs, but only someone who enters a value on their own machine can use it. Moving machines, you re-enter vault values once.`,
    keywords: ['secret', 'vault', 'credential', 'encrypted', 'masked', 'used in', 'origin'],
  },
  {
    id: 'sessions',
    title: 'Sessions',
    body: `The Sessions tab — alongside Vault in the inspector dock — manages your GitHub sign-in. It is what authorises push, pull, refresh, and pull-request creation.

## Signing in

Two ways:

- **Device flow** — the app shows a short code; you enter it on \`github.com/login/device\`. No token to copy.
- **Paste a token** — a personal access token (classic \`ghp_...\` or fine-grained \`github_pat_...\`).

Either way the token is verified with a \`GET /user\` call before it is accepted. The tab then shows the account, the granted scopes, and the last-verified time:

    Signed in as  ada-dev
    Scopes        repo, pull_request
    Verified      2 minutes ago

A token needs \`repo\` (read + push) and \`pull_request\` (open PRs). If \`pull_request\` is missing the tab warns you.

## How the token is stored

The token is **encrypted with AES-256-GCM under your master key** and written to this machine's IndexedDB — the same vault store as your secrets. It is **never pushed to Git**: the synced doc holds only session metadata (the account login, the granted scopes, timestamps, and a pointer to the encrypted entry). So a teammate pulling your workspace never receives your token, and you sign in fresh on each machine.

## If the token is revoked

Revoke or expire the token on GitHub and the next push/pull/refresh fails with an "unauthorized" error; the Workspace panel shows a **Reconnect** button. The session is **not** wiped automatically — your branch and repo connection are kept — so reconnecting with a fresh token resumes exactly where you were.

## Disconnecting

"Disconnect" on the Sessions tab does a clean teardown:

    1. Deletes the encrypted token from this machine's vault store
    2. Removes the session metadata
    3. Clears the repo connection and the working-branch pointer

The GitHub repository, the branch, and your commits are untouched on GitHub — only this device's credentials are removed. Reconnect any time to pick the workspace back up.`,
    keywords: [
      'session',
      'sessions',
      'github',
      'token',
      'pat',
      'sign in',
      'device flow',
      'disconnect',
      'revoked',
      'reconnect',
    ],
  },
  {
    id: 'execution-plans',
    title: 'Execution Plans',
    body: `An execution plan runs a sequence of requests in order — for login-then-call chains and smoke suites.

## Building a plan — example

    Plan: "Smoke -- core API"
      1. POST /auth/login       (extracts AUTH_TOKEN)
      2. GET  /me               (Bearer {{AUTH_TOKEN}})
      3. GET  /projects?limit=5
      4. POST /projects         (body: a new project)

Add steps with the step picker — it lists local and linked requests, filterable by name. Each row has an enable/disable checkbox, up/down reorder arrows, a quick-view (the resolved request, read-only), and a remove control.

- **Plan variables** — key/value pairs scoped to the plan, sitting between extracted globals and the environment priority.
- A **plan-level environment priority** can override the workspace order for this run only.

## Running

- **Run** executes the steps and ignores assertions.
- **Run with assertions** folds each request's assertion verdicts into a per-step pass/fail flag.
- **Stop on assertion failure** halts at the first failing step.

The last-run summary reads like:

    3/4 requests succeeded . 6/7 assertions ok . 612 ms

Each step expands to its URL, response, and assertions, with its own Retry. Plan **definitions** are part of the synced doc and push to Git with the workspace; plan **runs** are recorded only in this machine's History.

## Running plans headlessly / in CI

The \`apicircle\` CLI runs plans without the app — point it at a workspace folder and name the plan:

    apicircle run "Smoke -- core API" --reporter junit

It resolves variables, executes the steps, evaluates assertions, and exits \`0\` when every step passes or \`1\` when one fails — so a CI job can gate a merge on a plan. \`--bail\` stops at the first failed step, \`--env <name>\` layers an environment onto the run, and \`--reporter json|junit\` emits a machine-readable report. Encrypted environment variables are supplied at runtime via \`--secrets\` or \`APICIRCLE_SECRET_*\` — their values never travel through Git. See Command-line (CLI) for the full flag list.

The web and desktop apps still run plans interactively with the live last-run summary shown above; the CLI is the headless path.`,
    keywords: [
      'plan',
      'execution',
      'sequence',
      'step',
      'run',
      'assertions',
      'retry',
      'ci',
      'pipeline',
      'smoke',
      'cli',
      'junit',
    ],
  },
  {
    id: 'history',
    title: 'History',
    body: `Every Send and every plan run is recorded in History — a local-only log, newest first.

## What is stored

For each request run: the method, URL, status, duration, response headers and body, and assertion verdicts. For each plan run: a summary plus the per-step results. History is part of the local document — it never pushes to Git, and clearing browser storage clears it.

## Tabs

- **Requests** — individual Sends.
- **Plans** — plan-run summaries that expand to per-step detail.
- **Snapshots** — the workspace snapshot list (see Workspace snapshots).

The Requests tab looks like:

    200  GET   List users     124 ms   2/2 ok
    401  POST  Create user      88 ms   0/1 fail
    ERR  GET   Fetch report   aborted

## Filtering and clearing

Entries group into date buckets (Today, Yesterday, then by day/month/year). Narrow the list by free-text search (name, method, status, or URL substring), by status bucket (\`ok\`, \`4xx\`, \`5xx\`, \`error\`), by HTTP method, or by a date range.

Clearing is **filter-aware** — the clear button reflects the current filter:

    Filter: status = 5xx    ->  "Clear matching" removes only those rows
    No filter               ->  "Clear all" empties the tab

So you can prune just the noise (say, every \`error\` run from a flaky afternoon) without losing the rest.

## Storage footprint

History is a circular buffer capped by a fixed maximum number of runs — once full, the oldest run drops as a new one lands, so it never grows without bound. It lives entirely in this browser's IndexedDB. To reclaim space immediately, use the filter-aware clear above.`,
    keywords: ['history', 'logs', 'past runs', 'buffer', 'filter', 'clear', 'date range'],
  },
  {
    id: 'snapshots',
    title: 'Workspace snapshots',
    body: `A snapshot is a full copy of the synced document, saved into a local list so you can roll back.

## When snapshots are taken

- **Automatically** — before every push, merge, linked-workspace update, withdraw, and deprecate.
- **Manually** — "Take snapshot now" on History → Snapshots, with an optional note.

Each row shows what triggered it, when, and its size:

    Before push             2026-05-18 09:14   1.2 MB
    Manual "pre-refactor"   2026-05-17 16:40   1.1 MB

## Restoring

Restore swaps the synced doc back to the captured state. A confirm dialog shows a counts-after-restore table so you see the magnitude before committing, and you type \`RESTORE\` to proceed:

    Category        Now   After   change
    Requests         48     41     -7
    Environments      5      5      0
    Mock servers      3      2     -1

Restore also clears the diff base, so the next push surfaces the restore as a fresh re-fork against the remote.

## Downloading a snapshot

Each row has a **Download** button — it saves that snapshot as an \`apicircle-snapshot-<timestamp>.json\` file (the complete \`WorkspaceSynced\` document). Use it as a portable offline backup, to inspect the workspace JSON directly, or to hand the state to a teammate outside Git.

## How much space it uses

Snapshots live only on this machine. They are kept within a size budget — pick **10 / 50 / 200 MB or Unlimited** in Settings → Workspace snapshot cap. When the total goes over budget, the oldest snapshots drop first. The Snapshots header shows current usage, e.g. \`4 entries . 4.6 MB of 50 MB\`.`,
    keywords: ['snapshot', 'restore', 'rollback', 'backup', 'download', 'undo', 'cap'],
  },
  {
    id: 'mocks',
    title: 'Mock servers',
    body: `A mock server stands in for a real API — describe the endpoints and Studio answers requests on \`localhost\`. Definitions are data and live in the synced doc; running one needs the desktop app or the CLI.

## Creating a mock server

- **Empty** — a blank server you add endpoints to by hand.
- **From a spec** — paste an OpenAPI, Postman, or Insomnia source; it is parsed into endpoints when the server starts.

## Endpoints and the response flow

Each endpoint is a method + path pattern, edited as a flow: Endpoint → Validation → Rules → Default response. Example — a \`GET /users/:id\` endpoint:

    Default response   200   { "id": ":id", "name": "Sample User" }
    Validation rule    header X-Api-Key required  -> else 401
    Response rule      when path id = 0           -> 404 {"error":"not found"}
    Multiplier         ?count=N repeats $.items N times

- **Validation rules** — header / query / cookie / body / content-type checks; a failure short-circuits with a fail response.
- **Response rules** — conditional responses chosen by a query param, path param, header, cookie, or JSON-path body value, tried in declaration order.
- **Multipliers** — expand an array in a JSON response from a request value. \`GET /items?count=3\` repeats the template at \`$.items\` three times.

Validation and response rules can be disabled without deleting them. CORS is off by default — enable it on the server card for cross-origin clients.

## The web limitation, and how to run a mock

The **web app cannot run a mock server** — a browser tab cannot open a listening TCP socket. It can fully create and edit mock definitions; a banner reminds you to run them elsewhere. Two ways to actually run one:

    Desktop app   Start/Stop on the Mocks panel; it prints the port:
                  Started "Payments mock" on http://127.0.0.1:4100

    CLI           apicircle mock ./openapi.yaml --port 4100

Whichever you use, point your requests at the printed \`localhost\` address.`,
    keywords: [
      'mock',
      'mock server',
      'openapi',
      'postman',
      'insomnia',
      'validation',
      'response rule',
      'multiplier',
      'endpoint',
      'cors',
    ],
  },
  {
    id: 'mock-runtime',
    title: 'Mock runtime',
    body: `A mock server lets you run an API on \`localhost\` before — or instead of — the real one. You **create** mock servers in the Mocks panel (see Mock servers); this page is about **running** one and pointing your requests at it.

## Why running a mock needs the Desktop app or the CLI

A server has to open a network port and listen on it, and a browser tab is not allowed to do that. So the **web app cannot run a mock** — it can only create and edit the definition, which is why the Mocks panel shows a "run it elsewhere" banner. To actually serve traffic, use the Desktop app or the \`apicircle\` command-line tool. The definition is the same either way; only the thing that runs it differs.

## Run a mock in the Desktop app

Open the Mocks panel, select the mock server, and press **Start**. Studio boots it and shows the address it is listening on:

    Started "Payments mock" on http://127.0.0.1:4100

Send requests to that address, and press **Stop** when you are done. The mock keeps running in the background while the Desktop app is open, so you can switch panels, edit requests, and keep hitting it.

## Run a mock from the CLI

The CLI runs a mock straight from a spec file — no app needed, which is handy in a terminal workflow or for a teammate who only has the file:

    apicircle mock ./openapi.yaml

It prints the address and how many endpoints it loaded, then waits for traffic:

    Mock server listening on http://127.0.0.1:54113 with 12 endpoints (type=openapi). Press Ctrl-C to stop.

By default it picks a free port — pin a specific one with \`--port\`:

    apicircle mock ./openapi.yaml --port 4100

Stop it with **Ctrl-C**. Other options: \`--host\` (default \`127.0.0.1\`), \`--type\` to force \`openapi\` / \`postman\` / \`insomnia\`, \`--format\` for OpenAPI \`json\` / \`yaml\`, and \`--cors\`.

## Point your requests at the running mock

A mock is just an HTTP server, so use it like any other API. The tidy way is an environment variable for the base URL — then one switch swaps your whole collection between the mock and the real service:

    Environment "Mock"   BASE_URL = http://127.0.0.1:4100
    Environment "Prod"   BASE_URL = https://api.example.com

Write your requests as \`{{BASE_URL}}/v1/users\`, make "Mock" the active environment, and every Send now hits the local mock instead of production.

## "OpenAPI, Postman, or Insomnia file" — what that means

You can start a mock from three kinds of file, and the difference is worth knowing. OpenAPI is an **API description**; Postman and Insomnia files are **saved request collections**. The mock engine never runs or replays a collection — it reads the file only to learn the endpoints, then serves canned responses. How realistic those responses are depends on the source:

    OpenAPI    Highest fidelity. Endpoints plus example responses taken
               from the spec's schemas and examples (the 2xx success case).
    Postman    Endpoints from each saved request. A request's saved example
               response becomes the mock body; with no example, the
               endpoint answers 200 with an empty body {}.
    Insomnia   Endpoints only. The export format carries no example
               responses, so every endpoint starts as 200 with body {}.

So mocking a Postman or Insomnia file works fine — just expect to open the endpoints in the Mocks panel afterwards and fill in realistic responses. For the richest mock with no extra editing, start from an **OpenAPI** spec.

## How the mock decides what to answer

For each incoming request the mock checks, in order: validation rules, then response rules top to bottom, then multipliers, and finally the default response if nothing matched. If a mock returns something you did not expect, that order is where to look — a validation rule may be short-circuiting the request, or an earlier response rule may be winning. Path parameters match by position: an endpoint path \`/users/:id\` answers a request to \`/users/42\`.

## Common snags

- **"Port already in use"** — another process holds that port. Stop it, or start the mock on a different \`--port\`.
- **A browser client gets a CORS error** — turn CORS on for the server. The CLI enables it by default; in the app it is a toggle on the server card.
- **The mock stops answering** — the Desktop app was closed, or the CLI process was stopped. A mock runs only as long as its host is alive.`,
    keywords: [
      'mock runtime',
      'run mock',
      'desktop',
      'cli',
      'apicircle mock',
      'start',
      'stop',
      'cors',
      'port',
      'localhost',
      'postman',
      'insomnia',
    ],
  },
  {
    id: 'mcp',
    title: 'MCP',
    body: `The MCP server exposes your workspace to AI assistants and other Model Context Protocol clients over stdio — they read and edit it as a catalog of tools (71 of them).

## What an AI client can do

The tools cluster into areas:

- **Read & search** the workspace — requests, folders, environments, plans, assertions.
- **Author** — create / update / delete requests, folders, environments, assertions; reshape execution plans.
- **Import** — pull in OpenAPI, Postman, Insomnia, HAR, or curl as requests.
- **Mock servers** — create from a spec, edit endpoints, validation rules, response rules, multipliers.
- **History** — list, read, and purge run history.
- **Generate code** — turn a request into runnable client code.

## Code generation — the time-saver

\`generate.code\` takes a request id plus a target and returns ready-to-paste code. Targets: \`curl\`, \`fetch\`, \`node-axios\`, \`python-requests\`, \`go\`, \`rust\`.

Example — you have a request "Create user" in the workspace and ask your assistant for Python:

    generate.code  { requestId: "req_create_user", target: "python-requests" }

    import requests
    resp = requests.post(
        "https://api.example.com/v1/users",
        headers={"Content-Type": "application/json"},
        json={"name": "Ada Lovelace"},
    )

Why it saves time: the request — URL, headers, body, auth, query and path params — is already defined and tested in Studio. Codegen renders that exact, known-good request into your codebase, so the client code and the request you verified cannot drift apart. Define once, Send to confirm it works, then generate the call in whatever language your service is written in.

## Connecting a client

The MCP panel has a card per client — Claude Desktop, Claude Code, Cursor, GitHub Copilot, ChatGPT, Continue, Cline, Zed, Windsurf, and a generic stdio option — each with a copy-ready config snippet and the default config-file path.

MCP runs over stdio, so it needs the desktop app, or \`npx @apicircle/cli mcp\` from a terminal. The web build cannot expose a stdio server. Note MCP returns code as text — your assistant writes it to a file; MCP itself does not touch the filesystem.`,
    keywords: [
      'mcp',
      'model context protocol',
      'ai',
      'assistant',
      'tool',
      'claude',
      'cursor',
      'code generation',
      'codegen',
    ],
  },
  {
    id: 'desktop',
    title: 'Desktop App',
    body: `The desktop app is the Electron build of API Circle Studio. It runs the same interface as the browser build and adds the things a browser tab cannot do — running mock servers, hosting the MCP stdio server, OS-keychain secret storage, and sending requests without browser CORS or stripped cookies.

## Early Access — the desktop builds are not code-signed

API Circle Studio is pre-launch and self-funded. Code signing needs paid certificates that renew every year — an Apple Developer Program membership for macOS and an EV code-signing certificate for Windows — and the project cannot fund them yet. So the desktop binaries ship **unsigned**.

That is expected, not a sign of a tampered download. What you will see:

- **macOS** — Gatekeeper says the developer "cannot be verified". Approve it once under System Settings → Privacy & Security → Open Anyway.
- **Windows** — SmartScreen shows "Windows protected your PC". Click More info, then Run anyway.
- **Linux** — no signing prompt; the AppImage and \`.deb\` run directly.
- **Auto-updates** — each update is unsigned too, so the same one-time approval is needed after a new build installs.

The binaries are built in the open by this repository's GitHub Actions, and nothing about being unsigned touches your workspace data. Per-platform steps live in the install guide on the GitHub Releases page. Signed builds will ship once the project can afford the certificates.

## What the desktop app adds over the browser build

- **Mock servers** — Start and Stop a mock from the Mocks panel; a browser tab cannot open a listening port.
- **MCP server** — host the stdio MCP server so AI clients can drive the workspace.
- **OS-keychain secrets** — the master key is wrapped by macOS Keychain, Windows Credential Manager, or Linux libsecret instead of a workspace passphrase.
- **No browser limits** — requests send the \`Cookie\` header and are not blocked by CORS.

## Auto-update

The desktop app checks for updates and shows a banner when one is ready — click **Restart to install**. Because the build is unsigned the OS may show its security warning again for the new binary; approve it once more. An update replaces the app binary in place and never touches your workspace.`,
    keywords: [
      'desktop',
      'electron',
      'install',
      'download',
      'code signing',
      'code-signed',
      'unsigned',
      'signed',
      'certificate',
      'gatekeeper',
      'smartscreen',
      'early access',
      'auto-update',
    ],
  },
  {
    id: 'cli',
    title: 'Command-line (CLI)',
    body: `\`apicircle\` is the command-line companion to Studio — a no-Electron way to run mocks, drive the MCP server, import specs, and execute plans. It is the npm package **\`@apicircle/cli\`** and installs the \`apicircle\` command.

## Getting it

No install needed — run it on demand with npx:

    npx @apicircle/cli mock ./openapi.yaml

Or install it once, globally, for a short command:

    npm install -g @apicircle/cli
    apicircle --version

## The subcommands

Run a mock server:

    apicircle mock ./openapi.yaml --port 4100
    apicircle mock ./postman-collection.json --type postman

Options: \`--port\` (default: a free port), \`--host\` (default \`127.0.0.1\`), \`--type\` (\`openapi\`/\`postman\`/\`insomnia\`/\`auto\`), \`--format\` (\`json\`/\`yaml\`/\`auto\`), \`--cors\`.

Run the MCP server against a workspace folder, for AI clients:

    apicircle mcp --workspace ./my-workspace

Import a spec into a workspace folder's \`workspace.json\`, one request per operation:

    apicircle import openapi ./petstore.yaml
    apicircle import curl - < request.txt

\`<type>\` is \`openapi\`, \`postman\`, \`insomnia\`, or \`curl\`; \`<input>\` is a file path or \`-\` for stdin; \`--workspace\` picks the target folder.

Run a saved execution plan and report the result:

    apicircle run "Smoke -- core API" --reporter junit
    apicircle run <plan-id> --bail --env Staging

The plan is given by name or id. Options: \`--reporter\` (\`text\`/\`json\`/\`junit\`), \`--bail\` (stop at the first failed step), \`--env <name>\` (layer an environment onto the run), \`--secrets <file>\` (supply encrypted values), \`--no-assertions\`, \`--no-save\`. The exit code is \`0\` when every step passes and \`1\` when one fails, so CI can gate on it.

## Who it is for

The CLI suits power users who skip the desktop app, and CI jobs that keep a workspace checked into Git — an \`import\` step refreshes the JSON the desktop app picks up on its next pull, and an \`apicircle run\` step turns a saved plan into a merge gate. The CLI **runs mocks, the MCP server, imports, and execution plans** — it does not execute ad-hoc single requests, so wrap a one-off request in a one-step plan when you need it headless.`,
    keywords: [
      'cli',
      'command line',
      'terminal',
      'apicircle',
      'npx',
      'npm',
      'install',
      'ci',
      'run',
      'plan',
    ],
  },
  {
    id: 'global-assets',
    title: 'Global Assets',
    body: `Global Assets is a workspace-wide library of reusable schema documents. It opens as the Assets tab of the inspector dock and lives in the synced doc, so pushing the workspace shares the library with the team. It has two libraries: JSON Schemas and GraphQL definitions.

## Schemas — JSON Schema documents

Define a JSON Schema once and reuse it. An asset named "User":

    {
      "type": "object",
      "required": ["name", "email"],
      "properties": {
        "name":  { "type": "string" },
        "email": { "type": "string", "format": "email" }
      }
    }

**With an Editor request:** open the request's Body tab, set the body type to json, and pick the schema. As you type the body, the editor flags anything that does not match — a missing \`email\`, a number where a string belongs — before you Send. You catch a malformed payload while authoring instead of from a 400.

**With a mock API endpoint:** a mock endpoint carries its own validation rules (required header, body checks, and so on) defined right on the endpoint. The practical pattern is to treat the Global Assets schema as the team's canonical contract for a shape like "User", and mirror its must-have constraints in the mock endpoint's validation rules. The request side and the mock side then agree because both trace back to the same documented schema.

## GraphQL definitions

Store a GraphQL schema as SDL or as introspection JSON:

    type Query { user(id: ID!): User }
    type User  { id: ID!  name: String!  role: Role! }

A request with a graphql body that references the definition gets field and argument awareness while you write the query — a typo in a field name surfaces in the editor.

## Why one library

A single source of truth: update the "User" asset once and every request that references it moves with it — no copy-pasted schemas drifting apart. Deleting an asset is gated by a confirm dialog because it cascades: any request that referenced it has its mapping cleared.`,
    keywords: [
      'global assets',
      'asset',
      'schema',
      'json schema',
      'graphql',
      'sdl',
      'introspection',
      'library',
    ],
  },
  {
    id: 'settings',
    title: 'Settings & appearance',
    body: `The Settings chip in the top bar opens a popover of appearance and behaviour options. Settings are per-device — they live in the local document, so they do not follow the workspace to Git.

## Appearance

- **Theme** — pick a colour theme. Hovering the row opens a live preview; **Enter** commits, **Esc** reverts.
- **Font family** — the UI font, with the same live-preview behaviour.
- **Text size** — scales all UI text, including code editors, in fixed steps, with a Reset to 100%. Also available as **Ctrl/Cmd + Shift + =** / **-** / **0**. Example: bump to 120% on a 4K display, reset before a screen-share.

## Behavior

- **Validate before sending** — on: the editor shows pre-send warnings and blocks Send when required auth fields are blank. Off: Send is never blocked. Example — leave it on while authoring, turn it off to fire a deliberately malformed request.
- **Code editor captures mouse wheel** — on: scrolling inside a code editor stays there until its edge; off (default): the page keeps scrolling so a long body does not trap the wheel.
- **Workspace snapshot cap** — the size budget for the local snapshot list: **10 / 50 / 200 MB / Unlimited**. Example: set 10 MB on a small laptop, Unlimited if you lean on snapshots heavily.`,
    keywords: [
      'settings',
      'theme',
      'font',
      'text size',
      'appearance',
      'preferences',
      'validate',
      'dark mode',
    ],
  },
  {
    id: 'keyboard-shortcuts',
    title: 'Keyboard Shortcuts',
    body: `## Sending and editing

- **Send the active request** — **Ctrl + Enter** (**Cmd + Enter** on macOS). Example: you are deep in the JSON body editor — press it without reaching for the mouse and the request fires.
- **New request** — **Ctrl/Cmd + N**, when the Editor panel is active.

## Navigation

- **Switch panels** — **Ctrl/Cmd + 1-9**: 1 Workspace, 2 Link Workspace, 3 Editor, 4 Environments, 5 Execution, 6 History, 7 Mocks, 8 MCP, 9 Help Center. Example: **Ctrl/Cmd + 6** jumps to History to inspect the response you just got.
- **Open the Secret Vault** — **Ctrl/Cmd + K** opens the Vault tab in the inspector dock.
- **Refresh the working branch** — **Ctrl/Cmd + Shift + R**. Plain **Ctrl + R** is the browser's reload — the Shift is what disambiguates them.

## Text size

- **Grow** — **Ctrl/Cmd + Shift + =**.
- **Shrink** — **Ctrl/Cmd + Shift + -**.
- **Reset to 100%** — **Ctrl/Cmd + Shift + 0**.

The text-size shortcuts fire even while you are typing; the others stand down whenever an input or editor is focused, so they never eat a keystroke you meant as text.`,
    keywords: ['shortcut', 'hotkey', 'keyboard', 'ctrl', 'cmd', 'send', 'switch panel'],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    body: `## "Token missing scope"

Your PAT lacks \`repo\` or \`pull_request\`. Secret Vault → Sessions → update the token → retry.

## "GitHub rejected the token" / unauthorized

The token was revoked, expired, or had its scopes changed on GitHub. The Workspace panel shows a **Reconnect** button — sign in again; your branch and repo connection are kept.

## "Workspace conflicted"

Refresh found edits on both sides. The conflict resolver opens — pick **Accept ours** / **Accept theirs** / **Discard** per entity, then Merge.

## "This branch already has content"

The first-pull banner: the branch has a \`workspace.json\` you have never pulled. Pull first so your branch adopts it before you push over it.

## "Branch was retired" / "PR #N was merged"

Refresh found the working branch merged or deleted on GitHub. Create a fresh working branch to continue.

## "Attachment too large"

Files over 100 MB are refused (GitHub's blob limit). 10-100 MB warn and recommend Git LFS.

## "Rate limited"

GitHub's API hit its rate limit. The error names a reset time — wait, or sign in (signed-in requests get a higher limit than anonymous marketplace browsing).

## Wrong workspace passphrase

The passphrase does not match the one the encrypted values were created with. Encrypted variables stay unreadable until the correct passphrase is entered — there is no reset; the original passphrase is required.

## Cookies are not being sent

In the browser build the Fetch API strips the \`Cookie\` header. The desktop app and the CLI do send it — run cookie-dependent requests there.

## A variable is sent literally as \`{{NAME}}\`

No layer resolved it. Check the variable exists in an active environment, the context, or the vault, and that its environment is high enough in the priority list.

## A request fails with a network or CORS error

The target server is unreachable, or a browser CORS policy blocked it. Try the desktop app or the CLI (no browser CORS), and confirm the URL and that the host is up.

## A mock server will not start

Common causes: the port is already in use (stop the other server, or pass a different \`--port\`); the spec failed to parse (check the OpenAPI / Postman / Insomnia text is valid); or an OAuth2 callback never fired (browser-redirect grants need the desktop app).

## A plan step fails but the run continues

That is expected unless **Stop on assertion failure** is on. Turn it on to halt at the first failing step.

## Secrets gone after a browser-data clear

The Secret Vault and the GitHub session live in this browser's IndexedDB. Clearing site data removes them — the synced workspace is safe in Git, but vault values and the session must be re-entered.`,
    keywords: [
      'error',
      'fix',
      'recover',
      'scope',
      'conflict',
      'attachment',
      'mock',
      'port',
      'rate limit',
      'cors',
      'cookie',
      'passphrase',
      'troubleshoot',
    ],
  },
];

/**
 * Multi-token AND search across title + body + keywords. Splits the query
 * on whitespace; each token must match somewhere in the section. This
 * handles phrase queries like "personal access token" — sections that
 * contain the words anywhere still match even when the exact phrase
 * doesn't appear verbatim.
 *
 * Leading and trailing punctuation (`:`, `,`, `?`, `.`) is stripped from
 * each token so accidental copy-paste doesn't break matching.
 */
export function searchHelp(query: string): HelpSection[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}_-]+|[^\p{L}\p{N}_-]+$/gu, ''))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return HELP_SECTIONS;
  return HELP_SECTIONS.filter((section) => {
    const haystack =
      `${section.title}\n${section.body}\n${(section.keywords ?? []).join(' ')}`.toLowerCase();
    return tokens.every((tok) => haystack.includes(tok));
  });
}
