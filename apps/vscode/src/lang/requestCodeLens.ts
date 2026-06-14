import * as vscode from 'vscode';
import type { Folder } from '@apicircle/shared';
import { resolveInheritedAuth } from '@apicircle/core';
import type { InFlightSendTracker } from '../execute/inFlightTracker';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { ApicircleFsProvider } from '../fs/apicircleFsProvider';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// CodeLens provider for apicircle:// request YAML documents.
//
// Emits the following rows when the relevant anchor lines are present:
//
//   Above `name:`        ▶ Send · ✚ Add section… · ⤵ New from template…
//                        (or — while a send is in flight —
//                         ⏳ Sending… (<elapsed>) · ✖ Cancel)
//   Above `body:`        Body: <type> · ⇄ Switch type…
//                          + when type is binary: 📎 Pick attachment file…
//                          + when type is form-data: ✚ Add text row / ✚ Add
//                            file row / ⇄ Switch row kind…
//   Above each `- kind:` row inside formRows:
//                          ↻ Switch kind · 📎 Pick file (file rows only)
//   Above `auth:`        Auth: <type> · ⇄ Switch type…
//
// Body-type-specific lenses materialise only when their type is current, so a
// JSON body doesn't show a "Pick attachment file…" lens and a form-data body
// doesn't show one for binary. Per-row lenses inside formRows: pass the row
// index into the relevant command so the user doesn't have to disambiguate
// through a second quick-pick.
//
// When an InFlightSendTracker is supplied, the provider subscribes to its
// onDidChange so the lens row updates the moment a send starts/ends, and runs
// a 500ms tick while any send is active to keep the elapsed-time counter
// fresh without spamming refresh()es when nothing is happening.
// =============================================================================

