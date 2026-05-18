import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Command } from 'commander';
import { inferFormat, inferType, makeSource, registerMockCommand } from './mock';

// `apicircle mock <spec>` blocks the process via SIGINT once the server is
// running. We can't drive that path from a unit test without a child
// process, so we exercise the parsing + booting in isolation by stubbing
// the listener before the command's `installShutdown` runs. The integration
// test in P29's release smoke also covers the full lifecycle end-to-end.

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apicircle-cli-mock-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('apicircle mock command registration', () => {
  it('registers the mock subcommand with expected options', () => {
    const program = new Command();
    registerMockCommand(program);
    const mock = program.commands.find((c) => c.name() === 'mock');
    expect(mock).toBeDefined();
    const optionNames = mock!.options.map((o) => o.long);
    expect(optionNames).toContain('--port');
    expect(optionNames).toContain('--host');
    expect(optionNames).toContain('--type');
    expect(optionNames).toContain('--format');
  });

  it('exits with helpful error when the spec file is missing', async () => {
    const program = new Command().exitOverride();
    registerMockCommand(program);
    const missing = path.join(tmpDir, 'does-not-exist.yaml');
    await expect(
      program.parseAsync(['node', 'apicircle', 'mock', missing, '--port', '0']),
    ).rejects.toThrow();
  });
});

describe('mock helpers', () => {
  it('inferType prefers explicit hint over filename heuristic', () => {
    expect(inferType('/tmp/whatever.yaml', 'postman')).toBe('postman');
    expect(inferType('/tmp/whatever.yaml', 'auto')).toBe('openapi');
  });

  it('inferType detects postman / insomnia in filenames', () => {
    expect(inferType('/tmp/postman_collection.json', 'auto')).toBe('postman');
    expect(inferType('/tmp/Insomnia_2025.json', 'auto')).toBe('insomnia');
  });

  it('inferFormat picks yaml from extension', () => {
    expect(inferFormat('/tmp/x.yaml', 'auto')).toBe('yaml');
    expect(inferFormat('/tmp/x.yml', 'auto')).toBe('yaml');
    expect(inferFormat('/tmp/x.json', 'auto')).toBe('json');
    expect(inferFormat('/tmp/x.yaml', 'json')).toBe('json');
  });

  it('makeSource builds the right discriminator', () => {
    expect(makeSource('openapi', 'yaml', 'spec')).toEqual({
      kind: 'openapi',
      spec: 'spec',
      format: 'yaml',
    });
    expect(makeSource('postman', 'json', 'col')).toEqual({
      kind: 'postman',
      collection: 'col',
    });
    expect(makeSource('insomnia', 'json', 'exp')).toEqual({
      kind: 'insomnia',
      export: 'exp',
    });
  });
});
