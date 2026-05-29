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
  --workspace <dir>  Registry root or single-workspace directory.
                     Defaults to APICIRCLE_WORKSPACE, then the current directory.
  -v, -V, --version  Print the version number.
  -h, --help         Show help.

Examples:
  apicircle-mcp
  apicircle-mcp --workspace ./api-circle-workspaces
`;
}
