import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import kleur from 'kleur';
import {
  parseSourceToEndpoints,
  startMockServer,
  type MockServerHandle,
} from '@apicircle/mock-server-core';
import { generateId, type MockServer } from '@apicircle/shared';

// =============================================================================
// `apicircle mock <spec>` — boot a mock server from an OpenAPI / Postman /
// Insomnia file. The path's extension chooses the parser; user can override
// with `--type {openapi,postman,insomnia}`.
// =============================================================================

interface MockOptions {
  port?: string;
  host?: string;
  type?: 'openapi' | 'postman' | 'insomnia' | 'auto';
  format?: 'json' | 'yaml' | 'auto';
  cors?: boolean;
}

export function registerMockCommand(program: Command): void {
  program
    .command('mock')
    .description('Run a mock server from an OpenAPI / Postman / Insomnia file')
    .argument('<spec>', 'Path to the spec file')
    .option('-p, --port <number>', 'TCP port to bind (defaults to a free port)')
    .option('-h, --host <host>', 'Hostname to bind', '127.0.0.1')
    .option('-t, --type <type>', 'Source type: openapi | postman | insomnia | auto', 'auto')
    .option('-f, --format <format>', 'OpenAPI format: json | yaml | auto', 'auto')
    .option('--cors', 'Enable permissive CORS', true)
    .action(async (spec: string, opts: MockOptions) => {
      const absolute = path.resolve(spec);
      const raw = await fs.readFile(absolute, 'utf-8');
      const type = inferType(absolute, opts.type ?? 'auto');
      const format = type === 'openapi' ? inferFormat(absolute, opts.format ?? 'auto') : 'json';

      const source = makeSource(type, format, raw);
      const parsed = await parseSourceToEndpoints(source);
      const mock: MockServer = {
        id: generateId(),
        name: path.basename(absolute),
        source,
        endpoints: parsed.endpoints,
        defaultPort: opts.port ? Number(opts.port) : null,
        cors: { enabled: opts.cors !== false, origins: ['*'] },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const handle = await startMockServer(mock, {
        port: opts.port ? Number(opts.port) : undefined,
        host: opts.host,
      });
      process.stdout.write(
        `${kleur.green('Mock server')} listening on ${kleur.cyan(`http://${opts.host}:${handle.port}`)} ` +
          `with ${parsed.endpoints.length} endpoints (type=${type}). Press Ctrl-C to stop.\n`,
      );
      if (parsed.warnings.length) {
        for (const w of parsed.warnings) {
          process.stderr.write(`${kleur.yellow('warn')}: ${w}\n`);
        }
      }
      installShutdown(handle);
    });
}

export function inferType(
  filePath: string,
  hint: NonNullable<MockOptions['type']>,
): 'openapi' | 'postman' | 'insomnia' {
  if (hint && hint !== 'auto') return hint;
  const lower = filePath.toLowerCase();
  if (lower.includes('postman')) return 'postman';
  if (lower.includes('insomnia')) return 'insomnia';
  return 'openapi';
}

export function inferFormat(
  filePath: string,
  hint: NonNullable<MockOptions['format']>,
): 'json' | 'yaml' {
  if (hint && hint !== 'auto') return hint;
  const lower = filePath.toLowerCase();
  return lower.endsWith('.yaml') || lower.endsWith('.yml') ? 'yaml' : 'json';
}

export function makeSource(
  type: 'openapi' | 'postman' | 'insomnia',
  format: 'json' | 'yaml',
  raw: string,
): MockServer['source'] {
  switch (type) {
    case 'openapi':
      return { kind: 'openapi', spec: raw, format };
    case 'postman':
      return { kind: 'postman', collection: raw };
    case 'insomnia':
      return { kind: 'insomnia', export: raw };
  }
}

function installShutdown(handle: MockServerHandle): void {
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await handle.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
