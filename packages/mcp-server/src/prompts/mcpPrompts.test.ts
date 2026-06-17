import { describe, expect, it } from 'vitest';
import { MCP_PROMPTS, MCP_PROMPT_CATEGORIES } from './mcpPrompts';

describe('mcpPrompts', () => {
  it('has at least one prompt per category', () => {
    for (const cat of MCP_PROMPT_CATEGORIES) {
      const count = MCP_PROMPTS.filter((p) => p.category === cat.id).length;
      expect(count, `category "${cat.id}" has no prompts`).toBeGreaterThan(0);
    }
  });

  it('every prompt has a non-empty text and at least one tool', () => {
    for (const p of MCP_PROMPTS) {
      expect(p.text.length, `prompt "${p.id}" has empty text`).toBeGreaterThan(0);
      expect(p.tools.length, `prompt "${p.id}" has no tools`).toBeGreaterThan(0);
    }
  });

  it('prompt ids are unique', () => {
    const ids = MCP_PROMPTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every prompt category is valid', () => {
    const validCategories = new Set(MCP_PROMPT_CATEGORIES.map((c) => c.id));
    for (const p of MCP_PROMPTS) {
      expect(
        validCategories.has(p.category),
        `prompt "${p.id}" has invalid category "${p.category}"`,
      ).toBe(true);
    }
  });

  it('category ids are unique', () => {
    const ids = MCP_PROMPT_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
