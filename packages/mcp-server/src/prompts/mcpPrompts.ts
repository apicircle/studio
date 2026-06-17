// Curated starter prompts the user can paste into any MCP-connected AI
// client to drive their workspace. Each prompt names the MCP tool family
// it exercises so users can match it back to the tool catalog.
//
// Hand-curated, not auto-derived: the goal is to teach the user what's
// possible, not to enumerate every tool. ~3-4 per category covers the
// common cases without overwhelming the page.
//
// Shared between Desktop/Web (ui-components) and VS Code extension.

export interface McpPrompt {
  id: string;
  /** Natural-language prompt the user copies. */
  text: string;
  /** Short description rendered under the prompt. */
  description: string;
  /** Which MCP tool family this prompt exercises — used as a filter chip. */
  category: McpPromptCategory;
  /** The MCP tool names this prompt is likely to drive. Informational only. */
  tools: ReadonlyArray<string>;
}

export type McpPromptCategory =
  | 'workspaces'
  | 'collections'
  | 'environments'
  | 'execution'
  | 'mocks'
  | 'auth'
  | 'imports';

export const MCP_PROMPT_CATEGORIES: ReadonlyArray<{
  id: McpPromptCategory;
  label: string;
}> = [
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'collections', label: 'Collections' },
  { id: 'environments', label: 'Environments' },
  { id: 'execution', label: 'Execution' },
  { id: 'mocks', label: 'Mocks' },
  { id: 'auth', label: 'Auth' },
  { id: 'imports', label: 'Imports' },
];

export const MCP_PROMPTS: ReadonlyArray<McpPrompt> = [
  // ── Workspaces (multi-workspace discovery) ───────────────────────
  {
    id: 'list-workspaces',
    text: 'List every API Circle workspace I have and tell me which is active.',
    description:
      'Multi-workspace discovery — call this first when you are not sure which workspace to drive.',
    category: 'workspaces',
    tools: ['workspace.list'],
  },
  {
    id: 'scope-to-workspace',
    text: 'Read the requests in the "Petstore" workspace.',
    description:
      'Drill into a specific workspace by name; the AI passes `workspaceId` to scope reads.',
    category: 'workspaces',
    tools: ['workspace.list', 'workspace.read'],
  },
  {
    id: 'multi-workspace-summary',
    text: 'Across every workspace, count requests, folders, environments, and mocks. Give me one row per workspace.',
    description:
      'High-level summary across every registered workspace — pairs well with the multi-workspace envelope.',
    category: 'workspaces',
    tools: ['workspace.list'],
  },

  // ── Collections (requests + folders in the active workspace) ─────
  {
    id: 'list-requests',
    text: 'List every request in my API Circle workspace grouped by folder.',
    description: 'Quick overview of the request catalog so you know what is already wired up.',
    category: 'collections',
    tools: ['workspace.read', 'request.read', 'folder.read'],
  },
  {
    id: 'create-request',
    text: 'Add a new GET request named "Health check" pointing at https://example.com/healthz with an Accept: application/json header.',
    description: 'Have the AI author a request and persist it to the workspace.',
    category: 'collections',
    tools: ['request.create'],
  },
  {
    id: 'update-request',
    text: 'Find the "Create user" request and change its method to POST and body to {"name": "Ada"}.',
    description: 'Targeted edit by name — the AI looks it up, then updates.',
    category: 'collections',
    tools: ['request.read', 'request.update'],
  },
  {
    id: 'organize-folders',
    text: 'Move every request whose URL contains /users into a folder named "User API".',
    description: 'Bulk reorganisation via natural language.',
    category: 'collections',
    tools: ['workspace.read', 'folder.create', 'request.update'],
  },

  // ── Environments ──────────────────────────────────────────────────
  {
    id: 'env-list',
    text: 'Show me all environments and which one is active.',
    description: 'Inventory of envs + which is layered onto requests right now.',
    category: 'environments',
    tools: ['environment.read'],
  },
  {
    id: 'env-create',
    text: 'Create a "staging" environment with BASE_URL=https://staging.example.com and API_KEY={{SECRET:staging-key}}.',
    description: 'Spin up a new env with both a plain variable and a secret reference.',
    category: 'environments',
    tools: ['environment.create'],
  },
  {
    id: 'env-switch',
    text: 'Switch the active environment to "production" and confirm by previewing the effective URL of the "Get user" request.',
    description: 'Activate an env then verify variable interpolation.',
    category: 'environments',
    tools: ['environment.update', 'request.read'],
  },

  // ── Execution ─────────────────────────────────────────────────────
  {
    id: 'run-request',
    text: 'Run the "Get user" request with userId=42 and show me the JSON response.',
    description: 'One-shot execution with overridden context vars.',
    category: 'execution',
    tools: ['request.execute'],
  },
  {
    id: 'run-plan',
    text: 'Execute the "Regression smoke" plan and summarise which assertions failed.',
    description: 'Drive a saved execution plan end-to-end.',
    category: 'execution',
    tools: ['plan.read', 'plan.execute'],
  },
  {
    id: 'inspect-history',
    text: 'Show me the last 5 requests I ran and their status codes.',
    description: 'Quick triage when something just broke.',
    category: 'execution',
    tools: ['history.read'],
  },

  // ── Mocks ─────────────────────────────────────────────────────────
  {
    id: 'mock-start',
    text: 'Start the "Petstore" mock on port 4010 and tell me its base URL.',
    description: 'Spin up a local mock so requests can hit it.',
    category: 'mocks',
    tools: ['mock.list', 'mock.start'],
  },
  {
    id: 'mock-list',
    text: 'List every running mock with its port, served spec, and request count.',
    description: 'Status snapshot of every active mock runtime.',
    category: 'mocks',
    tools: ['mock.list'],
  },
  {
    id: 'mock-stop',
    text: 'Stop every running mock.',
    description: 'Clean shutdown of all mock servers in one go.',
    category: 'mocks',
    tools: ['mock.stopAll'],
  },

  // ── Auth ──────────────────────────────────────────────────────────
  {
    id: 'auth-set-bearer',
    text: 'Set the "Get user" request to use bearer auth with token={{ACCESS_TOKEN}}.',
    description: 'Wire bearer auth onto a single request via env-var reference.',
    category: 'auth',
    tools: ['request.update'],
  },
  {
    id: 'auth-oauth2',
    text: 'Configure the "Create order" request to use OAuth2 client-credentials against https://auth.example.com/token with the "orders.write" scope.',
    description: 'Full OAuth2 client-credentials wiring without leaving the chat.',
    category: 'auth',
    tools: ['request.update'],
  },

  // ── Imports ───────────────────────────────────────────────────────
  {
    id: 'import-openapi',
    text: 'Import the OpenAPI spec at ./openapi.yaml and create one request per operation.',
    description: 'Bulk import of a spec file from the workspace.',
    category: 'imports',
    tools: ['import.openapi'],
  },
  {
    id: 'import-curl',
    text: 'I am going to paste a cURL command — turn it into a saved request named "Webhook test".',
    description: 'cURL → saved request with a name you control.',
    category: 'imports',
    tools: ['import.curl'],
  },
];
