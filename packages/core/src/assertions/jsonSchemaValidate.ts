/**
 * A tiny, dependency-free, STRICT validator for the JSON Schema subset that API Circle emits as
 * a `json-schema` assertion (see {@link runAssertions}). It is intentionally NOT a full JSON
 * Schema implementation — it covers exactly the keywords the response-schema generator produces:
 *
 *   - `type` — a JSON type name or an array of them (`['string','null']` for nullable fields);
 *   - `properties` + `required` + `additionalProperties:false` (strict: no unexpected keys);
 *   - `items` — an array's element schema (an empty array trivially passes);
 *   - `enum` — the value must be one of the listed literals;
 *   - `pattern` — a regex a string value must match (used for string `format`s).
 *
 * An empty schema (`{}`) accepts any value — how an unresolved (`unknown`) field is represented.
 * Validation is fail-fast: it returns the FIRST mismatch as a `$`-rooted path + reason, or `null`
 * when the value conforms.
 */

export interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: Array<string | number | boolean | null>;
  pattern?: string;
}

type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

/** The JSON type of a value — `null` and `array` distinguished from `object` (matches the engine). */
function jsonTypeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value; // 'string' | 'number' | 'boolean' | 'object' | 'undefined'
}

/** Whether a value satisfies a single JSON Schema type name. `integer` = a whole number. */
function matchesType(type: JsonSchemaType, value: unknown): boolean {
  switch (type) {
    case 'object':
      return jsonTypeOf(value) === 'object';
    case 'array':
      return Array.isArray(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number';
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
  }
}

/** A child path for an object key: `$.name` for an identifier-like key, `$["odd key"]` otherwise. */
function childPath(base: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`;
}

/** A compact JSON rendering of a value for error messages (objects/arrays summarized by type). */
function describe(value: unknown): string {
  const t = jsonTypeOf(value);
  if (t === 'object' || t === 'array') return t;
  return JSON.stringify(value);
}

/**
 * Validate `value` against `schema`. Returns `null` when valid, else the first mismatch as a
 * human-readable `path: reason` string. `path` is the `$`-rooted location of the offending value.
 */
export function validateJsonSchema(schema: JsonSchema, value: unknown, path = '$'): string | null {
  if (schema.enum) {
    return schema.enum.some((e) => e === value)
      ? null
      : `${path}: expected one of ${JSON.stringify(schema.enum)}, got ${describe(value)}`;
  }

  const types =
    schema.type === undefined
      ? undefined
      : Array.isArray(schema.type)
        ? schema.type
        : [schema.type];
  if (types && !types.some((t) => matchesType(t, value))) {
    return `${path}: expected type ${types.join('|')}, got ${jsonTypeOf(value)}`;
  }

  if (
    jsonTypeOf(value) === 'object' &&
    (schema.properties || schema.required || schema.additionalProperties === false)
  ) {
    const obj = value as Record<string, unknown>;
    const props = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!(key in obj)) return `${childPath(path, key)}: required property missing`;
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) return `${childPath(path, key)}: unexpected property`;
      }
    }
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) {
        const err = validateJsonSchema(sub, obj[key], childPath(path, key));
        if (err) return err;
      }
    }
  }

  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const err = validateJsonSchema(schema.items, value[i], `${path}[${i}]`);
      if (err) return err;
    }
  }

  if (typeof value === 'string' && schema.pattern) {
    let re: RegExp;
    try {
      re = new RegExp(schema.pattern);
    } catch {
      return null; // an unparseable pattern can't fail the value — treat as no constraint
    }
    if (!re.test(value)) return `${path}: "${value}" does not match /${schema.pattern}/`;
  }

  return null;
}
