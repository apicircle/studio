import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Command } from 'commander';
import { loadFromFile } from '@apicircle/core/workspace/file-backed';
import { registerImportCommand } from './import';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apicircle-cli-import-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function buildProgram(): Command {
  const program = new Command().exitOverride();
  registerImportCommand(program);
  return program;
}

describe('apicircle import', () => {
  it('imports an OpenAPI spec into a fresh workspace', async () => {
    const specPath = path.join(tmpDir, 'spec.json');
    await fs.writeFile(
      specPath,
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'X', version: '1.0' },
        paths: {
          '/a': { get: { responses: { '200': { description: 'ok' } } } },
          '/b': { post: { responses: { '200': { description: 'ok' } } } },
        },
      }),
    );
    const ws = path.join(tmpDir, 'ws');
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'apicircle',
      'import',
      'openapi',
      specPath,
      '--workspace',
      ws,
      '--format',
      'json',
    ]);
    const loaded = await loadFromFile(ws);
    expect(loaded).not.toBeNull();
    expect(Object.keys(loaded!.synced.collections.requests).length).toBe(2);
  });

  it('imports a curl one-liner', async () => {
    const curlPath = path.join(tmpDir, 'curl.txt');
    await fs.writeFile(curlPath, "curl -X POST https://api.example.test/users -d '{}'");
    const ws = path.join(tmpDir, 'ws');
    const program = buildProgram();
    await program.parseAsync(['node', 'apicircle', 'import', 'curl', curlPath, '--workspace', ws]);
    const loaded = await loadFromFile(ws);
    expect(Object.values(loaded!.synced.collections.requests)[0].method).toBe('POST');
  });

  it('imports a Postman collection', async () => {
    const colPath = path.join(tmpDir, 'col.json');
    await fs.writeFile(
      colPath,
      JSON.stringify({
        info: { name: 'X' },
        item: [{ name: 'a', request: { method: 'GET', url: 'https://api/x' } }],
      }),
    );
    const ws = path.join(tmpDir, 'ws');
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'apicircle',
      'import',
      'postman',
      colPath,
      '--workspace',
      ws,
    ]);
    const loaded = await loadFromFile(ws);
    expect(Object.keys(loaded!.synced.collections.requests).length).toBe(1);
  });

  it('imports an Insomnia export', async () => {
    const expPath = path.join(tmpDir, 'export.json');
    await fs.writeFile(
      expPath,
      JSON.stringify({
        _type: 'export',
        resources: [{ _type: 'request', method: 'GET', url: 'https://api/y' }],
      }),
    );
    const ws = path.join(tmpDir, 'ws');
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'apicircle',
      'import',
      'insomnia',
      expPath,
      '--workspace',
      ws,
    ]);
    const loaded = await loadFromFile(ws);
    expect(Object.keys(loaded!.synced.collections.requests).length).toBe(1);
  });
});
