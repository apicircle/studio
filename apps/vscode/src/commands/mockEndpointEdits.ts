import * as vscode from 'vscode';
import { generateId } from '@apicircle/shared';
import type {
  MockRequestSchema,
  MockResponseBodyType,
  MockResponseConfig,
  MockResponseMultiplier,
  MockResponseRule,
  MockValidationKind,
  MockValidationRule,
} from '@apicircle/shared';
import { makeDefaultMockResponseBody, MAX_RESPONSE_MULTIPLIERS } from '@apicircle/shared';
import { parseEndpointFromYaml, EndpointYamlParseError } from '../fs/endpointYaml';
import { uriEntityKind } from '../fs/uriKind';
import {
  VALIDATION_KINDS,
  applyValidationKindChange,
  expectedValueCatalogue,
  validationKindDef,
  validationKindNeeds,
  validationTargetCandidates,
} from '../lang/mockValidationKinds';

// =============================================================================
// Mock endpoint edit commands — rewritten to drive the per-endpoint YAML file
// directly. Each command opens the endpoint YAML (if not already focused),
// edits the in-memory text via WorkspaceEdit, and then saves the document so
// the FS provider parses the result and applies `mock.upsert`.
//
// This is the same UX as the request YAML editing — the user sees the change
// land immediately as new YAML in their editor (instead of a hidden state
// mutation behind a quick-pick).
// =============================================================================

// Match section headers with OR without an inline `[]` empty-list suffix —
// the projection emits empty arrays inline, so the regex needs to fire on
// both shapes for the lens-driven "add first rule" path.
const DEFAULT_RESPONSE_RE = /^defaultResponse\s*:/;
const RESPONSE_RULES_RE = /^responseRules\s*:/;
const REQUEST_VALIDATION_RE = /^requestValidation\s*:/;
const MULTIPLIERS_RE = /^\s+multipliers\s*:/;
const TOP_LEVEL_KEY_RE = /^[A-Za-z]/;
const ARRAY_ENTRY_ID_RE = /^\s+-\s+id:\s*['"]?([A-Za-z0-9_-]+)['"]?/;

async function ensureEndpointDocument(uri?: vscode.Uri): Promise<vscode.TextDocument | null> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    await vscode.window.showWarningMessage('No endpoint YAML is active.');
    return null;
  }
  if (targetUri.scheme !== 'apicircle' || uriEntityKind(targetUri) !== 'endpoint') {
    await vscode.window.showWarningMessage(
      'This command only runs against an APICircle endpoint YAML.',
    );
    return null;
  }
  return vscode.workspace.openTextDocument(targetUri);
}

/** Locate the line range of a top-level section. End is exclusive at the next
 *  top-level key (or EOF). Returns null when the section is absent. */
function findTopLevelSection(
  document: vscode.TextDocument,
  test: RegExp,
): { headerLine: number; endLine: number } | null {
  let headerLine = -1;
  for (let line = 0; line < document.lineCount; line++) {
    if (test.test(document.lineAt(line).text)) {
      headerLine = line;
      break;
    }
  }
  if (headerLine === -1) return null;
  let endLine = document.lineCount;
  for (let line = headerLine + 1; line < document.lineCount; line++) {
    if (TOP_LEVEL_KEY_RE.test(document.lineAt(line).text)) {
      endLine = line;
      break;
    }
  }
  return { headerLine, endLine };
}

/** Save the document so the FS provider's writeFile fires applyMutation. We
 *  await the save explicitly — VS Code's `applyEdit` only writes to the
 *  in-memory TextDocument; `document.save()` is what kicks the FS writer. */
async function commitSave(document: vscode.TextDocument): Promise<void> {
  // Validate the parser accepts the new shape BEFORE saving so we can surface
  // a clean error toast instead of a NoPermissions failure from VS Code.
  try {
    parseEndpointFromYaml(document.getText());
  } catch (e) {
    if (e instanceof EndpointYamlParseError) {
      await vscode.window.showErrorMessage(
        `Endpoint YAML would not parse — leaving unsaved so you can fix it. ${e.message}`,
      );
      return;
    }
    throw e;
  }
  await document.save();
}

async function applyAndSave(
  document: vscode.TextDocument,
  edit: vscode.WorkspaceEdit,
): Promise<boolean> {
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) {
    await vscode.window.showErrorMessage('Failed to edit the endpoint YAML.');
    return false;
  }
  await commitSave(document);
  return true;
}

// ---------------------------------------------------------------------------
// Add validation rule
// ---------------------------------------------------------------------------

/** Seed a fresh validation rule. We intentionally do NOT prompt for kind /
 *  target / expected up front — the rule lands in the editor with sensible
 *  prefills and the user refines it through the per-field ◆ Kind / ◆ Target /
 *  ◆ Value CodeLenses (see endpointCodeLens.ts). This mirrors the rest of the
 *  endpoint-edit UX: the change shows up immediately as new YAML. */
function makeDefaultValidationRule(): MockValidationRule {
  const def = validationKindDef('header-required');
  return {
    id: generateId(),
    kind: 'header-required',
    target: def?.defaultTarget ?? 'X-Api-Key',
    enabled: true,
    failResponse: {
      status: 400,
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      body: { type: 'json', content: '{"error":"validation_failed"}' },
    },
  };
}

export async function addMockValidationRuleCommand(uri?: vscode.Uri): Promise<void> {
  const document = await ensureEndpointDocument(uri);
  if (!document) return;

  const rule = makeDefaultValidationRule();
  const block = renderValidationRule(rule);
  const refreshed = await vscode.workspace.openTextDocument(document.uri);
  const editor = await vscode.window.showTextDocument(refreshed);
  const edit = new vscode.WorkspaceEdit();
  insertIntoSection(refreshed, edit, REQUEST_VALIDATION_RE, 'requestValidation', block);
  const ok = await applyAndSave(refreshed, edit);
  if (!ok) return;
  // Reveal the new rule's kind row so the ◆ Kind / ◆ Target lenses are in view.
  await revealValidationField(editor, refreshed.uri, rule.id, 'kind');
}

// ---------------------------------------------------------------------------
// Per-field validation editors — driven by the ◆ Kind / ◆ Target / ◆ Value
// CodeLenses on each requestValidation entry. Each parses the endpoint, mutates
// the single targeted rule, and re-renders that entry losslessly via
// renderValidationRule (failResponse and every other field round-trip through
// the parser unchanged).
// ---------------------------------------------------------------------------

interface LoadedValidationRule {
  document: vscode.TextDocument;
  schema: MockRequestSchema;
  rule: MockValidationRule;
}

/** Parse the endpoint and locate one validation rule by id. Surfaces a clean
 *  toast (instead of throwing) when the YAML won't parse or the id is gone. */
