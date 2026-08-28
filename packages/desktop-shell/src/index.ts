// @apicircle/desktop-shell — reusable Electron main-process building blocks.
// An edition's desktop app constructs the managers, registers the IPC bridges,
// and starts the workspace-file watcher; the Studio-specific composition
// (window creation, CSP, branding, auto-update, quit-drain) stays in the app.

// Managers
export * from './mock/mockManager';
export * from './workspaceFile/workspaceFileManager';
export * from './workspaceFile/workspaceWatcher';

// IPC bridges
export * from './ipc/mockBridge';
export * from './ipc/workspaceFileBridge';
export * from './ipc/secretsBridge';
export * from './ipc/oauth2Bridge';

// OAuth2 callback server + window-state persistence
export * from './oauth2Server';
export * from './windowState';

// Security helpers (shared by the bridges and the app's window-open handler)
export * from './security/assertTrustedSender';
export * from './security/assertHttpUrl';
