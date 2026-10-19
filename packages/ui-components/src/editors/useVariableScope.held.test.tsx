import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { collectVariableSuggestions, resolveString } from '@apicircle/core';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useVariableScope } from './useVariableScope';

// An extracted value held in memory because it looks like a credential is a
// context variable to the editor too — known to autocomplete, the resolved-URL
// preview and pre-send validation — but its value is never shown.

describe('useVariableScope — held extracted values', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  it('offers a held value by name, masked, beside the saved ones', () => {
    const local = useWorkspaceStore.getState().local!;
    act(() => {
      useWorkspaceStore.setState({
        local: { ...local, globalContext: { USER_ID: '42' } },
        heldContext: { AUTH: { value: 'login-token-value', reason: 'named like a credential' } },
      });
    });

    const { result } = renderHook(() => useVariableScope(null));

    expect(result.current.contextVars).toEqual({ USER_ID: '42', AUTH: '••••' });
    expect(resolveString('Bearer {{AUTH}}', result.current).value).toBe('Bearer ••••');
    expect(JSON.stringify(collectVariableSuggestions(result.current))).not.toContain(
      'login-token-value',
    );
  });
});
