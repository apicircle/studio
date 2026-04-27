// Preload runs in an isolated context that has access to a limited set
// of Electron APIs. We expose a narrow `apicircleDesktop` namespace on
// the renderer's `window` so the persistence layer can detect us and
// wrap the master JWK with the OS keychain.
//
// Surface kept tight — every method here adds attack surface, so we
// only ship the three calls `NativeSecretBridge` actually needs.

import { contextBridge, ipcRenderer } from 'electron';

const bridge = {
  encryptString: (plaintext: string): Promise<string> =>
    ipcRenderer.invoke('apicircle:secret:encrypt', plaintext) as Promise<string>,
  decryptString: (ciphertext: string): Promise<string> =>
    ipcRenderer.invoke('apicircle:secret:decrypt', ciphertext) as Promise<string>,
  isEncryptionAvailable: (): Promise<boolean> =>
    ipcRenderer.invoke('apicircle:secret:isAvailable') as Promise<boolean>,
};

contextBridge.exposeInMainWorld('apicircleDesktop', bridge);
