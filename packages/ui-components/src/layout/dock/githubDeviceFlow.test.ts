import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __setGitHubDeviceFlowAvailableForTests,
  isGitHubDeviceFlowAvailable,
} from './githubDeviceFlow';

// `vi.stubEnv` mutates the shared `import.meta.env` that every module reads,
// so the function under test sees a flipped `VITE_GH_DEVICE_FLOW` (a plain
// `import.meta.env.X = …` assignment doesn't propagate cross-module here).
// Vitest pins `import.meta.env.DEV` to `true` and won't let stubEnv flip it,
// so the production `DEV=false → hidden` path can't run in-process — it's
// covered behaviorally by the false-override and `VITE_GH_DEVICE_FLOW="0"`
// cases below (and by SecretVaultDockPanel.test.tsx). The package runs under
// jsdom, so `window` is defined for the runtime branches.
describe('isGitHubDeviceFlowAvailable', () => {
  afterEach(() => {
    __setGitHubDeviceFlowAvailableForTests(null);
    vi.unstubAllEnvs();
  });

  it('honours the explicit test override above runtime detection', () => {
    __setGitHubDeviceFlowAvailableForTests(true);
    expect(isGitHubDeviceFlowAvailable()).toBe(true);
    __setGitHubDeviceFlowAvailableForTests(false);
    expect(isGitHubDeviceFlowAvailable()).toBe(false);
  });

  it('tracks the build’s Vite DEV flag when no override is set', () => {
    // The dev server reports DEV=true (button shown); every production build —
    // the static web deploy and the packaged desktop app — reports DEV=false
    // (button hidden). Assert the no-override result equals DEV either way.
    const dev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
    expect(isGitHubDeviceFlowAvailable()).toBe(dev);
  });

  it('VITE_GH_DEVICE_FLOW="1" forces it on (fork with its own relay)', () => {
    vi.stubEnv('VITE_GH_DEVICE_FLOW', '1');
    expect(isGitHubDeviceFlowAvailable()).toBe(true);
  });

  it('VITE_GH_DEVICE_FLOW="0" forces it off', () => {
    vi.stubEnv('VITE_GH_DEVICE_FLOW', '0');
    expect(isGitHubDeviceFlowAvailable()).toBe(false);
  });
});
