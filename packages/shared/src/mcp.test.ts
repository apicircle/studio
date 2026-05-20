import { describe, expect, it } from 'vitest';
import { MCP_TOOL_NAMES, type McpToolName, type McpError } from './mcp';

describe('MCP_TOOL_NAMES', () => {
  it('catalog has no duplicates', () => {
    const set = new Set<McpToolName>(MCP_TOOL_NAMES);
    expect(set.size).toBe(MCP_TOOL_NAMES.length);
  });

  it('catalog covers every namespace area', () => {
    const namespaces = new Set(MCP_TOOL_NAMES.map((t) => t.split('.')[0]));
    for (const expected of [
      'import',
      'generate',
      'workspace',
      'request',
      'folder',
      'environment',
      'plan',
      'assertion',
      'codebase',
      'prompt',
      'mock',
    ]) {
      expect(namespaces).toContain(expected);
    }
  });

  it('every tool name uses dot-namespacing', () => {
    for (const name of MCP_TOOL_NAMES) {
      expect(name).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });
});

describe('McpError', () => {
  it('accepts every documented error code', () => {
    const codes: McpError['code'][] = [
      'invalid_input',
      'not_found',
      'conflict',
      'unsupported',
      'internal',
    ];
    for (const code of codes) {
      const e: McpError = { code, message: 'x' };
      expect(e.code).toBe(code);
    }
  });

  it('details is optional', () => {
    const e: McpError = { code: 'internal', message: 'boom' };
    expect(e.details).toBeUndefined();
  });
});
