// Re-export from the shared package so Desktop/Web UI and VS Code extension
// both consume the same canonical prompt catalog.
// Uses the sub-path import to avoid pulling in mcp-server's Node.js-only
// transitive deps (@hono/node-server, @modelcontextprotocol/sdk) into the
// Vite web build.
export {
  MCP_PROMPTS,
  MCP_PROMPT_CATEGORIES,
  type McpPrompt,
  type McpPromptCategory,
} from '@apicircle/mcp-server/prompts';
