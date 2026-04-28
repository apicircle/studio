// MCP envelope types shared by the MCP server (`@apicircle/mcp-server`)
// and any consumer that needs to know the tool catalog up-front (the
// desktop app's "MCP" panel renders config snippets that reference these
// tool names verbatim).
//
// The actual tool input/output schemas live next to each tool's
// implementation in `@apicircle/mcp-server` (Zod schemas), since they
// depend on workspace types that would otherwise force `shared` to
// import everything.

/**
 * Every MCP tool the server exposes. Namespaced by capability area so AI
 * clients can group them in their UI. Keep in sync with the registry in
 * `packages/mcp-server/src/tools/registry.ts`.
 */
export type McpToolName =
  // Imports
  | 'import.curl'
  | 'import.openapi'
  | 'import.postman'
  | 'import.insomnia'
  | 'import.har'

  // Code generation
  | 'generate.code'

  // Workspace bulk read/write
  | 'workspace.read'
  | 'workspace.write'

  // Per-entity CRUD
  | 'request.create'
  | 'request.read'
  | 'request.update'
  | 'request.delete'
  | 'folder.create'
  | 'folder.read'
  | 'folder.update'
  | 'folder.delete'
  | 'environment.create'
  | 'environment.read'
  | 'environment.update'
  | 'environment.delete'
  | 'plan.create'
  | 'plan.run'
  | 'plan.read'
  | 'plan.update'
  | 'plan.delete'
  | 'assertion.create'
  | 'assertion.read'
  | 'assertion.update'
  | 'assertion.delete'

  // Codebase extraction
  | 'codebase.extract_collection'

  // Prompt-driven authoring (LLM-shaped JSON in, structured persistence out)
  | 'prompt.create_environment'
  | 'prompt.create_assertion'
  | 'prompt.create_plan'

  // Mock server lifecycle
  | 'mock.create_from_openapi'
  | 'mock.create_from_postman'
  | 'mock.create_from_insomnia'
  | 'mock.list'
  | 'mock.start'
  | 'mock.stop'
  | 'mock.delete'
  | 'mock.import_postman_mock_collection';

export interface McpError {
  code: 'invalid_input' | 'not_found' | 'conflict' | 'unsupported' | 'internal';
  message: string;
  details?: unknown;
}

/** Helper: full enumeration of tool names — useful for the docs / config UIs. */
export const MCP_TOOL_NAMES: ReadonlyArray<McpToolName> = [
  'import.curl',
  'import.openapi',
  'import.postman',
  'import.insomnia',
  'import.har',
  'generate.code',
  'workspace.read',
  'workspace.write',
  'request.create',
  'request.read',
  'request.update',
  'request.delete',
  'folder.create',
  'folder.read',
  'folder.update',
  'folder.delete',
  'environment.create',
  'environment.read',
  'environment.update',
  'environment.delete',
  'plan.create',
  'plan.run',
  'plan.read',
  'plan.update',
  'plan.delete',
  'assertion.create',
  'assertion.read',
  'assertion.update',
  'assertion.delete',
  'codebase.extract_collection',
  'prompt.create_environment',
  'prompt.create_assertion',
  'prompt.create_plan',
  'mock.create_from_openapi',
  'mock.create_from_postman',
  'mock.create_from_insomnia',
  'mock.list',
  'mock.start',
  'mock.stop',
  'mock.delete',
  'mock.import_postman_mock_collection',
];
