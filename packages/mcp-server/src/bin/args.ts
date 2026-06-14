export function hasVersionFlag(args: readonly string[]): boolean {
  return args.some((arg) => arg === '--version' || arg === '-v' || arg === '-V');
}

export function hasHelpFlag(args: readonly string[]): boolean {
  return args.some((arg) => arg === '--help' || arg === '-h' || arg === 'help');
}

export function formatHelp(): string {
  return `Usage: apicircle-mcp [options]

Starts the API Circle MCP stdio server for AI clients.

Options:
  --workspace <dir>  Workspace directory. Auto-detected layout:
                       • registry.json   → multi-workspace registry root
                       • workspace.json  → single workspace / Git-backed dir
                     Defaults to APICIRCLE_WORKSPACE env var, then cwd.
  -v, -V, --version  Print the version number.
  -h, --help         Show help.

Examples:
  apicircle-mcp
  apicircle-mcp --workspace ~/.apicircle
  apicircle-mcp --workspace ./my-repo/.apicircle
`;
}
