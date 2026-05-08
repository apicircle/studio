// Plan §11.2 Help Center content. One section per top-level concept,
// kept under ~80 words each. We intentionally don't ship marketing or
// step-by-step tutorials here — inline guide text covers the
// task-specific bits, and §11.3 forbids it ("If we need more than 80
// words for a section, the section is doing too much").

export interface HelpSection {
  /** Stable id used for anchor links and search-result jump targets. */
  id: string;
  title: string;
  /** Plain-text body; HelpPanel renders <p> per double-newline block. */
  body: string;
  /** Search keywords that aren't in the body — used to widen substring matches. */
  keywords?: string[];
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'welcome',
    title: 'Welcome',
    body: 'API Circle Studio is a workspace for designing, running, and sharing HTTP request collections. Your workspace lives in two halves: a synced document that gets pushed to Git as workspace.json, and a local document that stays in IndexedDB on your machine. Anything you publish — releases, linked workspaces, request definitions — lives in the synced half. History, drafts, and your encrypted secrets stay local.',
    keywords: ['intro', 'about', 'overview', 'getting started'],
  },
  {
    id: 'workspace-and-git',
    title: 'Workspace & Git',
    body: 'The Workspace panel is where you connect a GitHub repo, create a working branch, push, and refresh. Local-only mode (no GitHub session) keeps the experience usable for scratch work. With a session, the working branch model lets you safely sync changes: every push targets your branch, and a PR closes the loop. Refresh runs a 3-way diff against the last pulled snapshot and opens the resolver when local and remote both touched the same entity.',
    keywords: ['github', 'pat', 'token', 'push', 'pull', 'branch', 'sync', 'pr', 'pull request'],
  },
  {
    id: 'editor',
    title: 'Editor',
    body: 'Create requests in the Editor panel sidebar. Each request carries a method, URL, headers, query params, body, context variables, and assertions. Body types include json, text, xml, graphql, urlencoded, form-data, and binary; the Content-Type header auto-syncs with the body type so you rarely set it manually. Send runs the request through the workspace resolver, applies the active environment, and surfaces the response with assertion verdicts inline. Folder and request rows expose actions through a kebab (⋮) menu — rename, duplicate, delete, set folder auth.',
    keywords: [
      'request',
      'send',
      'body',
      'headers',
      'assertions',
      'response',
      'duplicate',
      'kebab',
    ],
  },
  {
    id: 'mocks',
    title: 'Mocks',
    body: 'Mock servers live alongside your collections. Create one manually or paste an OpenAPI / Postman / Insomnia spec — the runtime parses the spec at start time. Each endpoint has a default response plus optional validation rules (header / query / cookie / body / content-type checks that short-circuit with a fail response) and conditional response rules (when-clauses on query, path param, header, cookie, or JSON-path body). Multipliers expand an array inside the response body using a value from the request — e.g. ?pageSize=N produces N items at $.items. Validation rules can be disabled without deleting; response rules too.',
    keywords: [
      'mock',
      'mocks',
      'mock server',
      'openapi',
      'postman',
      'insomnia',
      'validation',
      'response rule',
      'multiplier',
    ],
  },
  {
    id: 'mock-runtime',
    title: 'Mock runtime',
    body: 'Definitions are authored in the web UI, but the running server is a Node process. The Desktop app embeds it; the CLI (`apicircle mock <spec>`) starts one from a file. The Hono-based router applies validation rules first, then response rules in declaration order, then multipliers; if no rule matches, the default response wins. Each endpoint binds at the source path (OpenAPI {id} → :id). CORS defaults to off — enable it in the server card when you need cross-origin clients.',
    keywords: ['mock runtime', 'desktop', 'cli', 'apicircle mock', 'cors', 'hono'],
  },
  {
    id: 'auth-types',
    title: 'Auth types',
    body: 'The auth picker on a request supports inherit (uses ancestor folder auth), none, basic, bearer, api-key (header / query / cookie), custom-header, and OAuth2 (client-credentials, auth-code, PKCE, password, implicit, device). It also covers AWS SigV4, NTLM, Digest, Hawk, and JWT bearer (HS256). OAuth2 grants run through a desktop callback server or browser popup — tokens are stored on the request itself; refresh is automatic when the access token expires. Folder auth applies to every descendant request unless that request opts out with `none`.',
    keywords: [
      'auth',
      'oauth',
      'oauth2',
      'pkce',
      'sigv4',
      'ntlm',
      'digest',
      'hawk',
      'jwt',
      'bearer',
      'basic',
    ],
  },
  {
    id: 'environments',
    title: 'Environments',
    body: 'Environments are key-value sets that resolve {{NAME}} placeholders in URLs, headers, query params, and request bodies. The resolver order is fixed: context variables first, then the active environment, then the priority list, then secrets. Toggle "encrypted" on a variable to AES-GCM-encrypt the value with your local master key — the ciphertext is what gets pushed to Git, never the plaintext. Plan-level priority overrides this list during plan runs.',
    keywords: ['env', 'variable', 'placeholder', 'encrypted', 'priority', 'BASE_URL'],
  },
  {
    id: 'secret-vault',
    title: 'Secret Vault',
    body: 'The Secret Vault holds encrypted credentials and GitHub session tokens, keyed by label. Each entry carries an origin: workspace-defined keys you created, or linked-from keys provisioned for a linked workspace. The "where used" column tracks which environments, requests, and link cards consume each key, and delete is gated when usage is non-empty. The Sessions tab manages your GitHub PAT — update the token in place without losing branch or PR state.',
    keywords: ['secret', 'vault', 'token', 'session', 'pat', 'encrypted', 'used in'],
  },
  {
    id: 'link-workspace',
    title: 'Link Workspace',
    body: 'Link another workspace to consume its release ledger. Private links are by repo + branch using your active GitHub session; public links flow through marketplace search (GitHub repos tagged topic:apicircle-marketplace). Each card shows the pinned version, cached version count, and a changelog viewer. Pinning, unpinning, and unlinking always go through a confirmation dialog. Required secret keys declared on a card become inputs that write through to your Secret Vault tagged origin: linked.',
    keywords: ['link', 'connection', 'marketplace', 'consume', 'dependency', 'pin'],
  },
  {
    id: 'release-management',
    title: 'Release Management',
    body: 'Workspaces own their release ledger in workspace.json under releases.self.versions. Publishing stamps a SHA-256 of the canonical pre-publish workspace into workspaceSnapshot for integrity verification. Every action — publish, deprecate, yank — routes through a confirm dialog; yank requires typed confirmation ("Type YANK v1.3.0"). Consumer workspaces cache the source ledger under releases.perLink at link time and refresh it on demand. No GitHub Actions, no tag automation: the workspace doc is the source of truth.',
    keywords: ['release', 'publish', 'version', 'semver', 'deprecate', 'yank', 'snapshot'],
  },
  {
    id: 'execution-plans',
    title: 'Execution Plans',
    body: "Plans run a sequence of requests in order. Each step references a request id; the executor walks them sequentially, persisting one request-run per step plus a single plan-run summary into history. Run with assertions to fold each request's assertion verdicts into a per-step pass/fail flag. Plan-level env priority overrides the workspace's global order during the run. Plans are local-only — they never push to Git.",
    keywords: ['plan', 'execution', 'sequence', 'steps', 'assertions', 'priority'],
  },
  {
    id: 'history',
    title: 'History',
    body: 'Every send and every plan run lands in History, capped as a circular buffer (most recent first). Two tabs: Requests shows individual sends with status, duration, and assertion verdicts; Plans shows plan-run summaries with okCount/total badges. The top of the panel surfaces Workspace snapshots — pre-destructive captures plus manual saves you can restore from. History lives only in your local document — clearing browser storage clears history; pushing to Git never includes it.',
    keywords: ['history', 'logs', 'past runs', 'buffer', 'snapshot', 'restore'],
  },
  {
    id: 'snapshots',
    title: 'Workspace snapshots',
    body: 'Snapshots capture the entire synced doc into the local ledger. Auto-captured before every push, merge, linked-update apply, yank, and deprecate; also available as "Take snapshot now" in the History panel. Restore swaps the synced doc back to the captured state and clears the diff base so the next push surfaces the restore as a fresh re-fork against remote. The ledger is a ring buffer — pick the cap (10 / 50 / 200 MB or unlimited) in Settings; oldest entries evict when over cap.',
    keywords: ['snapshot', 'restore', 'rollback', 'backup', 'undo', 'ledger', 'ring buffer'],
  },
  {
    id: 'mcp',
    title: 'MCP',
    body: 'The MCP server exposes the workspace to AI assistants and CLI clients. Tools cover requests, folders, environments (CRUD + active + priority + import/export), execution plans (CRUD + add/remove/reorder steps + variables), assertions, mock servers (CRUD + endpoint CRUD + validation/response rule editing + multipliers), history (list, get, delete, purge by age), code generation, and importers (OpenAPI, Postman, Insomnia, HAR, curl). Configuration snippets for Claude Desktop, Cursor, and Continue live in the MCP panel.',
    keywords: [
      'mcp',
      'model context protocol',
      'ai',
      'assistant',
      'tool',
      'claude',
      'cursor',
      'continue',
    ],
  },
  {
    id: 'keyboard-shortcuts',
    title: 'Keyboard Shortcuts',
    body: 'Send: Ctrl+Enter (Cmd+Enter on macOS). Switch panels: Ctrl+1 through Ctrl+7 for Workspace, Link Workspace, Editor, Environments, Execution, History, Help. Open Secret Vault: Ctrl+K. Refresh the working branch: Ctrl+Shift+R. New request: Ctrl+N. Shortcuts that would conflict with browser defaults (like plain Ctrl+R) take Shift to disambiguate.',
    keywords: ['shortcut', 'hotkey', 'keyboard', 'ctrl', 'cmd'],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    body: '"Token missing scope": PAT lacks repo or pull_request scope — open Sessions, update the token, retry. "Workspace conflicted": refresh found divergent edits — pick a side per entity in the resolver. "Attachment too large": files over 100 MB are refused (GitHub blob limit); 10–100 MB warns and recommends LFS. "This branch already has content": first-pull banner — pull before pushing. Mock startup errors: port in use, spec parse failed, or OAuth2 callback never fires (Desktop bridge needed for browser-redirect grants).',
    keywords: [
      'error',
      'fix',
      'recover',
      'scope',
      'conflict',
      'attachment',
      'mock',
      'port',
      'oauth',
      'first pull',
    ],
  },
];

/**
 * Substring search across title, body, and keywords. Lower-cased, returns
 * the matching sections in the original order so the user gets a stable
 * results layout rather than relevance-ranked.
 */
export function searchHelp(query: string): HelpSection[] {
  const q = query.trim().toLowerCase();
  if (!q) return HELP_SECTIONS;
  return HELP_SECTIONS.filter((section) => {
    if (section.title.toLowerCase().includes(q)) return true;
    if (section.body.toLowerCase().includes(q)) return true;
    if (section.keywords?.some((kw) => kw.toLowerCase().includes(q))) return true;
    return false;
  });
}
