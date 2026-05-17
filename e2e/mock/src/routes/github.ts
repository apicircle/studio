// Stateful in-memory GitHub REST API mock. Implements the subset the
// workspaceStore exercises during link / push / pull / branch flows:
//
//   GET    /user                                         — viewer
//   GET    /user/repos                                   — listAccessibleRepos
//   GET    /repos/:owner/:repo                           — getRepo
//   GET    /repos/:owner/:repo/branches                  — listBranches
//   GET    /repos/:owner/:repo/branches/:branch          — getBranchHead
//   GET    /repos/:owner/:repo/git/refs/heads/:branch    — getRef
//   POST   /repos/:owner/:repo/git/refs                  — createBranch/Tag
//   PATCH  /repos/:owner/:repo/git/refs/heads/:branch    — updateRef
//   DELETE /repos/:owner/:repo/git/refs/*                — deleteRef
//   POST   /repos/:owner/:repo/git/blobs                 — createBlob
//   POST   /repos/:owner/:repo/git/trees                 — createTree
//   POST   /repos/:owner/:repo/git/commits               — createCommit
//   GET    /repos/:owner/:repo/git/commits/:sha          — getCommit
//   GET    /repos/:owner/:repo/contents/:path            — getContents
//   PUT    /repos/:owner/:repo/contents/:path            — putContents
//   GET    /repos/:owner/:repo/compare/:base...:head     — compareCommits
//   POST   /repos/:owner/:repo/pulls                     — createPullRequest
//   GET    /repos/:owner/:repo/pulls                     — listPullRequests
//   GET    /repos/:owner/:repo/pulls/:number             — getPullRequest
//   GET    /repos/:owner/:repo/topics                    — listRepoTopics
//   PUT    /repos/:owner/:repo/topics                    — setRepoTopics
//   POST   /repos/:owner/:repo/releases                  — createRelease
//   GET    /search/repositories                          — searchMarketplaceRepos
//
// OAuth Device Flow:
//   POST   /login/device/code
//   POST   /login/oauth/access_token
//
// Control plane (tests use these to seed + inspect the mock):
//   POST   /__gh/repos                  — create or replace a mock repo
//   GET    /__gh/repos/:owner/:repo     — read mock repo state
//   POST   /__gh/scopes                 — replace OAuth scope header
//   POST   /__gh/auth-failure           — force authenticated endpoints to fail
//   DELETE /__gh/auth-failure           — clear forced auth failure
//   DELETE /__gh                        — reset all state
//
// All endpoints are exposed under `/_gh/*` to keep the mock origin
// distinct from real github.com requests; gitFixture rewrites
// `https://api.github.com/...` → `http://localhost:5176/_gh/...` via
// Playwright page.route.

import { Hono } from 'hono';
import { createHash } from 'node:crypto';

interface MockBlob {
  sha: string;
  content: string; // base64 if `encoding === 'base64'`, raw otherwise
  encoding: 'utf-8' | 'base64';
  size: number;
}

interface MockTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  content?: string; // when authored inline via createTree
}

interface MockTree {
  sha: string;
  entries: MockTreeEntry[];
}

interface MockCommit {
  sha: string;
  message: string;
  treeSha: string;
  parents: string[];
}

interface MockRepo {
  owner: string;
  name: string;
  defaultBranch: string;
  visibility: 'public' | 'private' | 'internal';
  isPrivate: boolean;
  pushable: boolean;
  topics: string[];
  // Refs: full ref name (e.g. "refs/heads/main") → commit SHA
  refs: Map<string, string>;
  blobs: Map<string, MockBlob>;
  trees: Map<string, MockTree>;
  commits: Map<string, MockCommit>;
  // Path → ref → file content. Updated on putContents + via tree
  // commits when a tree carries inline content.
  contents: Map<string, Map<string, { sha: string; content: string }>>;
  pulls: Array<{
    number: number;
    head: string;
    base: string;
    title: string;
    state: 'open' | 'closed';
    merged: boolean;
    draft: boolean;
    htmlUrl: string;
  }>;
  releases: Array<{ id: number; tagName: string; htmlUrl: string; name: string; body: string }>;
}

