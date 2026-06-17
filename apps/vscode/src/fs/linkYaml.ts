import * as YAML from 'yaml';
import type { LinkedWorkspace, ReleaseHistory } from '@apicircle/shared';
import { unknownTopLevelKeys, isPresentNonArray, isPresentNonMapping } from './yamlStructure';

// =============================================================================
// Linked-workspace YAML projection.
//
// Round-trips the EDITABLE half of a LinkedWorkspace (synced.linkedWorkspaces)
// to/from the human-friendly YAML the user edits. Identity / source fields are
// read-only — they're emitted for context but the parser preserves the existing
// record's values, so editing them is a no-op (the source repo is fixed at link
// time; re-link to change it).
//
// Editable:   name · description · pinnedVersion · scope · sessionMode ·
//             requiredSecretKeyIds · marketplace
// Read-only:  id · source.repoFullName · source.branch · source.provider ·
//             kind · linkedAt · updatePolicy
//
// `pinnedVersion` validation against the cached ledger happens in the FS
// provider's writeFile (it has the workspace state); this parser only enforces
// shape.
// =============================================================================

const KNOWN_LINK_KEYS = [
  'name',
  'description',
  'repoFullName',
  'branch',
  'kind',
  'linkedAt',
  'pinnedVersion',
  'scope',
  'sessionMode',
  'requiredSecretKeyIds',
  'marketplace',
] as const;

const SCOPE_VALUES = ['collections', 'environments'] as const;
const SESSION_MODES = ['workspace', 'dedicated'] as const;
const MARKETPLACE_KEYS = ['listedAs', 'tags', 'summary'] as const;

export class LinkYamlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkYamlParseError';
  }
}

interface LinkEditablePatch {
  name?: string;
  description?: string;
  pinnedVersion?: string | null;
  scope?: Array<'collections' | 'environments'>;
  sessionMode?: 'workspace' | 'dedicated';
  requiredSecretKeyIds?: string[];
  marketplace?: { listedAs: string; tags: string[]; summary: string } | null;
}

export interface ParsedLinkYaml {
  patch: LinkEditablePatch;
  warnings: string[];
}

const HEADER_COMMENT = `# API Circle — Linked workspace
#
# This workspace consumes the source repo below, one level deep. Edit the
# fields and save to update the link. The ◆ CodeLens pickers above each field
# are the quickest way to change pinned version / scope / session mode.
#
# Read-only (preserved on save — re-link to change the source repo):
#   repoFullName · branch · kind · linkedAt
#
# pinnedVersion: a published version from the source's cached release ledger,
# or null to track the source branch HEAD. Refresh the link to pull newer
# versions into the ledger.
`;

