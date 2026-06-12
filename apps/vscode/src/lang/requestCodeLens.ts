import * as vscode from 'vscode';
import type { InFlightSendTracker } from '../execute/inFlightTracker';

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

  constructor(private readonly tracker?: InFlightSendTracker) {
    if (tracker) {
      this.trackerSub = tracker.onDidChange(() => {
        this.refresh();
        this.updateTick();
      });
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

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    if (document.uri.scheme !== 'apicircle') return [];
    if (!document.uri.path.endsWith('.req.yaml')) return [];

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
        lenses.push(
          new vscode.CodeLens(range, {
            title: '▶ Send',
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
    }

    if (headersAnchorLine !== -1) {
      const text = document.lineAt(headersAnchorLine).text;
      const range = new vscode.Range(headersAnchorLine, 0, headersAnchorLine, text.length);
      lenses.push(
        new vscode.CodeLens(range, {
          title: '✚ Pick header…',
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

    // 'headers' | 'query' | 'cookies' | 'pathParams' | '' (none)
    let listKind = '';
    let listIndent = -1;

    for (let line = 0; line < document.lineCount; line++) {
      const text = document.lineAt(line).text;
      if (text.trim().length === 0) continue;
      const indent = text.match(/^ */)?.[0].length ?? 0;

      // Leave the current list when we dedent to/below its key.
      if (listKind !== '' && indent <= listIndent) {
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
        // Top-level method / url field editors.
        if (/^method\s*:/.test(text)) {
          fieldLens(line, '◆ Method', 'apicircle.setRequestMethodField', 'Pick the HTTP method.');
          continue;
        }
        if (/^url\s*:/.test(text)) {
          fieldLens(line, '◆ URL', 'apicircle.setRequestTextField', 'Edit the request URL.');
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
        } else if (/^\s+value\s*:/.test(text)) {
          fieldLens(
            line,
            '◆ Value',
            'apicircle.setRequestTextField',
            'Edit the value (supports {{var}}).',
          );
        }
      } else if (listKind === 'pathParams') {
        // pathParams is a `name: value` map — each row's value is editable.
        if (/^\s+[A-Za-z0-9_-]+\s*:/.test(text)) {
          fieldLens(
            line,
            '◆ Value',
            'apicircle.setRequestTextField',
            "Edit this path param's value.",
          );
        }
      } else if (listKind === 'auth') {
        // Auth scalar fields are edited directly in the YAML — no per-field
        // ◆ editor lens. The only auth lens kept is ⟳ Format JSON on the JSON
        // block scalars (payload / jwtHeaders), where a hand-edit would
        // otherwise have to reflow multi-line JSON by hand.
        const k = /^\s+([A-Za-z][A-Za-z0-9_]*)\s*:/.exec(text)?.[1];
        if (k === 'payload' || k === 'jwtHeaders') {
          fieldLens(line, '⟳ Format JSON', 'apicircle.formatJson', 'Reflow this JSON auth field.');
        }
      } else if (listKind === 'assertions') {
        if (/^\s+(?:-\s+)?kind\s*:/.test(text)) {
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
          fieldLens(
            line,
            '◆ Target',
            'apicircle.setRequestTextField',
            'Edit the target (header name / JSON path).',
          );
        } else if (/^\s+expected\s*:/.test(text)) {
          fieldLens(
            line,
            '◆ Expected',
            'apicircle.setRequestTextField',
            'Edit the expected value.',
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

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  dispose(): void {
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    this.trackerSub?.dispose();
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
