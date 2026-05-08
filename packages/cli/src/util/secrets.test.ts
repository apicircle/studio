import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { WorkspaceState } from '@apicircle/core';
import {
  buildSecretsFromCli,
  collectSecretRequirements,
  formatMissingSecretsError,
  resolveSecretsForWorkspace,
} from './secrets';

function makeWorkspace(): WorkspaceState {
  return {
    synced: {
      schemaVersion: 1,
      workspaceId: 'ws',
      workspaceName: 'fixture',
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        requests: {},
        folders: {},
      },
      environments: {
        items: {
          dev: {
            name: 'dev',
            variables: [
              { key: 'TOKEN', value: '', encrypted: true, secretKeyId: 'sec-token' },
              { key: 'BASE_URL', value: 'https://api.example.com', encrypted: false },
            ],
          },
          prod: {
            name: 'prod',
            variables: [
              { key: 'TOKEN', value: '', encrypted: true, secretKeyId: 'sec-token' },
              { key: 'CLIENT_KEY', value: '', encrypted: true, secretKeyId: 'sec-client' },
            ],
          },
        },
        activeName: null,
        priorityOrder: ['dev'],
      },
      linkedWorkspaces: {},
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink: {} },
      globalAssets: { schemas: {}, graphql: {} },
      mockServers: {},
      secretKeys: {
        'sec-token': { id: 'sec-token', label: 'API_TOKEN', createdAt: '2026-04-01T00:00:00Z' },
      },
      meta: {
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
        appVersion: '0.1.0',
      },
    },
    local: {
      schemaVersion: 1,
      workspaceId: 'ws',
      executionPlans: {},
      history: { requestRuns: [], planRuns: [] },
      secretIndex: { entries: {} },
      sessions: { github: null },
      connectedRepo: null,
      workingBranch: null,
      sync: { lastPulledSnapshot: null, lastPulledSha: null, lastPulledAt: null, dirtyKeys: [] },
      linkedCollections: {},
      globalContext: {},
      mockRuntime: { active: {} },
      ui: { activeRequestId: null, sidebarExpandedSections: [], themeId: 'studio-dark' },
    },
  };
}

describe('cli/secrets', () => {
  describe('collectSecretRequirements', () => {
    it('lists every distinct secretKeyId referenced across environments', () => {
      const reqs = collectSecretRequirements(makeWorkspace());
      const ids = reqs.map((r) => r.id).sort();
      expect(ids).toEqual(['sec-client', 'sec-token']);
      const tokenReq = reqs.find((r) => r.id === 'sec-token')!;
      expect(tokenReq.label).toBe('API_TOKEN'); // from synced.secretKeys
      expect(tokenReq.references).toEqual(
        expect.arrayContaining([
          { envName: 'dev', varKey: 'TOKEN' },
          { envName: 'prod', varKey: 'TOKEN' },
        ]),
      );
      const clientReq = reqs.find((r) => r.id === 'sec-client')!;
      // Falls back to a short-id label when synced.secretKeys lacks the id.
      expect(clientReq.label).toContain('sec-cl');
    });

    it('returns empty when no env-var references a secret key', () => {
      const ws = makeWorkspace();
      ws.synced.environments.items.dev.variables = [
        { key: 'BASE', value: 'plain', encrypted: false },
      ];
      ws.synced.environments.items.prod.variables = [];
      expect(collectSecretRequirements(ws)).toEqual([]);
    });
  });

  describe('buildSecretsFromCli', () => {
    it('reads APICIRCLE_SECRET_<id>=value env vars', async () => {
      const result = await buildSecretsFromCli({
        env: { APICIRCLE_SECRET_alpha: 'A', APICIRCLE_SECRET_beta: 'B', UNRELATED: 'x' },
      });
      expect(result.byId).toEqual({ alpha: 'A', beta: 'B' });
    });

    it('reads a JSON file mapping ids → values', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apicircle-secrets-'));
      const file = path.join(dir, 's.json');
      await fs.writeFile(file, JSON.stringify({ alpha: 'fromfile', gamma: 'g' }));
      const result = await buildSecretsFromCli({
        secretsFile: file,
        env: { APICIRCLE_SECRET_alpha: 'fromenv' },
      });
      // Env vars override file values (later in resolution order).
      expect(result.byId).toEqual({ alpha: 'fromenv', gamma: 'g' });
    });

    it('throws on a malformed JSON file', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apicircle-secrets-'));
      const file = path.join(dir, 'bad.json');
      await fs.writeFile(file, JSON.stringify(['not', 'an', 'object']));
      await expect(buildSecretsFromCli({ secretsFile: file })).rejects.toThrow(
        /expected an object/,
      );
    });
  });

  describe('resolveSecretsForWorkspace', () => {
    it('returns the id→value map when every required secret is provided', async () => {
      const ws = makeWorkspace();
      // Env-var names preserve the secretKeyId verbatim (hyphens included).
      const map = await resolveSecretsForWorkspace(ws, {
        env: { 'APICIRCLE_SECRET_sec-token': 'T', 'APICIRCLE_SECRET_sec-client': 'C' },
      });
      expect(map['sec-token']).toBe('T');
      expect(map['sec-client']).toBe('C');
    });

    it('throws an APICIRCLE_MISSING_SECRETS error listing every missing id', async () => {
      const ws = makeWorkspace();
      const promise = resolveSecretsForWorkspace(ws, { env: {} });
      await expect(promise).rejects.toThrow(/sec-token/);
      await expect(promise).rejects.toThrow(/sec-client/);
    });
  });

  describe('formatMissingSecretsError', () => {
    it('renders a multi-line message that mentions the env+var references', () => {
      const msg = formatMissingSecretsError([
        {
          id: 'abc',
          label: 'API_TOKEN',
          references: [
            { envName: 'dev', varKey: 'TOKEN' },
            { envName: 'prod', varKey: 'TOKEN' },
          ],
        },
      ]);
      expect(msg).toContain('Missing secret values');
      expect(msg).toContain('id "abc"');
      expect(msg).toContain('API_TOKEN');
      expect(msg).toContain('env "dev" var "TOKEN"');
      expect(msg).toContain('APICIRCLE_SECRET_<id>');
      expect(msg).toContain('--secrets <file>.json');
    });
  });
});
