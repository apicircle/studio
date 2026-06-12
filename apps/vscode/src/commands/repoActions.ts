import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitHubClient, GitHubError } from '@apicircle/git';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { getGitHubToken } from '../host/githubAuth';

const execFileAsync = promisify(execFile);

// =============================================================================
// Repo-side release operations for the workspace's OWN GitHub repo: tag a
// published version (optionally creating a GitHub Release) and edit the repo's
// topics (which drive marketplace discovery). The repo is derived from the
// open folder's `origin` remote; the token comes from VS Code's GitHub session.
// =============================================================================

export interface RepoActionsDeps {
  bridge: VsCodeBridge;
}

interface OwnerName {
  owner: string;
  name: string;
}

/** Parse `owner/name` from a github.com remote URL (https or ssh). */
export function parseGitHubRemote(url: string): OwnerName | null {
  const trimmed = url.trim().replace(/\.git$/, '');
  // git@github.com:owner/name  |  https://github.com/owner/name  |  ssh://git@github.com/owner/name
  const m = /github\.com[:/]([^/]+)\/([^/]+)$/.exec(trimmed);
  if (!m) return null;
  return { owner: m[1], name: m[2] };
}

async function deriveRepo(folder: string): Promise<OwnerName | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', folder, 'remote', 'get-url', 'origin']);
    return parseGitHubRemote(stdout);
  } catch {
    return null;
  }
}

/** Resolve the active workspace's repo (owner/name) — remote first, then prompt. */
async function resolveRepo(deps: RepoActionsDeps): Promise<OwnerName | null> {
  const surface = deps.bridge.activeWorkspace();
  if (!surface) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return null;
  }
  const folder = surface.workspace.workspaceFolder.uri.fsPath;
  const fromRemote = await deriveRepo(folder);
  if (fromRemote) return fromRemote;
  const manual = await vscode.window.showInputBox({
    prompt: "Could not read the folder's GitHub remote — enter the repo (owner/name)",
    placeHolder: 'octo-org/payments-workspace',
    validateInput: (v) => (v.includes('/') ? null : 'Use owner/name'),
  });
  if (!manual?.trim()) return null;
  const [owner, name] = manual.trim().split('/', 2);
  return { owner, name };
}

/** Resolve the default branch SHA — reads repo metadata, falling back to a probe. */
async function resolveDefaultBranchSha(
  client: GitHubClient,
  token: string,
  repo: OwnerName,
): Promise<{ branch: string; sha: string } | null> {
  // Read the repo's declared default branch (authoritative) and tag its HEAD.
  try {
    const meta = await client.getRepo(token, repo.owner, repo.name);
    const ref = await client.getRef(token, repo.owner, repo.name, meta.defaultBranch);
    return { branch: meta.defaultBranch, sha: ref.sha };
  } catch (e) {
    if (!(e instanceof GitHubError)) throw e;
    // Metadata unreachable — fall back to probing the common names.
  }
  for (const branch of ['main', 'master']) {
    try {
      const ref = await client.getRef(token, repo.owner, repo.name, branch);
      return { branch, sha: ref.sha };
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) continue;
      throw e;
    }
  }
  const branch = await vscode.window.showInputBox({
    prompt: 'Default branch to tag (could not read repo metadata)',
    placeHolder: 'develop',
  });
  if (!branch?.trim()) return null;
  try {
    const ref = await client.getRef(token, repo.owner, repo.name, branch.trim());
    return { branch: branch.trim(), sha: ref.sha };
  } catch {
    return null;
  }
}

