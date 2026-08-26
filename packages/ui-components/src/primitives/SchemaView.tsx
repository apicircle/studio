import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from './cn';

/**
 * The JSON Schema subset the contract tooling actually emits: `type` (widened to
 * `[t, 'null']` for a nullable field), `properties` + `required`, `items`, `enum`,
 * a `pattern` standing in for a well-known string format, and
 * `additionalProperties: false` to mean "no extra fields".
 *
 * Anything outside this subset still renders — unknown keywords are ignored and
 * the node falls back to "any shape" — so an unusual schema degrades rather than
 * throwing.
 */
export interface JsonSchemaNode {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  enum?: (string | number)[];
  pattern?: string;
  format?: string;
  description?: string;
  additionalProperties?: boolean;
}

function asNode(value: unknown): JsonSchemaNode | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
}

/** The type words a reader sees, with nullability spelled out rather than implied. */
export function describeType(node: JsonSchemaNode): { type: string; nullable: boolean } {
  const raw = node.type;
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const nullable = list.includes('null');
  const concrete = list.filter((t) => t !== 'null');
  if (concrete.length > 0) return { type: concrete.join(' or '), nullable };
  if (node.enum) return { type: 'enum', nullable };
  if (node.properties) return { type: 'object', nullable };
  if (node.items) return { type: 'array', nullable };
  // `{}` — the shape the extractor could not resolve. Say so plainly; a reader
  // needs to know this validates nothing, not that it is "an object".
  return { type: 'any', nullable };
}

const TYPE_TONE: Record<string, string> = {
  object: 'border-accent-strong/40 bg-accent/10 text-accent',
  array: 'border-http-put/40 bg-http-put/10 text-http-put',
  string: 'border-http-get/40 bg-http-get/10 text-http-get',
  number: 'border-http-get/40 bg-http-get/10 text-http-get',
  integer: 'border-http-get/40 bg-http-get/10 text-http-get',
  boolean: 'border-http-get/40 bg-http-get/10 text-http-get',
  enum: 'border-http-patch/40 bg-http-patch/10 text-http-patch',
  any: 'border-border bg-card text-text-dim',
};

function TypeBadge({ node }: { node: JsonSchemaNode }) {
  const { type, nullable } = describeType(node);
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span
        className={cn(
          'rounded-sm border px-1 text-[10px] font-semibold uppercase tracking-wide',
          TYPE_TONE[type] ?? TYPE_TONE.any,
        )}
      >
        {type}
      </span>
      {nullable ? (
        <span className="rounded-sm border border-border bg-card px-1 text-[10px] text-text-dim">
          nullable
        </span>
      ) : null}
    </span>
  );
}

/** `format` / `pattern` / `enum` — the constraints beyond the bare type. */
function Constraints({ node }: { node: JsonSchemaNode }) {
  const chips: string[] = [];
  if (node.format) chips.push(node.format);
  else if (node.pattern) chips.push('pattern');
  if (node.enum) chips.push(node.enum.map((v) => String(v)).join(' | '));
  if (chips.length === 0) return null;
  return (
    <span className="min-w-0 truncate text-[11px] text-text-dim" title={chips.join(' · ')}>
      {chips.join(' · ')}
    </span>
  );
}

function hasChildren(node: JsonSchemaNode): boolean {
  return Boolean(node.properties) || Boolean(node.items);
}

