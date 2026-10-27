// Bundle a spec that is split across files into ONE self-contained document.
//
// A split spec points at other documents with external `$ref`s
// (`./schemas/user.yaml#/User`, a path item that is `$ref: './paths/pets.yaml'`).
// Spec parsing never reads files or opens connections (see `openapiNode.ts`), so
// those documents reach us the only safe way: as text someone supplied — files
// uploaded beside a spec asset, or files the Lens CLI read from inside the
// repository. This module puts them together:
//   • every supplied document is embedded VERBATIM under the root's
//     `x-apicircle-documents/<target>` extension key;
//   • every `$ref` that points into one is rewritten as an in-document pointer
//     (`schemas/user.yaml#/User` → `#/x-apicircle-documents/schemas~1user.yaml/User`).
//     A ref inside a supplied document resolves against THAT document's folder,
//     and a ref back to the root spec becomes `#/…`;
//   • nothing else changes. The in-document resolvers (`dereferenceInternal`,
//     swagger-parser) then resolve the whole thing — a cycle across files is an
//     ordinary in-document cycle by then — so every parser downstream reads a
//     split spec exactly as it reads a single file.
// It also reports every other document the spec reaches (through the supplied
// ones too), each supplied or not: that list is what the upload flow shows.
//
// A `$ref` in a LITERAL position (`example`, `default`, `enum`, `const`, an
// Example Object's `value`, a JSON Schema `examples` array) is data, not a
// reference: it is neither followed, rewritten nor reported.

import yaml from 'js-yaml';

/** The root extension key the supplied documents are embedded under. */
export const BUNDLED_DOCUMENTS_KEY = 'x-apicircle-documents';

/** Another document the spec's `$ref`s reach. */
export interface SpecReference {
  /** A POSIX path relative to the root spec's folder (`schemas/user.yaml`,
   *  `../common/errors.json`), or an absolute URL — which is never fetched. */
  target: string;
  /** Whether it was supplied and read as JSON or YAML. */
  supplied: boolean;
}

export interface BundleSpecResult {
  /** The spec with every supplied document embedded and every `$ref` into one
   *  rewritten. The input text itself, byte for byte, when nothing changed and
   *  no other output format was asked for. */
  text: string;
  format: 'json' | 'yaml';
  /** Every other document reachable from the root, in the order first met. */
  references: SpecReference[];
  warnings: string[];
}

export interface BundleSpecOptions {
  /** The format to write. Defaults to JSON when anything was rewritten (the
   *  parsers' input), else the input's own format. */
  output?: 'json' | 'yaml';
}

/** Keys whose value is data in OpenAPI / JSON Schema, never a reference. */
const LITERAL_KEYS: ReadonlySet<string> = new Set(['example', 'default', 'enum', 'const']);

/** Keys whose value (an object) is a map from user-chosen NAMES to nodes, so its
 *  own keys are names — a property called `example` is still a schema. */
const NAME_MAP_KEYS: ReadonlySet<string> = new Set([
  'properties',
  'patternProperties',
  'definitions',
  '$defs',
  'schemas',
  'parameters',
  'responses',
  'headers',
  'requestBodies',
  'securitySchemes',
  'links',
  'callbacks',
  'paths',
  'webhooks',
  'pathItems',
  'content',
  'encoding',
  'variables',
]);

/** `scheme:` — an absolute URL (or a drive-letter path, which is never read either). */
const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;