interface MockState {
  viewer: { login: string; id: number; name: string | null; avatarUrl: string | null };
  scopes: string;
  tokenScopes: Map<string, string>;
  authFailure: { status: 401 | 403; message: string; acceptedScopes?: string } | null;
  tokenAuthFailures: Map<string, { status: 401 | 403; message: string; acceptedScopes?: string }>;
  repos: Map<string, MockRepo>; // key = "owner/name"
  // Device-flow scratch: device code → status
  deviceCodes: Map<
    string,
    {
      userCode: string;
      clientId: string;
      granted: boolean;
      token: string | null;
      expiresAt: number;
    }
  >;
}

function freshState(): MockState {
  return {
    viewer: {
      login: 'mock-user',
      id: 1,
      name: 'Mock User',
      avatarUrl: 'https://example.test/avatar.png',
    },
    scopes: 'repo,read:user',
    tokenScopes: new Map(),
    authFailure: null,
    tokenAuthFailures: new Map(),
    repos: new Map(),
    deviceCodes: new Map(),
  };
}

let state: MockState = freshState();

function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

function ensureRepo(owner: string, name: string): MockRepo | null {
  return state.repos.get(`${owner}/${name}`) ?? null;
}

function fullName(repo: MockRepo): string {
  return `${repo.owner}/${repo.name}`;
}

function repoEnvelope(repo: MockRepo) {
  return {
    id: 1,
    name: repo.name,
    full_name: fullName(repo),
    owner: { login: repo.owner, id: 1 },
    default_branch: repo.defaultBranch,
    private: repo.isPrivate,
    visibility: repo.visibility,
    permissions: { push: repo.pushable, pull: true, admin: repo.pushable },
    html_url: `https://github.test/${repo.owner}/${repo.name}`,
  };
}

function pullEnvelope(pull: MockRepo['pulls'][number]) {
  return {
    number: pull.number,
    head: { ref: pull.head },
    base: { ref: pull.base },
    title: pull.title,
    state: pull.state,
    merged: pull.merged,
    draft: pull.draft,
    html_url: pull.htmlUrl,
  };
}

function bearerToken(c: { req: { header: (name: string) => string | undefined } }): string | null {
  const authorization = c.req.header('authorization') ?? c.req.header('Authorization') ?? '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function scopesFor(c: { req: { header: (name: string) => string | undefined } }): string {
  const token = bearerToken(c);
  return (token ? state.tokenScopes.get(token) : undefined) ?? state.scopes;
}

function authFailureFor(c: {
  req: { header: (name: string) => string | undefined };
}): { status: 401 | 403; message: string; acceptedScopes?: string } | null {
  const token = bearerToken(c);
  return (token ? state.tokenAuthFailures.get(token) : undefined) ?? state.authFailure;
}

function branchEnvelope(branch: string, sha: string) {
  return { name: branch, commit: { sha } };
}

function updateContentsFromTree(repo: MockRepo, branchName: string, treeSha: string): void {
  const tree = repo.trees.get(treeSha);
  if (!tree) return;
  for (const entry of tree.entries) {
    if (entry.type !== 'blob') continue;
    const blob = repo.blobs.get(entry.sha);
    if (!blob) continue;
    let perPath = repo.contents.get(entry.path);
    if (!perPath) {
      perPath = new Map();
      repo.contents.set(entry.path, perPath);
    }
    const content =
      blob.encoding === 'base64'
        ? Buffer.from(blob.content, 'base64').toString('utf-8')
        : blob.content;
    perPath.set(branchName, { sha: entry.sha, content });
  }
}

function ensureSeedCommit(repo: MockRepo): string {
  // Create an empty initial commit if the repo has no refs yet.
  if (repo.refs.size > 0) {
    const head = repo.refs.get(`refs/heads/${repo.defaultBranch}`);
    if (head) return head;
  }
  const treeSha = sha1(`tree:seed:${fullName(repo)}`);
  const tree: MockTree = { sha: treeSha, entries: [] };
  repo.trees.set(treeSha, tree);
  const commitSha = sha1(`commit:seed:${fullName(repo)}`);
  const commit: MockCommit = {
    sha: commitSha,
    message: 'Initial commit (mock)',
    treeSha,
    parents: [],
  };
  repo.commits.set(commitSha, commit);
  repo.refs.set(`refs/heads/${repo.defaultBranch}`, commitSha);
  return commitSha;
}

