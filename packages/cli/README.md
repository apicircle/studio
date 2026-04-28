# @apicircle/cli

Command-line companion to [APICircle Studio](https://github.com/apicircle/studio-v2). Run mock servers, drive the MCP server, and import OpenAPI / Postman / Insomnia / curl into a workspace from any terminal — no Electron required.

## Install

```bash
npm install -g @apicircle/cli
# or use without installing
npx @apicircle/cli --help
```

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

Wire this into Claude Desktop / Cursor / etc — see [`docs/connect-your-ai-client.md`](../../docs/connect-your-ai-client.md).

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

## License

MIT.
