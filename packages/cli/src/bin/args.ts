export function hasRootVersionFlag(args: readonly string[]): boolean {
  return args.length === 1 && ['--version', '-v', '-V'].includes(args[0] ?? '');
}

export function hasRootHelpFlag(args: readonly string[]): boolean {
  return args.length === 1 && ['--help', '-h', 'help'].includes(args[0] ?? '');
}

export function formatRootHelp(): string {
  return `Usage: apicircle [options] [command]

Command-line companion to API Circle Studio.

Options:
  -v, -V, --version  Print the version number.
  -h, --help         Show help.

Commands:
  mock [options] <workspace>        Start a local mock server.
  mcp [options] [workspace]         Start the MCP stdio server.
  import <source> <workspace>       Import OpenAPI, Postman, Insomnia, or curl.
  run [options] <plan-id>           Run an execution plan.
  workspaces                        Manage local workspace registries.
  linked <subcommand>               Manage linked workspaces (list/link/refresh/unlink).
  release <subcommand>              Tag releases / set topics on the workspace's GitHub repo.

Run "apicircle <command> --help" for command-specific help.
`;
}
