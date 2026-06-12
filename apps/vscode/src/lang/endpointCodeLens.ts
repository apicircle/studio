import * as vscode from 'vscode';
import { MAX_RESPONSE_MULTIPLIERS, MAX_RESPONSE_RULE_CONDITIONS } from '@apicircle/shared';
import { validationKindNeeds } from './mockValidationKinds';

// =============================================================================
// CodeLens provider for apicircle:// per-endpoint YAML documents
// (URI shape: apicircle://<ws>/mocks/<mockId>/<endpointId>.endpoint.yaml).
//
// Two layers of lenses:
//
// 1. Structural (section headers + entry rows):
//      Above `responseRules:`        ✚ Add response rule
//      Above `requestValidation:`    🛡 Add validation rule
//      Above `defaultResponse.headers:`  ✚ Add header
//      Above `defaultResponse:` (no multiplier yet)  ✱ Add multiplier
//      Each responseRules `- id:`    ✓/⊘ Enable · ✚ Header · ✕ Remove
//      Each requestValidation `- id:` ✓/⊘ Enable · ✕ Remove + ◆ Kind/Target/Value
//      each `multipliers:` entry     ✕ Remove multiplier
//
// 2. Field editors (one lens on the field row itself — the lens passes the
//    LINE NUMBER it sits on; the command derives indent from the document):
//      `method:`                     ◆ Method
//      any `status:`                 ◆ Status         (default / rule / failResponse)
//      header `- key:` / `value:`    ◆ Key / ◆ Value  (header-aware value catalogue)
//      body `type:`                  ◆ Body type
//      when-clause `scope:`/`op:`/`target:`  ◆ Scope / ◆ Op / ◆ Target
//      `when:`                       ✚ Add condition
//      multiplier `source.kind:`     ◆ Kind
//      multiplier `source.key:`      ◆ Key
//      multiplier `targetJsonPath:`  ◆ Path           (picks an array from the
//                                                       default-response body)
// =============================================================================