/** `apicircle.tagRelease` — create a `v<version>` git tag (+ optional GitHub Release). */
export async function tagReleaseCommand(deps: RepoActionsDeps): Promise<void> {
  const surface = deps.bridge.activeWorkspace();
  if (!surface) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }
  const state = await surface.read();
  const ledger = state.synced.releases.self;
  if (!ledger || ledger.versions.length === 0) {
    await vscode.window.showInformationMessage(
      'No published releases to tag. Publish a version first.',
    );
    return;
  }
  const versionPick = await vscode.window.showQuickPick(
    ledger.versions
      .slice()
      .reverse()
      .map((v) => ({
        label: `v${v.version}${v.version === ledger.currentVersion ? '  (current)' : ''}`,
        detail: v.notes || undefined,
        value: v.version,
        notes: v.notes,
      })),
    { placeHolder: 'Pick a published version to tag on GitHub' },
  );
  if (!versionPick) return;

  const token = await getGitHubToken(true);
  if (!token) {
    await vscode.window.showWarningMessage('GitHub sign-in is required to tag a release.');
    return;
  }
  const repo = await resolveRepo(deps);
  if (!repo) return;
  const client = new GitHubClient();
  const tagName = `v${versionPick.value}`;

  let target: { branch: string; sha: string } | null;
  try {
    target = await resolveDefaultBranchSha(client, token, repo);
  } catch (e) {
    await vscode.window.showErrorMessage(
      `Could not resolve the default branch: ${e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }
  if (!target) return;

  try {
    const existing = await client.getTagSha(token, repo.owner, repo.name, tagName);
    if (existing !== null) {
      const override = await vscode.window.showWarningMessage(
        `Tag ${tagName} already exists at ${existing.slice(0, 7)}. Replace it?`,
        { modal: true },
        'Replace',
      );
      if (override !== 'Replace') return;
      await client.deleteRef(token, repo.owner, repo.name, `tags/${tagName}`);
    }
    await client.createTag(token, repo.owner, repo.name, { tagName, sha: target.sha });
  } catch (e) {
    await vscode.window.showErrorMessage(
      `Tagging failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }

  let releaseUrl: string | undefined;
  const makeRelease = await vscode.window.showQuickPick(
    [
      { label: 'Just the tag', value: false },
      { label: 'Tag + GitHub Release', value: true },
    ],
    { placeHolder: `Created ${tagName} on ${target.branch}. Also create a GitHub Release?` },
  );
  if (makeRelease?.value) {
    try {
      const release = await client.createRelease(token, repo.owner, repo.name, {
        tagName,
        releaseName: tagName,
        body: versionPick.notes ?? '',
      });
      releaseUrl = release.htmlUrl;
    } catch (e) {
      await vscode.window.showErrorMessage(
        `Tag created, but the GitHub Release failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
  }

  if (releaseUrl) {
    const open = await vscode.window.showInformationMessage(
      `Tagged ${tagName} and created a GitHub Release.`,
      'View Release',
    );
    if (open === 'View Release') await vscode.env.openExternal(vscode.Uri.parse(releaseUrl));
  } else {
    await vscode.window.showInformationMessage(`Tagged ${tagName} on ${target.branch}.`);
  }
}

const TOPIC_RE = /^[a-z0-9][a-z0-9-]*$/;

/** `apicircle.editRepoTopics` — edit the repo's topics (drives marketplace discovery). */
export async function editRepoTopicsCommand(deps: RepoActionsDeps): Promise<void> {
  const token = await getGitHubToken(true);
  if (!token) {
    await vscode.window.showWarningMessage('GitHub sign-in is required to edit topics.');
    return;
  }
  const repo = await resolveRepo(deps);
  if (!repo) return;
  const client = new GitHubClient();

  let current: string[];
  try {
    current = await client.listRepoTopics(token, repo.owner, repo.name);
  } catch (e) {
    await vscode.window.showErrorMessage(
      `Could not read topics: ${e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }

  const editable = current.filter((t) => t !== 'apicircle');
  const input = await vscode.window.showInputBox({
    prompt:
      'Topics (comma-separated). The "apicircle" topic is always kept — it drives marketplace discovery.',
    value: editable.join(', '),
    validateInput: (v) => {
      const tags = v
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      for (const t of tags) {
        if (!TOPIC_RE.test(t))
          return `"${t}" must start with a letter/digit and use only lowercase letters, digits, or "-".`;
        if (t.length > 50) return `"${t}" exceeds 50 characters.`;
      }
      if (tags.length + 1 > 20) return 'GitHub allows at most 20 topics.';
      return null;
    },
  });
  if (input === undefined) return;

  const next = Array.from(
    new Set([
      'apicircle',
      ...input
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ]),
  );
  try {
    await client.setRepoTopics(token, repo.owner, repo.name, next);
  } catch (e) {
    await vscode.window.showErrorMessage(
      `Saving topics failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }
  await vscode.window.showInformationMessage(`Topics saved (${next.length}).`);
}
