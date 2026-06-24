import type { Command } from 'commander';
import kleur from 'kleur';
import { getGitProvider } from '@apicircle/git';

// =============================================================================
// `apicircle release tag <repo> <version>` — create a `v<version>` git tag on
// the repo's default branch HEAD, optionally a GitHub Release. Tokens come from
// `--token` or `GITHUB_TOKEN`.
//
// `apicircle release topics <repo>` — list / set the repo's topics (the
// `apicircle` topic is always kept; it drives marketplace discovery).
// =============================================================================

interface TagOptions {
  release?: boolean;
  notes?: string;
  override?: boolean;
  token?: string;
}

interface TopicsOptions {
  set?: string;
  token?: string;
}

const TOPIC_RE = /^[a-z0-9][a-z0-9-]*$/;

function resolveToken(opts: { token?: string }): string {
  return (opts.token ?? process.env.GITHUB_TOKEN ?? '').trim();
}

function parseRepo(repo: string): { owner: string; name: string } | null {
  if (!repo.includes('/')) return null;
  const [owner, name] = repo.split('/', 2);
  return { owner, name };
}

export function registerReleaseCommand(program: Command): void {
  const release = program
    .command('release')
    .description("Tag releases and edit topics on the workspace's GitHub repo.");

  release
    .command('tag <repo> <version>')
    .description('Create a v<version> tag on the default branch HEAD.')
    .option('-r, --release', 'Also create a GitHub Release for the tag.')
    .option('-n, --notes <notes>', 'Release notes (used when --release is set).', '')
    .option('--override', 'Replace an existing tag of the same name.')
    .option('--token <token>', 'GitHub token (or set GITHUB_TOKEN).')
    .action(async (repo: string, version: string, opts: TagOptions) => {
      const parsed = parseRepo(repo);
      if (!parsed) {
        process.stderr.write(`${kleur.red('error')}: repo must be owner/name\n`);
        process.exit(2);
      }
      const token = resolveToken(opts);
      if (!token) {
        process.stderr.write(
          `${kleur.red('error')}: a token is required (--token or GITHUB_TOKEN)\n`,
        );
        process.exit(2);
      }
      const tagName = `v${version.replace(/^v/, '')}`;
      const client = getGitProvider('github');
      try {
        const meta = await client.getRepo(token, parsed.owner, parsed.name);
        const ref = await client.getRef(token, parsed.owner, parsed.name, meta.defaultBranch);
        const existing = await client.getTagSha(token, parsed.owner, parsed.name, tagName);
        if (existing !== null) {
          if (!opts.override) {
            process.stderr.write(
              `${kleur.red('error')}: tag ${tagName} already exists at ${existing.slice(0, 7)} — pass --override to replace\n`,
            );
            process.exit(2);
          }
          await client.deleteRef(token, parsed.owner, parsed.name, `tags/${tagName}`);
        }
        await client.createTag(token, parsed.owner, parsed.name, { tagName, sha: ref.sha });
        process.stdout.write(
          `${kleur.green('tagged')} ${kleur.bold(tagName)} ${kleur.dim(`on ${meta.defaultBranch} (${ref.sha.slice(0, 7)})`)}\n`,
        );
        if (opts.release) {
          const r = await client.createRelease(token, parsed.owner, parsed.name, {
            tagName,
            releaseName: tagName,
            body: opts.notes ?? '',
          });
          process.stdout.write(`${kleur.green('release')} ${kleur.dim(r.htmlUrl)}\n`);
        }
      } catch (err) {
        process.stderr.write(
          `${kleur.red('error')}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(2);
      }
    });

  release
    .command('topics <repo>')
    .description("List or set the repo's topics ('apicircle' is always kept).")
    .option('--set <topics>', 'Comma-separated topics to set (replaces existing).')
    .option('--token <token>', 'GitHub token (or set GITHUB_TOKEN).')
    .action(async (repo: string, opts: TopicsOptions) => {
      const parsed = parseRepo(repo);
      if (!parsed) {
        process.stderr.write(`${kleur.red('error')}: repo must be owner/name\n`);
        process.exit(2);
      }
      const token = resolveToken(opts);
      if (!token) {
        process.stderr.write(
          `${kleur.red('error')}: a token is required (--token or GITHUB_TOKEN)\n`,
        );
        process.exit(2);
      }
      const client = getGitProvider('github');
      try {
        if (opts.set === undefined) {
          const list = await client.listRepoTopics(token, parsed.owner, parsed.name);
          if (list.length === 0) {
            process.stdout.write(`${kleur.dim('(no topics)')}\n`);
          } else {
            for (const t of list) process.stdout.write(`${t}\n`);
          }
          return;
        }
        const normalized = Array.from(
          new Set([
            'apicircle',
            ...opts.set
              .split(',')
              .map((t) => t.trim().toLowerCase())
              .filter(Boolean),
          ]),
        );
        for (const t of normalized) {
          if (!TOPIC_RE.test(t)) {
            process.stderr.write(`${kleur.red('error')}: invalid topic "${t}"\n`);
            process.exit(2);
          }
          if (t.length > 50) {
            process.stderr.write(`${kleur.red('error')}: topic "${t}" exceeds 50 characters\n`);
            process.exit(2);
          }
        }
        if (normalized.length > 20) {
          process.stderr.write(`${kleur.red('error')}: GitHub allows at most 20 topics\n`);
          process.exit(2);
        }
        const saved = await client.setRepoTopics(token, parsed.owner, parsed.name, normalized);
        process.stdout.write(`${kleur.green('topics set')} ${kleur.dim(`(${saved.length})`)}\n`);
        for (const t of saved) process.stdout.write(`  ${t}\n`);
      } catch (err) {
        process.stderr.write(
          `${kleur.red('error')}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(2);
      }
    });
}