type Kind = 'node' | 'names' | 'examples' | 'example';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tryParse(text: string, format: 'json' | 'yaml'): unknown {
  try {
    return format === 'yaml' ? yaml.load(text) : JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Parse spec text as JSON or YAML: the format the filename's extension names
 * first, else the one the content looks like, then the other one. `null` when
 * neither reads it.
 */
export function parseSpecText(
  text: string,
  filename?: string,
): { doc: unknown; format: 'json' | 'yaml' } | null {
  const lower = filename?.toLowerCase() ?? '';
  const primary: 'json' | 'yaml' = lower.endsWith('.json')
    ? 'json'
    : lower.endsWith('.yaml') || lower.endsWith('.yml')
      ? 'yaml'
      : text.trimStart().startsWith('{')
        ? 'json'
        : 'yaml';
  const secondary = primary === 'json' ? 'yaml' : 'json';
  const first = tryParse(text, primary);
  if (first !== undefined) return { doc: first, format: primary };
  const second = tryParse(text, secondary);
  return second === undefined ? null : { doc: second, format: secondary };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value; // a stray `%` stays literal
  }
}

/** Collapse `.` and `..` in a POSIX path. A `..` above a relative root is kept
 *  (`../common/errors.json` is a real target); above an absolute one it is dropped. */
function normalizePath(path: string): string {
  const absolute = path.startsWith('/');
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!absolute) out.push('..');
      continue;
    }
    out.push(segment);
  }
  return (absolute ? '/' : '') + out.join('/');
}

function folderOf(target: string): string {
  const slash = target.lastIndexOf('/');
  return slash < 0 ? '' : target.slice(0, slash);
}

/** Where a `$ref`'s document part points, seen from the document `from`. */
function resolveTarget(uri: string, from: string): string {
  if (URL_SCHEME.test(uri)) return uri;
  if (URL_SCHEME.test(from)) {
    try {
      return new URL(uri, from).href;
    } catch {
      return uri;
    }
  }
  const path = safeDecode(uri).replace(/\\/g, '/');
  if (path.startsWith('/')) return normalizePath(path);
  const folder = folderOf(from);
  return normalizePath(folder === '' ? path : `${folder}/${path}`);
}

/** One JSON Pointer segment for an embedded document's key: `~` and `/` escaped
 *  (RFC 6901), then percent-encoded so the pointer is a valid URI fragment. */
