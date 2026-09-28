// Find values that LOOK like secrets in a workspace about to be pushed to Git.
//
// `redactForGit` blanks every credential FIELD it knows about — each auth
// variant's passwords, tokens and keys, a custom auth header's value, a
// `user:pass@` in a URL. What it cannot know about is free text: a request
// header named `Authorization` holding a literal bearer token, `?api_key=…` in a
// query row, a session cookie pasted from a browser, an environment variable
// typed in plain instead of bound to the Secret Vault. Those reach
// `workspace.json` verbatim, and on a public repository anyone can read them.
//
// `scanWorkspaceForSecrets(synced)` is the lint for that free text. The push
// path runs it on the document it is about to write and stops to ask when it
// finds anything. A finding says WHERE and WHY — never the value itself. It is a
// heuristic on purpose: a false positive costs one confirmation, a false
// negative leaks a credential. The rules live in `secretShapes.ts`.
//
// Where it looks:
//   • requests and linked-request overrides — headers, query rows, cookies,
//     context variables, the URL (its `user:pass@`, its query string, a known
//     token format anywhere in it) and a custom-header auth value;
//   • folders — a custom-header auth value;
//   • plaintext (not encrypted) environment variables, linked-environment
//     overrides and plan variables.
// Request bodies are not scanned, and the credential fields `redactForGit`
// blanks structurally are not reported: the push path scans the redacted
// document, where they are already empty.

import type {
  Request as ApiRequest,
  RequestAuth,
  RequestOverridePatch,
  WorkspaceSynced,
} from '@apicircle/shared';
import {
  carriesLiteral,
  secretFormatReason,
  secretRowReason,
  secretValueReason,
  urlQueryPairs,
  urlUserinfo,
  userinfoReason,
} from './secretShapes';

/** One place in a workspace holding something that looks like a secret. */
export interface SecretFinding {
  /** Identifies the place, not the value: two scans of an unchanged
   *  workspace yield the same ids, which is what acknowledging relies on. */
  id: string;
  /** Where it is, for people — `Request "Login" in Auth › Header "Authorization"`.
   *  Never contains the value. */
  location: string;
  /** Why it was flagged — `looks like a GitHub token`, `named like a
   *  credential`. Never contains the value. */
  reason: string;
}

type Row = { key: string; value: string };

/** Names in labels are the user's own, but keep a pathological one readable. */
function quoted(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '(unnamed)';
  return `"${trimmed.length > 80 ? `${trimmed.slice(0, 79)}…` : trimmed}"`;
}

function folderPath(synced: WorkspaceSynced, folderId: string | null): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let id = folderId;
  while (id !== null && !seen.has(id)) {
    seen.add(id);
    const folder = synced.collections?.folders?.[id];
    if (!folder) break;
    names.unshift(folder.name.trim() || '(unnamed)');
    id = folder.parentId;
  }
  return names.join(' / ');
}

class Collector {
  readonly findings: SecretFinding[] = [];

  add(id: string, owner: string, field: string, reason: string | null): void {
    if (reason) this.findings.push({ id, location: `${owner} › ${field}`, reason });
  }

  rows(id: string, owner: string, noun: string, rows: ReadonlyArray<Row> | undefined): void {
    (rows ?? []).forEach((row, index) => {
      this.add(
        `${id}:${noun}:${index}:${row.key}`,
        owner,
        `${noun} ${quoted(row.key)}`,
        secretRowReason(row.key, row.value),
      );
    });
  }

