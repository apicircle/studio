import packageJson from '../package.json';

export function readPackageVersion(): string {
  const version = (packageJson as { version?: unknown }).version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('Unable to read @apicircle/mcp-server package version');
  }
  return version;
}

export const MCP_PACKAGE_VERSION = readPackageVersion();
