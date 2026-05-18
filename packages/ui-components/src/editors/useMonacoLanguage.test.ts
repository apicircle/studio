import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useMonacoLanguage } from './useMonacoLanguage';

describe('useMonacoLanguage', () => {
  it('returns plaintext when content type is undefined', () => {
    const { result } = renderHook(() => useMonacoLanguage(undefined));
    expect(result.current).toBe('plaintext');
  });

  it('maps application/json → json', () => {
    const { result } = renderHook(() => useMonacoLanguage('application/json'));
    expect(result.current).toBe('json');
  });

  it('strips charset parameters', () => {
    const { result } = renderHook(() => useMonacoLanguage('application/json; charset=utf-8'));
    expect(result.current).toBe('json');
  });

  it('honors +xml suffix', () => {
    const { result } = renderHook(() => useMonacoLanguage('application/atom+xml'));
    expect(result.current).toBe('xml');
  });
});
