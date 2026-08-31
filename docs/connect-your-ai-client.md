# Connect your AI client

> **MCP has moved to API Circle Lens.**
> API Circle Studio no longer ships, publishes, configures, or documents an active MCP server or MCP CLI. Existing Studio references to `apicircle-mcp`, `@apicircle/mcp-server`, or `apicircle mcp` are legacy/deprecated.

Studio remains the free GUI for API workspace editing, mocks, plans, environments, request history, snapshots, and Git-backed `.apicircle` workspace files. Those workspace files remain compatible with API Circle Lens.

For supported MCP workflows, use API Circle Lens:

```bash
apicircle-lens mcp --repo ./your-workspace-repo
```

Use Lens when you need AI-client setup for Claude Desktop, Claude Code, Codex, Cursor, GitHub Copilot, ChatGPT, Continue, Cline, Zed, Windsurf, or another MCP stdio client. Lens owns the active MCP server, Lens tool catalog, current client snippets, and plan-gated headless automation.

## Migration notes

- Keep using Studio for the free GUI workspace authoring flow.
- Open the same `.apicircle` repo in Lens when you need MCP or CLI automation.
- Replace `apicircle-mcp` and `npx @apicircle/cli mcp ...` configs with `apicircle-lens mcp ...`.
- Do not install `@apicircle/mcp-server` for new Studio workflows; it is no longer a Studio-owned deployment target.
