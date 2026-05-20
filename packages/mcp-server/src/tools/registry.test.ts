import { describe, expect, it } from 'vitest';
import { MCP_TOOL_NAMES } from '@apicircle/shared';
import { TOOL_REGISTRY, getTool } from './registry';

describe('TOOL_REGISTRY', () => {
  it('exposes one ToolDef per catalog name in @apicircle/shared', () => {
    const registered = new Set(TOOL_REGISTRY.map((t) => t.name));
    for (const name of MCP_TOOL_NAMES) {
      expect(registered.has(name)).toBe(true);
    }
  });

  it('does not introduce tools that are not in the catalog', () => {
    const catalog = new Set(MCP_TOOL_NAMES);
    for (const tool of TOOL_REGISTRY) {
      expect(catalog.has(tool.name)).toBe(true);
    }
  });

  it('every tool has a non-empty description', () => {
    for (const tool of TOOL_REGISTRY) {
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('getTool resolves by name', () => {
    expect(getTool('request.create')?.name).toBe('request.create');
    expect(getTool('mock.start')?.name).toBe('mock.start');
  });

  it('getTool returns undefined for an unknown name', () => {
    // @ts-expect-error — exercising the runtime fallback
    expect(getTool('nope.nope')).toBeUndefined();
  });

  it('catalog has no duplicate registrations', () => {
    const seen = new Set<string>();
    for (const tool of TOOL_REGISTRY) {
      expect(seen.has(tool.name)).toBe(false);
      seen.add(tool.name);
    }
    expect(seen.size).toBe(TOOL_REGISTRY.length);
  });
});