const DEFAULT_RESPONSE_RE = /^defaultResponse\s*:/;
const RESPONSE_RULES_RE = /^responseRules\s*:/;
const REQUEST_VALIDATION_RE = /^requestValidation\s*:/;
const REQUEST_SCHEMA_RE = /^requestSchema\s*:/;
const SCHEMA_LIST_RE = /^\s{2}(pathParams|queryParams|headers|cookies|body)\s*:/;
const TYPE_HINT_RE = /^\s+typeHint\s*:/;
const EXAMPLE_RE = /^\s+example\s*:/;
const DESCRIPTION_RE = /^\s+description\s*:/;
const MULTIPLIERS_RE = /^\s+multipliers\s*:/;
const HEADERS_RE = /^\s+headers\s*:/;
const ARRAY_ENTRY_ID_RE = /^\s+-\s+id:\s*['"]?([A-Za-z0-9_-]+)['"]?/;
const RULE_ENABLED_RE = /^\s+enabled\s*:\s*(true|false)\b/;

const METHOD_RE = /^method\s*:/;
const STATUS_RE = /^\s+status\s*:/;
const HEADER_KEY_RE = /^\s+-\s+key\s*:/;
const HEADER_VALUE_RE = /^\s+value\s*:/;
const BODY_TYPE_RE = /^\s+type\s*:/;
const BODY_TYPE_VALUE_RE = /^\s+type\s*:\s*['"]?([a-z-]+)['"]?/;
const CONTENT_RE = /^\s+content\s*:/;
const WHEN_RE = /^\s+when\s*:/;
const CLAUSE_SCOPE_RE = /^\s+scope\s*:/;
const CLAUSE_OP_RE = /^\s+op\s*:/;
const CLAUSE_OP_VALUE_RE = /^\s+op\s*:\s*['"]?([a-z-]+)['"]?/;
const CLAUSE_TARGET_RE = /^\s+target\s*:/;
const CLAUSE_VALUE_RE = /^\s+value\s*:/;
const SOURCE_RE = /^\s+source\s*:/;
const SOURCE_KIND_RE = /^\s+kind\s*:/;
const SOURCE_KEY_RE = /^\s+key\s*:/;
const TARGET_PATH_RE = /^\s+targetJsonPath\s*:/;
const DEFAULT_COUNT_RE = /^\s+defaultCount\s*:/;
const MIN_RE = /^\s+min\s*:/;
const MAX_RE = /^\s+max\s*:/;
const NAME_RE = /^\s+name\s*:/;

export class EndpointCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChange.event;

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    if (document.uri.scheme !== 'apicircle') return [];
    if (!document.uri.path.endsWith('.endpoint.yaml')) return [];

    const lenses: vscode.CodeLens[] = [];
    let defaultResponseLine = -1;
    let responseRulesLine = -1;
    let validationLine = -1;
    let multipliersLine = -1;
    let requestSchemaLine = -1;

    for (let line = 0; line < document.lineCount; line++) {
      const text = document.lineAt(line).text;
      if (defaultResponseLine === -1 && DEFAULT_RESPONSE_RE.test(text)) {
        defaultResponseLine = line;
      } else if (responseRulesLine === -1 && RESPONSE_RULES_RE.test(text)) {
        responseRulesLine = line;
      } else if (validationLine === -1 && REQUEST_VALIDATION_RE.test(text)) {
        validationLine = line;
      } else if (requestSchemaLine === -1 && REQUEST_SCHEMA_RE.test(text)) {
        requestSchemaLine = line;
      }
    }

    this.addRequestSchemaLenses(document, lenses, requestSchemaLine, validationLine);

    // multipliers: lives inside defaultResponse.
    if (defaultResponseLine !== -1) {
      const endLine = nextTopLevelLine(document, defaultResponseLine + 1);
      for (let line = defaultResponseLine + 1; line < endLine; line++) {
        if (MULTIPLIERS_RE.test(document.lineAt(line).text)) {
          multipliersLine = line;
          break;
        }
      }
    }

    if (defaultResponseLine !== -1) {
      const dEnd = nextTopLevelLine(document, defaultResponseLine + 1);
      // Collect the multiplier entry ids (direct `- id:` rows under multipliers:).
      const multiplierIds: { line: number; id: string }[] = [];
      if (multipliersLine !== -1) {
        for (let line = multipliersLine + 1; line < dEnd; line++) {
          const text = document.lineAt(line).text;
          const leading = text.match(/^\s*/)?.[0].length ?? 0;
          if (text.trim().length > 0 && leading <= 2) break; // left the block
          const idMatch = ARRAY_ENTRY_ID_RE.exec(text);
          if (idMatch && leading <= 4) multiplierIds.push({ line, id: idMatch[1] });
        }
      }
      // Add-multiplier while under the cap (raise MAX_RESPONSE_MULTIPLIERS to
      // allow N — no other change needed).
      if (multiplierIds.length < MAX_RESPONSE_MULTIPLIERS) {
        lenses.push(
          new vscode.CodeLens(lineRange(document, defaultResponseLine), {
            title: '✱ Add multiplier',
            tooltip:
              'Add a response multiplier — repeats an array in the response body based on a query / path / header / body-JSON value.',
            command: 'apicircle.addMockMultiplier',
            arguments: [document.uri],
          }),
        );
      }
      // Add-header lens above defaultResponse.headers.
      for (let line = defaultResponseLine + 1; line < dEnd; line++) {
        if (HEADERS_RE.test(document.lineAt(line).text)) {
          lenses.push(
            new vscode.CodeLens(lineRange(document, line), {
              title: '✚ Add header',
              tooltip:
                'Append a response header — quick-pick over common ones (Content-Type / Cache-Control / ETag / CORS / …) with curated values, or type a custom name.',
              command: 'apicircle.addMockResponseHeader',
              arguments: [document.uri],
            }),
          );
          break;
        }
      }
      // Remove-multiplier per entry.
      for (const { line, id } of multiplierIds) {
        lenses.push(
          new vscode.CodeLens(lineRange(document, line), {
            title: '✕ Remove multiplier',
            command: 'apicircle.removeMockMultiplier',
            arguments: [document.uri, id],
          }),
        );
      }
    }

    if (responseRulesLine !== -1) {
      const range = lineRange(document, responseRulesLine);
      lenses.push(
        new vscode.CodeLens(range, {
          title: '✚ Add response rule',
          tooltip:
            'Append a conditional response rule. When the clauses match, this rule overrides the default response.',
          command: 'apicircle.addMockResponseRule',
          arguments: [document.uri],
        }),
      );
      const endLine = nextTopLevelLine(document, responseRulesLine + 1);
      for (let line = responseRulesLine + 1; line < endLine; line++) {
        const text = document.lineAt(line).text;
        const idMatch = ARRAY_ENTRY_ID_RE.exec(text);
        if (!idMatch) continue;
        if ((text.match(/^\s*/)?.[0].length ?? 0) > 4) continue;
        const ruleId = idMatch[1];
        const rowRange = lineRange(document, line);
        const enabled = readRuleEnabled(document, line, endLine);
        lenses.push(
          new vscode.CodeLens(rowRange, {
            title: enabled === false ? '✓ Enable' : '⊘ Disable',
            tooltip:
              enabled === false
                ? 'Flip enabled: false → true so this rule fires at runtime.'
                : "Flip enabled: true → false. Disabled rules stay in the YAML for what-if testing but don't fire.",
            command: 'apicircle.toggleMockRuleEnabled',
            arguments: [document.uri, 'response', ruleId],
          }),
          new vscode.CodeLens(rowRange, {
            title: '✕ Remove rule',
            command: 'apicircle.removeMockResponseRule',
            arguments: [document.uri, ruleId],
          }),
        );
        // ✚ Add header belongs on this rule's response.headers: block — not on
        // the rule's `- id:` row — so it reads as "add a header to THIS list".
        const ruleEnd = nextArrayEntryLine(document, line + 1, endLine);
        for (let h = line + 1; h < ruleEnd; h++) {
          if (HEADERS_RE.test(document.lineAt(h).text)) {
            lenses.push(
              new vscode.CodeLens(lineRange(document, h), {
                title: '✚ Add header',
                tooltip:
                  'Append a response header to this rule — quick-pick over common ones with curated values, or type a custom name.',
                command: 'apicircle.addMockResponseHeader',
                arguments: [document.uri, ruleId],
              }),
            );
            break;
          }
        }
      }
    }

    if (validationLine !== -1) {
      const range = lineRange(document, validationLine);
      lenses.push(
        new vscode.CodeLens(range, {
          title: '🛡 Add validation rule',
          tooltip:
            'Append a pre-request validation gate (no prompts — refine kind / target / value with the ◆ lenses).',
          command: 'apicircle.addMockValidationRule',
          arguments: [document.uri],
        }),
      );
      const endLine = nextTopLevelLine(document, validationLine + 1);
      for (let line = validationLine + 1; line < endLine; line++) {
        const text = document.lineAt(line).text;
        const idMatch = ARRAY_ENTRY_ID_RE.exec(text);
        if (!idMatch) continue;
        if ((text.match(/^\s*/)?.[0].length ?? 0) > 4) continue;
        const ruleId = idMatch[1];
        const rowRange = lineRange(document, line);
        const enabled = readRuleEnabled(document, line, endLine);
        lenses.push(
          new vscode.CodeLens(rowRange, {
            title: enabled === false ? '✓ Enable' : '⊘ Disable',
            tooltip:
              enabled === false
                ? 'Flip enabled: false → true so this validation gate fires.'
                : "Flip enabled: true → false. Disabled validations stay in the YAML but don't gate requests.",
            command: 'apicircle.toggleMockRuleEnabled',
            arguments: [document.uri, 'validation', ruleId],
          }),
          new vscode.CodeLens(rowRange, {
            title: '✕ Remove rule',
            command: 'apicircle.removeMockValidationRule',
            arguments: [document.uri, ruleId],
          }),
        );
        // ◆ Kind / ◆ Target / ◆ Value on the validation entry's field rows.
        const fields = findValidationFields(document, line, endLine);
        if (fields.kindLine !== -1) {
          lenses.push(
            new vscode.CodeLens(lineRange(document, fields.kindLine), {
              title: '◆ Kind',
              tooltip: 'Change the validation kind. The target and value rows adapt to match.',
              command: 'apicircle.setMockValidationKind',
              arguments: [document.uri, ruleId],
            }),
          );
        }
        const needs = validationKindNeeds(fields.kind);
        if (needs.target && fields.targetLine !== -1) {
          lenses.push(
            new vscode.CodeLens(lineRange(document, fields.targetLine), {
              title: '◆ Target',
              tooltip:
                "Pick the header / query / cookie name — from this endpoint's declared params + the curated header catalogue, or type your own.",
              command: 'apicircle.setMockValidationTarget',
              arguments: [document.uri, ruleId],
            }),
          );
        }
        if (needs.expected && fields.expectedLine !== -1) {
          lenses.push(
            new vscode.CodeLens(lineRange(document, fields.expectedLine), {
              title: '◆ Value',
              tooltip:
                'Pick the expected value — curated header / Content-Type values, or a regex / literal you type.',
              command: 'apicircle.setMockValidationExpected',
              arguments: [document.uri, ruleId],
            }),
          );
        }
      }
    }

    this.addFieldLenses(document, lenses);
    return lenses;
  }

  /**
   * Section-header lenses for `requestSchema`. When the block exists, each
   * "add" lens sits directly above the subsection it targets — ✚ Path param on
   * `pathParams:`, ✚ Query param on `queryParams:`, ✚ Header on `headers:`,
   * ✚ Cookie on `cookies:`, and ✚ Body example on `body:` (or on the
   * `requestSchema:` header when the body block isn't documented yet). A
   * subsection key that's been hand-deleted falls back to the `requestSchema:`
   * header so the affordance is never lost. When the whole block is absent (the
   * projection hides an empty schema), a single ✚ Add request schema lens lands
   * on the `requestValidation:` anchor.
   */
  private addRequestSchemaLenses(
    document: vscode.TextDocument,
    lenses: vscode.CodeLens[],
    requestSchemaLine: number,
    validationLine: number,
  ): void {
    if (requestSchemaLine !== -1) {
      // Locate each `  <key>:` subsection line inside the requestSchema block so
      // the matching add-lens can anchor on top of it.
      const blockEnd = nextTopLevelLine(document, requestSchemaLine + 1);
      const subLine: Record<string, number> = {};
      for (let line = requestSchemaLine + 1; line < blockEnd; line++) {
        const m = SCHEMA_LIST_RE.exec(document.lineAt(line).text);
        if (m && subLine[m[1]] === undefined) subLine[m[1]] = line;
      }
      const addParam = (
        key: 'pathParams' | 'queryParams' | 'headers' | 'cookies',
        title: string,
        tooltip: string,
      ): void => {
        const anchor = subLine[key] ?? requestSchemaLine;
        lenses.push(
          new vscode.CodeLens(lineRange(document, anchor), {
            title,
            tooltip,
            command: 'apicircle.addMockRequestSchemaParam',
            arguments: [document.uri, key],
          }),
        );
      };
      addParam(
        'pathParams',
        '✚ Path param',
        'Declare a path param (prefilled from the pathPattern slots).',
      );
      addParam('queryParams', '✚ Query param', 'Declare a query param.');
      addParam('headers', '✚ Header', 'Declare an expected request header.');
      addParam('cookies', '✚ Cookie', 'Declare an expected request cookie.');
      const bodyAnchor = subLine.body ?? requestSchemaLine;
      lenses.push(
        new vscode.CodeLens(lineRange(document, bodyAnchor), {
          title: '✚ Body example',
          tooltip: 'Document the expected request body shape (description + example).',
          command: 'apicircle.addMockRequestSchemaBodyExample',
          arguments: [document.uri],
        }),
      );
      return;
    }
    if (validationLine !== -1) {
      lenses.push(
        new vscode.CodeLens(lineRange(document, validationLine), {
          title: '✚ Add request schema',
          tooltip:
            "Declare this endpoint's expected inputs (path / query / header / cookie params + body docs). Path params seed from the pathPattern. Editable here and in the Desktop / Web app.",
          command: 'apicircle.addMockRequestSchema',
          arguments: [document.uri],
        }),
      );
    }
  }

  /**
   * Single pass that emits a ◆ field-editor lens on every editable scalar row,
   * tracking nesting context so the same `value:` / `key:` / `target:` token
   * is interpreted correctly whether it sits in a headers list, a when-clause,
   * or a multiplier source.
   */
  private addFieldLenses(document: vscode.TextDocument, lenses: vscode.CodeLens[]): void {
    let headersIndent = -1;
    let whenIndent = -1;
    let multiplierIndent = -1;
    let sourceIndent = -1;
    // Op of the when-clause currently being scanned — drives whether the clause
    // `value:` row gets a ◆ Value lens (present / absent ignore the value).
    let currentClauseOp = '';
    // Whether the body subtree currently being scanned is JSON — drives the
    // ⟳ Format JSON lens on its `content:` row.
    let bodyTypeIsJson = false;
    // requestSchema context — the indent of the `requestSchema:` key (0) while
    // inside it, and which param list (pathParams / headers / …) we're in.
    let schemaIndent = -1;
    let schemaList = '';

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

    for (let line = 0; line < document.lineCount; line++) {
      const text = document.lineAt(line).text;
      if (text.trim().length === 0) continue;
      const indent = text.match(/^ */)?.[0].length ?? 0;

      // Dedent out of any context we've left (a sibling/ancestor at ≤ indent).
      if (headersIndent !== -1 && indent <= headersIndent) headersIndent = -1;
      if (whenIndent !== -1 && indent <= whenIndent) {
        whenIndent = -1;
        currentClauseOp = '';
      }
      if (sourceIndent !== -1 && indent <= sourceIndent) sourceIndent = -1;
      if (multiplierIndent !== -1 && indent <= multiplierIndent) multiplierIndent = -1;
      if (schemaIndent !== -1 && indent <= schemaIndent && !REQUEST_SCHEMA_RE.test(text)) {
        schemaIndent = -1;
        schemaList = '';
      }

      // A new when-clause dash resets the per-clause op tracking so each
      // clause's value lens is gated by its own op.
      if (whenIndent !== -1 && indent > whenIndent && /^\s*-\s/.test(text)) {
        currentClauseOp = '';
      }

      // requestSchema context tracking.
      if (REQUEST_SCHEMA_RE.test(text)) {
        schemaIndent = indent;
        schemaList = '';
        continue;
      }
      if (schemaIndent !== -1) {
        const listMatch = SCHEMA_LIST_RE.exec(text);
        if (listMatch) {
          schemaList = listMatch[1];
          continue;
        }
      }

      // Open contexts.
      if (HEADERS_RE.test(text)) {
        headersIndent = indent;
        continue;
      }
      if (WHEN_RE.test(text)) {
        whenIndent = indent;
        currentClauseOp = '';
        // Cap the when-clauses at MAX_RESPONSE_RULE_CONDITIONS (=1 today): once
        // the rule has a clause, hide the add lens. Raising the constant is the
        // only change needed to allow N (the engine already AND-combines all).
        if (countWhenClauses(document, line, indent) < MAX_RESPONSE_RULE_CONDITIONS) {
          fieldLens(
            line,
            '✚ Add condition',
            'apicircle.addMockConditionClause',
            'Add the condition for this rule (scope / target / op / value).',
          );
        }
        continue;
      }
      if (MULTIPLIERS_RE.test(text)) {
        multiplierIndent = indent;
        continue;
      }
      if (multiplierIndent !== -1 && SOURCE_RE.test(text)) {
        sourceIndent = indent;
        continue;
      }

      // Field rows.
      if (METHOD_RE.test(text)) {
        fieldLens(line, '◆ Method', 'apicircle.setMockMethodField', 'Pick the HTTP method.');
      } else if (STATUS_RE.test(text)) {
        fieldLens(
          line,
          '◆ Status',
          'apicircle.setMockStatusField',
          'Pick the response status (common codes or a custom 100–599).',
        );
      } else if (BODY_TYPE_RE.test(text)) {
        bodyTypeIsJson = BODY_TYPE_VALUE_RE.exec(text)?.[1] === 'json';
        fieldLens(
          line,
          '◆ Body type',
          'apicircle.setMockBodyTypeField',
          'Switch the body type — replaces the body subtree with a fresh starter.',
        );
      } else if (bodyTypeIsJson && CONTENT_RE.test(text)) {
        bodyTypeIsJson = false; // one body's content row
        fieldLens(
          line,
          '⟳ Format JSON',
          'apicircle.formatJson',
          'Reflow this stringified JSON body into pretty, indented JSON.',
        );
      } else if (schemaIndent !== -1 && NAME_RE.test(text)) {
        fieldLens(
          line,
          '◆ Name',
          schemaList === 'headers'
            ? 'apicircle.setMockHeaderParamNameField'
            : 'apicircle.setMockTextField',
          "Set this parameter's name.",
        );
      } else if (schemaIndent !== -1 && TYPE_HINT_RE.test(text)) {
        fieldLens(
          line,
          '◆ Type',
          'apicircle.setMockParamTypeField',
          'Pick the type hint (string / integer / boolean / uuid / …). Documentation only.',
        );
      } else if (schemaIndent !== -1 && EXAMPLE_RE.test(text)) {
        fieldLens(line, '◆ Example', 'apicircle.setMockTextField', 'Set an example value.');
      } else if (schemaIndent !== -1 && DESCRIPTION_RE.test(text)) {
        fieldLens(line, '◆ Description', 'apicircle.setMockTextField', 'Set a description.');
      } else if (headersIndent !== -1 && indent > headersIndent && HEADER_KEY_RE.test(text)) {
        fieldLens(
          line,
          '◆ Key',
          'apicircle.setMockHeaderKeyField',
          'Pick the header name from the curated catalogue or type your own.',
        );
        // Per-header enable/disable toggle — `enabled: false` headers stay in
        // the YAML for what-if testing but aren't sent.
        const headerEnabled = readHeaderEnabled(document, line);
        fieldLens(
          line,
          headerEnabled === false ? '✓ Enable' : '⊘ Disable',
          'apicircle.toggleMockHeaderEnabled',
          headerEnabled === false
            ? 'Flip enabled: false → true so this header is sent.'
            : "Flip enabled: true → false. Disabled headers stay in the YAML but aren't sent.",
        );
      } else if (headersIndent !== -1 && indent > headersIndent && HEADER_VALUE_RE.test(text)) {
        fieldLens(
          line,
          '◆ Value',
          'apicircle.setMockHeaderValueField',
          'Pick the header value — curated values for this header where we have them.',
        );
      } else if (whenIndent !== -1 && CLAUSE_SCOPE_RE.test(text)) {
        fieldLens(
          line,
          '◆ Scope',
          'apicircle.setMockClauseScopeField',
          'Pick the condition scope.',
        );
      } else if (whenIndent !== -1 && CLAUSE_OP_RE.test(text)) {
        const opMatch = CLAUSE_OP_VALUE_RE.exec(text);
        if (opMatch) currentClauseOp = opMatch[1];
        fieldLens(line, '◆ Op', 'apicircle.setMockClauseOpField', 'Pick the comparison operator.');
      } else if (whenIndent !== -1 && CLAUSE_TARGET_RE.test(text)) {
        fieldLens(
          line,
          '◆ Target',
          'apicircle.setMockClauseTargetField',
          "Pick the condition target — this endpoint's declared params for the scope, or a custom name / JSON path.",
        );
      } else if (whenIndent !== -1 && CLAUSE_VALUE_RE.test(text)) {
        // present / absent ops compare nothing — omit the value lens entirely so
        // there's no empty value picker to confuse. For other ops the picker
        // surfaces curated values (header scope) or free text.
        if (currentClauseOp !== 'present' && currentClauseOp !== 'absent') {
          fieldLens(
            line,
            '◆ Value',
            'apicircle.setMockClauseValueField',
            'Pick the value this clause compares against — curated values for header scope, or free text.',
          );
        }
      } else if (sourceIndent !== -1 && SOURCE_KIND_RE.test(text)) {
        fieldLens(
          line,
          '◆ Kind',
          'apicircle.setMockMultiplierKindField',
          'Pick where the repeat count is read from (query / path / header / body-JSON path).',
        );
      } else if (sourceIndent !== -1 && SOURCE_KEY_RE.test(text)) {
        fieldLens(
          line,
          '◆ Key',
          'apicircle.setMockMultiplierKeyField',
          'Set the source name / JSON path the count is read from.',
        );
      } else if (multiplierIndent !== -1 && TARGET_PATH_RE.test(text)) {
        fieldLens(
          line,
          '◆ Path',
          'apicircle.setMockMultiplierTargetPathField',
          'Pick the array to repeat — JSON paths discovered in the default-response body, or a custom path.',
        );
      } else if (multiplierIndent !== -1 && DEFAULT_COUNT_RE.test(text)) {
        fieldLens(
          line,
          '◆ Count',
          'apicircle.setMockNumberField',
          'Default repeat count when the source value is missing or non-numeric.',
        );
      } else if (multiplierIndent !== -1 && MIN_RE.test(text)) {
        fieldLens(
          line,
          '◆ Min',
          'apicircle.setMockNumberField',
          'Lower bound on the resolved count.',
        );
      } else if (multiplierIndent !== -1 && MAX_RE.test(text)) {
        fieldLens(
          line,
          '◆ Max',
          'apicircle.setMockNumberField',
          'Upper bound on the resolved count.',
        );
      } else if (multiplierIndent !== -1 && NAME_RE.test(text)) {
        fieldLens(
          line,
          '◆ Name',
          'apicircle.setMockTextField',
          'Optional label for this multiplier.',
        );
      }
    }
  }

  refresh(): void {
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

/**
 * Find the OUTER `enabled:` field for the rule that starts at `entryStartLine`
 * (the `- id: …` row). Returns the boolean value, or null when no outer
 * enabled field is present.
 */
function readRuleEnabled(
  document: vscode.TextDocument,
  entryStartLine: number,
  sectionEndLine: number,
): boolean | null {
  const dashIndent = document.lineAt(entryStartLine).text.match(/^\s*/)?.[0].length ?? 0;
  const targetIndent = dashIndent + 2;
  for (let line = entryStartLine + 1; line < sectionEndLine; line++) {
    const text = document.lineAt(line).text;
    if (text.trim().length === 0) continue;
    const leading = text.match(/^\s*/)?.[0].length ?? 0;
    if (leading <= dashIndent && /^\s*-\s+/.test(text)) return null;
    if (leading !== targetIndent) continue;
    const match = RULE_ENABLED_RE.exec(text);
    if (match) return match[1] === 'true';
  }
  return null;
}

/**
 * Count the `when` clauses nested under a `when:` line at `whenIndent`. A clause
 * is any `- …` dash row deeper than the `when:` key. Stops at the next sibling/
 * ancestor row. Drives the MAX_RESPONSE_RULE_CONDITIONS cap on ✚ Add condition.
 */
function countWhenClauses(
  document: vscode.TextDocument,
  whenLine: number,
  whenIndent: number,
): number {
  let count = 0;
  for (let line = whenLine + 1; line < document.lineCount; line++) {
    const text = document.lineAt(line).text;
    if (text.trim().length === 0) continue;
    const leading = text.match(/^\s*/)?.[0].length ?? 0;
    if (leading <= whenIndent) break;
    if (/^\s*-\s/.test(text)) count++;
  }
  return count;
}

/**
 * Read a header entry's `enabled:` value. `keyLine` is the entry's `- key:` row;
 * the `enabled:` field sits deeper in the same entry. Returns the boolean, or
 * null when the entry has no explicit `enabled:` (treated as enabled).
 */
function readHeaderEnabled(document: vscode.TextDocument, keyLine: number): boolean | null {
  const dashIndent = document.lineAt(keyLine).text.match(/^\s*/)?.[0].length ?? 0;
  for (let line = keyLine + 1; line < document.lineCount; line++) {
    const text = document.lineAt(line).text;
    if (text.trim().length === 0) continue;
    const leading = text.match(/^\s*/)?.[0].length ?? 0;
    if (leading <= dashIndent) break; // left this header entry
    const m = RULE_ENABLED_RE.exec(text);
    if (m) return m[1] === 'true';
  }
  return null;
}

const VALIDATION_KIND_RE = /^\s+kind\s*:\s*['"]?([A-Za-z-]+)['"]?/;
const VALIDATION_TARGET_RE = /^\s+target\s*:/;
const VALIDATION_EXPECTED_RE = /^\s+expected\s*:/;

/**
 * Within one requestValidation entry, locate the `kind:` / `target:` /
 * `expected:` rows at the entry's direct field indent (dashIndent + 2) and
 * read the kind value.
 */
function findValidationFields(
  document: vscode.TextDocument,
  entryStartLine: number,
  sectionEndLine: number,
): { kind: string; kindLine: number; targetLine: number; expectedLine: number } {
  const dashIndent = document.lineAt(entryStartLine).text.match(/^\s*/)?.[0].length ?? 0;
  const targetIndent = dashIndent + 2;
  let kind = '';
  let kindLine = -1;
  let targetLine = -1;
  let expectedLine = -1;
  for (let line = entryStartLine + 1; line < sectionEndLine; line++) {
    const text = document.lineAt(line).text;
    if (text.trim().length === 0) continue;
    const leading = text.match(/^\s*/)?.[0].length ?? 0;
    if (leading <= dashIndent && /^\s*-\s+/.test(text)) break;
    if (leading !== targetIndent) continue;
    const kindMatch = VALIDATION_KIND_RE.exec(text);
    if (kindMatch) {
      kind = kindMatch[1];
      kindLine = line;
      continue;
    }
    if (targetLine === -1 && VALIDATION_TARGET_RE.test(text)) targetLine = line;
    else if (expectedLine === -1 && VALIDATION_EXPECTED_RE.test(text)) expectedLine = line;
  }
  return { kind, kindLine, targetLine, expectedLine };
}

function lineRange(document: vscode.TextDocument, line: number): vscode.Range {
  const text = document.lineAt(line).text;
  return new vscode.Range(line, 0, line, text.length);
}

/**
 * Index of the next top-level array entry (a `- id:` row at outer indent ≤ 4)
 * at or after `from`, bounded by `limit`. Used to scope one response-rule entry
 * so its `headers:` lens lands inside the right rule.
 */
function nextArrayEntryLine(document: vscode.TextDocument, from: number, limit: number): number {
  for (let line = from; line < limit; line++) {
    const text = document.lineAt(line).text;
    if ((text.match(/^\s*/)?.[0].length ?? 0) > 4) continue;
    if (ARRAY_ENTRY_ID_RE.test(text)) return line;
  }
  return limit;
}

/** Find the line index of the next top-level YAML key at or after `from`. */
function nextTopLevelLine(document: vscode.TextDocument, from: number): number {
  for (let line = from; line < document.lineCount; line++) {
    if (/^[A-Za-z]/.test(document.lineAt(line).text)) return line;
  }
  return document.lineCount;
}