export function buildGithubRoutes(): Hono {
  const app = new Hono();

  // --------------------------------------------------------------------
  // Control plane
  // --------------------------------------------------------------------
  app.post('/__gh/repos', async (c) => {
    const body = await c.req.json<{
      owner: string;
      name: string;
      defaultBranch?: string;
      isPrivate?: boolean;
      pushable?: boolean;
      visibility?: 'public' | 'private' | 'internal';
      topics?: string[];
      seedFiles?: Array<{ path: string; content: string }>;
    }>();
    const owner = body.owner;
    const name = body.name;
    const defaultBranch = body.defaultBranch ?? 'main';
    const repo: MockRepo = {
      owner,
      name,
      defaultBranch,
      visibility: body.visibility ?? (body.isPrivate ? 'private' : 'public'),
      isPrivate: body.isPrivate ?? false,
      pushable: body.pushable ?? true,
      topics: body.topics ?? [],
      refs: new Map(),
      blobs: new Map(),
      trees: new Map(),
      commits: new Map(),
      contents: new Map(),
      pulls: [],
      releases: [],
    };
    state.repos.set(`${owner}/${name}`, repo);
    ensureSeedCommit(repo);
    if (body.seedFiles && body.seedFiles.length > 0) {
      const ref = `refs/heads/${defaultBranch}`;
      const commitSha = repo.refs.get(ref)!;
      const commit = repo.commits.get(commitSha)!;
      const tree = repo.trees.get(commit.treeSha)!;
      for (const f of body.seedFiles) {
        const blobSha = sha1(`blob:${f.path}:${f.content}`);
        repo.blobs.set(blobSha, {
          sha: blobSha,
          content: f.content,
          encoding: 'utf-8',
          size: f.content.length,
        });
        tree.entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blobSha });
        let perPath = repo.contents.get(f.path);
        if (!perPath) {
          perPath = new Map();
          repo.contents.set(f.path, perPath);
        }
        perPath.set(defaultBranch, { sha: blobSha, content: f.content });
      }
    }
    return c.json({ ok: true, repo: repoEnvelope(repo) });
  });

  app.get('/__gh/repos/:owner/:name', (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ error: 'not_found' }, 404);
    const refs: Record<string, string> = {};
    for (const [k, v] of repo.refs) refs[k] = v;
    const contents: Record<string, Record<string, { sha: string; content: string }>> = {};
    for (const [path, perRef] of repo.contents) {
      contents[path] = {};
      for (const [ref, file] of perRef) contents[path][ref] = file;
    }
    return c.json({
      repo: repoEnvelope(repo),
      refs,
      contents,
      pulls: repo.pulls,
      releases: repo.releases,
    });
  });

  app.delete('/__gh', (c) => {
    state = freshState();
    return c.json({ ok: true });
  });

  app.post('/__gh/scopes', async (c) => {
    const body = await c.req.json<{ scopes: string | string[]; token?: string }>();
    const scopes = Array.isArray(body.scopes) ? body.scopes.join(',') : body.scopes;
    if (body.token) {
      state.tokenScopes.set(body.token, scopes);
    } else {
      state.scopes = scopes;
    }
    return c.json({ ok: true, scopes, token: body.token ?? null });
  });

  app.post('/__gh/auth-failure', async (c) => {
    const body = await c.req.json<{
      status?: 401 | 403;
      message?: string;
      acceptedScopes?: string;
      token?: string;
    }>();
    const failure = {
      status: body.status ?? 401,
      message: body.message ?? 'Bad credentials',
      acceptedScopes: body.acceptedScopes,
    };
    if (body.token) {
      state.tokenAuthFailures.set(body.token, failure);
    } else {
      state.authFailure = failure;
    }
    return c.json({ ok: true, authFailure: failure, token: body.token ?? null });
  });

  app.delete('/__gh/auth-failure', (c) => {
    const token = c.req.query('token');
    if (token) {
      state.tokenAuthFailures.delete(token);
    } else {
      state.authFailure = null;
      state.tokenAuthFailures.clear();
    }
    return c.json({ ok: true });
  });

  app.use('/_gh/*', async (c, next) => {
    const authFailure = authFailureFor(c);
    if (!authFailure) {
      await next();
      return;
    }
    c.header('x-oauth-scopes', scopesFor(c));
    if (authFailure.acceptedScopes) {
      c.header('x-accepted-oauth-scopes', authFailure.acceptedScopes);
    }
    return c.json({ message: authFailure.message }, authFailure.status);
  });

  // --------------------------------------------------------------------
  // User
  // --------------------------------------------------------------------
  app.get('/_gh/user', (c) => {
    c.header('x-oauth-scopes', scopesFor(c));
    return c.json({
      login: state.viewer.login,
      id: state.viewer.id,
      name: state.viewer.name,
      avatar_url: state.viewer.avatarUrl,
    });
  });

  app.get('/_gh/user/repos', (c) => {
    const repos = Array.from(state.repos.values()).map(repoEnvelope);
    return c.json(repos);
  });

  // --------------------------------------------------------------------
  // Repo
  // --------------------------------------------------------------------
  app.get('/_gh/repos/:owner/:name', (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ message: 'Not Found' }, 404);
    return c.json(repoEnvelope(repo));
  });

  app.get('/_gh/repos/:owner/:name/branches', (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ message: 'Not Found' }, 404);
    const out: Array<{ name: string; commit: { sha: string } }> = [];
    for (const [ref, sha] of repo.refs) {
      if (ref.startsWith('refs/heads/')) {
        out.push(branchEnvelope(ref.slice('refs/heads/'.length), sha));
      }
    }
    return c.json(out);
  });

  app.get('/_gh/repos/:owner/:name/branches/:branch', (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ message: 'Not Found' }, 404);
    const branch = decodeURIComponent(c.req.param('branch'));
    const sha = repo.refs.get(`refs/heads/${branch}`);
    if (!sha) return c.json({ message: 'Branch not found' }, 404);
    return c.json(branchEnvelope(branch, sha));
  });

  // --------------------------------------------------------------------
  // Git data — refs / blobs / trees / commits
  // --------------------------------------------------------------------
  app.get('/_gh/repos/:owner/:name/git/refs/heads/:branch', (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ message: 'Not Found' }, 404);
    const branch = decodeURIComponent(c.req.param('branch'));
    const sha = repo.refs.get(`refs/heads/${branch}`);
    if (!sha) return c.json({ message: 'Ref not found' }, 404);
    return c.json({ ref: `refs/heads/${branch}`, object: { sha, type: 'commit' } });
  });

  app.get('/_gh/repos/:owner/:name/git/refs/tags/:tag', (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ message: 'Not Found' }, 404);
    const tag = decodeURIComponent(c.req.param('tag'));
    const sha = repo.refs.get(`refs/tags/${tag}`);
    if (!sha) return c.json({ message: 'Ref not found' }, 404);
    return c.json({ ref: `refs/tags/${tag}`, object: { sha, type: 'commit' } });
  });

  app.post('/_gh/repos/:owner/:name/git/refs', async (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ message: 'Not Found' }, 404);
    const body = await c.req.json<{ ref: string; sha: string }>();
    if (repo.refs.has(body.ref)) {
      return c.json({ message: 'Reference already exists' }, 422);
    }
    repo.refs.set(body.ref, body.sha);
    return c.json({ ref: body.ref, object: { sha: body.sha, type: 'commit' } });
  });

  app.patch('/_gh/repos/:owner/:name/git/refs/heads/:branch', async (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ message: 'Not Found' }, 404);
    const branch = decodeURIComponent(c.req.param('branch'));
    const body = await c.req.json<{ sha: string; force?: boolean }>();
    const ref = `refs/heads/${branch}`;
    if (!repo.refs.has(ref)) return c.json({ message: 'Ref not found' }, 404);
    repo.refs.set(ref, body.sha);
    const commit = repo.commits.get(body.sha);
    if (commit) updateContentsFromTree(repo, branch, commit.treeSha);
    return c.json({ ref, object: { sha: body.sha, type: 'commit' } });
  });

  app.delete('/_gh/repos/:owner/:name/git/refs/*', (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ message: 'Not Found' }, 404);
    const url = new URL(c.req.url);
    const idx = url.pathname.indexOf('/git/refs/');
    const refSuffix = decodeURIComponent(url.pathname.slice(idx + '/git/refs/'.length));
    const full = `refs/${refSuffix}`;
    repo.refs.delete(full);
    return new Response(null, { status: 204 });
  });

  app.post('/_gh/repos/:owner/:name/git/blobs', async (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ message: 'Not Found' }, 404);
    const body = await c.req.json<{ content: string; encoding: 'utf-8' | 'base64' }>();
    const sha = sha1(`blob:${body.encoding}:${body.content}`);
    repo.blobs.set(sha, {
      sha,
      content: body.content,
      encoding: body.encoding,
      size: body.content.length,
    });
    return c.json({ sha, size: body.content.length, url: `${c.req.url}/${sha}` });
  });

  app.post('/_gh/repos/:owner/:name/git/trees', async (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ message: 'Not Found' }, 404);
    const body = await c.req.json<{
      base_tree?: string;
      tree: Array<{
        path: string;
        mode: string;
        type: 'blob' | 'tree' | 'commit';
        sha?: string;
        content?: string;
      }>;
    }>();
    const baseEntries = body.base_tree ? (repo.trees.get(body.base_tree)?.entries ?? []) : [];
    const merged = new Map<string, MockTreeEntry>();
    for (const e of baseEntries) merged.set(e.path, e);
    for (const e of body.tree) {
      let sha = e.sha;
      if (!sha && e.content !== undefined) {
        sha = sha1(`blob:utf-8:${e.content}`);
        if (!repo.blobs.has(sha)) {
          repo.blobs.set(sha, {
            sha,
            content: e.content,
            encoding: 'utf-8',
            size: e.content.length,
          });
        }
      }
      if (!sha) continue;
      merged.set(e.path, {
        path: e.path,
        mode: e.mode,
        type: e.type,
        sha,
        content: e.content,
      });
    }
    const entries = Array.from(merged.values());
    const treeSha = sha1(`tree:${entries.map((e) => `${e.path}:${e.sha}`).join('|')}`);
    repo.trees.set(treeSha, { sha: treeSha, entries });
    return c.json({
      sha: treeSha,
      tree: entries.map((e) => ({ path: e.path, mode: e.mode, type: e.type, sha: e.sha })),
    });
  });

  app.post('/_gh/repos/:owner/:name/git/commits', async (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ message: 'Not Found' }, 404);
    const body = await c.req.json<{ message: string; tree: string; parents: string[] }>();
    const sha = sha1(`commit:${body.tree}:${body.parents.join(',')}:${body.message}:${Date.now()}`);
    repo.commits.set(sha, {
      sha,
      message: body.message,
      treeSha: body.tree,
      parents: body.parents,
    });
    // Update contents view from this tree for refs that uniquely point to
    // the parent. The updateRef route also refreshes the exact target
    // branch after a push, which handles the common case where a new branch
    // still shares its parent SHA with main.
    const tree = repo.trees.get(body.tree);
    if (tree) {
      // Determine which branch this commit will land on by looking for
      // the parent in refs.
      for (const [refName, refSha] of repo.refs) {
        if (body.parents.includes(refSha) && refName.startsWith('refs/heads/')) {
          const branchName = refName.slice('refs/heads/'.length);
          updateContentsFromTree(repo, branchName, body.tree);
          break;
        }
      }
    }
    return c.json({
      sha,
      tree: { sha: body.tree },
      message: body.message,
      parents: body.parents.map((p) => ({ sha: p })),
    });
  });

  app.get('/_gh/repos/:owner/:name/git/commits/:sha', (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ message: 'Not Found' }, 404);
    const commit = repo.commits.get(c.req.param('sha'));
    if (!commit) return c.json({ message: 'Commit not found' }, 404);
    return c.json({
      sha: commit.sha,
      tree: { sha: commit.treeSha },
      message: commit.message,
      parents: commit.parents.map((p) => ({ sha: p })),
    });
  });

  // --------------------------------------------------------------------
  // Contents API
  // --------------------------------------------------------------------
  app.get('/_gh/repos/:owner/:name/contents/*', (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ message: 'Not Found' }, 404);
    const url = new URL(c.req.url);
    const idx = url.pathname.indexOf('/contents/');
    const path = decodeURIComponent(url.pathname.slice(idx + '/contents/'.length));
    const ref = c.req.query('ref') ?? repo.defaultBranch;
    const perPath = repo.contents.get(path);
    if (!perPath) return c.json({ message: 'Not Found' }, 404);
    const file = perPath.get(ref);
    if (!file) return c.json({ message: 'Not Found' }, 404);
    return c.json({
      type: 'file',
      path,
      sha: file.sha,
      size: file.content.length,
      // GitHub returns base64-encoded `content` with \n every 60 chars.
      // We keep it inline since the client strips \n before decode.
      content: Buffer.from(file.content, 'utf-8').toString('base64'),
      encoding: 'base64',
    });
  });

  app.put('/_gh/repos/:owner/:name/contents/*', async (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ message: 'Not Found' }, 404);
    const url = new URL(c.req.url);
    const idx = url.pathname.indexOf('/contents/');
    const path = decodeURIComponent(url.pathname.slice(idx + '/contents/'.length));
    const body = await c.req.json<{
      message: string;
      content: string; // base64
      branch?: string;
      sha?: string;
    }>();
    const branch = body.branch ?? repo.defaultBranch;
    const ref = `refs/heads/${branch}`;
    if (!repo.refs.has(ref)) {
      // Bootstrap the branch off the default branch head.
      const headSha = repo.refs.get(`refs/heads/${repo.defaultBranch}`);
      if (headSha) repo.refs.set(ref, headSha);
      else ensureSeedCommit(repo);
    }
    const decoded = Buffer.from(body.content, 'base64').toString('utf-8');
    const blobSha = sha1(`blob:utf-8:${decoded}`);
    repo.blobs.set(blobSha, {
      sha: blobSha,
      content: decoded,
      encoding: 'utf-8',
      size: decoded.length,
    });
    let perPath = repo.contents.get(path);
    if (!perPath) {
      perPath = new Map();
      repo.contents.set(path, perPath);
    }
    perPath.set(branch, { sha: blobSha, content: decoded });
    // Synthesize a commit + advance the ref.
    const parentSha = repo.refs.get(ref)!;
    const parentTreeSha = repo.commits.get(parentSha)?.treeSha;
    const parentTree = parentTreeSha ? repo.trees.get(parentTreeSha) : null;
    const mergedEntries = new Map<string, MockTreeEntry>();
    if (parentTree) for (const e of parentTree.entries) mergedEntries.set(e.path, e);
    mergedEntries.set(path, { path, mode: '100644', type: 'blob', sha: blobSha });
    const newEntries = Array.from(mergedEntries.values());
    const treeSha = sha1(`tree:${newEntries.map((e) => `${e.path}:${e.sha}`).join('|')}`);
    repo.trees.set(treeSha, { sha: treeSha, entries: newEntries });
    const commitSha = sha1(`commit:${treeSha}:${parentSha}:${body.message}:${Date.now()}`);
    repo.commits.set(commitSha, {
      sha: commitSha,
      message: body.message,
      treeSha,
      parents: [parentSha],
    });
    repo.refs.set(ref, commitSha);
    return c.json({
      content: { sha: blobSha, path },
      commit: { sha: commitSha, message: body.message },
    });
  });

  // --------------------------------------------------------------------
  // Compare commits (used by refresh / divergence detection)
  // --------------------------------------------------------------------
  app.get('/_gh/repos/:owner/:name/compare/:base/...:head', (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ message: 'Not Found' }, 404);
    const baseHead = c.req.param('base');
    const headRef = c.req.param('head');
    const baseSha = repo.refs.get(`refs/heads/${baseHead}`) ?? baseHead;
    const headSha = repo.refs.get(`refs/heads/${headRef}`) ?? headRef;
    // Simplified comparison — identical if same SHA, otherwise diverged
    // (the mock doesn't track full ancestry).
    if (baseSha === headSha) {
      return c.json({ status: 'identical', ahead_by: 0, behind_by: 0 });
    }
    return c.json({ status: 'ahead', ahead_by: 1, behind_by: 0 });
  });

  app.get('/_gh/repos/:owner/:name/compare/*', (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ message: 'Not Found' }, 404);
    return c.json({ status: 'ahead', ahead_by: 1, behind_by: 0 });
  });

  // --------------------------------------------------------------------
  // Pulls / topics / releases
  // --------------------------------------------------------------------
  app.post('/_gh/repos/:owner/:name/pulls', async (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ message: 'Not Found' }, 404);
    const body = await c.req.json<{ title: string; head: string; base: string; draft?: boolean }>();
    const num = repo.pulls.length + 1;
    const htmlUrl = `https://github.test/${repo.owner}/${repo.name}/pull/${num}`;
    const pull: MockRepo['pulls'][number] = {
      number: num,
      head: body.head,
      base: body.base,
      title: body.title,
      state: 'open',
      merged: false,
      draft: body.draft ?? false,
      htmlUrl,
    };
    repo.pulls.push(pull);
    return c.json(pullEnvelope(pull));
  });

  app.get('/_gh/repos/:owner/:name/pulls', (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ message: 'Not Found' }, 404);
    const stateFilter = c.req.query('state') ?? 'open';
    const pulls =
      stateFilter === 'all' ? repo.pulls : repo.pulls.filter((pull) => pull.state === stateFilter);
    return c.json(pulls.map((pull) => pullEnvelope(pull)));
  });

  app.get('/_gh/repos/:owner/:name/pulls/:number', (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ message: 'Not Found' }, 404);
    const number = Number.parseInt(c.req.param('number'), 10);
    const pull = repo.pulls.find((p) => p.number === number);
    if (!pull) return c.json({ message: 'Not Found' }, 404);
    return c.json(pullEnvelope(pull));
  });

  app.get('/_gh/repos/:owner/:name/topics', (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ message: 'Not Found' }, 404);
    return c.json({ names: repo.topics });
  });

  app.put('/_gh/repos/:owner/:name/topics', async (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ message: 'Not Found' }, 404);
    const body = await c.req.json<{ names: string[] }>();
    repo.topics = body.names;
    return c.json({ names: repo.topics });
  });

  app.post('/_gh/repos/:owner/:name/releases', async (c) => {
    const repo = ensureRepo(c.req.param('owner'), c.req.param('name'));
    if (!repo) return c.json({ message: 'Not Found' }, 404);
    const body = await c.req.json<{
      tag_name: string;
      name?: string;
      body?: string;
      draft?: boolean;
      prerelease?: boolean;
    }>();
    const id = repo.releases.length + 1;
    const htmlUrl = `https://github.test/${repo.owner}/${repo.name}/releases/tag/${body.tag_name}`;
    repo.releases.push({
      id,
      tagName: body.tag_name,
      htmlUrl,
      name: body.name ?? body.tag_name,
      body: body.body ?? '',
    });
    return c.json({ id, html_url: htmlUrl, tag_name: body.tag_name });
  });

  // --------------------------------------------------------------------
  // Search (marketplace)
  // --------------------------------------------------------------------
  app.get('/_gh/search/repositories', (c) => {
    const items = Array.from(state.repos.values()).map((repo) => ({
      full_name: fullName(repo),
      name: repo.name,
      owner: { login: repo.owner },
      description: 'Mock marketplace repo',
      topics: repo.topics,
      stargazers_count: 0,
      default_branch: repo.defaultBranch,
    }));
    return c.json({ items });
  });

  // --------------------------------------------------------------------
  // OAuth Device Flow
  // --------------------------------------------------------------------
  app.post('/_gh/login/device/code', async (c) => {
    const body = await c.req.json<{ client_id: string; scope?: string }>();
    const deviceCode = `dc-${Math.random().toString(36).slice(2, 12)}`;
    const userCode = `${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    state.deviceCodes.set(deviceCode, {
      userCode,
      clientId: body.client_id,
      granted: true, // mock: instantly grant
      token: `ghp_mock_${Math.random().toString(36).slice(2, 12)}`,
      expiresAt: Date.now() + 600_000,
    });
    return c.json({
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: `https://github.test/login/device`,
      expires_in: 600,
      interval: 1,
    });
  });

  app.post('/_gh/login/oauth/access_token', async (c) => {
    const body = await c.req.json<{ client_id: string; device_code: string; grant_type: string }>();
    const entry = state.deviceCodes.get(body.device_code);
    if (!entry) return c.json({ error: 'expired_token' });
    if (!entry.granted) return c.json({ error: 'authorization_pending' });
    if (!entry.token) return c.json({ error: 'access_denied', error_description: 'denied' });
    return c.json({
      access_token: entry.token,
      token_type: 'bearer',
      scope: 'repo,read:user',
    });
  });

  return app;
}
