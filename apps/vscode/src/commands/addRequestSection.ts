import * as vscode from 'vscode';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// `apicircle.addRequestSection` — driven by the CodeLens above `name:` in
// request YAML. Opens a quick-pick listing every optional section the
// `serializeRequestToYaml` projection knows how to emit. Picking a section
// that already exists in the document scrolls cursor to it; picking one
// that's absent inserts a starter scaffold at the bottom of the document.
//
// Insertion ordering follows the natural top-down section order of the
// YAML projection so a fresh document built by adding all sections one by
// one matches what serialize produces on a fully populated request.
// =============================================================================

interface SectionDef {
  key: string;
  label: string;
  description: string;
  /** Lines to insert when the section is added (no leading newline — the
   *  caller takes care of separator newlines). */
  scaffold: string[];
}

// Ordered to match the canonical projection order so multiple inserts read
// top-to-bottom the way a serialise() output would.
const SECTIONS: SectionDef[] = [
  {
    key: 'pathParams',
    label: '$(symbol-key) Path Params',
    description: 'Values for `:name` / `{name}` placeholders in the URL.',
    scaffold: ['pathParams:', '  id: "123"'],
  },
  {
    key: 'query',
    label: '$(search) Query Params',
    description: 'URL query string parameters.',
    scaffold: ['query:', '  - key: page', '    value: "1"', '    enabled: true'],
  },
  {
    key: 'headers',
    label: '$(list-flat) Headers',
    description: 'Custom request headers.',
    scaffold: ['headers:', '  - key: Accept', '    value: application/json', '    enabled: true'],
  },
  {
    key: 'cookies',
    label: '$(bookmark) Cookies',
    description: 'Cookies merged into the Cookie header at send time.',
    scaffold: ['cookies:', '  - key: session', '    value: ""', '    enabled: true'],
  },
  {
    key: 'auth',
    label: '$(key) Auth',
    description: 'Authentication scheme (bearer / basic / api-key / oauth2 / …).',
    scaffold: ['auth:', '  type: bearer', '  token: "{{auth_token}}"'],
  },
  {
    key: 'body',
    label: '$(json) Body',
    description: 'Request body (json / text / xml / form-data / urlencoded / graphql).',
    scaffold: ['body:', '  type: json', '  content: |-', '    {', '      "key": "value"', '    }'],
  },
  {
    key: 'contextVars',
    label: '$(symbol-variable) Context Variables',
    description: 'Per-request scoped variables overlaid on top of the env.',
    scaffold: ['contextVars:', '  - key: timestamp', '    value: ""'],
  },
  {
    key: 'extractions',
    label: '$(symbol-property) Extractions',
    description: 'Capture values from the response into globalContext for later requests.',
    scaffold: [
      'extractions:',
      '  - id: ext1',
      '    variable: auth_token',
      '    source: body',
      '    path: data.token',
      '    enabled: true',
    ],
  },
  {
    key: 'assertions',
    label: '$(check) Assertions',
    description: 'Validate the response — status code, headers, JSON-path values.',
    scaffold: [
      'assertions:',
      '  - id: a1',
      '    name: Status 200',
      '    kind: status',
      '    op: equals',
      '    expected: "200"',
    ],
  },
];

/** Search the document for a top-level YAML key. Returns the 0-indexed line. */
function findSectionLine(text: string, key: string): number {
  const pattern = new RegExp(`^${key}\\s*:`, 'm');
  const match = pattern.exec(text);
  if (!match) return -1;
  return text.slice(0, match.index).split('\n').length - 1;
}

export async function addRequestSectionCommand(uri?: vscode.Uri): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    await vscode.window.showWarningMessage('No request YAML is active.');
    return;
  }
  if (targetUri.scheme !== 'apicircle' || uriEntityKind(targetUri) !== 'request') {
    await vscode.window.showWarningMessage(
      'This command only runs against APICircle request YAML files.',
    );
    return;
  }
  const document = await vscode.workspace.openTextDocument(targetUri);
  const text = document.getText();

  const items = SECTIONS.map((s) => {
    const present = findSectionLine(text, s.key) !== -1;
    return {
      label: s.label,
      description: present ? '✓ already in document' : s.description,
      detail: present ? 'Jump to existing section' : 'Insert starter scaffold',
      sectionKey: s.key,
      present,
    };
  });

  const pick = await vscode.window.showQuickPick(items, {
    title: 'Add a section to this request',
    placeHolder: 'Pick a section — adds it if missing, scrolls to it if already present.',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!pick) return;

  const editor = await vscode.window.showTextDocument(document);
  if (pick.present) {
    const line = findSectionLine(document.getText(), pick.sectionKey);
    const target = document.lineAt(line).range;
    editor.selection = new vscode.Selection(target.start, target.start);
    editor.revealRange(target, vscode.TextEditorRevealType.InCenter);
    return;
  }

  const section = SECTIONS.find((s) => s.key === pick.sectionKey);
  if (!section) return;

  // Insertion strategy: append at the end of the document, preserving a
  // single blank line between sections. The serialiser is order-tolerant
  // so we don't have to weave the new section into its canonical position.
  const endLine = document.lineCount - 1;
  const endPosition = document.lineAt(endLine).range.end;
  const needsLeadingNewline = document.lineAt(endLine).text.trim().length > 0 ? '\n\n' : '\n';
  const insertText = needsLeadingNewline + section.scaffold.join('\n') + '\n';

  const edit = new vscode.WorkspaceEdit();
  edit.insert(document.uri, endPosition, insertText);
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    await vscode.window.showErrorMessage(`Failed to insert ${section.key} scaffold.`);
    return;
  }
  // Scroll to the inserted block + put cursor on the new section header.
  const newSectionLine = findSectionLine(document.getText(), section.key);
  if (newSectionLine !== -1) {
    const target = document.lineAt(newSectionLine).range;
    editor.selection = new vscode.Selection(target.start, target.start);
    editor.revealRange(target, vscode.TextEditorRevealType.InCenter);
  }
}
