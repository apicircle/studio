// Minimal JSON Schema → example value generator. Used when an OpenAPI
// operation has no `example` / `examples` map, but the response body's
// schema is defined. Handles the common cases:
//
//   • primitives (string, number, integer, boolean, null) — picks a
//     plausible default per `format` when present
//   • arrays — single-element with the items schema sampled
//   • objects — every required property; falls back to all properties
//     when `required` is missing
//   • enums — first value
//   • const — verbatim
//   • allOf / oneOf / anyOf — first branch
//
// Doesn't try to be a full faker — the goal is "realistic enough for a
// developer testing happy paths", not exhaustive boundary cases.

export interface JsonSchemaLike {
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  example?: unknown;
  properties?: Record<string, JsonSchemaLike>;
  required?: string[];
  items?: JsonSchemaLike;
  allOf?: JsonSchemaLike[];
  oneOf?: JsonSchemaLike[];
  anyOf?: JsonSchemaLike[];
}

const FORMAT_DEFAULTS: Record<string, string> = {
  'date-time': '2026-04-27T00:00:00.000Z',
  date: '2026-04-27',
  time: '00:00:00',
  email: 'user@example.com',
  hostname: 'example.com',
  ipv4: '127.0.0.1',
  ipv6: '::1',
  uri: 'https://example.com',
  url: 'https://example.com',
  uuid: '00000000-0000-4000-8000-000000000000',
  byte: 'AA==',
  binary: '',
};

export function schemaToExample(schema: JsonSchemaLike | undefined): unknown {
  if (!schema) return null;

  // Explicit example / default / const win in that order.
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }

  // Compositors: pick the first branch.
  const branch = schema.allOf?.[0] ?? schema.oneOf?.[0] ?? schema.anyOf?.[0];
  if (branch) return schemaToExample(branch);

  // Type can be a single string or an array; pick the first non-null.
  const type = pickType(schema.type);

  switch (type) {
    case 'string':
      return schema.format ? (FORMAT_DEFAULTS[schema.format] ?? 'string') : 'string';
    case 'integer':
      return 0;
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'null':
      return null;
    case 'array': {
      const items = schema.items ? schemaToExample(schema.items) : null;
      return [items];
    }
    case 'object':
    default: {
      const properties = schema.properties ?? {};
      const required = schema.required ?? Object.keys(properties);
      const out: Record<string, unknown> = {};
      for (const key of required) {
        const propSchema = properties[key];
        out[key] = schemaToExample(propSchema);
      }
      return out;
    }
  }
}

function pickType(type: string | string[] | undefined): string | undefined {
  if (!type) return undefined;
  if (typeof type === 'string') return type;
  // Prefer non-null types so the example isn't trivially `null`.
  return type.find((t) => t !== 'null') ?? type[0];
}
