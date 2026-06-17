// =============================================================================
// Minimal `vscode` namespace mock for Vitest unit tests.
//
// The real `vscode` module is only resolvable inside a running VS Code extension
// host. For pure-Node unit tests we expose just the API surface our code
// actually touches, with no-op or stub implementations. E2E tests use
// `@vscode/test-electron` against the real module.
// =============================================================================

import { vi } from 'vitest';

export class Uri {
  static file(path: string): Uri {
    return new Uri('file', '', path, '', '');
  }
  static parse(value: string): Uri {
    const m = /^([a-z][a-z0-9+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i.exec(
      value,
    );
    if (!m) throw new Error(`Invalid URI: ${value}`);
    return new Uri(m[1] ?? '', m[2] ?? '', m[3] ?? '', m[4] ?? '', m[5] ?? '');
  }
  static from(parts: {
    scheme: string;
    authority?: string;
    path?: string;
    query?: string;
    fragment?: string;
  }): Uri {
    return new Uri(
      parts.scheme,
      (parts.authority ?? '').toLowerCase(),
      parts.path ?? '',
      parts.query ?? '',
      parts.fragment ?? '',
    );
  }
  constructor(
    public readonly scheme: string,
    public readonly authority: string,
    public readonly path: string,
    public readonly query: string,
    public readonly fragment: string,
  ) {}
  get fsPath(): string {
    return this.path;
  }
  toString(): string {
    const auth = this.authority ? `//${this.authority}` : '';
    const q = this.query ? `?${this.query}` : '';
    const f = this.fragment ? `#${this.fragment}` : '';
    return `${this.scheme}:${auth}${this.path}${q}${f}`;
  }
  toJSON(): unknown {
    return {
      scheme: this.scheme,
      authority: this.authority,
      path: this.path,
      query: this.query,
      fragment: this.fragment,
    };
  }
  with(
    parts: Partial<{
      scheme: string;
      authority: string;
      path: string;
      query: string;
      fragment: string;
    }>,
  ): Uri {
    return new Uri(
      parts.scheme ?? this.scheme,
      parts.authority ?? this.authority,
      parts.path ?? this.path,
      parts.query ?? this.query,
      parts.fragment ?? this.fragment,
    );
  }
}

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export enum FileChangeType {
  Changed = 1,
  Created = 2,
  Deleted = 3,
}

export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

export enum QuickPickItemKind {
  Separator = -1,
  Default = 0,
}

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => (this.listeners = this.listeners.filter((l) => l !== listener)) };
  };
  fire(e: T): void {
    this.listeners.forEach((l) => l(e));
  }
  dispose(): void {
    this.listeners = [];
  }
}

