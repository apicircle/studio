# Changelog

## 1.0.0

First public release of API Circle Studio — a Git-native, AI-native API workspace.

### Workspace & Git sync

- Two-document workspace model (synced + local) with stable JSON serialization for clean Git diffs.
- GitHub sync: PAT connect with scope guidance, auto-branch, push (including attachments), PR creation, on-demand refresh, and 3-way conflict resolution.
- Link Workspace + releases: private and public links, marketplace search, cached collections, version pinning, and a changelog viewer.

### Requests & execution

- 17 authentication schemes, all end-to-end functional — Bearer, Basic, API key, custom header, the full OAuth2 grant set, AWS SigV4, Digest, NTLM, Hawk, and JWT.
- Imports: cURL, OpenAPI / Swagger, Postman, Insomnia, and HAR.
- Environments with priority ordering, assertions, and multi-step execution plans.

### Platform surfaces

- **Local mock servers** — a Hono-based engine that serves OpenAPI / Postman / Insomnia specs on localhost.
- **MCP server** — exposes the workspace as a tool catalog any Model Context Protocol client can drive.
- **CLI** — `apicircle mock | mcp | import | run` for headless and CI use.
- **Desktop app** (Electron) with OS-keychain secret storage, plus the web app and embeddable npm packages.

### Published packages

`@apicircle/shared`, `@apicircle/core`, `@apicircle/mock-server-core`, `@apicircle/mcp-server`, and `@apicircle/cli` — all at `1.0.0`.