async function loadValidationRule(
  uri: vscode.Uri | undefined,
  ruleId: string | undefined,
): Promise<LoadedValidationRule | null> {
  const document = await ensureEndpointDocument(uri);
  if (!document) return null;
  if (!ruleId) {
    await vscode.window.showWarningMessage('No validation rule id supplied.');
    return null;
  }
  const refreshed = await vscode.workspace.openTextDocument(document.uri);
  let parsed;
  try {
    parsed = parseEndpointFromYaml(refreshed.getText());
  } catch (e) {
    if (e instanceof EndpointYamlParseError) {
      await vscode.window.showErrorMessage(
        `Endpoint YAML won't parse — fix it before editing the rule. ${e.message}`,
      );
      return null;
    }
    throw e;
  }
  const rule = parsed.endpoint.requestValidation.find((r) => r.id === ruleId);
  if (!rule) {
    await vscode.window.showErrorMessage(`Validation rule "${ruleId}" not found.`);
    return null;
  }
  return { document: refreshed, schema: parsed.endpoint.requestSchema, rule };
}

/** Replace one validation rule's YAML block with a freshly rendered version,
 *  save, and reveal the requested field. */
async function commitValidationRule(
  document: vscode.TextDocument,
  rule: MockValidationRule,
  reveal: 'kind' | 'target' | 'expected',
): Promise<void> {
  const section = findTopLevelSection(document, REQUEST_VALIDATION_RE);
  if (!section) {
    await vscode.window.showErrorMessage('requestValidation: section not found.');
    return;
  }
  const range = findArrayEntryRange(document, section.headerLine + 1, section.endLine, rule.id);
  if (!range) {
    await vscode.window.showErrorMessage(`Validation rule "${rule.id}" not found.`);
    return;
  }
  const editor = await vscode.window.showTextDocument(document);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, range, renderValidationRule(rule));
  const ok = await applyAndSave(document, edit);
  if (!ok) return;
  await revealValidationField(editor, document.uri, rule.id, reveal);
}

const CUSTOM_PICK = '__custom__';