export class CancellationTokenSource {
  token = {
    isCancellationRequested: false,
    onCancellationRequested: vi.fn(),
  };
  cancel(): void {
    this.token.isCancellationRequested = true;
  }
  dispose(): void {}
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export const window = {
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showInputBox: vi.fn(),
  showQuickPick: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  createOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    append: vi.fn(),
    clear: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  })),
  createStatusBarItem: vi.fn(() => ({
    text: '',
    tooltip: '',
    command: undefined,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  })),
  createTreeView: vi.fn(),
  /**
   * Invoke the task callback synchronously with a no-op progress + a token
   * whose cancellation can be driven by tests via `__withProgressCancelOnce`.
   *
   * Default behaviour: the token is never cancelled. Call
   * `window.__withProgressCancelOnce()` BEFORE the command-under-test to
   * arm the NEXT `withProgress` invocation so its token fires
   * `onCancellationRequested` and reports `isCancellationRequested: true`.
   * The flag auto-resets after consumption so it never leaks between
   * tests.
   */
  withProgress: vi.fn(
    async <R>(
      _opts: unknown,
      task: (
        progress: { report: (v: unknown) => void },
        token: {
          isCancellationRequested: boolean;
          onCancellationRequested: (cb: () => void) => { dispose: () => void };
        },
      ) => Promise<R>,
    ): Promise<R> => {
      const armed =
        (window as unknown as { __cancelNextWithProgress: boolean }).__cancelNextWithProgress ===
        true;
      (window as unknown as { __cancelNextWithProgress: boolean }).__cancelNextWithProgress = false;
      const listeners: Array<() => void> = [];
      const token = {
        get isCancellationRequested(): boolean {
          return armed;
        },
        onCancellationRequested(cb: () => void): { dispose: () => void } {
          listeners.push(cb);
          return {
            dispose: () => {
              /* no-op for tests */
            },
          };
        },
      };
      // Notify listeners synchronously so callers that subscribe via
      // `token.onCancellationRequested(...)` actually run their handler.
      if (armed)
        queueMicrotask(() => {
          for (const l of listeners) l();
        });
      return await task({ report: () => {} }, token);
    },
  ),
  /** Arm the next `withProgress` invocation to report cancellation. Auto-resets after use. */
  __withProgressCancelOnce(): void {
    (window as unknown as { __cancelNextWithProgress: boolean }).__cancelNextWithProgress = true;
  },
  registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
  registerCustomEditorProvider: vi.fn(() => ({ dispose: vi.fn() })),
  registerFileSystemProvider: vi.fn(() => ({ dispose: vi.fn() })),
  registerNotebookSerializer: vi.fn(() => ({ dispose: vi.fn() })),
  showTextDocument: vi.fn(),
  activeTextEditor: undefined as unknown,
  visibleTextEditors: [] as unknown[],
  /**
   * Minimal webview-panel mock. Tests can inspect / trigger:
   *   - panel.webview.postMessage (mock fn)
   *   - panel.webview.onDidReceiveMessage  → captures the listener so tests can fire messages
   *   - panel.onDidDispose                 → captures the listener so tests can fire disposal
   *   - panel.reveal, panel.dispose        → spies
   */
  createWebviewPanel: vi.fn((_id: string, _title: string, _column: unknown, _options?: unknown) => {
    const messageListeners: Array<(msg: unknown) => void> = [];
    const disposeListeners: Array<() => void> = [];
    const panel = {
      webview: {
        html: '',
        postMessage: vi.fn(),
        onDidReceiveMessage: vi.fn((cb: (msg: unknown) => void) => {
          messageListeners.push(cb);
          return { dispose: vi.fn() };
        }),
        _fireMessage(msg: unknown): void {
          for (const l of messageListeners) l(msg);
        },
      },
      reveal: vi.fn(),
      onDidDispose: vi.fn((cb: () => void) => {
        disposeListeners.push(cb);
        return { dispose: vi.fn() };
      }),
      dispose: vi.fn(() => {
        for (const l of disposeListeners) l();
      }),
    };
    return panel;
  }),
};

export const workspace = {
  workspaceFolders: undefined as unknown,
  getConfiguration: vi.fn(() => ({
    get: vi.fn((key: string, defaultValue?: unknown) => defaultValue),
    update: vi.fn(),
    has: vi.fn(),
    inspect: vi.fn(),
  })),
  onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
  onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
  onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
  onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
  onWillSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
  textDocuments: [] as unknown[],
  createFileSystemWatcher: vi.fn(() => ({
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
    onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  })),
  registerFileSystemProvider: vi.fn(() => ({ dispose: vi.fn() })),
  registerNotebookSerializer: vi.fn(() => ({ dispose: vi.fn() })),
  registerTextDocumentContentProvider: vi.fn(() => ({ dispose: vi.fn() })),
  applyEdit: vi.fn(),
  openTextDocument: vi.fn(),
  asRelativePath: vi.fn((path: string) => path),
  fs: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    stat: vi.fn(),
    readDirectory: vi.fn(),
    createDirectory: vi.fn(),
    delete: vi.fn(),
    rename: vi.fn(),
    copy: vi.fn(),
  },
};

export const commands = {
  registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  registerTextEditorCommand: vi.fn(() => ({ dispose: vi.fn() })),
  executeCommand: vi.fn(),
  getCommands: vi.fn(() => Promise.resolve([] as string[])),
};

export const languages = {
  registerCodeLensProvider: vi.fn(() => ({ dispose: vi.fn() })),
  registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
  registerHoverProvider: vi.fn(() => ({ dispose: vi.fn() })),
  registerDefinitionProvider: vi.fn(() => ({ dispose: vi.fn() })),
  registerReferenceProvider: vi.fn(() => ({ dispose: vi.fn() })),
  registerRenameProvider: vi.fn(() => ({ dispose: vi.fn() })),
  registerDocumentSymbolProvider: vi.fn(() => ({ dispose: vi.fn() })),
  registerWorkspaceSymbolProvider: vi.fn(() => ({ dispose: vi.fn() })),
  registerCodeActionsProvider: vi.fn(() => ({ dispose: vi.fn() })),
  registerDocumentLinkProvider: vi.fn(() => ({ dispose: vi.fn() })),
  registerInlayHintsProvider: vi.fn(() => ({ dispose: vi.fn() })),
  createDiagnosticCollection: vi.fn(() => ({
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
  })),
  setLanguageConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
};

