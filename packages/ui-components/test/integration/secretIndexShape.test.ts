import { describe, expect, it } from 'vitest';
import { createEmptyWorkspace } from '../../src/persistence/workspaceStorage';
import { addSecretEntry, setSecretUsedIn } from '../../src/store/secretActions';

// Regression snapshot — locks down the shape of WorkspaceLocal.secretIndex
// so accidental schema drift is loud and obvious. Updates should be
// intentional + accompanied by a code-review note in the PR.

describe('SecretIndex shape regression', () => {
  it('empty index matches the frozen shape', () => {
    const { local } = createEmptyWorkspace();
    expect(local.secretIndex).toMatchInlineSnapshot(`
      {
        "entries": {},
      }
    `);
  });

  it('a populated entry carries every documented field', () => {
    let { local } = createEmptyWorkspace();
    local = addSecretEntry(local, {
      id: 's-1',
      label: 'TOKEN',
      origin: 'linked',
      linkedWorkspaceId: 'lw-pets',
      linkedKeyId: 'BEARER',
    });
    local = setSecretUsedIn(local, 's-1', [
      { kind: 'request', id: 'r-1', label: 'Get user' },
      { kind: 'environment-var', id: 'dev.AUTH', label: 'dev → AUTH' },
      { kind: 'linked-workspace-input', id: 'lw-pets', label: 'Pets API' },
    ]);

    const entry = local.secretIndex.entries['s-1'];
    // Stamp createdAt to make the snapshot stable.
    const stable = { ...entry, createdAt: '2026-04-27T00:00:00.000Z' };

    expect(stable).toMatchInlineSnapshot(`
      {
        "createdAt": "2026-04-27T00:00:00.000Z",
        "id": "s-1",
        "label": "TOKEN",
        "linkedKeyId": "BEARER",
        "linkedWorkspaceId": "lw-pets",
        "origin": "linked",
        "usedIn": [
          {
            "id": "r-1",
            "kind": "request",
            "label": "Get user",
          },
          {
            "id": "dev.AUTH",
            "kind": "environment-var",
            "label": "dev → AUTH",
          },
          {
            "id": "lw-pets",
            "kind": "linked-workspace-input",
            "label": "Pets API",
          },
        ],
      }
    `);
  });
});
