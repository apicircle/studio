import * as YAML from 'yaml';
import type { MockServer, MockServerSource, MockEndpoint } from '@apicircle/shared';
import { unknownTopLevelKeys } from './yamlStructure';

const KNOWN_MOCK_KEYS = ['name', 'defaultPort', 'cors', 'source', 'endpoints'] as const;

// =============================================================================
// Mock-server YAML projection.
//
// Round-trip between the canonical MockServer shape inside
// workspace.json and the human-friendly YAML the user edits.
//
// Editable fields:
//   • name
//   • defaultPort (null or 1024-65535)
//   • cors (enabled, origins[])
//
// Read-only annotations (preserved through round-trip):
//   • source — re-import the spec via the New Mock wizard to change
//   • endpoints — derived from source; re-parsing happens elsewhere
//
// The parser surfaces warnings for any read-only field the user tries to
// edit (e.g. endpoints). The desktop editor remains the right surface for
// per-endpoint mutation (response rules, validation, multipliers).
// =============================================================================

interface MockYamlOutput {
  name: string;
  defaultPort: number | null;
  cors: { enabled: boolean; origins?: string[] };
  source: {
    kind: MockServerSource['kind'];
    /** For OpenAPI: 'json' or 'yaml'. */
    format?: 'json' | 'yaml';
    /**
     * Byte-length of the source spec. P3R4-G3: we deliberately do NOT
     * serialize the spec content itself — it can contain bearer tokens,
     * API keys, or other secrets in `security.example` blocks and would
     * leak into Git via the workspace document otherwise. The raw spec
     * lives in workspace.json's `mockServers[id].source` field, which
     * is read by the parser at start time but never round-trips through
     * the human-edited YAML.
     */
    bytes?: number;
  };
  endpoints: Array<{
    id: string;
    method: string;
    pathPattern: string;
    name: string;
    defaultStatus: number;
  }>;
}

const HEADER_COMMENT = `# API Circle Mock Server — edit name / defaultPort / cors below and save.
#
# Source + endpoints are read-only in this projection. To change them:
#   • Re-import the spec via 'API Circle: New Mock' (replaces source)
#   • Per-endpoint behavior — open the per-endpoint YAML from the Mock
#     sidebar (click the endpoint row or the ✎ pencil) to edit method,
#     path, request validation, response rules, default response,
#     headers, multipliers, etc.
#
# Note: the raw spec content is intentionally NOT shown in this YAML —
# specs can contain bearer tokens or API keys that would otherwise be
# committed to Git. The full spec lives in workspace.json and is read by
# the mock-server runtime directly.
#
# Click the ▶ Start Mock CodeLens at top to spin up the server on
# 'defaultPort' (or a free port when null).
`;

export function serializeMockToYaml(server: MockServer): string {
  const out: MockYamlOutput = {
    name: server.name,
    defaultPort: server.defaultPort,
    cors: {
      enabled: server.cors.enabled,
      ...(server.cors.origins.length > 0 ? { origins: server.cors.origins } : {}),
    },
    source: serializeSource(server.source),
    endpoints: server.endpoints.map(serializeEndpointSummary),
  };
  const doc = new YAML.Document(out);
  doc.commentBefore = HEADER_COMMENT.replace(/^# /gm, ' ').trimEnd();
  return doc.toString({ lineWidth: 0 });
}

function serializeSource(source: MockServerSource): MockYamlOutput['source'] {
  if (source.kind === 'manual') {
    return { kind: 'manual' };
  }
  if (source.kind === 'openapi') {
    return {
      kind: 'openapi',
      format: source.format,
      bytes: source.spec.length,
    };
  }
  if (source.kind === 'postman') {
    return { kind: 'postman', bytes: source.collection.length };
  }
  return { kind: 'insomnia', bytes: source.export.length };
}

function serializeEndpointSummary(ep: MockEndpoint): MockYamlOutput['endpoints'][number] {
  return {
    id: ep.id,
    method: ep.method,
    pathPattern: ep.pathPattern,
    name: ep.name,
    defaultStatus: ep.defaultResponse.status,
  };
}

export interface ParsedMockYaml {
  /** Patch fields applied via mock.upsert with the existing server's source/endpoints preserved. */
  patch: Pick<MockServer, 'name' | 'defaultPort' | 'cors'>;
  warnings: string[];
}

export function parseMockFromYaml(text: string): ParsedMockYaml {
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch (e) {
    throw new MockYamlParseError(`Invalid YAML: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new MockYamlParseError('Document root must be a mapping.');
  }
  const obj = parsed as Record<string, unknown>;
  const warnings: string[] = [];

  const unknown = unknownTopLevelKeys(obj, KNOWN_MOCK_KEYS);
  if (unknown.length > 0) {
    throw new MockYamlParseError(
      `Unknown field(s): ${unknown.join(', ')}. Rename or remove them — saving an unrecognized mock structure is blocked to prevent silent data loss.`,
    );
  }

  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    throw new MockYamlParseError('Mock `name` is required and must be a non-empty string.');
  }

  let defaultPort: number | null = null;
  if (obj.defaultPort === null || obj.defaultPort === undefined) {
    defaultPort = null;
  } else if (typeof obj.defaultPort === 'number' && Number.isInteger(obj.defaultPort)) {
    if (obj.defaultPort < 1024 || obj.defaultPort > 65535) {
      throw new MockYamlParseError('`defaultPort` must be null or an integer in 1024-65535.');
    }
    defaultPort = obj.defaultPort;
  } else {
    throw new MockYamlParseError('`defaultPort` must be null or an integer.');
  }

  const cors = normalizeCors(obj.cors, warnings);

  if (obj.source !== undefined) {
    warnings.push(
      '`source` is read-only — re-import the spec via "API Circle: New Mock" to change it.',
    );
  }
  if (obj.endpoints !== undefined) {
    warnings.push(
      '`endpoints` is read-only in mock.yaml — open the per-endpoint `<endpointId>.yaml` (from the Mock sidebar) to edit method / path / response rules / validation rules / multipliers.',
    );
  }

  return {
    patch: { name: obj.name, defaultPort, cors },
    warnings,
  };
}

function normalizeCors(value: unknown, warnings: string[]): MockServer['cors'] {
  if (value === undefined || value === null) {
    return { enabled: false, origins: [] };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    warnings.push('`cors` should be a mapping with `enabled` + optional `origins`');
    return { enabled: false, origins: [] };
  }
  const r = value as Record<string, unknown>;
  const unknown = unknownTopLevelKeys(r, ['enabled', 'origins']);
  if (unknown.length > 0) {
    throw new MockYamlParseError(
      `cors: unknown field(s) ${unknown.join(', ')}. Expected { enabled, origins }.`,
    );
  }
  const enabled = r.enabled === true;
  let origins: string[] = [];
  if (Array.isArray(r.origins)) {
    origins = r.origins.filter((o): o is string => typeof o === 'string');
    if (origins.length !== r.origins.length) {
      warnings.push('`cors.origins` entries must be strings — non-string rows dropped.');
    }
  }
  return { enabled, origins };
}

export class MockYamlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MockYamlParseError';
  }
}
