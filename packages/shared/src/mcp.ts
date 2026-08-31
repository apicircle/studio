// MCP envelope types. The MCP server itself moved to the Lens overlay
// (`@apicircle-lens/mcp-core`); these names stay here because they are
// published API of `@apicircle/shared` and removing them would be a
// breaking change to a package the split was meant to leave untouched.
// and any consumer that needs to know the tool catalog up-front (the
// Lens uses the legacy names when maintaining backward-compatible adapters.
//
// The actual tool input/output schemas live next to each tool's
// implementation in `@apicircle-lens/mcp-core` (Zod schemas), since they
// depend on workspace types that would otherwise force `shared` to
// import everything.

/**
 * Every MCP tool the server exposes. Namespaced by capability area so AI
 * clients can group them in their UI. Keep in sync with the Lens MCP registry
 * while this legacy shared API remains exported.
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

  // Workspace bulk read/write + multi-workspace discovery
  | 'workspace.list'
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
  | 'folder.export_json'
  | 'folder.import_json'
  | 'environment.create'
  | 'environment.read'
  | 'environment.update'
  | 'environment.delete'
  | 'environment.set_active'
  | 'environment.set_priority'
  | 'environment.export'
  | 'environment.import'
  | 'plan.create'
  | 'plan.run'
  | 'plan.read'
  | 'plan.update'
  | 'plan.delete'
  | 'plan.add_step'
  | 'plan.remove_step'
  | 'plan.reorder_steps'
  | 'plan.set_variables'
  | 'assertion.create'
  | 'assertion.read'
  | 'assertion.update'
  | 'assertion.delete'

  // History (local request/plan run buffers)
  | 'history.list_runs'
  | 'history.get_run'
  | 'history.delete_run'
  | 'history.purge_by_age'

  // Codebase extraction
  | 'codebase.extract_collection'

  // Prompt-driven authoring (LLM-shaped JSON in, structured persistence out)
  | 'prompt.create_environment'
  | 'prompt.create_assertion'
  | 'prompt.create_plan'
  | 'prompt.create_request'
  | 'prompt.update_request'
  | 'prompt.create_folder_tree'
  | 'prompt.add_plan_steps'
  | 'prompt.set_plan_variables'
  | 'prompt.create_mock_server'
  | 'prompt.add_mock_endpoint'
  | 'prompt.set_endpoint_validation_rules'
  | 'prompt.set_endpoint_response_rules'
  | 'prompt.set_endpoint_multipliers'
  | 'prompt.set_endpoint_request_schema'

  // Global file asset library (file uploads bound to request bodies and
  // mock responses; provenance + reference-count surface)
  | 'assets.list_files'
  | 'assets.create_file'
  | 'assets.update_file'
  | 'assets.delete_file'

  // Mock server lifecycle
  | 'mock.create_from_openapi'
  | 'mock.create_from_postman'
  | 'mock.create_from_insomnia'
  | 'mock.create_manual'
  | 'mock.list'
  | 'mock.list_endpoints'
  | 'mock.refresh'
  | 'mock.promote_endpoint'
  | 'mock.promote_to_collection'
  | 'mock.start'
  | 'mock.stop'
  | 'mock.delete'
  | 'mock.add_endpoint'
  | 'mock.update_endpoint'
  | 'mock.delete_endpoint'
  | 'mock.set_validation_rules'
  | 'mock.set_response_rules'
  | 'mock.set_multipliers'
  | 'mock.set_request_schema'
  | 'mock.set_default_port'
  | 'mock.import_postman_mock_collection'

  // Release ledger (synced.releases.self — the versions linked consumers pin to)
  | 'release.list'
  | 'release.publish'
  | 'release.deprecate'
  | 'release.yank'

  // Linked workspaces — pure-data config (synced.linkedWorkspaces)
  | 'linked.list'
  | 'linked.get'
  | 'linked.set_config'
  | 'linked.unlink'

  // GitHub network ops (need a token: `token` arg or `GITHUB_TOKEN` env)
  | 'linked.link'
  | 'linked.refresh'
  | 'release.tag'
  | 'repo.set_topics'

  // Marketplace discovery (anonymous or token-authenticated)
  | 'marketplace.search';

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
  'workspace.list',
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
  'folder.export_json',
  'folder.import_json',
  'environment.create',
  'environment.read',
  'environment.update',
  'environment.delete',
  'environment.set_active',
  'environment.set_priority',
  'environment.export',
  'environment.import',
  'plan.create',
  'plan.run',
  'plan.read',
  'plan.update',
  'plan.delete',
  'plan.add_step',
  'plan.remove_step',
  'plan.reorder_steps',
  'plan.set_variables',
  'assertion.create',
  'assertion.read',
  'assertion.update',
  'assertion.delete',
  'history.list_runs',
  'history.get_run',
  'history.delete_run',
  'history.purge_by_age',
  'codebase.extract_collection',
  'prompt.create_environment',
  'prompt.create_assertion',
  'prompt.create_plan',
  'prompt.create_request',
  'prompt.update_request',
  'prompt.create_folder_tree',
  'prompt.add_plan_steps',
  'prompt.set_plan_variables',
  'prompt.create_mock_server',
  'prompt.add_mock_endpoint',
  'prompt.set_endpoint_validation_rules',
  'prompt.set_endpoint_response_rules',
  'prompt.set_endpoint_multipliers',
  'prompt.set_endpoint_request_schema',
  'assets.list_files',
  'assets.create_file',
  'assets.update_file',
  'assets.delete_file',
  'mock.create_from_openapi',
  'mock.create_from_postman',
  'mock.create_from_insomnia',
  'mock.create_manual',
  'mock.list',
  'mock.list_endpoints',
  'mock.refresh',
  'mock.promote_endpoint',
  'mock.promote_to_collection',
  'mock.start',
  'mock.stop',
  'mock.delete',
  'mock.add_endpoint',
  'mock.update_endpoint',
  'mock.delete_endpoint',
  'mock.set_validation_rules',
  'mock.set_response_rules',
  'mock.set_multipliers',
  'mock.set_request_schema',
  'mock.set_default_port',
  'mock.import_postman_mock_collection',
  'release.list',
  'release.publish',
  'release.deprecate',
  'release.yank',
  'linked.list',
  'linked.get',
  'linked.set_config',
  'linked.unlink',
  'linked.link',
  'linked.refresh',
  'release.tag',
  'repo.set_topics',
  'marketplace.search',
];
