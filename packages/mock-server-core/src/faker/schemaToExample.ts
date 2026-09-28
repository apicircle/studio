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
//
// The walk is BOUNDED, whatever document it is handed. A dereferenced spec is
// not always a tree:
//
//   • the Node build's swagger-parser leaves an in-document cycle as a REAL
//     object cycle (`Category.properties.children.items === Category`), and
//   • both resolvers share one object between every use of a `$ref` (js-yaml
//     does the same for every use of a YAML anchor), so a few KB of fan-out can
//     describe an example with more nodes than memory holds.
//
// So a schema met again inside itself answers with the empty value of its kind
// (`{}` / `[]`) — the same place the browser resolver cuts that cycle
// (`refDeref.ts`) — nesting stops at `EXAMPLE_MAX_DEPTH`, and what an example
// emits is paid for from an `ExampleBudget`:
//
//   • every schema visited costs one unit, and
//   • explicit example data (an `example`, a named example's `value`, a
//     `default`, `const` or enum member) is free the FIRST time an operation
//     emits it — data the document spells out cannot be larger than the
//     document — while each repeat (a YAML alias, a shared `$ref`) costs one
//     unit per node, plus one per 64 characters of text.
//
// A budget belongs to ONE OPERATION: the parser hands each operation a fresh
// one, and nothing is counted across a whole document — an earlier
// document-wide cap truncated a legitimate 800-operation spec to 434 endpoints.
// Past the budget, the rest of that one operation's example is left empty and
// the budget reports `truncated`, so the caller can say so.

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

/** Units one operation may spend on its examples. Real response schemas stay
 *  in the hundreds of nodes; the budget only binds a document built to explode. */
export const EXAMPLE_NODE_BUDGET = 10_000;

/** Levels of nesting one example may reach before the rest is left empty. */
export const EXAMPLE_MAX_DEPTH = 64;

/** Characters of repeated text that cost one extra unit. */
const TEXT_UNIT = 64;

/**
 * One operation's allowance for building examples. The parser creates one per
 * operation and passes it to every example it builds for that operation — the
 * response body, its headers, its parameter examples — so an operation's
 * examples stay bounded however far its schemas and data fan out.
 */
export class ExampleBudget {
  private remaining: number;
  private cut = false;
  /** Example-data objects this operation has already emitted once. */
  private readonly emitted = new WeakSet<object>();

  constructor(units: number = EXAMPLE_NODE_BUDGET) {
    this.remaining = units;
  }

  /** True once any part of an example was left out: the budget ran out, or
   *  the nesting went past `EXAMPLE_MAX_DEPTH`. A cycle cut is not a
   *  truncation — a recursive schema has no end to show. */
  get truncated(): boolean {
    return this.cut;
  }

  /** Spend `units`. `false` — and `truncated` from then on — when fewer are left. */
  spend(units = 1): boolean {
    if (this.remaining >= units) {
      this.remaining -= units;
      return true;
    }
    this.remaining = 0;
    this.cut = true;
    return false;
  }

  /** Record a cut made for a reason other than the budget (the depth cap). */
  markTruncated(): void {
    this.cut = true;
  }

  /** Whether this operation already emitted `node`; records it either way. */
  emittedBefore(node: object): boolean {
    if (this.emitted.has(node)) return true;
    this.emitted.add(node);
    return false;
  }
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

const PRIMITIVE_TYPES: ReadonlySet<string> = new Set([
  'string',
  'integer',
  'number',
  'boolean',
  'null',
]);

/** Build an example for `schema` on a budget of its own. */
export function schemaToExample(schema: JsonSchemaLike | undefined): unknown {
  return exampleFromSchema(schema, new ExampleBudget());
}

/** Build an example for `schema`, spending `budget` — the caller passes one
 *  budget per operation (see the module header). */
export function exampleFromSchema(
  schema: JsonSchemaLike | undefined,
  budget: ExampleBudget,
): unknown {
  return synthesize(schema, budget, new Set<object>(), 0);
}

/**
 * A copy of explicit example data that is safe to serialise: a value that
 * contains itself is cut where it closes, nesting stops at `EXAMPLE_MAX_DEPTH`,
 * and whatever the operation already emitted costs budget to emit again (see
 * the module header). Anything that is not a plain object or array — a number,
 * the `Date` js-yaml makes of a timestamp — comes back as it is, so serialising
 * the copy gives exactly what serialising the original would have.
 */
export function exampleFromData(value: unknown, budget: ExampleBudget): unknown {
  return copyData(value, budget, new Set<object>(), 0, false);
}

function synthesize(
  schema: JsonSchemaLike | undefined,
  budget: ExampleBudget,
  path: Set<object>,
  depth: number,
): unknown {
  if (!schema) return null;
  // Not a schema object (a JSON Schema boolean, a malformed entry): there is
  // nothing to read from it, so it gets the generic object answer.
  if (typeof schema !== 'object') return {};
  // Met again inside itself: a cycle. Answer where the browser resolver cuts it.
  if (path.has(schema)) return emptyExampleOf(schema);
  if (depth >= EXAMPLE_MAX_DEPTH) {
    budget.markTruncated();
    return emptyExampleOf(schema);
  }
  if (!budget.spend()) return emptyExampleOf(schema);

  // Explicit example / default / const win in that order.
  if (schema.example !== undefined) return explicitValue(schema.example, budget);
  if (schema.default !== undefined) return explicitValue(schema.default, budget);
  if (schema.const !== undefined) return explicitValue(schema.const, budget);

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return explicitValue(schema.enum[0], budget);
  }