export async function setMockValidationKindCommand(
  uri?: vscode.Uri,
  ruleId?: string,
): Promise<void> {
  const loaded = await loadValidationRule(uri, ruleId);
  if (!loaded) return;
  type KindPick = vscode.QuickPickItem & { value: MockValidationKind };
  const items: KindPick[] = VALIDATION_KINDS.map((k) => ({
    label: k.kind === loaded.rule.kind ? `$(check) ${k.label}` : k.label,
    description: k.description,
    value: k.kind,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Validation rule kind',
    placeHolder: 'Pick the pre-request gate kind — target / value rows adapt to match.',
  });
  if (!picked) return;
  const next = applyValidationKindChange(loaded.rule, picked.value);
  // Land the user on the row most likely to need attention next: the target
  // (if the new kind has one), else the value, else the kind row.
  const needs = validationKindNeeds(picked.value);
  const reveal = needs.target ? 'target' : needs.expected ? 'expected' : 'kind';
  await commitValidationRule(loaded.document, next, reveal);
}

export async function setMockValidationTargetCommand(
  uri?: vscode.Uri,
  ruleId?: string,
): Promise<void> {
  const loaded = await loadValidationRule(uri, ruleId);
  if (!loaded) return;
  const { rule, schema } = loaded;
  if (!validationKindNeeds(rule.kind).target) {
    await vscode.window.showInformationMessage(`The "${rule.kind}" kind has no target to set.`);
    return;
  }

  type TargetPick = vscode.QuickPickItem & { value: string };
  const items: TargetPick[] = validationTargetCandidates(rule.kind, schema).map((c) => ({
    label: c.name,
    description: c.description,
    value: c.name,
  }));
  items.push({ label: '✏ Custom…', description: 'Type any name.', value: CUSTOM_PICK });

  const picked = await vscode.window.showQuickPick(items, {
    title: `Target for ${rule.kind}`,
    placeHolder: 'Pick a name or type a custom one.',
    matchOnDescription: true,
  });
  if (!picked) return;
  let target = picked.value;
  if (target === CUSTOM_PICK) {
    const typed = await vscode.window.showInputBox({
      prompt: 'Target name',
      value: rule.target,
      validateInput: (v) => (v.trim().length === 0 ? 'Required.' : null),
    });
    if (typed === undefined) return;
    target = typed.trim();
  }
  await commitValidationRule(loaded.document, { ...rule, target }, 'target');
}

export async function setMockValidationExpectedCommand(
  uri?: vscode.Uri,
  ruleId?: string,
): Promise<void> {
  const loaded = await loadValidationRule(uri, ruleId);
  if (!loaded) return;
  const { rule } = loaded;
  if (!validationKindNeeds(rule.kind).expected) {
    await vscode.window.showInformationMessage(`The "${rule.kind}" kind compares no value.`);
    return;
  }

  // Regex kinds have no fixed catalogue — collect a pattern free-form.
  if (rule.kind === 'header-matches' || rule.kind === 'query-matches') {
    const typed = await vscode.window.showInputBox({
      title: `Expected regex for ${rule.target || rule.kind}`,
      prompt: 'Regular expression the value must match.',
      value: rule.expected ?? '',
      placeHolder: 'e.g. ^Bearer\\s.+$',
      validateInput: (v) => {
        try {
          RegExp(v);
          return null;
        } catch (e) {
          return `Invalid regex: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });
    if (typed === undefined) return;
    await commitValidationRule(loaded.document, { ...rule, expected: typed }, 'expected');
    return;
  }

  // content-type-equals → the Content-Type catalogue; header-equals →
  // the picked header's curated values; query-equals has no catalogue.
  const catalogue = expectedValueCatalogue(rule.kind, rule.target);

  let expected: string | undefined;
  if (catalogue.length > 0) {
    type ValuePick = vscode.QuickPickItem & { value: string };
    const items: ValuePick[] = catalogue.map((v) => ({ label: v, value: v }));
    items.push({ label: '✏ Custom…', description: 'Type any value.', value: CUSTOM_PICK });
    const picked = await vscode.window.showQuickPick(items, {
      title: `Expected value for ${rule.target || rule.kind}`,
      placeHolder: 'Pick a curated value or type your own.',
    });
    if (!picked) return;
    expected =
      picked.value === CUSTOM_PICK
        ? await vscode.window.showInputBox({
            prompt: 'Expected value',
            value: rule.expected ?? '',
          })
        : picked.value;
  } else {
    expected = await vscode.window.showInputBox({
      title: `Expected value for ${rule.target || rule.kind}`,
      prompt: 'Value the request must send.',
      value: rule.expected ?? '',
    });
  }
  if (expected === undefined) return;
  await commitValidationRule(loaded.document, { ...rule, expected }, 'expected');
}

/** Reveal a validation rule's `kind:` / `target:` / `expected:` row after a
 *  save. Re-reads the (possibly re-projected) document and scans the entry by
 *  id. No-op when the row can't be found. */
async function revealValidationField(
  editor: vscode.TextEditor,
  uri: vscode.Uri,
  ruleId: string,
  field: 'kind' | 'target' | 'expected',
): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const section = findTopLevelSection(document, REQUEST_VALIDATION_RE);
  if (!section) return;
  const range = findArrayEntryRange(document, section.headerLine + 1, section.endLine, ruleId);
  if (!range) return;
  const fieldRe = new RegExp(`^\\s+${field}\\s*:`);
  for (let line = range.start.line; line < range.end.line; line++) {
    if (fieldRe.test(document.lineAt(line).text)) {
      const position = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter,
      );
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Add response rule
// ---------------------------------------------------------------------------

export async function addMockResponseRuleCommand(uri?: vscode.Uri): Promise<void> {
  const document = await ensureEndpointDocument(uri);
  if (!document) return;

  const name = await vscode.window.showInputBox({
    title: 'Response rule',
    prompt: 'Rule name',
    placeHolder: 'e.g. Page 1 — small list',
    validateInput: (v) => (v.trim().length === 0 ? 'Required.' : null),
  });
  if (!name) return;

  type ScopePick = vscode.QuickPickItem & {
    value: 'query' | 'pathParam' | 'header' | 'cookie' | 'body-json-path';
  };
  const scopePick = await vscode.window.showQuickPick<ScopePick>(
    [
      { label: 'Query param', value: 'query' },
      { label: 'Path param', value: 'pathParam' },
      { label: 'Header', value: 'header' },
      { label: 'Cookie', value: 'cookie' },
      { label: 'Body JSON path', value: 'body-json-path' },
    ],
    { title: 'Condition scope' },
  );
  if (!scopePick) return;

  const target = await vscode.window.showInputBox({
    prompt: 'Target name or JSON path',
    validateInput: (v) => (v.trim().length === 0 ? 'Required.' : null),
  });
  if (target === undefined) return;

  type OpPick = vscode.QuickPickItem & {
    value: 'equals' | 'not-equals' | 'matches' | 'gt' | 'lt' | 'gte' | 'lte' | 'present' | 'absent';
  };
  const opPick = await vscode.window.showQuickPick<OpPick>(
    [
      { label: 'equals', value: 'equals' },
      { label: 'not-equals', value: 'not-equals' },
      { label: 'matches (regex)', value: 'matches' },
      { label: '>', value: 'gt' },
      { label: '<', value: 'lt' },
      { label: '>=', value: 'gte' },
      { label: '<=', value: 'lte' },
      { label: 'present', value: 'present' },
      { label: 'absent', value: 'absent' },
    ],
    { title: 'Comparison op' },
  );
  if (!opPick) return;

  let value: string | undefined;
  if (opPick.value !== 'present' && opPick.value !== 'absent') {
    const typed = await vscode.window.showInputBox({ prompt: 'Comparison value' });
    if (typed === undefined) return;
    value = typed;
  }

  const statusRaw = await vscode.window.showInputBox({
    title: 'Response status when the rule matches',
    value: '200',
    validateInput: (v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 100 || n > 599) return 'Must be an integer 100-599.';
      return null;
    },
  });
  if (statusRaw === undefined) return;
  const status = Number(statusRaw);

  const bodyTypePick = await vscode.window.showQuickPick(
    BODY_TYPE_PICKS.map((b) => ({ label: b.label, value: b.value })),
    { title: 'Response body type when the rule matches' },
  );
  if (!bodyTypePick) return;

  const rule: MockResponseRule = {
    id: generateId(),
    name: name.trim(),
    enabled: true,
    when: [
      {
        id: generateId(),
        scope: scopePick.value,
        target: target.trim(),
        op: opPick.value,
        value,
      },
    ],
    response: {
      status,
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      body: makeDefaultMockResponseBody(bodyTypePick.value),
    },
  };
  const block = renderResponseRule(rule);
  const refreshed = await vscode.workspace.openTextDocument(document.uri);
  const editor = await vscode.window.showTextDocument(refreshed);
  const edit = new vscode.WorkspaceEdit();
  insertIntoSection(refreshed, edit, RESPONSE_RULES_RE, 'responseRules', block);
  const ok = await applyAndSave(refreshed, edit);
  if (!ok) return;
  await flashAt(editor, RESPONSE_RULES_RE, refreshed.uri);
}

// ---------------------------------------------------------------------------
// Add multiplier
// ---------------------------------------------------------------------------

/** Append a sample multiplier to defaultResponse.multipliers with no prompts —
 *  the user refines kind / key / target / count through the per-field
 *  ◆ lenses. The list is capped at MAX_RESPONSE_MULTIPLIERS for now; bail with
 *  a hint at the cap. */
export async function addMockMultiplierCommand(uri?: vscode.Uri): Promise<void> {
  const document = await ensureEndpointDocument(uri);
  if (!document) return;
  const refreshed = await vscode.workspace.openTextDocument(document.uri);

  const defaultResponseSection = findTopLevelSection(refreshed, DEFAULT_RESPONSE_RE);
  if (!defaultResponseSection) {
    await vscode.window.showErrorMessage('defaultResponse: section not found in endpoint YAML.');
    return;
  }
  let multipliersLine = -1;
  for (
    let line = defaultResponseSection.headerLine + 1;
    line < defaultResponseSection.endLine;
    line++
  ) {
    if (MULTIPLIERS_RE.test(refreshed.lineAt(line).text)) {
      multipliersLine = line;
      break;
    }
  }
  // Enforce the cap: count existing `- id:` entries in the multipliers block.
  if (multipliersLine !== -1) {
    let count = 0;
    for (let line = multipliersLine + 1; line < defaultResponseSection.endLine; line++) {
      const text = refreshed.lineAt(line).text;
      const leading = text.match(/^\s*/)?.[0].length ?? 0;
      if (text.trim().length > 0 && leading <= 2) break; // left the block
      if (/^\s+-\s+id:/.test(text)) count++;
    }
    if (count >= MAX_RESPONSE_MULTIPLIERS) {
      await vscode.window.showInformationMessage(
        `This response is at the multiplier limit (${MAX_RESPONSE_MULTIPLIERS}). Multiple multipliers are coming soon — edit the existing one with the ◆ lenses or remove it first.`,
      );
      return;
    }
  }

  const multiplier: MockResponseMultiplier = {
    id: generateId(),
    source: { kind: 'query', key: 'pageSize' },
    targetJsonPath: '$.items',
    defaultCount: 10,
  };
  const block = renderMultiplier(multiplier);
  const editor = await vscode.window.showTextDocument(refreshed);
  const edit = new vscode.WorkspaceEdit();

  if (multipliersLine === -1) {
    // multipliers: absent — append the list at the end of defaultResponse.
    edit.insert(
      refreshed.uri,
      new vscode.Position(defaultResponseSection.endLine, 0),
      `  multipliers:\n${indentBlock(block, 4)}`,
    );
  } else if (/:\s*\[\s*\]/.test(refreshed.lineAt(multipliersLine).text)) {
    // Inline-empty `multipliers: []` → block form with the first entry.
    edit.replace(
      refreshed.uri,
      refreshed.lineAt(multipliersLine).range,
      `  multipliers:\n${indentBlock(block, 4).replace(/\n$/, '')}`,
    );
  } else {
    // Append after the last line of the existing multipliers block.
    let end = defaultResponseSection.endLine;
    for (let line = multipliersLine + 1; line < defaultResponseSection.endLine; line++) {
      const text = refreshed.lineAt(line).text;
      const leading = text.match(/^\s*/)?.[0].length ?? 0;
      if (text.trim().length > 0 && leading <= 2) {
        end = line;
        break;
      }
    }
    edit.insert(refreshed.uri, new vscode.Position(end, 0), indentBlock(block, 4));
  }
  const ok = await applyAndSave(refreshed, edit);
  if (!ok) return;
  await flashAt(editor, MULTIPLIERS_RE, refreshed.uri);
}

// ---------------------------------------------------------------------------
// Switch response body type (defaultResponse OR a named response rule)
// ---------------------------------------------------------------------------

const BODY_TYPE_PICKS: ReadonlyArray<{ label: string; value: MockResponseBodyType }> = [
  { label: '$(circle-slash) None', value: 'none' },
  { label: '$(json) JSON', value: 'json' },
  { label: '$(symbol-text) Text', value: 'text' },
  { label: '$(symbol-misc) XML', value: 'xml' },
  { label: '$(symbol-string) URL-encoded', value: 'urlencoded' },
  { label: '$(list-tree) Form Data', value: 'form-data' },
  { label: '$(file-binary) Binary', value: 'binary' },
];

export async function switchMockResponseBodyTypeCommand(
  uri?: vscode.Uri,
  ruleId?: string,
): Promise<void> {
  const document = await ensureEndpointDocument(uri);
  if (!document) return;
  const pick = await vscode.window.showQuickPick(
    BODY_TYPE_PICKS.map((b) => ({ label: b.label, value: b.value })),
    {
      title: ruleId ? `Response body for rule "${ruleId}"` : 'Default response body type',
    },
  );
  if (!pick) return;
  const body = makeDefaultMockResponseBody(pick.value);
  const refreshed = await vscode.workspace.openTextDocument(document.uri);
  const editor = await vscode.window.showTextDocument(refreshed);
  const bodyRange = ruleId
    ? findResponseBodyRangeForRule(refreshed, ruleId)
    : findResponseBodyRangeForDefault(refreshed);
  if (!bodyRange) {
    await vscode.window.showErrorMessage(
      ruleId
        ? `Could not locate response.body for rule "${ruleId}".`
        : 'Could not locate defaultResponse.body block.',
    );
    return;
  }
  // Indentation is derived from the actual `body:` line so nesting depth is
  // never assumed (defaultResponse.body sits at indent 2, a rule's
  // response.body at 6 — the old hardcoded `ruleId ? 6 : 4` was wrong for
  // the default case).
  const bodyIndent = leadingSpaces(refreshed.lineAt(bodyRange.start.line).text);
  const block = renderResponseBody(body, bodyIndent);
  // Also reconcile the Content-Type header in the SAME response config so the
  // headers list isn't left advertising a media type the body no longer uses.
  // For type=none we strip the row outright; for every other type we update
  // (or insert) the matching media type. Other headers are preserved verbatim.
  const headersRange = ruleId
    ? findResponseHeadersRangeForRule(refreshed, ruleId)
    : findResponseHeadersRangeForDefault(refreshed);
  const headersIndent =
    headersRange !== null ? leadingSpaces(refreshed.lineAt(headersRange.start.line).text) : 0;
  const newHeadersBlock =
    headersRange !== null
      ? reconcileContentType(refreshed, headersRange, pick.value, headersIndent)
      : null;

  const edit = new vscode.WorkspaceEdit();
  edit.replace(refreshed.uri, bodyRange, block);
  if (headersRange && newHeadersBlock !== null) {
    edit.replace(refreshed.uri, headersRange, newHeadersBlock);
  }
  const ok = await applyAndSave(refreshed, edit);
  if (!ok) return;
  editor.selection = new vscode.Selection(bodyRange.start, bodyRange.start);
  editor.revealRange(bodyRange, vscode.TextEditorRevealType.InCenter);
}

const BODY_TYPE_TO_CONTENT_TYPE: Record<MockResponseBodyType, string | null> = {
  none: null,
  json: 'application/json',
  text: 'text/plain',
  xml: 'application/xml',
  urlencoded: 'application/x-www-form-urlencoded',
  'form-data': 'multipart/form-data',
  binary: 'application/octet-stream',
};

const HEADER_KEY_RE = /^\s+-\s+key:\s*['"]?([^'"\n]+?)['"]?\s*$/;
const HEADER_VALUE_RE = /^(\s+)value:\s*.*$/;

/**
 * Rebuild the response.headers: block so its Content-Type row matches the
 * new body type. We mutate in-place line-by-line — preserving every other
 * header row verbatim — instead of re-emitting the whole list, because the
 * user may have hand-formatted comments / quoting on other rows.
 *
 * Returns the replacement text including the trailing newline, or null if
 * no edit is required (already up to date).
 */
export function reconcileContentType(
  document: vscode.TextDocument,
  headersRange: vscode.Range,
  newBodyType: MockResponseBodyType,
  parentIndent: number,
): string | null {
  const desired = BODY_TYPE_TO_CONTENT_TYPE[newBodyType];
  const lines: string[] = [];
  let contentTypeRowStart = -1;
  let contentTypeRowEnd = -1;
  for (let line = headersRange.start.line; line < headersRange.end.line; line++) {
    lines.push(document.lineAt(line).text);
  }
  const inlineEmptyHeaders = /:\s*\[\s*\]/.test(lines[0] ?? '');

  for (let i = 0; i < lines.length; i++) {
    const keyMatch = HEADER_KEY_RE.exec(lines[i]);
    if (!keyMatch) continue;
    if (keyMatch[1].toLowerCase() !== 'content-type') continue;
    contentTypeRowStart = i;
    // Row runs until the next `- key:` dash at the same indent or section end.
    const dashIndent = lines[i].match(/^\s*/)?.[0].length ?? 0;
    contentTypeRowEnd = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const leading = lines[j].match(/^\s*/)?.[0].length ?? 0;
      if (lines[j].trim().length === 0) continue;
      if (leading <= dashIndent) {
        contentTypeRowEnd = j;
        break;
      }
    }
    break;
  }

  if (desired === null) {
    // Removing Content-Type. If row absent, no-op.
    if (contentTypeRowStart === -1) return null;
    const before = lines.slice(0, contentTypeRowStart);
    const after = lines.slice(contentTypeRowEnd);
    const result = [...before, ...after];
    // If the result collapses to just the `headers:` header with no rows,
    // emit the inline-empty form so the YAML reads cleanly.
    if (result.length === 1) {
      const indent = ' '.repeat(parentIndent);
      return `${indent}headers: []\n`;
    }
    return result.join('\n') + '\n';
  }

  // Updating or inserting Content-Type.
  if (contentTypeRowStart !== -1) {
    // Update the existing value row in place.
    let updated = false;
    for (let j = contentTypeRowStart + 1; j < contentTypeRowEnd; j++) {
      const vMatch = HEADER_VALUE_RE.exec(lines[j]);
      if (!vMatch) continue;
      lines[j] = `${vMatch[1]}value: ${yamlStringLocal(desired)}`;
      updated = true;
      break;
    }
    if (!updated) {
      // Pathological — keep the result intact rather than corrupting the row.
      return null;
    }
    return lines.join('\n') + '\n';
  }

  // Insert a new Content-Type row at the top of the list.
  const dashIndent = ' '.repeat(parentIndent + 2);
  const childIndent = ' '.repeat(parentIndent + 4);
  if (inlineEmptyHeaders) {
    // Convert `headers: []` to block form + insert the row.
    const headerIndent = ' '.repeat(parentIndent);
    return (
      `${headerIndent}headers:\n` +
      `${dashIndent}- key: 'Content-Type'\n` +
      `${childIndent}value: ${yamlStringLocal(desired)}\n` +
      `${childIndent}enabled: true\n`
    );
  }
  const headerLine = lines[0];
  const tail = lines.slice(1);
  return (
    `${headerLine}\n` +
    `${dashIndent}- key: 'Content-Type'\n` +
    `${childIndent}value: ${yamlStringLocal(desired)}\n` +
    `${childIndent}enabled: true\n` +
    (tail.length > 0 ? tail.join('\n') + '\n' : '')
  );
}

function yamlStringLocal(value: string): string {
  if (/[:#&*!|>'"%@`]|^[\s-]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, "''")}'`;
}

function findResponseHeadersRangeForDefault(document: vscode.TextDocument): vscode.Range | null {
  const section = findTopLevelSection(document, DEFAULT_RESPONSE_RE);
  if (!section) return null;
  return findIndentedKeyRange(document, section.headerLine + 1, section.endLine, /^\s+headers\s*:/);
}

function findResponseHeadersRangeForRule(
  document: vscode.TextDocument,
  ruleId: string,
): vscode.Range | null {
  const section = findTopLevelSection(document, RESPONSE_RULES_RE);
  if (!section) return null;
  const ruleRange = findArrayEntryRange(document, section.headerLine + 1, section.endLine, ruleId);
  if (!ruleRange) return null;
  return findIndentedKeyRange(
    document,
    ruleRange.start.line + 1,
    ruleRange.end.line,
    /^\s+headers\s*:/,
  );
}

// ---------------------------------------------------------------------------
// Set response status
// ---------------------------------------------------------------------------

export async function setMockResponseStatusCommand(
  uri?: vscode.Uri,
  ruleId?: string,
): Promise<void> {
  const document = await ensureEndpointDocument(uri);
  if (!document) return;
  const refreshed = await vscode.workspace.openTextDocument(document.uri);
  const statusLine = ruleId
    ? findStatusLineForRule(refreshed, ruleId)
    : findStatusLineForDefault(refreshed);
  if (statusLine === null) {
    await vscode.window.showErrorMessage(
      ruleId
        ? `Could not locate status: under responseRules entry "${ruleId}".`
        : 'Could not locate defaultResponse.status.',
    );
    return;
  }
  const currentText = refreshed.lineAt(statusLine.line).text;
  const currentValue = /:\s*([0-9]+)/.exec(currentText)?.[1] ?? '200';
  const raw = await vscode.window.showInputBox({
    title: ruleId ? `Status for rule "${ruleId}"` : 'Default response status',
    value: currentValue,
    validateInput: (v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 100 || n > 599) return 'Must be an integer 100-599.';
      return null;
    },
  });
  if (raw === undefined) return;
  const editor = await vscode.window.showTextDocument(refreshed);
  const indent = currentText.match(/^\s*/)?.[0] ?? '';
  const replacement = `${indent}status: ${Number(raw)}`;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(refreshed.uri, refreshed.lineAt(statusLine.line).range, replacement);
  const ok = await applyAndSave(refreshed, edit);
  if (!ok) return;
  const pos = new vscode.Position(statusLine.line, indent.length);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(refreshed.lineAt(statusLine.line).range, vscode.TextEditorRevealType.InCenter);
}

// ---------------------------------------------------------------------------
// Toggle rule enabled
// ---------------------------------------------------------------------------

export async function toggleMockRuleEnabledCommand(
  uri?: vscode.Uri,
  kind?: 'response' | 'validation',
  ruleId?: string,
): Promise<void> {
  const document = await ensureEndpointDocument(uri);
  if (!document) return;
  if (!ruleId || !kind) {
    await vscode.window.showWarningMessage('Missing rule id or kind.');
    return;
  }
  const refreshed = await vscode.workspace.openTextDocument(document.uri);
  const sectionRe = kind === 'response' ? RESPONSE_RULES_RE : REQUEST_VALIDATION_RE;
  const section = findTopLevelSection(refreshed, sectionRe);
  if (!section) {
    await vscode.window.showErrorMessage('Section not found.');
    return;
  }
  const ruleRange = findArrayEntryRange(refreshed, section.headerLine + 1, section.endLine, ruleId);
  if (!ruleRange) {
    await vscode.window.showErrorMessage(`Rule "${ruleId}" not found.`);
    return;
  }
  // Scan the rule block for the OUTER `enabled:` field. Inner enabled (e.g.
  // on headers / failResponse.headers) sits two levels deeper, so guard by
  // the dash indent.
  const dashIndent = refreshed.lineAt(ruleRange.start.line).text.match(/^\s*/)?.[0].length ?? 0;
  const targetIndent = dashIndent + 2;
  let enabledLine = -1;
  let currentValue: boolean | null = null;
  for (let line = ruleRange.start.line + 1; line < ruleRange.end.line; line++) {
    const text = refreshed.lineAt(line).text;
    const leading = text.match(/^\s*/)?.[0].length ?? 0;
    if (leading !== targetIndent) continue;
    const match = /^\s+enabled\s*:\s*(true|false)\b/.exec(text);
    if (!match) continue;
    enabledLine = line;
    currentValue = match[1] === 'true';
    break;
  }
  if (enabledLine === -1 || currentValue === null) {
    await vscode.window.showWarningMessage(
      `Could not find an outer enabled: field on rule "${ruleId}".`,
    );
    return;
  }
  const editor = await vscode.window.showTextDocument(refreshed);
  const indent = refreshed.lineAt(enabledLine).text.match(/^\s*/)?.[0] ?? '';
  const replacement = `${indent}enabled: ${!currentValue}`;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(refreshed.uri, refreshed.lineAt(enabledLine).range, replacement);
  const ok = await applyAndSave(refreshed, edit);
  if (!ok) return;
  const pos = new vscode.Position(enabledLine, indent.length);
  editor.selection = new vscode.Selection(pos, pos);
}

// ---------------------------------------------------------------------------
// Add response header (defaultResponse or a rule)
// ---------------------------------------------------------------------------

// Curated catalogue — small subset of headers a mock response typically
// surfaces. Kept tight on purpose. Anything else uses "Custom…".
const RESPONSE_HEADER_PRESETS: ReadonlyArray<{ name: string; values: string[] }> = [
  {
    name: 'Content-Type',
    values: [
      'application/json',
      'application/xml',
      'text/plain',
      'text/html',
      'application/octet-stream',
    ],
  },
  {
    name: 'Cache-Control',
    values: ['no-cache', 'no-store', 'public, max-age=3600', 'private, max-age=0'],
  },
  {
    name: 'ETag',
    values: ['"{{etag}}"'],
  },
  {
    name: 'Location',
    values: ['/resource/{{id}}'],
  },
  {
    name: 'X-RateLimit-Remaining',
    values: ['100'],
  },
  {
    name: 'X-Request-Id',
    values: ['{{uuid}}'],
  },
  {
    name: 'Access-Control-Allow-Origin',
    values: ['*', '{{base_url}}'],
  },
  {
    name: 'Set-Cookie',
    values: ['session={{token}}; Path=/; HttpOnly'],
  },
];

const CUSTOM_HEADER_PICK = '__custom__';

export async function addMockResponseHeaderCommand(
  uri?: vscode.Uri,
  ruleId?: string,
): Promise<void> {
  const document = await ensureEndpointDocument(uri);
  if (!document) return;
  type NamePick = vscode.QuickPickItem & { value: string };
  const nameItems: NamePick[] = RESPONSE_HEADER_PRESETS.map((h) => ({
    label: h.name,
    value: h.name,
  }));
  nameItems.push({
    label: '✏ Custom header name…',
    description: 'Type any header name.',
    value: CUSTOM_HEADER_PICK,
  });
  const pickedName = await vscode.window.showQuickPick(nameItems, {
    title: ruleId ? `Header for rule "${ruleId}"` : 'Default response header',
    placeHolder: 'Pick a common header or type your own.',
  });
  if (!pickedName) return;

  let headerName = pickedName.value;
  if (headerName === CUSTOM_HEADER_PICK) {
    const typed = await vscode.window.showInputBox({
      prompt: 'Header name',
      validateInput: (v) =>
        v.trim().length === 0
          ? 'Required.'
          : /\s/.test(v)
            ? 'No whitespace in header names.'
            : null,
    });
    if (!typed) return;
    headerName = typed.trim();
  }

  const preset = RESPONSE_HEADER_PRESETS.find((h) => h.name === headerName);
  let headerValue: string | undefined;
  if (preset && preset.values.length > 0) {
    type ValuePick = vscode.QuickPickItem & { value: string };
    const valueItems: ValuePick[] = preset.values.map((v) => ({ label: v, value: v }));
    valueItems.push({
      label: '✏ Custom value…',
      value: CUSTOM_HEADER_PICK,
    });
    const pickedValue = await vscode.window.showQuickPick(valueItems, {
      title: `Value for ${headerName}`,
    });
    if (!pickedValue) return;
    headerValue =
      pickedValue.value === CUSTOM_HEADER_PICK
        ? await vscode.window.showInputBox({ prompt: `Value for ${headerName}` })
        : pickedValue.value;
  } else {
    headerValue = await vscode.window.showInputBox({ prompt: `Value for ${headerName}` });
  }
  if (headerValue === undefined) return;

  const refreshed = await vscode.workspace.openTextDocument(document.uri);
  const editor = await vscode.window.showTextDocument(refreshed);
  const headersRange = ruleId
    ? findResponseHeadersRangeForRule(refreshed, ruleId)
    : findResponseHeadersRangeForDefault(refreshed);
  if (!headersRange) {
    await vscode.window.showErrorMessage(
      ruleId
        ? `Could not locate headers: block for rule "${ruleId}".`
        : 'Could not locate defaultResponse.headers block.',
    );
    return;
  }
  // Indentation derived from the actual `headers:` line so the dash + child
  // rows nest correctly at any depth (defaultResponse.headers: at indent 2 →
  // rows at 4/6; a rule's response.headers: at 6 → rows at 8/10). The old
  // hardcoded `ruleId ? 6 : 4` mis-indented the rule case by two spaces.
  const headerLine = refreshed.lineAt(headersRange.start.line).text;
  const headersKeyIndent = leadingSpaces(headerLine);
  const dashIndent = ' '.repeat(headersKeyIndent + 2);
  const childIndent = ' '.repeat(headersKeyIndent + 4);
  const inlineEmpty = /:\s*\[\s*\]/.test(headerLine);
  const newRow =
    `${dashIndent}- key: ${yamlStringLocal(headerName)}\n` +
    `${childIndent}value: ${yamlStringLocal(headerValue)}\n` +
    `${childIndent}enabled: true\n`;
  const edit = new vscode.WorkspaceEdit();
  if (inlineEmpty) {
    const headerIndent = ' '.repeat(headersKeyIndent);
    edit.replace(
      refreshed.uri,
      refreshed.lineAt(headersRange.start.line).range,
      `${headerIndent}headers:\n${newRow.replace(/\n$/, '')}`,
    );
  } else {
    edit.insert(refreshed.uri, new vscode.Position(headersRange.end.line, 0), newRow);
  }
  const ok = await applyAndSave(refreshed, edit);
  if (!ok) return;
  editor.selection = new vscode.Selection(
    new vscode.Position(headersRange.start.line, 0),
    new vscode.Position(headersRange.start.line, 0),
  );
}

// ---------------------------------------------------------------------------
// Remove commands
// ---------------------------------------------------------------------------

export async function removeMockResponseRuleCommand(
  uri?: vscode.Uri,
  ruleId?: string,
): Promise<void> {
  await removeArrayEntry(uri, ruleId, RESPONSE_RULES_RE, 'response rule');
}

export async function removeMockValidationRuleCommand(
  uri?: vscode.Uri,
  ruleId?: string,
): Promise<void> {
  await removeArrayEntry(uri, ruleId, REQUEST_VALIDATION_RE, 'validation rule');
}

/** Remove one multiplier from defaultResponse.multipliers by id. */
export async function removeMockMultiplierCommand(
  uri?: vscode.Uri,
  multiplierId?: string,
): Promise<void> {
  const document = await ensureEndpointDocument(uri);
  if (!document) return;
  if (!multiplierId) {
    await vscode.window.showWarningMessage('No multiplier id supplied.');
    return;
  }
  const refreshed = await vscode.workspace.openTextDocument(document.uri);
  const defaultResponseSection = findTopLevelSection(refreshed, DEFAULT_RESPONSE_RE);
  if (!defaultResponseSection) {
    await vscode.window.showErrorMessage('defaultResponse: section not found.');
    return;
  }
  const range = findArrayEntryRange(
    refreshed,
    defaultResponseSection.headerLine + 1,
    defaultResponseSection.endLine,
    multiplierId,
    /^\s+-\s+id:\s*['"]?([A-Za-z0-9_-]+)['"]?/,
  );
  if (!range) {
    await vscode.window.showErrorMessage(`Multiplier "${multiplierId}" not found.`);
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.delete(refreshed.uri, range);
  await applyAndSave(refreshed, edit);
}

async function removeArrayEntry(
  uri: vscode.Uri | undefined,
  ruleId: string | undefined,
  sectionRe: RegExp,
  label: string,
): Promise<void> {
  const document = await ensureEndpointDocument(uri);
  if (!document) return;
  if (!ruleId) {
    await vscode.window.showWarningMessage(`No ${label} id supplied.`);
    return;
  }
  const refreshed = await vscode.workspace.openTextDocument(document.uri);
  const section = findTopLevelSection(refreshed, sectionRe);
  if (!section) {
    await vscode.window.showErrorMessage(`Section not found.`);
    return;
  }
  const range = findArrayEntryRange(refreshed, section.headerLine + 1, section.endLine, ruleId);
  if (!range) {
    await vscode.window.showErrorMessage(`${label} "${ruleId}" not found.`);
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.delete(refreshed.uri, range);
  await applyAndSave(refreshed, edit);
}

// ---------------------------------------------------------------------------
// Helpers — finding YAML ranges + rendering blocks
// ---------------------------------------------------------------------------

function insertIntoSection(
  document: vscode.TextDocument,
  edit: vscode.WorkspaceEdit,
  sectionRe: RegExp,
  sectionKey: 'requestValidation' | 'responseRules',
  rawBlock: string,
): void {
  const section = findTopLevelSection(document, sectionRe);
  if (section) {
    const headerLineText = document.lineAt(section.headerLine).text;
    // Inline-empty shape: `responseRules: []` (or similar). The projection
    // emits this when the array is empty; appending a `- id:` block after
    // the header would produce invalid YAML (list flagged empty AND with
    // entries). Replace the whole header line with the block-form opener
    // plus the new entry so the result is well-formed.
    if (/:\s*\[\s*\]/.test(headerLineText)) {
      edit.replace(
        document.uri,
        document.lineAt(section.headerLine).range,
        `${sectionKey}:\n${rawBlock.replace(/\n$/, '')}`,
      );
      return;
    }
    edit.insert(document.uri, new vscode.Position(section.endLine, 0), rawBlock);
    return;
  }
  // Section absent — append to EOF.
  const endLine = document.lineCount - 1;
  const endPosition = document.lineAt(endLine).range.end;
  const prefix = document.lineAt(endLine).text.trim().length > 0 ? '\n\n' : '\n';
  edit.insert(document.uri, endPosition, `${prefix}${sectionKey}:\n${rawBlock}`);
}

function findArrayEntryRange(
  document: vscode.TextDocument,
  fromLine: number,
  toLine: number,
  entryId: string,
  pattern: RegExp = ARRAY_ENTRY_ID_RE,
): vscode.Range | null {
  let startLine = -1;
  for (let line = fromLine; line < toLine; line++) {
    const text = document.lineAt(line).text;
    const match = pattern.exec(text);
    if (!match) continue;
    if (match[1] === entryId) {
      startLine = line;
      break;
    }
  }
  if (startLine === -1) return null;
  const dashIndent = document.lineAt(startLine).text.match(/^\s*/)?.[0].length ?? 0;
  let endLine = toLine;
  for (let line = startLine + 1; line < toLine; line++) {
    const text = document.lineAt(line).text;
    if (text.trim().length === 0) continue;
    const leading = text.match(/^\s*/)?.[0].length ?? 0;
    // Stop at the next entry at the same indent OR any sibling key with
    // ≤ that indent (so we don't include the trailing blank line of the
    // following sibling).
    if (leading <= dashIndent) {
      endLine = line;
      break;
    }
  }
  return new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(endLine, 0));
}

function findResponseBodyRangeForDefault(document: vscode.TextDocument): vscode.Range | null {
  const section = findTopLevelSection(document, DEFAULT_RESPONSE_RE);
  if (!section) return null;
  return findIndentedKeyRange(document, section.headerLine + 1, section.endLine, /^\s+body\s*:/);
}

function findResponseBodyRangeForRule(
  document: vscode.TextDocument,
  ruleId: string,
): vscode.Range | null {
  const section = findTopLevelSection(document, RESPONSE_RULES_RE);
  if (!section) return null;
  const ruleRange = findArrayEntryRange(document, section.headerLine + 1, section.endLine, ruleId);
  if (!ruleRange) return null;
  // Inside the rule range, find `      response:` then under it `        body:`.
  return findIndentedKeyRange(
    document,
    ruleRange.start.line + 1,
    ruleRange.end.line,
    /^\s+body\s*:/,
  );
}

/** Find the line range of the first indented key matching `keyRe` between
 *  fromLine (inclusive) and toLine (exclusive). The block runs from the key
 *  line through the last line indented deeper than the key itself. */
function findIndentedKeyRange(
  document: vscode.TextDocument,
  fromLine: number,
  toLine: number,
  keyRe: RegExp,
): vscode.Range | null {
  let startLine = -1;
  for (let line = fromLine; line < toLine; line++) {
    if (keyRe.test(document.lineAt(line).text)) {
      startLine = line;
      break;
    }
  }
  if (startLine === -1) return null;
  const keyIndent = document.lineAt(startLine).text.match(/^\s*/)?.[0].length ?? 0;
  let endLine = toLine;
  for (let line = startLine + 1; line < toLine; line++) {
    const text = document.lineAt(line).text;
    if (text.trim().length === 0) continue;
    const leading = text.match(/^\s*/)?.[0].length ?? 0;
    if (leading <= keyIndent) {
      endLine = line;
      break;
    }
  }
  return new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(endLine, 0));
}

function findStatusLineForDefault(document: vscode.TextDocument): { line: number } | null {
  const section = findTopLevelSection(document, DEFAULT_RESPONSE_RE);
  if (!section) return null;
  for (let line = section.headerLine + 1; line < section.endLine; line++) {
    if (/^\s+status\s*:/.test(document.lineAt(line).text)) return { line };
  }
  return null;
}

function findStatusLineForRule(
  document: vscode.TextDocument,
  ruleId: string,
): { line: number } | null {
  const section = findTopLevelSection(document, RESPONSE_RULES_RE);
  if (!section) return null;
  const ruleRange = findArrayEntryRange(document, section.headerLine + 1, section.endLine, ruleId);
  if (!ruleRange) return null;
  for (let line = ruleRange.start.line + 1; line < ruleRange.end.line; line++) {
    if (/^\s+status\s*:/.test(document.lineAt(line).text)) return { line };
  }
  return null;
}

async function flashAt(editor: vscode.TextEditor, test: RegExp, uri: vscode.Uri): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  for (let line = 0; line < document.lineCount; line++) {
    if (test.test(document.lineAt(line).text)) {
      const position = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter,
      );
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// YAML block renderers
// ---------------------------------------------------------------------------

function renderValidationRule(rule: MockValidationRule): string {
  const lines: string[] = [];
  lines.push(`  - id: ${yamlString(rule.id)}`);
  lines.push(`    kind: ${yamlString(rule.kind)}`);
  lines.push(`    target: ${yamlString(rule.target)}`);
  if (rule.expected !== undefined) {
    lines.push(`    expected: ${yamlString(rule.expected)}`);
  }
  if (rule.message !== undefined) {
    lines.push(`    message: ${yamlString(rule.message)}`);
  }
  lines.push(`    enabled: ${rule.enabled}`);
  lines.push('    failResponse:');
  lines.push(...indent(renderResponseConfigLines(rule.failResponse), 6));
  return lines.join('\n') + '\n';
}

function renderResponseRule(rule: MockResponseRule): string {
  const lines: string[] = [];
  lines.push(`  - id: ${yamlString(rule.id)}`);
  lines.push(`    name: ${yamlString(rule.name)}`);
  lines.push(`    enabled: ${rule.enabled}`);
  lines.push('    when:');
  for (const clause of rule.when) {
    lines.push(`      - id: ${yamlString(clause.id)}`);
    lines.push(`        scope: ${yamlString(clause.scope)}`);
    lines.push(`        target: ${yamlString(clause.target)}`);
    lines.push(`        op: ${yamlString(clause.op)}`);
    if (clause.value !== undefined) lines.push(`        value: ${yamlString(clause.value)}`);
  }
  lines.push('    response:');
  lines.push(...indent(renderResponseConfigLines(rule.response), 6));
  return lines.join('\n') + '\n';
}

/** Render one multiplier as a `- id:` list entry (two-space dash indent). */
function renderMultiplier(m: MockResponseMultiplier): string {
  const lines: string[] = [];
  lines.push(`- id: ${yamlString(m.id)}`);
  if (m.name) lines.push(`  name: ${yamlString(m.name)}`);
  lines.push('  source:');
  lines.push(`    kind: ${yamlString(m.source.kind)}`);
  lines.push(`    key: ${yamlString(m.source.key)}`);
  lines.push(`  targetJsonPath: ${yamlString(m.targetJsonPath)}`);
  lines.push(`  defaultCount: ${m.defaultCount}`);
  if (m.min !== undefined) lines.push(`  min: ${m.min}`);
  if (m.max !== undefined) lines.push(`  max: ${m.max}`);
  return lines.join('\n') + '\n';
}

function renderResponseConfigLines(cfg: MockResponseConfig): string[] {
  const lines: string[] = [];
  lines.push(`status: ${cfg.status}`);
  lines.push('headers:');
  if (cfg.headers.length === 0) {
    lines[lines.length - 1] = 'headers: []';
  } else {
    for (const h of cfg.headers) {
      lines.push(`  - key: ${yamlString(h.key)}`);
      lines.push(`    value: ${yamlString(h.value)}`);
      lines.push(`    enabled: ${h.enabled}`);
    }
  }
  lines.push('body:');
  lines.push(...indent(renderResponseBodyLines(cfg.body), 2));
  return lines;
}

function renderResponseBodyLines(body: MockResponseConfig['body']): string[] {
  const lines: string[] = [`type: ${yamlString(body.type)}`];
  lines.push(`content: ${yamlString(body.content)}`);
  if (body.type === 'form-data') {
    if (body.formRows.length === 0) {
      lines.push('formRows: []');
    } else {
      lines.push('formRows:');
      for (const r of body.formRows) {
        lines.push(`  - key: ${yamlString(r.key)}`);
        lines.push(`    value: ${yamlString(r.value)}`);
        lines.push(`    enabled: ${r.enabled}`);
      }
    }
  }
  return lines;
}

function renderResponseBody(body: MockResponseConfig['body'], baseIndent: number): string {
  const lines = [`body:`];
  lines.push(...indent(renderResponseBodyLines(body), 2));
  return indent(lines, baseIndent).join('\n') + '\n';
}

function indent(lines: string[], spaces: number): string[] {
  const prefix = ' '.repeat(spaces);
  return lines.map((l) => (l.length === 0 ? l : prefix + l));
}

/** Number of leading spaces on a line — used to derive YAML nesting depth
 *  from the document instead of assuming it. */
function leadingSpaces(lineText: string): number {
  return lineText.match(/^ */)?.[0].length ?? 0;
}

function indentBlock(block: string, spaces: number): string {
  return indent(block.replace(/\n$/, '').split('\n'), spaces).join('\n') + '\n';
}

function yamlString(value: string | number | boolean): string {
  if (typeof value !== 'string') return String(value);
  if (value.length === 0) return `''`;
  if (/[:#&*!|>'"%@`]|^[\s-]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, "''")}'`;
}