const NAME_LINE_RE = /^name:\s/;
const BODY_LINE_RE = /^body:\s*$/;
const AUTH_LINE_RE = /^auth:\s*$/;
const HEADERS_LINE_RE = /^headers\s*:/;
const CONTEXT_VARS_LINE_RE = /^contextVars\s*:/;
const QUERY_LINE_RE = /^query\s*:/;
const COOKIES_LINE_RE = /^cookies\s*:/;
const PATH_PARAMS_LINE_RE = /^pathParams\s*:/;
const ASSERTIONS_LINE_RE = /^assertions\s*:/;
const EXTRACTIONS_LINE_RE = /^extractions\s*:/;
const FORM_ROWS_LINE_RE = /^\s+formRows\s*:/;
const FORM_ROW_KIND_LINE_RE = /^\s+-\s+kind:\s*['"]?(text|file)['"]?/;

// Match `^\s+type:\s*<value>` so we can label the lens with the current type
// without parsing the whole YAML document.
const SECTION_TYPE_RE = /^\s+type:\s*['"]?([A-Za-z0-9-]+)['"]?/;

// OAuth2 grants get an extra "Get token" lens above their auth: header.
const OAUTH2_GRANT_TYPES: ReadonlySet<string> = new Set([
  'oauth2-client-credentials',
  'oauth2-auth-code',
  'oauth2-pkce',
  'oauth2-password',
  'oauth2-implicit',
  'oauth2-device',
]);

export class RequestCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private readonly trackerSub: vscode.Disposable | null = null;

  private readonly externalSubs: vscode.Disposable[] = [];

  constructor(
    private readonly tracker?: InFlightSendTracker,
    private readonly bridge?: VsCodeBridge,
    private readonly fsProvider?: { onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> },
  ) {
    if (tracker) {
      this.trackerSub = tracker.onDidChange(() => {
        this.refresh();
        this.updateTick();
      });
    }
    // The inherited-auth lens depends on the folder chain — a folder rename
    // or auth edit in another tab needs to re-fire onDidChangeCodeLenses or
    // the lens will display stale state until the request doc is touched.
    if (bridge) {
      this.externalSubs.push(bridge.onDidChangeActiveWorkspace(() => this.refresh()));
    }
    if (fsProvider) {
      this.externalSubs.push(
        fsProvider.onDidChangeFile((events) => {
          // Only refresh when a folder YAML actually changed — request edits
          // already drive their own per-document refresh via the buffer.
          if (events.some((e) => uriEntityKind(e.uri) === 'folder')) this.refresh();
        }),
      );
    }
  }

  /**
   * Maintain a 500ms refresh loop only while at least one send is in flight.
   * When the registry empties out, clear the interval so we're not waking
   * VS Code up to re-render lenses that haven't changed.
   */
  private updateTick(): void {
    if (!this.tracker) return;
    if (this.tracker.hasAny() && this.tickHandle === null) {
      this.tickHandle = setInterval(() => this.refresh(), 500);
    } else if (!this.tracker.hasAny() && this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  async provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens[]> {
    if (document.uri.scheme !== 'apicircle') return [];
    if (uriEntityKind(document.uri) !== 'request') return [];

    const lenses: vscode.CodeLens[] = [];
    let nameAnchorLine = -1;
    let bodyAnchorLine = -1;
    let authAnchorLine = -1;
    let headersAnchorLine = -1;
    let contextVarsAnchorLine = -1;
    let queryAnchorLine = -1;
    let cookiesAnchorLine = -1;
    let pathParamsAnchorLine = -1;
    let assertionsAnchorLine = -1;
    let extractionsAnchorLine = -1;
    let bodyCurrentType: string | null = null;
    let authCurrentType: string | null = null;

    for (let line = 0; line < document.lineCount; line++) {
      const text = document.lineAt(line).text;
      if (nameAnchorLine === -1 && NAME_LINE_RE.test(text)) {
        nameAnchorLine = line;
      } else if (bodyAnchorLine === -1 && BODY_LINE_RE.test(text)) {
        bodyAnchorLine = line;
        bodyCurrentType = readNestedType(document, line);
      } else if (authAnchorLine === -1 && AUTH_LINE_RE.test(text)) {
        authAnchorLine = line;
        authCurrentType = readNestedType(document, line);
      } else if (headersAnchorLine === -1 && HEADERS_LINE_RE.test(text)) {
        headersAnchorLine = line;
      } else if (contextVarsAnchorLine === -1 && CONTEXT_VARS_LINE_RE.test(text)) {
        contextVarsAnchorLine = line;
      } else if (queryAnchorLine === -1 && QUERY_LINE_RE.test(text)) {
        queryAnchorLine = line;
      } else if (cookiesAnchorLine === -1 && COOKIES_LINE_RE.test(text)) {
        cookiesAnchorLine = line;
      } else if (pathParamsAnchorLine === -1 && PATH_PARAMS_LINE_RE.test(text)) {
        pathParamsAnchorLine = line;
      } else if (assertionsAnchorLine === -1 && ASSERTIONS_LINE_RE.test(text)) {
        assertionsAnchorLine = line;
      } else if (extractionsAnchorLine === -1 && EXTRACTIONS_LINE_RE.test(text)) {
        extractionsAnchorLine = line;
      }
    }

    if (nameAnchorLine !== -1) {
      const text = document.lineAt(nameAnchorLine).text;
      const range = new vscode.Range(nameAnchorLine, 0, nameAnchorLine, text.length);
      const inFlight = this.tracker?.get(document.uri);
      if (inFlight) {
        const elapsedSec = Math.max(0, (Date.now() - inFlight.startedAt) / 1000);
        lenses.push(
          new vscode.CodeLens(range, {
            title: `⏳ Sending… (${formatElapsed(elapsedSec)})`,
            tooltip:
              'A send is in flight for this request. The response tab will open when it completes; click ✖ Cancel to abort.',
            // No command — informational lens. VS Code requires a command, so
            // route to the cancel handler with the URI; clicking the elapsed
            // lens then behaves identically to clicking ✖ Cancel.
            command: 'apicircle.cancelOneSend',
            arguments: [document.uri],
          }),
          new vscode.CodeLens(range, {
            title: '✖ Cancel',
            tooltip: 'Abort the in-flight send for this request.',
            command: 'apicircle.cancelOneSend',
            arguments: [document.uri],
          }),
        );
      } else {
        // The Send lens is the primary CTA for the request editor — wrap it in
        // ▶▶ markers so it visually pops above the lighter "✚ Add section…" /
        // "⤵ New from template…" siblings, and surface the Ctrl/Cmd+Enter
        // shortcut on the lens itself so first-time users learn it.
        lenses.push(
          new vscode.CodeLens(range, {
            title: '▶▶ SEND REQUEST  (Ctrl/Cmd+Enter)',
            tooltip:
              'Send this request and open the response tab. Keyboard shortcut: Ctrl+Enter (Cmd+Enter on macOS).',
            command: 'apicircle.sendRequest',
            arguments: [document.uri],
          }),
          new vscode.CodeLens(range, {
            title: '✚ Add section…',
            tooltip:
              'Insert or jump to a request section (query / path params / headers / cookies / auth / body / context vars / extractions / assertions).',
            command: 'apicircle.addRequestSection',
            arguments: [document.uri],
          }),
          new vscode.CodeLens(range, {
            title: '⤵ New from template…',
            tooltip: 'Create another request scaffolded from a common template.',
            command: 'apicircle.newRequestFromTemplate',
          }),
        );
      }
    }

    if (bodyAnchorLine !== -1) {
      const text = document.lineAt(bodyAnchorLine).text;
      const range = new vscode.Range(bodyAnchorLine, 0, bodyAnchorLine, text.length);
      lenses.push(
        new vscode.CodeLens(range, {
          title: `⇄ Switch body type${bodyCurrentType ? ` (current: ${bodyCurrentType})` : ''}…`,
          tooltip:
            'Switch the body shape — json / text / xml / form-data / urlencoded / binary / graphql / none. Replaces the body: block with a fresh scaffold.',
          command: 'apicircle.switchRequestBodyType',
          arguments: [document.uri],
        }),
      );

      // ⟳ Format JSON on the body's JSON-bearing row — the `content:` of a json
      // body, or the `variables:` of a graphql body (the query itself isn't
      // JSON). Reflows a stringified value into pretty, indented JSON.
      if (bodyCurrentType === 'json' || bodyCurrentType === 'graphql') {
        const jsonRow = bodyCurrentType === 'json' ? /^\s+content\s*:/ : /^\s+variables\s*:/;
        for (let l = bodyAnchorLine + 1; l < document.lineCount; l++) {
          const t = document.lineAt(l).text;
          if (/^[A-Za-z]/.test(t)) break; // next top-level key ends the body
          if (jsonRow.test(t)) {
            lenses.push(
              new vscode.CodeLens(new vscode.Range(l, 0, l, t.length), {
                title: '⟳ Format JSON',
                tooltip:
                  bodyCurrentType === 'json'
                    ? 'Reflow this stringified JSON body into pretty, indented JSON.'
                    : 'Reflow the GraphQL variables into pretty, indented JSON.',
                command: 'apicircle.formatJson',
                arguments: [document.uri, l],
              }),
            );
            break;
          }
        }
      }

      if (bodyCurrentType === 'binary') {
        lenses.push(
          new vscode.CodeLens(range, {
            title: '📎 Pick attachment file…',
            tooltip:
              'Pick a file from the Global Assets library, or upload a new one. The asset id + slotId + filename + size + mimeType + sha256 are written into body.attachment.',
            command: 'apicircle.pickBinaryAttachment',
            arguments: [document.uri],
          }),
        );
      }

      if (bodyCurrentType === 'form-data') {
        // The ✚ Add text/file row lenses anchor on the `formRows:` line itself
        // (inside the body block) so they read as "add a row to THIS list",
        // not as body-level actions. Fall back to the body: line when the
        // formRows: key isn't present (a hand-edited body mid-rewrite).
        let formRowsLine = -1;
        for (let line = bodyAnchorLine + 1; line < document.lineCount; line++) {
          const t = document.lineAt(line).text;
          if (/^[A-Za-z]/.test(t)) break; // next top-level key ends the body
          if (FORM_ROWS_LINE_RE.test(t)) {
            formRowsLine = line;
            break;
          }
        }
        const addRowRange = formRowsLine !== -1 ? lineRange(document, formRowsLine) : range;
        lenses.push(
          new vscode.CodeLens(addRowRange, {
            title: '✚ Add text row',
            tooltip: 'Append a `- kind: text` row to formRows.',
            command: 'apicircle.addFormDataRow',
            arguments: [document.uri, 'text'],
          }),
          new vscode.CodeLens(addRowRange, {
            title: '✚ Add file row',
            tooltip:
              'Append a `- kind: file` row. Opens the Global Assets picker so the new row is bound to a real asset.',
            command: 'apicircle.addFormDataRow',
            arguments: [document.uri, 'file'],
          }),
        );

        // Per-row lenses inside the formRows: list. Pass the row index into
        // each command so the user goes straight to the row they clicked
        // without a disambiguation step.
        let rowIndex = -1;
        let inFormRows = false;
        for (let line = bodyAnchorLine + 1; line < document.lineCount; line++) {
          const lineText = document.lineAt(line).text;
          if (!inFormRows) {
            if (FORM_ROWS_LINE_RE.test(lineText)) {
              inFormRows = true;
            }
            continue;
          }
          if (/^[A-Za-z]/.test(lineText)) break; // next top-level key
          if (/^\s{0,3}[A-Za-z]/.test(lineText) && !FORM_ROWS_LINE_RE.test(lineText)) break;
          const kindMatch = FORM_ROW_KIND_LINE_RE.exec(lineText);
          if (!kindMatch) continue;
          rowIndex += 1;
          const kind = kindMatch[1] as 'text' | 'file';
          const rowRange = new vscode.Range(line, 0, line, lineText.length);
          lenses.push(
            new vscode.CodeLens(rowRange, {
              title: `↻ Switch to ${kind === 'text' ? 'file' : 'text'}`,
              tooltip:
                kind === 'text'
                  ? 'Convert this row to `kind: file` and bind it to a file asset.'
                  : 'Convert this row back to `kind: text`. File fields are stripped; key + enabled survive.',
              command: 'apicircle.switchFormDataRowKind',
              arguments: [document.uri, rowIndex],
            }),
          );
          if (kind === 'file') {
            lenses.push(
              new vscode.CodeLens(rowRange, {
                title: '📎 Pick file…',
                tooltip: 'Pick a new file asset for this row from the Global Assets library.',
                command: 'apicircle.pickFormDataRowFile',
                arguments: [document.uri, rowIndex],
              }),
            );
          }
        }
      }
    }

    if (authAnchorLine !== -1) {
      const text = document.lineAt(authAnchorLine).text;
      const range = new vscode.Range(authAnchorLine, 0, authAnchorLine, text.length);
      lenses.push(
        new vscode.CodeLens(range, {
          title: `⇄ Switch auth type${authCurrentType ? ` (current: ${authCurrentType})` : ''}…`,
          tooltip:
            'Switch the auth scheme — bearer / basic / api-key / custom-header / OAuth2 (six grants) / AWS SigV4 / Digest / NTLM / Hawk / JWT Bearer / inherit / none. Replaces the auth: block with a fresh scaffold.',
          command: 'apicircle.switchRequestAuthType',
          arguments: [document.uri],
        }),
      );
      if (authCurrentType && OAUTH2_GRANT_TYPES.has(authCurrentType)) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: '🔑 Get token',
            tooltip:
              'Fetch an OAuth2 access token from the configured token URL and write accessToken / refreshToken / expiresAt back into the auth: block. Client Credentials + Password grants run inline; browser-redirect grants point you at the desktop / web app.',
            command: 'apicircle.fetchOAuth2Token',
            arguments: [document.uri],
          }),
        );
      }
      if (authCurrentType === 'inherit') {
        const inheritedLens = await this.buildInheritedAuthLens(document.uri, range);
        if (inheritedLens) lenses.push(inheritedLens);
      }
    }

    if (headersAnchorLine !== -1) {
      const text = document.lineAt(headersAnchorLine).text;
      const range = new vscode.Range(headersAnchorLine, 0, headersAnchorLine, text.length);
      lenses.push(
        new vscode.CodeLens(range, {
          title: '✚ Header',
          tooltip:
            'Two-step picker: choose a common HTTP header by name (Accept / Authorization / Content-Type / …), then a curated value. New row appends to headers:.',
          command: 'apicircle.pickHeader',
          arguments: [document.uri],
        }),
      );
    }

    if (contextVarsAnchorLine !== -1) {
      const text = document.lineAt(contextVarsAnchorLine).text;
      const range = new vscode.Range(contextVarsAnchorLine, 0, contextVarsAnchorLine, text.length);
      lenses.push(
        new vscode.CodeLens(range, {
          title: '🗺 Map from JSON…',
          tooltip:
            'Paste a JSON object — keys flatten to dotted paths (user.id, items.0.sku) and become contextVars rows. Replaces existing rows after a confirmation modal.',
          command: 'apicircle.mapContextVarsFromJson',
          arguments: [document.uri],
        }),
      );
    }

    if (queryAnchorLine !== -1) {
      lenses.push(
        new vscode.CodeLens(lineRange(document, queryAnchorLine), {
          title: '✚ Add query param',
          tooltip:
            'Append a query: row — key + value (supports {{var}} interpolation). Enabled by default.',
          command: 'apicircle.addQueryRow',
          arguments: [document.uri],
        }),
      );
    }
    if (cookiesAnchorLine !== -1) {
      lenses.push(
        new vscode.CodeLens(lineRange(document, cookiesAnchorLine), {
          title: '✚ Add cookie',
          tooltip:
            'Append a cookies: row — name + value. Cookies merge into the Cookie header at send time.',
          command: 'apicircle.addCookieRow',
          arguments: [document.uri],
        }),
      );
    }
    if (pathParamsAnchorLine !== -1) {
      lenses.push(
        new vscode.CodeLens(lineRange(document, pathParamsAnchorLine), {
          title: '✚ Add path param',
          tooltip:
            'Append a pathParams entry — fills a placeholder slot ({name} / :name) in the URL.',
          command: 'apicircle.addPathParamRow',
          arguments: [document.uri],
        }),
      );
    }
    if (assertionsAnchorLine !== -1) {
      lenses.push(
        new vscode.CodeLens(lineRange(document, assertionsAnchorLine), {
          title: '✚ Add assertion',
          tooltip:
            'Append an assertion — pick kind (status / header / json-path / response-time), op, expected.',
          command: 'apicircle.addAssertionRow',
          arguments: [document.uri],
        }),
      );
    }
    if (extractionsAnchorLine !== -1) {
      lenses.push(
        new vscode.CodeLens(lineRange(document, extractionsAnchorLine), {
          title: '✚ Add extraction',
          tooltip:
            'Append an extraction — capture a response value (body JSON path / header / cookie / status) into globalContext for later requests.',
          command: 'apicircle.addExtractionRow',
          arguments: [document.uri],
        }),
      );
    }

    this.addFieldLenses(document, lenses);
    return lenses;
  }

  /**
   * ◆ field-editor lenses on the editable scalar rows — the request-side mirror
   * of the endpoint editor. Tracks which list (headers / query / cookies /
   * pathParams) we're inside so the same `key:` / `value:` token gets the right
   * command (header rows are catalogue-aware; query / cookie / path-param rows
   * use the generic text editor).
   */
  private addFieldLenses(document: vscode.TextDocument, lenses: vscode.CodeLens[]): void {
    const fieldLens = (line: number, title: string, command: string, tooltip: string): void => {
      lenses.push(
        new vscode.CodeLens(lineRange(document, line), {
          title,
          tooltip,
          command,
          arguments: [document.uri, line],
        }),
      );
    };

    // 'headers' | 'query' | 'cookies' | 'pathParams' | 'auth' | 'assertions' |
    // 'extractions' | '' (none)
    let listKind = '';
    let listIndent = -1;
    // The auth `type:` value tells us which OAuth2 grant / Hawk / JWT variant
    // we're looking at, so the per-field lenses can pick the right enum
    // (clientAuthMethod / tokenType / codeChallengeMethod / algorithm). Scoped
    // to the duration of the auth: block.
    let currentAuthType = '';
    // The current assertion entry's `kind:` value. Scoped to one assertion
    // entry — gates the ◆ Target lens (status / duration have no target) and
    // drives the ◆ Expected picker (JSON path → pickJsonPath, header → value
    // catalogue, status → status code list).
    let currentAssertionKind = '';

    for (let line = 0; line < document.lineCount; line++) {
      const text = document.lineAt(line).text;
      if (text.trim().length === 0) continue;
      const indent = text.match(/^ */)?.[0].length ?? 0;

      // Leave the current list when we dedent to/below its key.
      if (listKind !== '' && indent <= listIndent) {
        if (listKind === 'auth') currentAuthType = '';
        if (listKind === 'assertions') currentAssertionKind = '';
        listKind = '';
        listIndent = -1;
      }

      // Enter a list/map section.
      if (indent === 0) {
        if (HEADERS_LINE_RE.test(text)) {
          listKind = 'headers';
          listIndent = indent;
          continue;
        }
        if (QUERY_LINE_RE.test(text)) {
          listKind = 'query';
          listIndent = indent;
          continue;
        }
        if (COOKIES_LINE_RE.test(text)) {
          listKind = 'cookies';
          listIndent = indent;
          continue;
        }
        if (PATH_PARAMS_LINE_RE.test(text)) {
          listKind = 'pathParams';
          listIndent = indent;
          continue;
        }
        if (AUTH_LINE_RE.test(text)) {
          listKind = 'auth';
          listIndent = indent;
          continue;
        }
        if (ASSERTIONS_LINE_RE.test(text)) {
          listKind = 'assertions';
          listIndent = indent;
          continue;
        }
        if (EXTRACTIONS_LINE_RE.test(text)) {
          listKind = 'extractions';
          listIndent = indent;
          continue;
        }
        // Top-level method field editor. The URL is edited inline — typed
        // ?query=… and {path} placeholders sync into the query: and pathParams:
        // blocks on save (parseRequestFromYaml), so a lens on `url:` would
        // just duplicate the obvious "click here, edit text" affordance.
        if (/^method\s*:/.test(text)) {
          fieldLens(line, '◆ Method', 'apicircle.setRequestMethodField', 'Pick the HTTP method.');
          continue;
        }
        // Any other top-level key ends a list context (handled by the dedent above).
        continue;
      }

      // Rows inside a tracked list.
      if (listKind === 'headers') {
        if (/^\s+-\s+key\s*:/.test(text)) {
          fieldLens(
            line,
            '◆ Key',
            'apicircle.setRequestHeaderKeyField',
            'Pick the header name from the catalogue or type your own.',
          );
        } else if (/^\s+value\s*:/.test(text)) {
          fieldLens(
            line,
            '◆ Value',
            'apicircle.setRequestHeaderValueField',
            'Pick the header value — curated values where we have them.',
          );
        }
      } else if (listKind === 'query' || listKind === 'cookies') {
        if (/^\s+-\s+key\s*:/.test(text)) {
          fieldLens(line, '◆ Key', 'apicircle.setRequestTextField', 'Edit the name.');
          // Per-row ✓ Enable / ⊘ Disable toggle — mirrors the response-header
          // toggle in the endpoint editor. Disabled rows stay in the YAML for
          // what-if testing but are skipped at send time.
          const rowEnabled = readRowEnabled(document, line);
          fieldLens(
            line,
            rowEnabled === false ? '✓ Enable' : '⊘ Disable',
            'apicircle.toggleRequestRowEnabled',
            rowEnabled === false
              ? 'Flip enabled: false → true so this row is sent.'
              : "Flip enabled: true → false. Disabled rows stay in the YAML but aren't sent.",
          );
        } else if (listKind === 'cookies' && /^\s+value\s*:/.test(text)) {
          // Cookies keep the ◆ Value lens (catalogue-less but useful for
          // multi-line edits). Query value rows are edited inline — typing
          // `?key=val` into url: round-trips through the YAML parser anyway,
          // so a separate value picker buys nothing.
          fieldLens(
            line,
            '◆ Value',
            'apicircle.setRequestTextField',
            'Edit the value (supports {{var}}).',
          );
        }
      } else if (listKind === 'pathParams') {
        // pathParams is a `name: value` map — each row's value is editable.
        // No per-row enable/disable: a placeholder can't be "off" and still
        // satisfy the URL substitution (the request wouldn't send), so the
        // enable concept doesn't apply here. We only emit ◆ Value.
        if (/^\s+[A-Za-z0-9_-]+\s*:/.test(text)) {
          fieldLens(
            line,
            '◆ Value',
            'apicircle.setRequestTextField',
            "Edit this path param's value.",
          );
        }
      } else if (listKind === 'auth') {
        // Most auth scalar fields are edited directly in the YAML — the
        // exceptions are the few enum-valued fields the user shouldn't have
        // to memorize: OAuth2 clientAuthMethod / codeChallengeMethod /
        // tokenType, Hawk + JWT algorithm. Plus ⟳ Format JSON on the JSON
        // block scalars (payload / jwtHeaders).
        const k = /^\s+([A-Za-z][A-Za-z0-9_]*)\s*:/.exec(text)?.[1];
        if (k === 'type') {
          const m = /^\s+type\s*:\s*['"]?([A-Za-z0-9-]+)['"]?/.exec(text);
          if (m) currentAuthType = m[1];
        }
        if (k === 'payload' || k === 'jwtHeaders') {
          fieldLens(line, '⟳ Format JSON', 'apicircle.formatJson', 'Reflow this JSON auth field.');
        } else if (k === 'clientAuthMethod' && currentAuthType === 'oauth2-client-credentials') {
          fieldLens(
            line,
            '◆ Client Auth Method',
            'apicircle.setRequestAuthField',
            'Pick where client credentials ride — Authorization header (Basic) or x-www-form-urlencoded body.',
          );
        } else if (k === 'codeChallengeMethod' && currentAuthType === 'oauth2-pkce') {
          fieldLens(
            line,
            '◆ Code Challenge Method',
            'apicircle.setRequestAuthField',
            'Pick the PKCE challenge method — S256 (preferred) or plain.',
          );
        } else if (k === 'tokenType' && OAUTH2_GRANT_TYPES.has(currentAuthType)) {
          fieldLens(
            line,
            '◆ Token Type',
            'apicircle.setRequestAuthField',
            'Pick the OAuth2 token type — Bearer (default), MAC, DPoP, or a custom scheme.',
          );
        } else if (k === 'algorithm' && currentAuthType === 'hawk') {
          fieldLens(
            line,
            '◆ Algorithm',
            'apicircle.setRequestAuthField',
            'Pick the Hawk MAC algorithm — SHA-256 (default) or SHA-1.',
          );
        } else if (k === 'algorithm' && currentAuthType === 'jwt-bearer') {
          fieldLens(
            line,
            '◆ Algorithm',
            'apicircle.setRequestAuthField',
            'Pick the JWT signing algorithm — HS256 / RS256 / ES256 / EdDSA / …',
          );
        }
      } else if (listKind === 'assertions') {
        // A new entry's `- id:` dash resets per-entry tracking so each
        // assertion's target/expected lens is driven by its own kind.
        if (/^\s+-\s+id\s*:/.test(text)) {
          currentAssertionKind = '';
        }
        if (/^\s+(?:-\s+)?kind\s*:/.test(text)) {
          const m = /^\s+(?:-\s+)?kind\s*:\s*['"]?([a-z-]+)['"]?/.exec(text);
          if (m) currentAssertionKind = m[1];
          fieldLens(
            line,
            '◆ Kind',
            'apicircle.setRequestAssertionKindField',
            'Pick the assertion kind.',
          );
        } else if (/^\s+op\s*:/.test(text)) {
          fieldLens(
            line,
            '◆ Op',
            'apicircle.setRequestAssertionOpField',
            'Pick the comparison operator.',
          );
        } else if (/^\s+target\s*:/.test(text)) {
          // Only `header` and `json-path` use the target slot. `status` and
          // `duration` compare against the whole status / latency value —
          // a target row is dead weight, so don't emit a lens on it.
          if (currentAssertionKind === 'header' || currentAssertionKind === 'json-path') {
            fieldLens(
              line,
              currentAssertionKind === 'json-path' ? '◆ Target (JSON path)' : '◆ Target (header)',
              'apicircle.setRequestAssertionTargetField',
              currentAssertionKind === 'json-path'
                ? 'Pick a JSON path from the latest response, or type one.'
                : 'Pick the response header name from the catalogue, or type your own.',
            );
          }
        } else if (/^\s+expected\s*:/.test(text)) {
          // Kind-aware expected: status → code list, header → curated values,
          // json-path → JSON-path extractor against the latest response,
          // duration → numeric input. Generic text fallback for unknown kinds.
          const titles: Record<string, string> = {
            status: '◆ Expected (status code)',
            header: '◆ Expected (header value)',
            'json-path': '◆ Expected (from response body)',
            duration: '◆ Expected (ms)',
          };
          fieldLens(
            line,
            titles[currentAssertionKind] ?? '◆ Expected',
            'apicircle.setRequestAssertionExpectedField',
            currentAssertionKind === 'json-path'
              ? 'Pick a value from the latest response body (run the request once first), or type it.'
              : 'Pick / type the expected value.',
          );
        }
      } else if (listKind === 'extractions') {
        if (/^\s+(?:-\s+)?variable\s*:/.test(text)) {
          fieldLens(line, '◆ Variable', 'apicircle.setRequestTextField', 'Edit the variable name.');
        } else if (/^\s+source\s*:/.test(text)) {
          fieldLens(
            line,
            '◆ Source',
            'apicircle.setRequestExtractionSourceField',
            'Pick the extraction source.',
          );
        } else if (/^\s+path\s*:/.test(text)) {
          fieldLens(line, '◆ Path', 'apicircle.setRequestTextField', 'Edit the source path.');
        }
      }
    }
  }

  /**
   * Resolve the auth that an `inherit`-typed request would actually use by
   * walking up the folder chain via `resolveInheritedAuth`. Returns a lens
   * that opens the source folder's YAML (or surfaces "→ none" when nothing
   * up the chain provides explicit auth).
   *
   * Returns `null` when the bridge isn't available, the document's request
   * id can't be located, or the request isn't actually `inherit` after a
   * fresh read (the YAML buffer can drift between paste + save).
   */
  private async buildInheritedAuthLens(
    uri: vscode.Uri,
    range: vscode.Range,
  ): Promise<vscode.CodeLens | null> {
    if (!this.bridge) return null;
    const params = new URLSearchParams(uri.query || '');
    const requestId = params.get('id');
    if (!requestId) return null;
    const decodedAuthority = decodeHexSafe(uri.authority);
    const surface = this.bridge
      .listWorkspaces()
      .find((w) => w.workspace.id === decodedAuthority || w.workspace.id === uri.authority);
    if (!surface) return null;
    let state;
    try {
      state = await surface.read();
    } catch {
      return null;
    }

    // Two code paths: a regular `requests/` URI consults the consumer's own
    // collections; a `linked/.../<…>.yaml` URI consults the linked
    // workspace's cached snapshot (which lives in WorkspaceLocal.
    // linkedCollections). For linked requests the inherited-auth source is a
    // linked folder, opened via a separate read-only URI.
    const linkId = params.get('link');
    let folders: Record<string, Folder>;
    let requestFolderId: string | null;
    let isLinked = false;
    if (linkId) {
      const snap = state.local.linkedCollections[linkId];
      const request = snap?.collections.requests[requestId];
      if (!request) return null;
      folders = snap.collections.folders;
      requestFolderId = request.folderId;
      isLinked = true;
    } else {
      const request = state.synced.collections.requests[requestId];
      if (!request) return null;
      folders = state.synced.collections.folders;
      requestFolderId = request.folderId;
    }

    const resolved = resolveInheritedAuth({
      requestAuth: { type: 'inherit' },
      folderId: requestFolderId,
      folders,
    });
    const source = findInheritedAuthSource(requestFolderId, folders);
    if (resolved.type === 'none' || !source) {
      return new vscode.CodeLens(range, {
        title: '◆ Inherits → none (no ancestor folder sets auth)',
        tooltip:
          'This request will send with no auth. Open a parent folder and set an `auth:` block to make `inherit` resolve to something.',
        command: 'apicircle.openFolderYaml',
        arguments: [],
      });
    }
    let targetUri: vscode.Uri;
    if (isLinked && linkId) {
      const link = state.synced.linkedWorkspaces[linkId];
      if (!link) return null;
      targetUri = ApicircleFsProvider.linkedFolderUri(surface.workspace.id, link, source);
    } else {
      targetUri = ApicircleFsProvider.folderUri(surface.workspace.id, source, folders);
    }
    return new vscode.CodeLens(range, {
      title: `◆ Inherits from ${source.name} (${resolved.type})${isLinked ? ' [linked]' : ''}`,
      tooltip: `Resolves via resolveInheritedAuth: the closest ancestor folder with an explicit auth is "${source.name}" (auth.type: ${resolved.type})${isLinked ? ' in the linked workspace' : ''}. Click to open the folder YAML.`,
      command: 'vscode.open',
      arguments: [targetUri],
    });
  }

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  dispose(): void {
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    this.trackerSub?.dispose();
    for (const s of this.externalSubs) s.dispose();
    this._onDidChangeCodeLenses.dispose();
  }
}

function formatElapsed(seconds: number): string {
  // Sub-second elapsed shows as "0.4s" for snappy feedback on fast LANs;
  // anything past 10s switches to whole seconds to avoid jitter in the
  // CodeLens title every refresh.
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

function lineRange(document: vscode.TextDocument, line: number): vscode.Range {
  const text = document.lineAt(line).text;
  return new vscode.Range(line, 0, line, text.length);
}

const ROW_ENABLED_RE = /^\s+enabled\s*:\s*(true|false)\b/;

/**
 * Read a query / cookie entry's `enabled:` value. `keyLine` is the entry's
 * `- key:` row; the matching `enabled:` field sits deeper in the same entry.
 * Returns the boolean, or null when no explicit `enabled:` is present
 * (treated as enabled).
 */
function readRowEnabled(document: vscode.TextDocument, keyLine: number): boolean | null {
  const dashIndent = document.lineAt(keyLine).text.match(/^\s*/)?.[0].length ?? 0;
  for (let line = keyLine + 1; line < document.lineCount; line++) {
    const text = document.lineAt(line).text;
    if (text.trim().length === 0) continue;
    const leading = text.match(/^\s*/)?.[0].length ?? 0;
    if (leading <= dashIndent) break; // left this entry
    const m = ROW_ENABLED_RE.exec(text);
    if (m) return m[1] === 'true';
  }
  return null;
}

/**
 * Walk up the folder chain from `folderId` and return the FIRST folder that
 * carries an explicit auth (anything other than `none` / `inherit`). Mirrors
 * `resolveInheritedAuth` but returns the SOURCE folder (so the CodeLens can
 * label and link it). Cycle-safe in the same way.
 */
function findInheritedAuthSource(
  folderId: string | null,
  folders: Record<string, Folder>,
): Folder | null {
  let cursor = folderId;
  const visited = new Set<string>();
  while (cursor !== null) {
    if (visited.has(cursor)) break;
    visited.add(cursor);
    const folder = folders[cursor];
    if (!folder) break;
    const auth = folder.auth;
    if (auth && auth.type !== 'inherit' && auth.type !== 'none') return folder;
    cursor = folder.parentId;
  }
  return null;
}

/**
 * Decode a hex-encoded authority back to its original string. Tolerates a
 * non-hex authority (defensive in case a URI was hand-constructed).
 */
function decodeHexSafe(authority: string): string {
  try {
    return Buffer.from(authority, 'hex').toString('utf8');
  } catch {
    return authority;
  }
}

/** Read the inner `type:` value of a YAML section whose header is on
 *  `headerLine`. Stops at the next top-level key or EOF. Returns null when
 *  the section has no `type:` field. */
function readNestedType(document: vscode.TextDocument, headerLine: number): string | null {
  for (let i = headerLine + 1; i < document.lineCount; i++) {
    const text = document.lineAt(i).text;
    if (/^[A-Za-z]/.test(text)) break;
    const match = SECTION_TYPE_RE.exec(text);
    if (match) return match[1];
  }
  return null;
}
