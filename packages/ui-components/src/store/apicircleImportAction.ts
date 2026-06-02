// Re-export the pure import-graft helper that now lives in `@apicircle/core`.
//
// Historical: this file used to own the workspace-grafting logic for the
// `apicircle.folder/v1` envelope. The implementation moved into
// `@apicircle/core/workspace/apicircleFolderImport` so the same code
// can power three writers — the React store (here), the headless CLI
// (`apicircle import apicircle`), and the MCP tool (`folder.import`).
// Keeping a re-export under the original path avoids a churn of
// import-line edits in the existing tests + workspace store.

export { importApicircleFolderInto, type ImportApicircleFolderResult } from '@apicircle/core';
