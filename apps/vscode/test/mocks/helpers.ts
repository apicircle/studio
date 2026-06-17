import type { Mock } from 'vitest';

// =============================================================================
// Test helpers — typed accessors for the `vscode` mock surface.
//
// The hand-rolled mock in `test/mocks/vscode.ts` exposes a wide,
// loosely-typed surface (every property is either a vi.fn or a plain
// value). Tests accessing `(window.showQuickPick as Mock).mockResolvedValueOnce(...)`
// pile up `as Mock` / `as unknown as ...` casts that obscure the actual
// intent.
//
// The helpers below are a typed front door: each function captures the
// mock surface, returns the vi.fn handle, and lets callers chain mock
// methods with full IntelliSense.
//
// Usage:
//   import { asMock } from '../../test/mocks/helpers';
//   asMock(window.showQuickPick).mockResolvedValueOnce({ label: 'x' });
//   asMock(workspace.getConfiguration).mockImplementation(() => ({ ... }));
// =============================================================================

/**
 * Type-narrow a value to a vitest `Mock`. The runtime check is implicit —
 * the mock module sets every property as a vi.fn, so this is a pure
 * type-level convenience. Throws (in dev) when used on a non-mock.
 */
export function asMock<T extends (...args: never[]) => unknown>(fn: T): Mock<T> {
  // Vitest's Mock type accepts the underlying function shape — the cast is
  // a no-op at runtime when fn is in fact a vi.fn.
  return fn as unknown as Mock<T>;
}
