import { describe, expect, it } from 'vitest';
import { Uri } from '../../test/mocks/vscode';
import { MCP_PROMPTS, MCP_PROMPT_CATEGORIES } from '@apicircle/mcp-server';
import {
  PROMPT_CATALOG_SCHEME,
  PromptCatalogContentProvider,
  buildPromptCategoryMarkdown,
  parsePromptCatalogUri,
  promptCategoryUri,
  promptIdFromAnchorLine,
  promptTitleFromId,
  promptsForCategory,
} from './promptCatalog';

describe('promptCatalog', () => {
  describe('promptTitleFromId', () => {
    it('Title-Cases each kebab segment', () => {
      expect(promptTitleFromId('list-requests')).toBe('List Requests');
      expect(promptTitleFromId('auth-set-bearer')).toBe('Auth Set Bearer');
    });
    it('handles a single word', () => {
      expect(promptTitleFromId('mocks')).toBe('Mocks');
    });
  });

  describe('promptsForCategory', () => {
    it('returns only prompts in the category, in catalog order', () => {
      const collections = promptsForCategory('collections');
      expect(collections.length).toBeGreaterThan(0);
      for (const p of collections) expect(p.category).toBe('collections');
      // catalog order preserved
      const expected = MCP_PROMPTS.filter((p) => p.category === 'collections').map((p) => p.id);
      expect(collections.map((p) => p.id)).toEqual(expected);
    });
  });

  describe('promptIdFromAnchorLine', () => {
    it('extracts the id from an anchor comment', () => {
      expect(promptIdFromAnchorLine('<!-- prompt:list-requests -->')).toBe('list-requests');
    });
    it('returns null for non-anchor lines', () => {
      expect(promptIdFromAnchorLine('## 1. List Requests')).toBeNull();
      expect(promptIdFromAnchorLine('')).toBeNull();
      expect(promptIdFromAnchorLine('<!-- not-a-prompt -->')).toBeNull();
    });
  });

  describe('promptCategoryUri / parsePromptCatalogUri', () => {
    it('round-trips category + canonical label', () => {
      const uri = promptCategoryUri('collections', 'Collections');
      expect(uri.scheme).toBe(PROMPT_CATALOG_SCHEME);
      expect(uri.path).toBe('/Collections.md');
      expect(uri.query).toContain('category=collections');
      const parsed = parsePromptCatalogUri(uri);
      expect(parsed).toEqual({ category: 'collections', label: 'Collections' });
    });

    it('derives the canonical label from the catalog (ignores a stale path label)', () => {
      const uri = Uri.from({
        scheme: PROMPT_CATALOG_SCHEME,
        authority: 'catalog',
        path: '/Whatever.md',
        query: 'category=mocks',
      });
      expect(parsePromptCatalogUri(uri)).toEqual({ category: 'mocks', label: 'Mocks' });
    });

    it('returns null for foreign schemes, missing query, and unknown categories', () => {
      expect(parsePromptCatalogUri(Uri.parse('file:///x.md'))).toBeNull();
      expect(
        parsePromptCatalogUri(
          Uri.from({ scheme: PROMPT_CATALOG_SCHEME, authority: 'catalog', path: '/x.md' }),
        ),
      ).toBeNull();
      expect(
        parsePromptCatalogUri(
          Uri.from({
            scheme: PROMPT_CATALOG_SCHEME,
            authority: 'catalog',
            path: '/x.md',
            query: 'category=nope',
          }),
        ),
      ).toBeNull();
    });

    it('builds a valid URI for every catalog category', () => {
      for (const c of MCP_PROMPT_CATEGORIES) {
        const uri = promptCategoryUri(c.id, c.label);
        expect(parsePromptCatalogUri(uri)).toEqual({ category: c.id, label: c.label });
      }
    });
  });

  describe('buildPromptCategoryMarkdown', () => {
    it('renders the title, an explanation, and the copy tip', () => {
      const md = buildPromptCategoryMarkdown('collections', 'Collections');
      expect(md).toContain('# Collections prompts');
      expect(md).toContain('Read, author, and reorganise'); // category blurb
      expect(md).toContain('⧉ Copy prompt'); // tip references the copy lens
      expect(md).toContain('↗ Open rendered preview');
    });

    it('renders every prompt with anchor, text, description, and tools', () => {
      for (const category of MCP_PROMPT_CATEGORIES) {
        const md = buildPromptCategoryMarkdown(category.id, category.label);
        for (const prompt of promptsForCategory(category.id)) {
          expect(md).toContain(`<!-- prompt:${prompt.id} -->`);
          expect(md).toContain(prompt.text);
          expect(md).toContain(prompt.description);
          expect(md).toContain('**What it does**');
          expect(md).toContain('**MCP tools it drives**');
          for (const tool of prompt.tools) expect(md).toContain(`\`${tool}\``);
        }
      }
    });

    it('numbers prompts sequentially from 1', () => {
      const md = buildPromptCategoryMarkdown('workspaces', 'Workspaces');
      expect(md).toContain('## 1. ');
      expect(md).toContain('## 2. ');
    });
  });

  describe('PromptCatalogContentProvider', () => {
    it('returns rendered Markdown for a valid catalog URI', () => {
      const provider = new PromptCatalogContentProvider();
      const content = provider.provideTextDocumentContent(
        promptCategoryUri('environments', 'Environments'),
      );
      expect(content).toContain('# Environments prompts');
      provider.dispose();
    });

    it('returns a fallback document for an unresolvable URI', () => {
      const provider = new PromptCatalogContentProvider();
      const content = provider.provideTextDocumentContent(Uri.parse('file:///nope.md'));
      expect(content).toContain('Unknown prompt category');
      provider.dispose();
    });
  });
});
