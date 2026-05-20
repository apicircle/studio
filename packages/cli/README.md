<p align="center">
  <img src="https://raw.githubusercontent.com/apicircle/studio/main/assets/logo.png" alt="API Circle Studio" width="120" height="120" />
</p>

<h1 align="center">@apicircle/cli</h1>

Command-line companion to [API Circle Studio](https://github.com/apicircle/studio). Run mock servers, drive the MCP server, import OpenAPI / Postman / Insomnia / curl into a workspace, and execute saved plans — all from any terminal, no Electron required.

## Install

```bash
npm install -g @apicircle/cli
# or use without installing
npx @apicircle/cli --help
```

## What's a "workspace folder"?

Several subcommands take `--workspace <dir>`. A _workspace folder_ is a
directory containing two JSON files (`workspace.synced.json` and
`workspace.local.json`) that together hold your collections, environments,
mock-server definitions, and per-device runtime state.

**You get one by cloning a GitHub repo** created with the Desktop app's
_Link to Git_ feature:

```bash
git clone https://github.com/<you>/<your-workspace-repo>
apicircle mcp --workspace ./<your-workspace-repo>
```

If you don't have a workspace repo yet, open the **Desktop / Web app** —
the workspace is created automatically in browser storage, and the **Mocks**
and **MCP** panels work directly inside the app with no folder required. Use
the CLI for headless / CI scenarios where on-disk JSON is the right interface.

## Subcommands

### `apicircle mock <spec>`

Boot a mock server from an OpenAPI / Postman / Insomnia file.

```bash
apicircle mock ./openapi.yaml --port 4040
apicircle mock ./postman_collection.json --type postman
apicircle mock ./insomnia_export.json --type insomnia --cors=false
```

The CLI binds to a free port unless `--port` is set, prints the URL, and runs until you `Ctrl-C`.

### `apicircle mcp [--workspace <dir>]`

Start the MCP stdio server pointed at a workspace folder.

```bash
apicircle mcp --workspace ./my-workspace
APICIRCLE_WORKSPACE=./my-workspace apicircle mcp
```

If `--workspace` is omitted, the current directory is used. The directory is auto-initialized with an empty `workspace.synced.json` + `workspace.local.json` on first run.

Wire this into Claude Desktop / Cursor / etc — see [Connect your AI client](https://github.com/apicircle/studio/blob/main/docs/connect-your-ai-client.md).

### `apicircle import <type> <input>`

Import a spec into a workspace folder.

```bash
apicircle import openapi  ./spec.yaml --workspace ./ws --format yaml
apicircle import postman  ./col.json  --workspace ./ws
apicircle import insomnia ./exp.json  --workspace ./ws
apicircle import curl     ./curl.txt  --workspace ./ws
apicircle import openapi  -           --workspace ./ws < ./spec.yaml
```

Each import appends one request per operation/item to `workspace.synced.json`.

### `apicircle run <plan>`

Execute a saved workspace execution plan headlessly and report pass/fail.

```bash
apicircle run "Smoke Tests" --reporter junit
apicircle run plan_a1b2c3 --env staging --bail
apicircle run "Nightly" --secrets ./secrets.json --no-save
```

Resolves a plan by name or id, runs each step through the real request engine, evaluates assertions, and carries extracted context forward. Flags: `--reporter text|json|junit`, `--bail` (stop at the first failed step), `--env <name>` (layer an environment onto the run), `--secrets <file>` or `APICIRCLE_SECRET_*` env vars (encrypted variables), `--no-save`, `--no-assertions`. Exit codes: `0` pass, `1` fail, `2` usage error, `3` run denied.

## License

Released under the **API Circle Studio License** — a custom source-available license, not an OSI-approved open-source license. Free for personal, educational, and non-commercial use, plus a 30-day commercial evaluation period; ongoing commercial use requires a separate license. See [LICENSE](./LICENSE) for the full terms, or contact **apicircle365@gmail.com** for commercial licensing.