  url(id: string, owner: string, url: string | undefined): void {
    if (!url) return;
    const info = urlUserinfo(url);
    if (info) this.add(`${id}:url-userinfo`, owner, 'URL user info', userinfoReason(info.userinfo));
    urlQueryPairs(url).forEach((pair, index) => {
      this.add(
        `${id}:url-query:${index}:${pair.key}`,
        owner,
        `URL query parameter ${quoted(pair.key)}`,
        secretRowReason(pair.key, pair.value),
      );
    });
    // A known token format in a path segment (`/bot<token>/…`). Only formats:
    // a long random-looking path segment is usually an id, not a secret.
    const bare = url.split('?')[0];
    const withoutUserinfo = info ? bare.slice(0, info.start) + bare.slice(info.end) : bare;
    const inPath = withoutUserinfo
      .split(/[/#]/)
      .map((segment) => secretFormatReason(segment))
      .find((reason) => reason !== null);
    this.add(`${id}:url`, owner, 'URL', inPath ?? null);
  }

  auth(id: string, owner: string, auth: RequestAuth | undefined): void {
    // The one auth variant whose credential is free text under a name the user
    // picks. Whatever the header is called, its value is what authenticates.
    if (auth?.type !== 'custom-header' || !carriesLiteral(auth.value)) return;
    this.add(
      `${id}:auth:${auth.key}`,
      owner,
      `Auth header ${quoted(auth.key)}`,
      secretValueReason(auth.value) ?? "is sent as the request's authentication",
    );
  }

  request(id: string, owner: string, request: Partial<ApiRequest> | RequestOverridePatch): void {
    this.url(id, owner, request.url);
    this.rows(id, owner, 'Header', request.headers);
    this.rows(id, owner, 'Query parameter', request.query);
    this.rows(id, owner, 'Cookie', request.cookies);
    this.rows(id, owner, 'Context variable', request.contextVars);
    this.auth(id, owner, request.auth);
  }
}

/**
 * Every place in `synced` that holds something shaped like a secret, in
 * document order. Pure; safe on partially-shaped workspaces. See the module
 * header for where it looks and what it deliberately leaves out.
 */
export function scanWorkspaceForSecrets(synced: WorkspaceSynced): SecretFinding[] {
  const out = new Collector();

  for (const [id, request] of Object.entries(synced.collections?.requests ?? {})) {
    const path = folderPath(synced, request.folderId ?? null);
    const owner = `Request ${quoted(request.name ?? '')}${path ? ` in ${path}` : ''}`;
    out.request(`request:${id}`, owner, request);
  }

  for (const [id, folder] of Object.entries(synced.collections?.folders ?? {})) {
    out.auth(`folder:${id}`, `Folder ${quoted(folderPath(synced, id))}`, folder.auth);
  }

  for (const [name, env] of Object.entries(synced.environments?.items ?? {})) {
    (env.variables ?? []).forEach((variable, index) => {
      if (variable.encrypted) return;
      out.add(
        `environment:${name}:variable:${index}:${variable.key}`,
        `Environment ${quoted(name)}`,
        `Variable ${quoted(variable.key)}`,
        secretRowReason(variable.key, variable.value),
      );
    });
  }

  const linkedName = (linkedWorkspaceId: string): string =>
    quoted(synced.linkedWorkspaces?.[linkedWorkspaceId]?.name ?? linkedWorkspaceId);

  for (const [key, override] of Object.entries(synced.linkedOverrides?.environmentVars ?? {})) {
    if (override.encrypted || override.removed || typeof override.value !== 'string') continue;
    out.add(
      `linked-environment:${key}`,
      `Linked environment ${quoted(override.envName)} from ${linkedName(override.linkedWorkspaceId)}`,
      `Variable ${quoted(override.varKey)}`,
      secretRowReason(override.varKey, override.value),
    );
  }

  for (const [key, override] of Object.entries(synced.linkedOverrides?.requests ?? {})) {
    const patch = override.patch ?? {};
    const owner =
      `Linked request ${quoted(patch.name ?? override.itemId)} ` +
      `from ${linkedName(override.linkedWorkspaceId)}`;
    out.request(`linked-request:${key}`, owner, patch);
  }

  for (const [id, plan] of Object.entries(synced.executionPlans ?? {})) {
    (plan.variables ?? []).forEach((variable, index) => {
      out.add(
        `plan:${id}:variable:${index}:${variable.key}`,
        `Plan ${quoted(plan.name)}`,
        `Variable ${quoted(variable.key)}`,
        secretRowReason(variable.key, variable.value),
      );
    });
  }

  return out.findings;
}

/** The findings in `found` whose place is not among `acknowledged`. */
export function unacknowledgedSecretFindings(
  found: readonly SecretFinding[],
  acknowledged: readonly SecretFinding[],
): SecretFinding[] {
  const ids = new Set(acknowledged.map((finding) => finding.id));
  return found.filter((finding) => !ids.has(finding.id));
}

/**
 * Thrown by a push that found values shaped like secrets the caller has not
 * acknowledged. Nothing has been written when it is thrown. It carries where
 * they are, never what they are; pushing again with these findings
 * acknowledged goes ahead.
 */
export class SecretsInPushError extends Error {
  readonly findings: readonly SecretFinding[];

  constructor(findings: readonly SecretFinding[]) {
    const many = findings.length !== 1;
    super(
      `Push stopped before writing anything: ${findings.length} value${many ? 's' : ''} in this ` +
        `workspace look${many ? '' : 's'} like ${many ? 'secrets' : 'a secret'} and would be ` +
        `written to Git as plain text — ` +
        findings.map((finding) => `${finding.location} (${finding.reason})`).join('; ') +
        '.',
    );
    this.name = 'SecretsInPushError';
    this.findings = findings;
  }
}
