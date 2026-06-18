import * as YAML from 'yaml';
import type { Folder, RequestAuth } from '@apicircle/shared';
import { unknownTopLevelKeys, isPresentNonMapping } from './yamlStructure';

// =============================================================================
// Folder YAML projection.
//
// Renders a Folder as a small, focused YAML document so the user can edit the
// two fields that actually matter for collaboration:
//
//   - `name`  — the folder name (must be unique among siblings under the same
//                parent — colliding renames are rejected by the reducer)
//   - `auth`  — optional folder-level RequestAuth that any descendant request
//                with `auth: { type: inherit }` will pick up via
//                `resolveInheritedAuth`. Omit (or set explicitly to
//                `{ type: none }`) to clear it.
//
// `id`, `parentId`, and the children list are intentionally NOT in the
// projection — identity rides in the `?id=` URI query, and structural moves
// happen through the TreeView (or via `folder.move` programmatically).
// =============================================================================

const KNOWN_FOLDER_KEYS = ['name', 'auth'] as const;

const HEADER_COMMENT = `# API Circle Folder — edit fields below and save (Ctrl+S) to commit.
#
# name: must be unique among siblings under the same parent. Colliding
#   renames are rejected on save.
# auth: optional folder-level auth. Descendant requests with auth.type:
#   inherit resolve to the first ancestor folder that sets an explicit
#   auth (anything other than 'none' or 'inherit'). Omit this section to
#   leave folder-level auth unset; the inherit walk then continues up the
#   chain.
#
# Identity (id / parentId) is intentionally not in this projection —
# folder moves use the TreeView drag-drop, not YAML edits.
`;

interface FolderYamlOutput {
  name: string;
  auth?: RequestAuth;
}

export function serializeFolderToYaml(folder: Folder): string {
  const out: FolderYamlOutput = { name: folder.name };
  if (folder.auth !== undefined) out.auth = folder.auth;
  const doc = new YAML.Document(out);
  doc.commentBefore = HEADER_COMMENT.replace(/^# /gm, ' ').trimEnd();
  return doc.toString({ lineWidth: 0 });
}

export interface ParsedFolderYaml {
  /**
   * Patch shape compatible with the `folder.update` WorkspacePatch. Key
   * presence matters: `auth: undefined` (i.e. the YAML omitted the section)
   * is conveyed as `auth: undefined` so the reducer clears the field, while
   * leaving `name` alone if it wasn't touched would mean omitting it from
   * the patch entirely. The parser always populates `name` (the field is
   * required), and always populates `auth` (omitted YAML = `undefined` =
   * clear).
   */
  patch: { name: string; auth: RequestAuth | undefined };
  warnings: string[];
}

export function parseFolderFromYaml(text: string): ParsedFolderYaml {
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch (e) {
    throw new FolderYamlParseError(`Invalid YAML: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new FolderYamlParseError('Document root must be a mapping with at least `name:`.');
  }

  const obj = parsed as Record<string, unknown>;
  const warnings: string[] = [];

  const unknown = unknownTopLevelKeys(obj, KNOWN_FOLDER_KEYS);
  if (unknown.length > 0) {
    throw new FolderYamlParseError(
      `Unknown field(s): ${unknown.join(', ')}. Editable folder fields are: ${KNOWN_FOLDER_KEYS.join(', ')}.`,
    );
  }

  if (typeof obj.name !== 'string') {
    throw new FolderYamlParseError('Field "name" must be a string.');
  }
  const name = obj.name.trim();
  if (!name) {
    throw new FolderYamlParseError('Field "name" must not be empty.');
  }

  if (isPresentNonMapping(obj.auth)) {
    throw new FolderYamlParseError('`auth` must be a mapping.');
  }
  let auth: RequestAuth | undefined;
  if (obj.auth !== undefined && obj.auth !== null) {
    const a = obj.auth as Record<string, unknown>;
    if (typeof a.type !== 'string') {
      throw new FolderYamlParseError('`auth.type` must be a string.');
    }
    auth = obj.auth as RequestAuth;
  }

  return { patch: { name, auth }, warnings };
}

export class FolderYamlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FolderYamlParseError';
  }
}