export const env = {
  appName: 'Visual Studio Code',
  appHost: 'desktop',
  remoteName: undefined as string | undefined,
  clipboard: {
    writeText: vi.fn(),
    readText: vi.fn(),
  },
  openExternal: vi.fn(),
  asExternalUri: vi.fn((uri: Uri) => uri),
};

/**
 * Minimal `vscode.authentication` mock. Tests call `authentication.getSession.mockResolvedValue(...)`
 * to drive the API. Real provider semantics — silent vs createIfNone, scope checks — are not modelled;
 * the production code uses a small slice of this surface.
 */
export const authentication = {
  getSession: vi.fn(),
  onDidChangeSessions: vi.fn(() => ({ dispose: vi.fn() })),
};

export const ExtensionMode = {
  Production: 1,
  Development: 2,
  Test: 3,
} as const;

export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
  Two = 2,
  Three = 3,
}

export class TreeItem {
  constructor(
    public label: string | { label: string; highlights?: [number, number][] },
    public collapsibleState?: TreeItemCollapsibleState,
  ) {}
  description?: string | boolean;
  tooltip?: string;
  iconPath?: string | Uri | ThemeIcon | { light: string | Uri; dark: string | Uri };
  command?: { command: string; title: string; arguments?: unknown[] };
  contextValue?: string;
  resourceUri?: Uri;
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class ThemeIcon {
  static readonly File = new ThemeIcon('file');
  static readonly Folder = new ThemeIcon('folder');
  constructor(
    public id: string,
    public color?: ThemeColor,
  ) {}
}

export class ThemeColor {
  constructor(public id: string) {}
}

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
}

export class Range {
  public readonly start: Position;
  public readonly end: Position;
  constructor(...args: unknown[]) {
    if (args.length === 4) {
      this.start = new Position(args[0] as number, args[1] as number);
      this.end = new Position(args[2] as number, args[3] as number);
    } else {
      this.start = args[0] as Position;
      this.end = args[1] as Position;
    }
  }
}

export class TextEdit {
  static replace(range: Range, newText: string): TextEdit {
    return new TextEdit(range, newText);
  }
  static insert(position: Position, newText: string): TextEdit {
    return new TextEdit(new Range(position, position), newText);
  }
  constructor(
    public readonly range: Range,
    public readonly newText: string,
  ) {}
}

export class CodeLens {
  isResolved = false;
  constructor(
    public range: Range,
    public command?: { title: string; command: string; arguments?: unknown[] },
  ) {
    if (command) this.isResolved = true;
  }
}

export class CompletionItem {
  detail?: string;
  documentation?: string;
  insertText?: string;
  filterText?: string;
  sortText?: string;
  constructor(
    public label: string,
    public kind?: CompletionItemKind,
  ) {}
}

export enum CompletionItemKind {
  Text = 0,
  Method = 1,
  Function = 2,
  Constructor = 3,
  Field = 4,
  Variable = 5,
  Class = 6,
  Interface = 7,
  Module = 8,
  Property = 9,
  Unit = 10,
  Value = 11,
  EnumMember = 19,
  Snippet = 14,
  Color = 15,
  File = 16,
  Reference = 17,
  Folder = 18,
  Constant = 20,
  Struct = 21,
  Event = 22,
  Operator = 23,
  TypeParameter = 24,
}

export class MarkdownString {
  value = '';
  isTrusted = false;
  supportThemeIcons = false;
  constructor(value?: string, supportThemeIcons?: boolean) {
    if (value) this.value = value;
    if (supportThemeIcons) this.supportThemeIcons = supportThemeIcons;
  }
  appendText(text: string): MarkdownString {
    this.value += text;
    return this;
  }
  appendMarkdown(text: string): MarkdownString {
    this.value += text;
    return this;
  }
  appendCodeblock(value: string, language?: string): MarkdownString {
    this.value += `\n\`\`\`${language ?? ''}\n${value}\n\`\`\`\n`;
    return this;
  }
}

export class Hover {
  contents: MarkdownString[];
  constructor(
    content: MarkdownString | MarkdownString[],
    public range?: Range,
  ) {
    this.contents = Array.isArray(content) ? content : [content];
  }
}

export class Selection {
  constructor(
    public anchor: Position,
    public active: Position,
  ) {}
}

/**
 * Minimal WorkspaceEdit that records replace / insert / delete operations.
 * Tests apply them to an in-memory document via `applyRecordedEdits` below —
 * the real host applies them atomically against the original positions.
 */
export type RecordedEdit =
  | { kind: 'replace'; uri: Uri; range: Range; text: string }
  | { kind: 'insert'; uri: Uri; position: Position; text: string }
  | { kind: 'delete'; uri: Uri; range: Range };

