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
    body: 'Create requests in the Editor panel sidebar. Each request carries a method, URL, headers, query params, body, context variables, and assertions. Body types include json, text, xml, graphql, urlencoded, form-data, and binary; the Content-Type header auto-syncs with the body type so you rarely set it manually. Send runs the request through the workspace resolver, applies the active environment, and surfaces the response with assertion verdicts inline.',
    keywords: ['request', 'send', 'body', 'headers', 'assertions', 'response'],
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
    body: 'Every send and every plan run lands in History, capped as a circular buffer (most recent first). Two tabs: Requests shows individual sends with status, duration, and assertion verdicts; Plans shows plan-run summaries with okCount/total badges. History lives only in your local document — clearing browser storage clears history; pushing to Git never includes it.',
    keywords: ['history', 'logs', 'past runs', 'buffer'],
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
    body: '"Token missing scope" modal: GitHub denied an action because the PAT lacks repo or pull_request scope. The modal opens the Sessions tab; update the token in place and retry. "Workspace conflicted": refresh detected divergent edits — open the Conflict Resolver, pick a side per entity, and apply. "Attachment too large": files over 100 MB are refused (GitHub blob limit); files between 10 and 100 MB warn and recommend Git LFS.',
    keywords: ['error', 'fix', 'recover', 'scope', 'conflict', 'attachment'],
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