/** One property row, plus its nested rows when it is an object or an array. */
function Row({
  name,
  node,
  required,
  depth,
  openDepth,
}: {
  name: string;
  node: JsonSchemaNode;
  required: boolean;
  depth: number;
  openDepth: number;
}) {
  const [open, setOpen] = useState(depth < openDepth);
  const expandable = hasChildren(node);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <li>
      <div className="flex min-h-6 items-center gap-2">
        {expandable ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`}
            className="-mx-1 flex h-6 w-6 shrink-0 items-center justify-center text-text-dim hover:text-text-primary"
          >
            <Chevron size={12} aria-hidden />
          </button>
        ) : (
          <span aria-hidden className="w-4 shrink-0" />
        )}
        <span className="shrink-0 font-mono text-xs text-text-primary">{name}</span>
        <TypeBadge node={node} />
        {required ? (
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-danger">
            required
          </span>
        ) : (
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-text-faint">
            optional
          </span>
        )}
        <Constraints node={node} />
      </div>
      {open && expandable ? (
        <div className="ml-3 border-l border-border-subtle pl-2">
          <Children node={node} depth={depth + 1} openDepth={openDepth} />
        </div>
      ) : null}
    </li>
  );
}

/** The rows under an object (its properties) or an array (its item shape). */
function Children({
  node,
  depth,
  openDepth,
}: {
  node: JsonSchemaNode;
  depth: number;
  openDepth: number;
}) {
  if (node.properties) {
    const required = new Set(node.required ?? []);
    const names = Object.keys(node.properties);
    if (names.length === 0) {
      return <p className="text-[11px] text-text-dim">No fields described.</p>;
    }
    return (
      <ul className="flex flex-col">
        {names.map((name) => (
          <Row
            key={name}
            name={name}
            node={node.properties![name]}
            required={required.has(name)}
            depth={depth}
            openDepth={openDepth}
          />
        ))}
      </ul>
    );
  }
  if (node.items) {
    const item = node.items;
    // An array of objects reads better as "each item" + the object's own fields
    // than as a row called "items".
    return (
      <div className="flex flex-col gap-1">
        <div className="flex min-h-6 items-center gap-2">
          <span aria-hidden className="w-4 shrink-0" />
          <span className="shrink-0 text-xs italic text-text-muted">each item</span>
          <TypeBadge node={item} />
          <Constraints node={item} />
        </div>
        {hasChildren(item) ? (
          <div className="ml-3 border-l border-border-subtle pl-2">
            <Children node={item} depth={depth + 1} openDepth={openDepth} />
          </div>
        ) : null}
      </div>
    );
  }
  return null;
}

export interface SchemaViewProps {
  /** A parsed JSON Schema. Anything that is not an object renders as unreadable. */
  schema: unknown;
  /** Accessible name for the region. */
  label?: string;
  /** Nesting levels expanded on first render. */
  openDepth?: number;
  className?: string;
}

/**
 * A JSON Schema rendered as the fields it actually describes — name, type,
 * required, and any constraint — instead of raw JSON.
 *
 * Every schema surface in the product used to show `{"type":"object","required":
 * [...],"additionalProperties":false}` verbatim, which asks the reader to parse
 * JSON Schema keywords in their head. That is fine for the developer who wrote
 * it and a wall of punctuation for the business analyst or contract author who
 * has to confirm it is right — the people this view is for.
 *
 * Read-only by design: editing stays with the JSON editor, so there is exactly
 * one way to change a schema and one way to read it.
 */
export function SchemaView({
  schema,
  label = 'Schema',
  openDepth = 1,
  className,
}: SchemaViewProps) {
  const node = asNode(schema);
  if (!node) {
    return (
      <p className="text-[11px] text-text-dim">
        This schema is not an object, so there are no fields to show.
      </p>
    );
  }

  const { type } = describeType(node);
  if (!hasChildren(node)) {
    // A bare primitive, an enum, or the unresolved `{}` — one line says it all.
    return (
      <div
        role="group"
        aria-label={label}
        className={cn('flex min-h-6 items-center gap-2', className)}
      >
        <span className="shrink-0 text-xs text-text-muted">
          {type === 'any' ? 'Any shape — this validates nothing yet' : 'Value'}
        </span>
        <TypeBadge node={node} />
        <Constraints node={node} />
      </div>
    );
  }

  return (
    <div role="group" aria-label={label} className={cn('flex flex-col gap-0.5', className)}>
      <Children node={node} depth={0} openDepth={openDepth} />
      {node.additionalProperties === false ? (
        <p className="mt-1 text-[11px] text-text-dim">Extra fields are not allowed.</p>
      ) : null}
    </div>
  );
}