export class WorkspaceEdit {
  edits: RecordedEdit[] = [];
  replace(uri: Uri, range: Range, text: string): void {
    this.edits.push({ kind: 'replace', uri, range, text });
  }
  insert(uri: Uri, position: Position, text: string): void {
    this.edits.push({ kind: 'insert', uri, position, text });
  }
  delete(uri: Uri, range: Range): void {
    this.edits.push({ kind: 'delete', uri, range });
  }
}

/** Absolute character offset of (line, char) in `text` (newline-delimited). */
function offsetOf(text: string, line: number, char: number): number {
  const parts = text.split('\n');
  let off = 0;
  for (let i = 0; i < line && i < parts.length; i++) off += parts[i].length + 1;
  return Math.min(off + char, text.length);
}

/**
 * Apply recorded WorkspaceEdit operations to `text`, mirroring the host's
 * atomic application: every edit resolves against the ORIGINAL offsets, then
 * they're applied last-to-first so earlier offsets don't shift.
 */
export function applyRecordedEdits(text: string, edits: RecordedEdit[]): string {
  const resolved = edits.map((e) => {
    if (e.kind === 'insert') {
      const off = offsetOf(text, e.position.line, e.position.character);
      return { start: off, end: off, text: e.text };
    }
    const start = offsetOf(text, e.range.start.line, e.range.start.character);
    const end = offsetOf(text, e.range.end.line, e.range.end.character);
    return { start, end, text: e.kind === 'delete' ? '' : e.text };
  });
  resolved.sort((a, b) => b.start - a.start);
  let out = text;
  for (const r of resolved) out = out.slice(0, r.start) + r.text + out.slice(r.end);
  return out;
}

export enum TextEditorRevealType {
  Default = 0,
  InCenter = 1,
  InCenterIfOutsideViewport = 2,
  AtTop = 3,
}

