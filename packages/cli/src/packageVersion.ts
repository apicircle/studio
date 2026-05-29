import packageJson from '../package.json';

export function readPackageVersion(): string {
  const version = (packageJson as { version?: unknown }).version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('Unable to read @apicircle/cli package version');
  }
  return version;
}

export const CLI_PACKAGE_VERSION = readPackageVersion();
