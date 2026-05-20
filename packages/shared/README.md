<p align="center">
  <img src="https://raw.githubusercontent.com/apicircle/studio/main/assets/logo.png" alt="API Circle Studio" width="120" height="120" />
</p>

<h1 align="center">@apicircle/shared</h1>

Shared foundation for [API Circle Studio](https://github.com/apicircle/studio) — the TypeScript types, ID generation, validators, and encryption helpers every other `@apicircle/*` package builds on.

## Install

```bash
npm install @apicircle/shared
```

## What's inside

- **Workspace types** — the canonical `WorkspaceSynced` / `WorkspaceLocal` schema and every entity type (requests, folders, environments, mock servers, plans, releases).
- **`generateId()`** — collision-resistant ID generation; the only sanctioned way to mint entity IDs.
- **Validators** — shape checks for workspace documents and imported specs.
- **Encryption helpers** — AES-GCM via WebCrypto for at-rest secret material.
- **MCP envelopes** — the request/response envelope types shared with `@apicircle/mcp-server`.

This package is mostly consumed indirectly through the other API Circle packages — install it directly when you are building tooling against the workspace format.

## License

Released under the **API Circle Studio License** — a custom source-available license, not an OSI-approved open-source license. Free for personal, educational, and non-commercial use, plus a 30-day commercial evaluation period; ongoing commercial use requires a separate license. See [LICENSE](./LICENSE) for the full terms, or contact **apicircle365@gmail.com** for commercial licensing.