export class Diagnostic {
  source?: string;
  code?: string | number;
  constructor(
    public range: Range,
    public message: string,
    public severity: DiagnosticSeverity = DiagnosticSeverity.Error,
  ) {}
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export class FileSystemError extends Error {
  static FileNotFound(uri?: Uri | string): FileSystemError {
    return new FileSystemError(`File not found: ${formatUri(uri)}`);
  }
  static NoPermissions(uri?: Uri | string): FileSystemError {
    return new FileSystemError(`No permissions: ${formatUri(uri)}`);
  }
  static FileExists(uri?: Uri | string): FileSystemError {
    return new FileSystemError(`File exists: ${formatUri(uri)}`);
  }
  static Unavailable(message?: string): FileSystemError {
    return new FileSystemError(`Unavailable: ${message ?? ''}`);
  }
  code?: string;
}

function formatUri(uri?: Uri | string): string {
  if (uri === undefined) return '<unknown>';
  if (typeof uri === 'string') return uri;
  return uri.toString();
}

export interface ExtensionContext {
  subscriptions: Array<{ dispose: () => unknown }>;
  globalState: {
    get: <T>(key: string, defaultValue?: T) => T | undefined;
    update: (key: string, value: unknown) => Thenable<void>;
    keys: () => readonly string[];
  };
  workspaceState: {
    get: <T>(key: string, defaultValue?: T) => T | undefined;
    update: (key: string, value: unknown) => Thenable<void>;
    keys: () => readonly string[];
  };
  secrets: {
    get: (key: string) => Thenable<string | undefined>;
    store: (key: string, value: string) => Thenable<void>;
    delete: (key: string) => Thenable<void>;
  };
  globalStorageUri: Uri;
  storageUri: Uri | undefined;
  extensionUri: Uri;
  extensionPath: string;
  asAbsolutePath: (relativePath: string) => string;
  extensionMode: number;
}

export interface Disposable {
  dispose(): void;
}

export type Thenable<T> = Promise<T>;

// ---------------------------------------------------------------------------
// Notebook API (Phase 9 — Plan Notebooks)
// ---------------------------------------------------------------------------

export enum NotebookCellKind {
  Markup = 1,
  Code = 2,
}

export class NotebookCellData {
  metadata?: { [key: string]: unknown };
  outputs?: NotebookCellOutput[];
  constructor(
    public kind: NotebookCellKind,
    public value: string,
    public languageId: string,
  ) {}
}

export class NotebookData {
  metadata?: { [key: string]: unknown };
  constructor(public cells: NotebookCellData[]) {}
}

export class NotebookCellOutputItem {
  constructor(
    public readonly data: Uint8Array,
    public readonly mime: string,
  ) {}
  static text(value: string, mime = 'text/plain'): NotebookCellOutputItem {
    return new NotebookCellOutputItem(new TextEncoder().encode(value), mime);
  }
  static json(value: unknown, mime = 'application/json'): NotebookCellOutputItem {
    return new NotebookCellOutputItem(new TextEncoder().encode(JSON.stringify(value)), mime);
  }
  static error(err: Error): NotebookCellOutputItem {
    return new NotebookCellOutputItem(
      new TextEncoder().encode(`${err.name}: ${err.message}`),
      'application/vnd.code.notebook.error',
    );
  }
}

export class NotebookCellOutput {
  constructor(
    public items: NotebookCellOutputItem[],
    public metadata?: { [key: string]: unknown },
  ) {}
}

// Minimal stand-in for NotebookController — tests inject the executeHandler
// directly so the runtime side never needs to fire it.
export const notebooks = {
  createNotebookController: (
    _id: string,
    _viewType: string,
    _label: string,
  ): {
    id: string;
    viewType: string;
    label: string;
    supportedLanguages: string[];
    supportsExecutionOrder: boolean;
    description: string;
    executeHandler: ((cells: unknown[], notebook: unknown, ctrl: unknown) => void) | undefined;
    createNotebookCellExecution: (cell: unknown) => unknown;
    dispose: () => void;
  } => ({
    id: _id,
    viewType: _viewType,
    label: _label,
    supportedLanguages: [],
    supportsExecutionOrder: false,
    description: '',
    executeHandler: undefined,
    createNotebookCellExecution: () => ({
      start: () => undefined,
      end: () => undefined,
      replaceOutput: () => Promise.resolve(),
      token: { onCancellationRequested: () => ({ dispose: () => undefined }) },
    }),
    dispose: () => undefined,
  }),
};

// ---------------------------------------------------------------------------
// Tests API (Phase 9 — Test Controller for assertions)
// ---------------------------------------------------------------------------

export enum TestRunProfileKind {
  Run = 1,
  Debug = 2,
  Coverage = 3,
}

export const tests = {
  createTestController: (
    _id: string,
    _label: string,
  ): {
    id: string;
    label: string;
    items: {
      add: (item: unknown) => void;
      replace: (items: unknown[]) => void;
      get: (id: string) => unknown;
      delete: (id: string) => void;
      forEach: (cb: (item: unknown) => void) => void;
      size: number;
    };
    createTestItem: (id: string, label: string, uri?: Uri) => unknown;
    createTestRun: (req: unknown, name?: string, persist?: boolean) => unknown;
    createRunProfile: (
      label: string,
      kind: TestRunProfileKind,
      handler: (req: unknown, token: unknown) => void | Thenable<void>,
      isDefault?: boolean,
    ) => unknown;
    dispose: () => void;
  } => {
    const itemsStore = new Map<string, unknown>();
    return {
      id: _id,
      label: _label,
      items: {
        add: (item: unknown) => {
          const id = (item as { id: string }).id;
          itemsStore.set(id, item);
        },
        replace: (items: unknown[]) => {
          itemsStore.clear();
          for (const it of items) {
            itemsStore.set((it as { id: string }).id, it);
          }
        },
        get: (id: string) => itemsStore.get(id),
        delete: (id: string) => {
          itemsStore.delete(id);
        },
        forEach: (cb) => {
          for (const item of itemsStore.values()) cb(item);
        },
        get size() {
          return itemsStore.size;
        },
      },
      createTestItem: (id, label, uri) => {
        const childMap = new Map<string, unknown>();
        const item: unknown = {
          id,
          label,
          uri,
          parent: undefined as unknown,
          children: {
            add: (child: unknown) => {
              const cid = (child as { id: string }).id;
              childMap.set(cid, child);
              (child as { parent?: unknown }).parent = item;
            },
            replace: (items: unknown[]) => {
              childMap.clear();
              for (const it of items) {
                childMap.set((it as { id: string }).id, it);
                (it as { parent?: unknown }).parent = item;
              }
            },
            get: (cid: string) => childMap.get(cid),
            delete: (cid: string) => {
              childMap.delete(cid);
            },
            forEach: (cb: (it: unknown) => void) => {
              for (const it of childMap.values()) cb(it);
            },
            get size() {
              return childMap.size;
            },
          },
        };
        return item;
      },
      createTestRun: () => ({
        passed: () => undefined,
        failed: () => undefined,
        skipped: () => undefined,
        appendOutput: () => undefined,
        end: () => undefined,
      }),
      createRunProfile: (_label, _kind, _handler) => ({ dispose: () => undefined }),
      dispose: () => undefined,
    };
  },
};

export class TestMessage {
  constructor(public message: string) {}
}
