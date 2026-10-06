import type { WorkspaceAccess } from '@apicircle/ui-components';

declare global {
  interface Window {
    /**
     * The workspace policy the Playwright web suite boots the shell under. Its
     * init script (`maxWorkspaces` in `e2e/web/fixtures/app.ts`) sets this
     * before any app code runs. Read on the dev server only — see `main.tsx`.
     */
    __apicircleE2eWorkspaceAccess?: unknown;
  }
}

/**
 * Turn the value the e2e suite put on `window` into a workspace policy.
 *
 * Standalone Studio is the free tier: `<App>` with no `workspaceAccess` keeps
 * one workspace open. The multi-workspace flows an edition unlocks — create,
 * switch, the recents list, delete — still ship in this shell, so the e2e
 * suite drives them under a raised cap, the way `WorkspaceSwitcher.test.tsx`
 * renders them inside an explicit unlimited policy.
 *
 * Anything but `{ maxWorkspaces }` holding a whole number of at least one, or
 * `Infinity`, reads as no policy, which leaves the free-tier default in place.
 * A fractional cap is refused rather than passed on: the switcher would count
 * it one way when offering New workspace and another when unlocking rows.
 */
export function parseDevWorkspaceAccess(raw: unknown): WorkspaceAccess | undefined {
  if (typeof raw !== 'object' || raw === null || !('maxWorkspaces' in raw)) return undefined;
  const { maxWorkspaces } = raw;
  if (typeof maxWorkspaces !== 'number') return undefined;
  const isCap =
    maxWorkspaces === Infinity || (Number.isInteger(maxWorkspaces) && maxWorkspaces >= 1);
  return isCap ? { maxWorkspaces } : undefined;
}
