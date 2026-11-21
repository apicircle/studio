import { describe, expect, it } from 'vitest';
import { specRefTargetKind } from './specRefTarget';

describe('specRefTargetKind', () => {
  it('reads JSON and YAML files as documents, whatever the case', () => {
    expect(specRefTargetKind('schemas/user.yaml')).toBe('document');
    expect(specRefTargetKind('../common/errors.JSON')).toBe('document');
    expect(specRefTargetKind('paths/admin_api-keys_{id}.yml')).toBe('document');
    expect(specRefTargetKind('https://example.com/specs/common.json')).toBe('document');
  });

  it('reads prose and code-sample sources as text', () => {
    // The two real shapes: Redocly code samples (medusa) and a Markdown description (allauth).
    expect(specRefTargetKind('code_samples/JavaScript/admin_api-keys/get.js')).toBe('text');
    expect(specRefTargetKind('../code_samples/Shell/admin_api-keys/post.sh')).toBe('text');
    expect(specRefTargetKind('description.md')).toBe('text');
    expect(specRefTargetKind('docs/Intro.MARKDOWN')).toBe('text');
    expect(specRefTargetKind('samples/get.py')).toBe('text');
  });

  it('leaves no extension, or one that says neither, unknown', () => {
    expect(specRefTargetKind('schemas/user')).toBe('unknown');
    expect(specRefTargetKind('schemas/user.v1')).toBe('unknown');
    expect(specRefTargetKind('schemas/user.xml')).toBe('unknown');
    // A dot that starts the name is not an extension, and neither is one in a folder.
    expect(specRefTargetKind('.md')).toBe('unknown');
    expect(specRefTargetKind('v1.0/user')).toBe('unknown');
    expect(specRefTargetKind('')).toBe('unknown');
  });

  it("reads a URL's name without its query", () => {
    expect(specRefTargetKind('https://example.com/docs/intro.md?raw=1')).toBe('text');
    expect(specRefTargetKind('https://example.com/specs/user.yaml?v=2')).toBe('document');
    expect(specRefTargetKind('https://example.com/')).toBe('unknown');
  });
});