  path.add(schema);
  try {
    // Compositors: pick the first branch.
    const branch = schema.allOf?.[0] ?? schema.oneOf?.[0] ?? schema.anyOf?.[0];
    if (branch) return synthesize(branch, budget, path, depth + 1);

    // Type can be a single string or an array; pick the first non-null.
    const type = pickType(schema.type);
    if (type !== undefined && PRIMITIVE_TYPES.has(type)) return primitiveExample(schema, type);
    if (type === 'array') {
      return [schema.items ? synthesize(schema.items, budget, path, depth + 1) : null];
    }
    // 'object', no type at all, or a type this generator doesn't know.
    const properties = schema.properties ?? {};
    const required = Array.isArray(schema.required) ? schema.required : Object.keys(properties);
    const out: Record<string, unknown> = {};
    for (const key of required) {
      const propSchema = properties[key];
      out[key] = synthesize(propSchema, budget, path, depth + 1);
    }
    return out;
  } finally {
    path.delete(schema);
  }
}

/** A schema's own `example` / `default` / `const` / enum member. A schema can
 *  be visited many times, so its text is paid for on every visit (the visit
 *  itself already cost a unit); objects follow the data rule. */
function explicitValue(value: unknown, budget: ExampleBudget): unknown {
  if (typeof value === 'string') {
    return budget.spend(Math.floor(value.length / TEXT_UNIT)) ? value : '';
  }
  return exampleFromData(value, budget);
}

/** What a schema answers with when nothing below it may be expanded — a cycle,
 *  the depth cap, a spent budget: an empty array or object. A primitive keeps
 *  its ordinary example; it has nothing below it to cut. */
function emptyExampleOf(schema: JsonSchemaLike): unknown {
  const type = pickType(schema.type);
  if (type === 'array') return [];
  if (type !== undefined && PRIMITIVE_TYPES.has(type)) return primitiveExample(schema, type);
  return {};
}

function primitiveExample(schema: JsonSchemaLike, type: string): unknown {
  switch (type) {
    case 'string':
      return typeof schema.format === 'string' && Object.hasOwn(FORMAT_DEFAULTS, schema.format)
        ? FORMAT_DEFAULTS[schema.format]
        : 'string';
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    default:
      // 'null'
      return null;
  }
}

/** `again` is true below a container this operation already emitted: from
 *  there down, everything emitted is a repeat and is paid for. */
function copyData(
  value: unknown,
  budget: ExampleBudget,
  path: Set<object>,
  depth: number,
  again: boolean,
): unknown {
  if (typeof value === 'string') {
    if (!again) return value;
    return budget.spend(1 + Math.floor(value.length / TEXT_UNIT)) ? value : '';
  }
  if (!isPlainContainer(value)) {
    // A number, boolean, null or `Date` has nothing to cut; a repeat still costs.
    if (again) budget.spend();
    return value;
  }
  // A value that contains itself (a recursive YAML alias): cut where it closes.
  if (path.has(value)) return emptyLike(value);
  if (depth >= EXAMPLE_MAX_DEPTH) {
    budget.markTruncated();
    return emptyLike(value);
  }
  const repeat = budget.emittedBefore(value) || again;
  if (repeat && !budget.spend()) return emptyLike(value);
  path.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item: unknown) => copyData(item, budget, path, depth + 1, repeat));
    }
    // `fromEntries` defines every key as an own property — a data key named
    // `__proto__` included — exactly as serialising the original shows it.
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        copyData(item, budget, path, depth + 1, repeat),
      ]),
    );
  } finally {
    path.delete(value);
  }
}

/** An array, or an object built from a JSON / YAML literal — the containers a
 *  copy descends into. */
function isPlainContainer(value: unknown): value is object {
  if (Array.isArray(value)) return true;
  if (value === null || typeof value !== 'object') return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function emptyLike(value: object): unknown {
  return Array.isArray(value) ? [] : {};
}

function pickType(type: unknown): string | undefined {
  if (!type) return undefined;
  if (typeof type === 'string') return type;
  if (!Array.isArray(type)) return undefined;
  // Prefer non-null types so the example isn't trivially `null`.
  const picked: unknown = type.find((t) => t !== 'null') ?? type[0];
  return typeof picked === 'string' ? picked : undefined;
}
