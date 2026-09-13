import type { ToastRecord } from '../primitives/Toast';

// What a mock's spec could NOT be read as.
//
// `createMockServer` and `refreshMockServer` both return the parser's warnings,
// and the create modal renders them — but the flows that rebuild an EXISTING
// mock (Refresh from spec, Re-import from spec, Serve OpenAPI contract, and the
// auto-refresh that follows a re-uploaded spec asset) used to drop them. That is
// the worse half: a create with a thin endpoint table is visible in the list
// that appears, while a refresh replaces a working endpoint table in place, so
// bodies collapsing to `{}` — or the table emptying outright, which is what a
// split spec whose paths are external `$ref`s does — looked like nothing
// happening at all.
//
// One shared toast so every flow says it the same way.

/** The toast a rebuilt mock deserves, or null when there is nothing to report:
 *  endpoints were produced and the parser had no complaint. Zero endpoints is
 *  always worth saying, warnings or not — a mock that serves nothing is not a
 *  success, however quietly it was rebuilt. */
export function mockSpecWarningToast(
  serverName: string,
  endpointCount: number,
  warnings: readonly string[],
): Omit<ToastRecord, 'id'> | null {
  if (warnings.length === 0 && endpointCount > 0) return null;
  const detail = warnings.join(' · ');
  if (endpointCount === 0) {
    return {
      tone: 'error',
      title: `"${serverName}" now serves no endpoints`,
      detail:
        detail ||
        'The spec produced no operations — check that it declares paths with 2xx responses.',
      ttlMs: 12000,
    };
  }
  return {
    tone: 'info',
    title: `"${serverName}" was rebuilt, but part of the spec could not be read`,
    detail,
    ttlMs: 12000,
  };
}
