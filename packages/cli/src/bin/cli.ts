import { CLI_PACKAGE_VERSION } from '../packageVersion';
import { formatRootHelp, hasRootHelpFlag, hasRootVersionFlag } from './args';

export async function runBin(argv: readonly string[] = process.argv): Promise<void> {
  const args = argv.slice(2);
  if (hasRootVersionFlag(args)) {
    process.stdout.write(`${CLI_PACKAGE_VERSION}\n`);
    return;
  }
  if (hasRootHelpFlag(args)) {
    process.stdout.write(formatRootHelp());
    return;
  }

  const { runCli } = await import('../index');
  await runCli(argv);
}

const entry = process.argv[1] ?? '';
if (entry.endsWith('apicircle') || entry.endsWith('cli.cjs') || entry.endsWith('cli.ts')) {
  void runBin();
}
