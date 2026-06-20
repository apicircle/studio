import * as vscode from 'vscode';
import {
  MCP_PROMPTS,
  MCP_PROMPT_CATEGORIES,
  type McpPrompt,
  type McpPromptCategory,
} from '@apicircle/mcp-server';

// =============================================================================
// apicircle-prompts: read-only prompt-catalog documents
//
// Each MCP prompt category (Workspaces, Collections, Environments, …) is
// projected as a single read-only Markdown document the user opens by clicking
// the category row in the MCP view's Prompts section. The document lists every
// prompt in the category with:
//
//   • a numbered heading                                    (what it is)
//   • the prompt text in a fenced code block                (copy / paste)
//   • a "What it does" line                                 (description)
//   • the MCP tools it drives                               (explanation)
//
// The document is rendered Markdown — open the preview (the ↗ lens at the top,
// or Ctrl+Shift+V) for a formatted view, or copy any single prompt with the
// ⧉ Copy prompt CodeLens (see lang/promptCatalogCodeLens.ts).
//
// URI shape:  apicircle-prompts://catalog/<Label>.md?category=<categoryId>
//
// The `?category=` query is the source of truth — the basename is purely the
// human-readable tab label. Content is static (derived from the shared
// MCP_PROMPTS catalog), so the provider never needs to fire change events.
// =============================================================================

export const PROMPT_CATALOG_SCHEME = 'apicircle-prompts';

/** Marker that precedes each prompt block — the CodeLens provider anchors the
 *  "⧉ Copy prompt" lens on this line and reads the prompt id back out via
 *  {@link promptIdFromAnchorLine}. */
const PROMPT_ANCHOR_PREFIX = '<!-- prompt:';

const PROMPT_ANCHOR_RE = /^<!--\s*prompt:([A-Za-z0-9-]+)\s*-->\s*$/;

/** One-line "what this category is for" blurb — the per-category explanation.
 *  Typed as an exhaustive record so adding a McpPromptCategory fails the build
 *  until a blurb is written for it. */
const CATEGORY_BLURBS: Record<McpPromptCategory, string> = {
  workspaces:
    'Discover and scope across every API Circle workspace you have registered. Start here when the AI is not sure which workspace to drive.',
  collections: 'Read, author, and reorganise the requests and folders in the active workspace.',
  environments:
    'Inspect, create, and switch the environments whose variables get layered onto requests.',
  execution: 'Run individual requests or saved plans, then triage what just happened from history.',
  mocks: 'Spin up, list, and tear down the local mock servers your requests can hit.',
  auth: 'Wire authentication onto requests — from a single bearer token to a full OAuth2 grant.',
  imports:
    'Bring existing API definitions into the workspace — OpenAPI specs, cURL commands, and more.',
};

/** Every prompt belonging to a category, in catalog order. */
export function promptsForCategory(category: McpPromptCategory): McpPrompt[] {
  return MCP_PROMPTS.filter((p) => p.category === category);
}

/** Derive a short Title-Case heading from a prompt id (`list-requests` →
 *  "List Requests"). Prompts carry no explicit title, so the id is the stable,
 *  predictable source. */
export function promptTitleFromId(id: string): string {
  return id
    .split('-')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/** Extract the prompt id from an anchor comment line, or null if the line is
 *  not an anchor. */
export function promptIdFromAnchorLine(line: string): string | null {
  const m = PROMPT_ANCHOR_RE.exec(line);
  return m ? m[1] : null;
}

/** Build the canonical read-only document URI for a prompt category. */
export function promptCategoryUri(category: McpPromptCategory, label: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: PROMPT_CATALOG_SCHEME,
    authority: 'catalog',
    path: `/${encodeURIComponent(label)}.md`,
    query: `category=${encodeURIComponent(category)}`,
  });
}

/** Resolve a prompt-catalog URI back to its canonical category + label, or null
 *  when the URI is not a recognised catalog document. */
export function parsePromptCatalogUri(
  uri: vscode.Uri,
): { category: McpPromptCategory; label: string } | null {
  if (uri.scheme !== PROMPT_CATALOG_SCHEME) return null;
  const raw = new URLSearchParams(uri.query || '').get('category');
  if (!raw) return null;
  const meta = MCP_PROMPT_CATEGORIES.find((c) => c.id === raw);
  return meta ? { category: meta.id, label: meta.label } : null;
}

/** CommonMark-safe fence: a run of backticks one longer than the longest
 *  backtick run inside `text` (min 3), so prompt text that itself contains
 *  backticks can't break out of the code block. */
function fenceFor(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

/** Render a prompt category as a complete Markdown document. Pure — no vscode
 *  dependency — so it round-trips in unit tests. */
export function buildPromptCategoryMarkdown(category: McpPromptCategory, label: string): string {
  const prompts = promptsForCategory(category);
  const lines: string[] = [];

  lines.push(`# ${label} prompts`);
  lines.push('');
  lines.push(CATEGORY_BLURBS[category]);
  lines.push('');
  lines.push(
    'Starter prompts for the API Circle MCP server. Copy one, paste it into your connected ' +
      'AI client (Claude Desktop, Cursor, GitHub Copilot, …), and tweak the wording to match ' +
      'your workspace — the client drives the MCP tools listed under each prompt.',
  );
  lines.push('');
  lines.push(
    '> Click **⧉ Copy prompt** above any prompt to copy it, or **↗ Open rendered preview** ' +
      'at the top for a formatted view.',
  );
  lines.push('');

  if (prompts.length === 0) {
    lines.push('_No prompts in this category yet._');
    lines.push('');
    return lines.join('\n');
  }

  prompts.forEach((prompt, i) => {
    const fence = fenceFor(prompt.text);
    lines.push('---');
    lines.push('');
    lines.push(`${PROMPT_ANCHOR_PREFIX}${prompt.id} -->`);
    lines.push(`## ${i + 1}. ${promptTitleFromId(prompt.id)}`);
    lines.push('');
    lines.push(`${fence}text`);
    lines.push(prompt.text);
    lines.push(fence);
    lines.push('');
    lines.push(`**What it does** — ${prompt.description}`);
    lines.push('');
    lines.push(
      `**MCP tools it drives** — ${prompt.tools.map((t) => `\`${t}\``).join(', ') || '_none_'}`,
    );
    lines.push('');
  });

  return lines.join('\n');
}

/**
 * Read-only TextDocumentContentProvider for `apicircle-prompts:` URIs. Returns
 * the rendered Markdown for a category, or a small fallback document when the
 * URI can't be resolved (e.g. a category was removed from the catalog while a
 * stale tab was open).
 */
export class PromptCatalogContentProvider
  implements vscode.TextDocumentContentProvider, vscode.Disposable
{
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange: vscode.Event<vscode.Uri> = this._onDidChange.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    const parsed = parsePromptCatalogUri(uri);
    if (!parsed) {
      return (
        '# Unknown prompt category\n\n' +
        'This prompt catalog document could not be resolved. Open a category from the ' +
        'MCP view’s **Prompts** section.\n'
      );
    }
    return buildPromptCategoryMarkdown(parsed.category, parsed.label);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
