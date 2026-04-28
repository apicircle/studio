import type { McpToolName } from '@apicircle/shared';
import type { AnyToolDef } from './types';
import {
  importCurlTool,
  importOpenApiTool,
  importPostmanTool,
  importInsomniaTool,
  importHarTool,
} from './imports';
import { generateCodeTool } from './codegen';
import {
  workspaceReadTool,
  workspaceWriteTool,
  requestCreateTool,
  requestReadTool,
  requestUpdateTool,
  requestDeleteTool,
  folderCreateTool,
  folderReadTool,
  folderUpdateTool,
  folderDeleteTool,
  environmentCreateTool,
  environmentReadTool,
  environmentUpdateTool,
  environmentDeleteTool,
  planCreateTool,
  planReadTool,
  planUpdateTool,
  planDeleteTool,
  planRunTool,
  assertionCreateTool,
  assertionReadTool,
  assertionUpdateTool,
  assertionDeleteTool,
} from './crud';
import { codebaseExtractCollectionTool } from './codebase';
import {
  promptCreateEnvironmentTool,
  promptCreateAssertionTool,
  promptCreatePlanTool,
} from './prompt';
import {
  mockCreateFromOpenApiTool,
  mockCreateFromPostmanTool,
  mockCreateFromInsomniaTool,
  mockListTool,
  mockStartTool,
  mockStopTool,
  mockDeleteTool,
  mockImportPostmanMockCollectionTool,
} from './mocks';

// Order matches MCP_TOOL_NAMES in `@apicircle/shared/src/mcp.ts`. CI guards
// drift via the registry test which asserts every catalog entry resolves.
export const TOOL_REGISTRY: AnyToolDef[] = [
  importCurlTool,
  importOpenApiTool,
  importPostmanTool,
  importInsomniaTool,
  importHarTool,
  generateCodeTool,
  workspaceReadTool,
  workspaceWriteTool,
  requestCreateTool,
  requestReadTool,
  requestUpdateTool,
  requestDeleteTool,
  folderCreateTool,
  folderReadTool,
  folderUpdateTool,
  folderDeleteTool,
  environmentCreateTool,
  environmentReadTool,
  environmentUpdateTool,
  environmentDeleteTool,
  planCreateTool,
  planRunTool,
  planReadTool,
  planUpdateTool,
  planDeleteTool,
  assertionCreateTool,
  assertionReadTool,
  assertionUpdateTool,
  assertionDeleteTool,
  codebaseExtractCollectionTool,
  promptCreateEnvironmentTool,
  promptCreateAssertionTool,
  promptCreatePlanTool,
  mockCreateFromOpenApiTool,
  mockCreateFromPostmanTool,
  mockCreateFromInsomniaTool,
  mockListTool,
  mockStartTool,
  mockStopTool,
  mockDeleteTool,
  mockImportPostmanMockCollectionTool,
];

export function getTool(name: McpToolName): AnyToolDef | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name);
}
