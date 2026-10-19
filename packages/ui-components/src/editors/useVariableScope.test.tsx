import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { collectVariableSuggestions, preSendValidation } from '@apicircle/core';
import type { Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useVariableScope } from './useVariableScope';

// The editor's scope must know which vault slots are encryption keys, the
// same way the send path does: autocomplete stops offering them, and the
// pre-send panel blocks a request that names one.

describe('useVariableScope — encryption keys', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  it('lists a slot that encrypts a variable as an encryption key, and leaves the rest secrets', async () => {
    await act(async () => {
      const s = useWorkspaceStore.getState();
      s.addEnvironment('staging');
      s.setPriorityOrder([{ kind: 'local', name: 'staging' }]);
      s.setVariables('staging', [{ key: 'ADMIN_TOKEN', value: 'tok', encrypted: false }]);
      const keyId = await s.addSecret({ label: 'ADMIN_KEY', value: 'slot-value' });
      await s.addSecret({ label: 'PARTNER_KEY', value: 'partner' });
      await s.bindVariableToSecretKey('staging', 0, keyId);
    });

    const { result } = renderHook(() => useVariableScope(null));

    expect(result.current.encryptionKeys).toEqual({ ADMIN_KEY: ['ADMIN_TOKEN'] });
    expect(collectVariableSuggestions(result.current).map((v) => v.key)).toEqual([
      'ADMIN_TOKEN',
      'PARTNER_KEY',
    ]);

    let requestId = '';
    act(() => {
      requestId = useWorkspaceStore.getState().addRequest(null);
    });
    const request: ApiRequest = {
      ...useWorkspaceStore.getState().synced!.collections.requests[requestId],
      headers: [{ key: 'Authorization', value: 'Bearer {{ADMIN_KEY}}', enabled: true }],
    };
    const verdict = preSendValidation({ request, scope: result.current });
    expect(verdict.blockers.map((b) => b.kind)).toContain('encryption-key-reference');
  });

  it('has no encryption keys before a workspace is loaded', () => {
    useWorkspaceStore.setState({ synced: null });
    const { result } = renderHook(() => useVariableScope(null));
    expect(result.current.encryptionKeys).toEqual({});
  });
});