function pointerSegment(key: string): string {
  return encodeURIComponent(key.replace(/~/g, '~0').replace(/\//g, '~1'));
}

function embeddedPointer(target: string, fragment: string): string {
  return `#/${BUNDLED_DOCUMENTS_KEY}/${pointerSegment(target)}${fragment}`;
}

/**
 * Bundle `root` and the `documents` it reaches into one self-contained spec.
 * `documents` maps a target (as {@link SpecReference.target} names it) to that
 * document's text; a target it lacks stays an external `$ref` and is reported
 * unsupplied. Pure: parses fresh copies, reads nothing, fetches nothing.
 */
export function bundleSpec(
  root: { text: string; filename: string },
  documents: ReadonlyMap<string, string>,
  opts: BundleSpecOptions = {},
): BundleSpecResult {
  const warnings: string[] = [];
  const parsedRoot = parseSpecText(root.text, root.filename);
  if (!parsedRoot || !isRecord(parsedRoot.doc)) {
    return { text: root.text, format: parsedRoot?.format ?? 'json', references: [], warnings };
  }
  const rootDoc = parsedRoot.doc;
  const rootPath = normalizePath(root.filename.replace(/\\/g, '/'));
  const rootKey = rootPath.slice(rootPath.lastIndexOf('/') + 1); // targets are relative to its folder

  const references = new Map<string, boolean>();
  const loaded = new Map<string, unknown>();
  const queue: Array<{ key: string; doc: unknown }> = [{ key: rootKey, doc: rootDoc }];
  const warnedFragments = new Set<string>();
  let changed = false;

  /** The supplied document for `target`, parsed once; `undefined` when it was
   *  not supplied or reads as neither JSON nor YAML. */
  const load = (target: string): unknown => {
    if (loaded.has(target)) return loaded.get(target);
    const text = documents.get(target);
    let doc: unknown;
    if (text !== undefined) {
      const parsed = parseSpecText(text, target);
      if (parsed && parsed.doc !== null && typeof parsed.doc === 'object') {
        doc = parsed.doc;
        queue.push({ key: target, doc });
      } else {
        warnings.push(`Referenced file "${target}" could not be read as JSON or YAML.`);
      }
    }
    loaded.set(target, doc);
    references.set(target, doc !== undefined);
    return doc;
  };

  const rewrite = (holder: Record<string, unknown>, ref: string, docKey: string): void => {
    const hash = ref.indexOf('#');
    const uri = hash < 0 ? ref : ref.slice(0, hash);
    const fragment = hash < 0 ? '' : ref.slice(hash + 1);
    if (fragment !== '' && !fragment.startsWith('/')) {
      // A plain-name fragment (`#Pet`) is a JSON Schema anchor, not a pointer.
      if (!warnedFragments.has(ref)) {
        warnedFragments.add(ref);
        warnings.push(`$ref "${ref}" uses a plain-name fragment, which is not resolved.`);
      }
      return;
    }
    let next: string;
    if (uri === '') {
      if (docKey === rootKey) return; // the root's own in-document ref
      next = embeddedPointer(docKey, fragment);
    } else {
      const target = resolveTarget(uri, docKey === rootKey ? '' : docKey);
      if (target === rootKey) next = `#${fragment}`;
      else if (load(target) !== undefined) next = embeddedPointer(target, fragment);
      else return; // not supplied: left as written, and reported
    }
    if (next !== ref) {
      holder.$ref = next;
      changed = true;
    }
  };

  for (let i = 0; i < queue.length; i += 1) {
    const { key: docKey, doc } = queue[i];
    const seen = new Set<object>();
    // A pre-order walk (children pushed in reverse), so references are met in
    // document order — the order the upload flow lists them in.
    const stack: Array<{ node: unknown; kind: Kind }> = [{ node: doc, kind: 'node' }];
    while (stack.length > 0) {
      const { node, kind } = stack.pop()!;
      if (node === null || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      const children: Array<{ node: unknown; kind: Kind }> = [];
      if (Array.isArray(node)) {
        for (const item of node) children.push({ node: item, kind: 'node' });
      } else if (kind === 'names' || kind === 'examples') {
        for (const value of Object.values(node)) {
          children.push({ node: value, kind: kind === 'examples' ? 'example' : 'node' });
        }
      } else {
        const obj = node as Record<string, unknown>;
        if (typeof obj.$ref === 'string') rewrite(obj, obj.$ref, docKey);
        for (const [key, value] of Object.entries(obj)) {
          if (key === '$ref' || LITERAL_KEYS.has(key)) continue;
          if (kind === 'example' && (key === 'value' || key === 'externalValue')) continue;
          if (key === 'examples') {
            // A JSON Schema `examples` array is literal; an OpenAPI `examples` map holds Example Objects.
            if (isRecord(value)) children.push({ node: value, kind: 'examples' });
            continue;
          }
          children.push({
            node: value,
            kind: NAME_MAP_KEYS.has(key) && isRecord(value) ? 'names' : 'node',
          });
        }
      }
      for (let c = children.length - 1; c >= 0; c -= 1) stack.push(children[c]);
    }
  }

  const embedded: Record<string, unknown> = {};
  for (const [target, doc] of loaded) if (doc !== undefined) embedded[target] = doc;
  if (Object.keys(embedded).length > 0) {
    const existing = rootDoc[BUNDLED_DOCUMENTS_KEY];
    rootDoc[BUNDLED_DOCUMENTS_KEY] = { ...(isRecord(existing) ? existing : {}), ...embedded };
    changed = true;
  }

  const referenceList = [...references].map(([target, supplied]) => ({ target, supplied }));
  const format = opts.output ?? (changed ? 'json' : parsedRoot.format);
  if (!changed && format === parsedRoot.format) {
    return { text: root.text, format, references: referenceList, warnings };
  }
  try {
    const text =
      format === 'yaml'
        ? yaml.dump(rootDoc, { noRefs: true, lineWidth: -1 })
        : JSON.stringify(rootDoc, null, 2);
    return { text, format, references: referenceList, warnings };
  } catch (err) {
    warnings.push(
      `The bundled spec could not be written as ${format.toUpperCase()} ` +
        `(${String(err)}); the spec is read as uploaded.`,
    );
    return { text: root.text, format: parsedRoot.format, references: referenceList, warnings };
  }
}
