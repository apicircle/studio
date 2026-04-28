import type { SecretEntry, WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';

// Build a map of secret-id → SecretUsage[] by scanning every place a
// `{{LABEL}}` placeholder can appear:
//   - request URL, headers (key + value), query (key + value), body content
//     (for text-shaped bodies), form-data text rows, contextVars
//   - environment variable values (so envs that wrap a vault secret get
//     credit for the consumption)
//   - linked-workspace requiredSecretKeyIds (secrets demanded by a link)
//
// The aggregator runs O(secrets × references). It's debounced upstream by
// the workspace store; this module is pure.

type Usage = SecretEntry['usedIn'][number];

const PLACEHOLDER = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;

export function aggregateUsedIn(
  synced: WorkspaceSynced,
  local: WorkspaceLocal,
): Record<string, SecretEntry['usedIn']> {
  const labelToId = new Map<string, string>();
  for (const entry of Object.values(local.secretIndex.entries)) {
    labelToId.set(entry.label, entry.id);
  }
  if (labelToId.size === 0) return {};

  const result: Record<string, Usage[]> = {};
  const push = (id: string, usage: Usage) => {
    if (!result[id]) result[id] = [];
    if (
      result[id].some((u) => u.kind === usage.kind && u.id === usage.id && u.label === usage.label)
    ) {
      return;
    }
    result[id].push(usage);
  };

  const scan = (text: string, usage: Usage) => {
    if (!text) return;
    PLACEHOLDER.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PLACEHOLDER.exec(text)) !== null) {
      const id = labelToId.get(match[1]);
      if (id) push(id, usage);
    }
  };

  // Requests
  for (const req of Object.values(synced.collections.requests)) {
    const usage: Usage = { kind: 'request', id: req.id, label: req.name || '(unnamed request)' };
    scan(req.url, usage);
    for (const h of req.headers) {
      scan(h.key, usage);
      scan(h.value, usage);
    }
    for (const q of req.query) {
      scan(q.key, usage);
      scan(q.value, usage);
    }
    for (const cv of req.contextVars) {
      scan(cv.key, usage);
      scan(cv.value, usage);
    }
    if (
      req.body.type === 'json' ||
      req.body.type === 'text' ||
      req.body.type === 'xml' ||
      req.body.type === 'graphql' ||
      req.body.type === 'urlencoded'
    ) {
      scan(req.body.content, usage);
    }
    if (req.body.type === 'form-data' && req.body.formRows) {
      for (const row of req.body.formRows) {
        scan(row.key, usage);
        if (row.kind === 'text') scan(row.value, usage);
      }
    }
  }

  // Environment variables
  for (const env of Object.values(synced.environments.items)) {
    for (const v of env.variables) {
      // Encrypted values are ciphertext, so {{X}} matches inside them are
      // false positives — skip the value field for encrypted vars.
      const usage: Usage = {
        kind: 'environment-var',
        id: `${env.name}.${v.key}`,
        label: `${env.name} → ${v.key || '(unnamed)'}`,
      };
      scan(v.key, usage);
      if (!v.encrypted) scan(v.value, usage);
    }
  }

  // Linked workspaces — when a link declares it requires a secret label,
  // that's a direct usage even before any placeholder references it.
  for (const link of Object.values(synced.linkedWorkspaces)) {
    for (const required of link.requiredSecretKeyIds) {
      const id = labelToId.get(required);
      if (id) {
        push(id, {
          kind: 'linked-workspace-input',
          id: link.id,
          label: link.name,
        });
      }
    }
  }

  return result;
}

/**
 * Convenience: walk the workspace and return the SAME local doc with every
 * SecretEntry's `usedIn` refreshed. Returns the original reference when
 * nothing changed so callers can short-circuit persists.
 */
export function recomputeUsedIn(synced: WorkspaceSynced, local: WorkspaceLocal): WorkspaceLocal {
  const map = aggregateUsedIn(synced, local);
  // Build a complete map covering every known entry, including ones with
  // zero references (so stale usedIn[] arrays get reset to []).
  const full: Record<string, SecretEntry['usedIn']> = {};
  for (const id of Object.keys(local.secretIndex.entries)) {
    full[id] = map[id] ?? [];
  }
  // Apply via the secretActions reducer behavior inline so this module
  // doesn't import from a sibling — keep deps acyclic.
  let changed = false;
  const entries = { ...local.secretIndex.entries };
  for (const [id, usedIn] of Object.entries(full)) {
    const existing = entries[id];
    if (!existing) continue;
    if (sameUsage(existing.usedIn, usedIn)) continue;
    entries[id] = { ...existing, usedIn };
    changed = true;
  }
  if (!changed) return local;
  return { ...local, secretIndex: { ...local.secretIndex, entries } };
}

function sameUsage(a: SecretEntry['usedIn'], b: SecretEntry['usedIn']): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.kind !== y.kind || x.id !== y.id || x.label !== y.label) return false;
  }
  return true;
}
