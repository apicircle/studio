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
      '--workspace-path',
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
    await program.parseAsync([
      'node',
      'apicircle',
      'import',
      'curl',
      curlPath,
      '--workspace-path',
      ws,
    ]);
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
      '--workspace-path',
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
      '--workspace-path',
      ws,
    ]);
    const loaded = await loadFromFile(ws);
    expect(Object.keys(loaded!.synced.collections.requests).length).toBe(1);
  });

  it('imports an apicircle.folder/v1 envelope with embedded files (reattach note)', async () => {
    const envPath = path.join(tmpDir, 'env-files.json');
    const envelope = {
      format: 'apicircle.folder/v1',
      exportedAt: '2026-06-02T00:00:00.000Z',
      appVersion: '1',
      source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Uploads' },
      folder: {
        name: 'Uploads',
        subfolders: [],
        requests: [],
      },
      dependencies: {
        schemas: [],
        graphql: [],
        files: [
          {
            id: 'file-1',
            name: 'avatar',
            slotId: 'slot-x',
            filename: 'avatar.png',
            size: 1,
            mimeType: 'image/png',
            createdAt: '2026-06-02T00:00:00.000Z',
            updatedAt: '2026-06-02T00:00:00.000Z',
          },
        ],
      },
    };
    await fs.writeFile(envPath, JSON.stringify(envelope));
    const ws = path.join(tmpDir, 'ws');
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'apicircle',
      'import',
      'apicircle',
      envPath,
      '--workspace-path',
      ws,
    ]);
    const loaded = await loadFromFile(ws);
    // The parser re-mints every embedded asset id, so look it up by name.
    const file = Object.values(loaded!.synced.globalAssets.files ?? {}).find(
      (f) => f.name === 'avatar',
    );
    expect(file).toBeDefined();
  });

  it('imports an apicircle.folder/v1 envelope', async () => {
    const envPath = path.join(tmpDir, 'envelope.json');
    const envelope = {
      format: 'apicircle.folder/v1',
      exportedAt: '2026-06-02T00:00:00.000Z',
      appVersion: '1',
      source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Imported Auth' },
      folder: {
        name: 'Imported Auth',
        subfolders: [],
        requests: [
          {
            id: 'r-1',
            name: 'POST /login',
            folderId: 'f-root',
            method: 'POST',
            url: 'https://api.example.com/login',
            headers: [],
            query: [],
            body: { type: 'none', content: '' },
            auth: { type: 'none' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: '2026-06-02T00:00:00.000Z',
            updatedAt: '2026-06-02T00:00:00.000Z',
          },
        ],
      },
      dependencies: { schemas: [], graphql: [], files: [] },
    };
    await fs.writeFile(envPath, JSON.stringify(envelope));
    const ws = path.join(tmpDir, 'ws');
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'apicircle',
      'import',
      'apicircle',
      envPath,
      '--workspace-path',
      ws,
    ]);
    const loaded = await loadFromFile(ws);
    const folder = Object.values(loaded!.synced.collections.folders).find(
      (f) => f.name === 'Imported Auth',
    );
    expect(folder).toBeDefined();
    const requests = Object.values(loaded!.synced.collections.requests).filter(
      (r) => r.folderId === folder?.id,
    );
    expect(requests).toHaveLength(1);
  });
});
