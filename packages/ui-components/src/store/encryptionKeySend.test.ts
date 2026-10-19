import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RUN_HIDDEN_VALUE } from '@apicircle/shared';
import { useWorkspaceStore } from './workspaceStore';

// The incident these tests pin (2026-10-18/19): an admin token was kept in the
// encrypted variable ADMIN_TOKEN, encrypted with the Secret Vault slot
// ADMIN_TOKEN_ENCRYPTION_KEY. A request was written with the slot's label —
// `Bearer {{ADMIN_TOKEN_ENCRYPTION_KEY}}` — and the slot's own value went to the
// server. History then kept the resolved token in plain text on disk.
//
// Now: a slot that encrypts variables is an encryption key, never a variable,
// and a stored run never holds a resolved secret.

const KEY_VALUE = 'slot-passphrase-do-not-send';
const TOKEN = 'admin-token-123456';

function stubFetch(body = '{"ok":true}') {
  const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(
      new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentAuthorization(fetchMock: ReturnType<typeof stubFetch>): string | null {
  const init = fetchMock.mock.calls[0]?.[1];
  return new Headers(init?.headers).get('authorization');
}

/** Workspace with ADMIN_TOKEN encrypted under the ADMIN_TOKEN_ENCRYPTION_KEY slot. */
async function seedEncryptedToken(): Promise<string> {
  let slotId = '';
  await act(async () => {
    const s = useWorkspaceStore.getState();
    s.addEnvironment('staging');
    s.setPriorityOrder([{ kind: 'local', name: 'staging' }]);
    s.setVariables('staging', [{ key: 'ADMIN_TOKEN', value: TOKEN, encrypted: false }]);
    slotId = await s.addSecret({
      label: 'ADMIN_TOKEN_ENCRYPTION_KEY',
      value: KEY_VALUE,
      origin: 'workspace',
    });
    expect(await s.bindVariableToSecretKey('staging', 0, slotId)).toBe(true);
  });
  return slotId;
}

async function sendWithAuthorization(value: string): Promise<string> {
  let id = '';
  await act(async () => {
    const s = useWorkspaceStore.getState();
    id = s.addRequest(null);
    s.setRequestUrl(id, 'https://admin.example.test/users');
    s.setRequestHeaders(id, [{ key: 'Authorization', value, enabled: true }]);
    s.setActiveRequestId(id);
    await s.executeActiveRequest();
  });
  return id;
}

describe('a vault slot that encrypts variables is an encryption key, not a variable', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses a request that names the key — nothing is sent and the key is stored nowhere', async () => {
    await seedEncryptedToken();
    const fetchMock = stubFetch();

    const id = await sendWithAuthorization('Bearer {{ADMIN_TOKEN_ENCRYPTION_KEY}}');

    expect(fetchMock).not.toHaveBeenCalled();
    const reason =
      'Not sent. {{ADMIN_TOKEN_ENCRYPTION_KEY}} is the encryption key of ADMIN_TOKEN, not a ' +
      'variable, so its value is never sent. Write {{ADMIN_TOKEN}} to send the variable.';
    expect(useWorkspaceStore.getState().lastRun[id]).toMatchObject({ ok: false, error: reason });
    const local = useWorkspaceStore.getState().local!;
    expect(local.history.requestRuns[0].error).toBe(reason);
    expect(JSON.stringify(local)).not.toContain(KEY_VALUE);
  });

  it('sends the variable the key encrypts, and History hides it', async () => {
    await seedEncryptedToken();
    const fetchMock = stubFetch(`{"echo":"${TOKEN}","session_token":"fresh-from-server"}`);

    await sendWithAuthorization('Bearer {{ADMIN_TOKEN}}');

    expect(sentAuthorization(fetchMock)).toBe(`Bearer ${TOKEN}`);
    const run = useWorkspaceStore.getState().local!.history.requestRuns[0];
    expect(run.secretsHidden).toBe(true);
    expect(run.requestHeaders).toEqual({ Authorization: RUN_HIDDEN_VALUE });
    expect(run.responseBodyPreview).toBe(
      `{"echo":"${RUN_HIDDEN_VALUE}","session_token":"${RUN_HIDDEN_VALUE}"}`,
    );
    const history = JSON.stringify(useWorkspaceStore.getState().local!.history);
    expect(history).not.toContain(TOKEN);
    expect(history).not.toContain('fresh-from-server');
  });

  it('keeps a slot that encrypts nothing usable as {{LABEL}}, hidden in History', async () => {
    await act(async () => {
      await useWorkspaceStore
        .getState()
        .addSecret({ label: 'PARTNER_API_KEY', value: 'partner-key-987', origin: 'workspace' });
    });
    const fetchMock = stubFetch();
    let id = '';
    await act(async () => {
      const s = useWorkspaceStore.getState();
      id = s.addRequest(null);
      s.setRequestUrl(id, 'https://partner.example.test/v1');
      s.setRequestHeaders(id, [
        { key: 'X-Partner', value: 'k={{PARTNER_API_KEY}}', enabled: true },
        { key: 'Accept', value: 'application/json', enabled: true },
      ]);
      s.setActiveRequestId(id);
      await s.executeActiveRequest();
    });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('x-partner')).toBe('k=partner-key-987');
    const run = useWorkspaceStore.getState().local!.history.requestRuns[0];
    expect(run.requestHeaders).toEqual({
      'X-Partner': RUN_HIDDEN_VALUE,
      Accept: 'application/json',
    });
  });

  it('hides the decrypted variable in a stored JSON request body', async () => {
    await seedEncryptedToken();
    const fetchMock = stubFetch();
    await act(async () => {
      const s = useWorkspaceStore.getState();
      const id = s.addRequest(null);
      s.setRequestMethod(id, 'POST');
      s.setRequestUrl(id, 'https://admin.example.test/login');
      s.setRequestBody(id, { type: 'json', content: '{"note":"x {{ADMIN_TOKEN}} y"}' });
      s.setActiveRequestId(id);
      await s.executeActiveRequest();
    });

    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(`{"note":"x ${TOKEN} y"}`);
    const run = useWorkspaceStore.getState().local!.history.requestRuns[0];
    expect(run.requestBodyPreview).toBe(`{"note":"x ${RUN_HIDDEN_VALUE} y"}`);
  });

  it('refuses a form-data body that names the key in a text row', async () => {
    await seedEncryptedToken();
    const fetchMock = stubFetch();
    let id = '';
    await act(async () => {
      const s = useWorkspaceStore.getState();
      id = s.addRequest(null);
      s.setRequestMethod(id, 'POST');
      s.setRequestUrl(id, 'https://admin.example.test/upload');
      s.setRequestBody(id, {
        type: 'form-data',
        content: '',
        formRows: [
          { kind: 'text', key: 'secret', value: '{{ADMIN_TOKEN_ENCRYPTION_KEY}}', enabled: true },
          { kind: 'file', key: 'file', slotId: null, enabled: false },
        ],
      });
      s.setActiveRequestId(id);
      await s.executeActiveRequest();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().lastRun[id]?.error).toMatch(/^Not sent\./);
  });

  it('refuses a plan step that names the key and sends the others', async () => {
    await seedEncryptedToken();
    const fetchMock = stubFetch();
    let planId = '';
    await act(async () => {
      const s = useWorkspaceStore.getState();
      const leak = s.addRequest(null);
      s.setRequestUrl(leak, 'https://admin.example.test/?k={{ADMIN_TOKEN_ENCRYPTION_KEY}}');
      const ok = s.addRequest(null);
      s.setRequestUrl(ok, 'https://admin.example.test/ok');
      planId = s.addPlan('Admin');
      s.addPlanStep(planId, leak);
      s.addPlanStep(planId, ok);
      await s.runPlan(planId);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://admin.example.test/ok');
    const steps = useWorkspaceStore.getState().lastPlanResults[planId];
    expect(steps[0].passed).toBe(false);
    expect(steps[0].result.error).toMatch(/^Not sent\. \{\{ADMIN_TOKEN_ENCRYPTION_KEY\}\}/);
    expect(JSON.stringify(useWorkspaceStore.getState().local)).not.toContain(KEY_VALUE);
  });

  it('refuses a replay and a step retry that name the key', async () => {
    await seedEncryptedToken();
    const fetchMock = stubFetch();
    const id = await sendWithAuthorization('Bearer {{ADMIN_TOKEN_ENCRYPTION_KEY}}');
    const runId = useWorkspaceStore.getState().local!.history.requestRuns[0].id;

    let replay: Awaited<
      ReturnType<ReturnType<typeof useWorkspaceStore.getState>['replayRequestRun']>
    > = null;
    await act(async () => {
      replay = await useWorkspaceStore.getState().replayRequestRun(runId);
    });
    expect(replay).toMatchObject({ ok: false, error: expect.stringMatching(/^Not sent\./) });

    let planId = '';
    await act(async () => {
      const s = useWorkspaceStore.getState();
      planId = s.addPlan('Retry');
      s.addPlanStep(planId, id);
      await s.retryPlanStep(planId, 0);
    });
    expect(useWorkspaceStore.getState().lastPlanResults[planId][0].result.error).toMatch(
      /^Not sent\./,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