export function serializeLinkToYaml(link: LinkedWorkspace, ledger?: ReleaseHistory | null): string {
  const out: Record<string, unknown> = {
    name: link.name,
  };
  if (link.description) out.description = link.description;
  // Read-only context block — flat keys the parser ignores on save.
  out.repoFullName = link.source.repoFullName;
  out.branch = link.source.branch;
  out.kind = link.kind;
  out.linkedAt = link.linkedAt;
  // Editable.
  out.pinnedVersion = link.pinnedVersion;
  out.scope = [...link.scope];
  out.sessionMode = link.source.sessionMode;
  out.requiredSecretKeyIds = [...link.requiredSecretKeyIds];
  if (link.marketplace) {
    out.marketplace = {
      listedAs: link.marketplace.listedAs,
      tags: [...link.marketplace.tags],
      summary: link.marketplace.summary,
    };
  }

  const doc = new YAML.Document(out);
  let header = HEADER_COMMENT.replace(/^# ?/gm, ' ').replace(/^\s$/gm, '').trimEnd();
  if (ledger && ledger.versions.length > 0) {
    const versions = ledger.versions.map((v) => v.version).join(', ');
    header += `\n\n Cached ledger (current: ${ledger.currentVersion ?? 'none'}): ${versions}`;
  }
  doc.commentBefore = header;
  return doc.toString({ lineWidth: 0 });
}

export function parseLinkFromYaml(text: string): ParsedLinkYaml {
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch (e) {
    throw new LinkYamlParseError(`Invalid YAML: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new LinkYamlParseError('Document root must be a mapping.');
  }
  const obj = parsed as Record<string, unknown>;
  const warnings: string[] = [];

  const unknown = unknownTopLevelKeys(obj, KNOWN_LINK_KEYS);
  if (unknown.length > 0) {
    throw new LinkYamlParseError(`Unknown field(s): ${unknown.join(', ')}. Rename or remove them.`);
  }

  const patch: LinkEditablePatch = {};

  if (obj.name !== undefined) {
    if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
      throw new LinkYamlParseError('`name` must be a non-empty string.');
    }
    patch.name = obj.name.trim();
  }
  if (obj.description !== undefined && obj.description !== null) {
    if (typeof obj.description !== 'string') {
      throw new LinkYamlParseError('`description` must be a string.');
    }
    patch.description = obj.description;
  }
  if (obj.pinnedVersion !== undefined) {
    if (obj.pinnedVersion === null) {
      patch.pinnedVersion = null;
    } else if (typeof obj.pinnedVersion === 'string' || typeof obj.pinnedVersion === 'number') {
      patch.pinnedVersion = String(obj.pinnedVersion);
    } else {
      throw new LinkYamlParseError('`pinnedVersion` must be a version string or null.');
    }
  }
  if (obj.scope !== undefined) {
    if (isPresentNonArray(obj.scope)) {
      throw new LinkYamlParseError('`scope` must be a list.');
    }
    const scope = obj.scope as unknown[];
    for (const s of scope) {
      if (typeof s !== 'string' || !SCOPE_VALUES.includes(s as (typeof SCOPE_VALUES)[number])) {
        throw new LinkYamlParseError(
          `\`scope\` entries must be one of: ${SCOPE_VALUES.join(', ')}.`,
        );
      }
    }
    // Dedupe, preserve declared order.
    patch.scope = Array.from(new Set(scope as Array<'collections' | 'environments'>));
  }
  if (obj.sessionMode !== undefined) {
    if (
      typeof obj.sessionMode !== 'string' ||
      !SESSION_MODES.includes(obj.sessionMode as (typeof SESSION_MODES)[number])
    ) {
      throw new LinkYamlParseError(`\`sessionMode\` must be one of: ${SESSION_MODES.join(', ')}.`);
    }
    patch.sessionMode = obj.sessionMode as 'workspace' | 'dedicated';
  }
  if (obj.requiredSecretKeyIds !== undefined) {
    if (isPresentNonArray(obj.requiredSecretKeyIds)) {
      throw new LinkYamlParseError('`requiredSecretKeyIds` must be a list.');
    }
    const ids = obj.requiredSecretKeyIds as unknown[];
    for (const k of ids) {
      if (typeof k !== 'string') {
        throw new LinkYamlParseError('`requiredSecretKeyIds` entries must be strings.');
      }
    }
    patch.requiredSecretKeyIds = Array.from(new Set(ids as string[]));
  }
  if (obj.marketplace !== undefined) {
    if (obj.marketplace === null) {
      patch.marketplace = null;
    } else {
      if (isPresentNonMapping(obj.marketplace)) {
        throw new LinkYamlParseError('`marketplace` must be a mapping or null.');
      }
      const m = obj.marketplace as Record<string, unknown>;
      const mUnknown = unknownTopLevelKeys(m, MARKETPLACE_KEYS);
      if (mUnknown.length > 0) {
        throw new LinkYamlParseError(`Unknown marketplace field(s): ${mUnknown.join(', ')}.`);
      }
      const listedAs = typeof m.listedAs === 'string' ? m.listedAs : '';
      const summary = typeof m.summary === 'string' ? m.summary : '';
      let tags: string[] = [];
      if (m.tags !== undefined) {
        if (isPresentNonArray(m.tags)) {
          throw new LinkYamlParseError('`marketplace.tags` must be a list.');
        }
        tags = (m.tags as unknown[]).filter((t): t is string => typeof t === 'string');
      }
      patch.marketplace = { listedAs, tags, summary };
    }
  }

  return { patch, warnings };
}
