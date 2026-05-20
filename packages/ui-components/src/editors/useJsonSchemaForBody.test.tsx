import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useJsonSchemaForBody } from './useJsonSchemaForBody';

type DiagOptions = {
  validate?: boolean;
  allowComments?: boolean;
  schemas?: Array<{ uri: string; fileMatch?: string[]; schema?: object }>;
};

function fakeMonaco() {
  let opts: DiagOptions = { schemas: [] };
  const setDiagnosticsOptions = vi.fn((next: DiagOptions) => {
    opts = next;
  });
  const monaco = {
    languages: {
      json: {
        jsonDefaults: {
          get diagnosticsOptions() {
            return opts;
          },
          setDiagnosticsOptions,
        },
      },
    },
  } as unknown as Parameters<typeof useJsonSchemaForBody>[0];
  const fakeEditor = {} as Parameters<typeof useJsonSchemaForBody>[1];
  return { monaco, fakeEditor, setDiagnosticsOptions, getOpts: () => opts };
}

describe('useJsonSchemaForBody', () => {
  it('registers a schema with a fileMatch when valid JSON Schema is supplied', () => {
    const { monaco, fakeEditor, getOpts } = fakeMonaco();
    renderHook(() =>
      useJsonSchemaForBody(monaco, fakeEditor, {
        modelUri: 'inmemory://x.body',
        schemaId: 'sch-1',
        schemaText: '{"type":"object"}',
      }),
    );
    const opts = getOpts();
    expect(opts.validate).toBe(true);
    expect(opts.schemas).toEqual([
      { uri: 'sch-1', fileMatch: ['inmemory://x.body'], schema: { type: 'object' } },
    ]);
  });

  it('does nothing when schemaText is unparseable', () => {
    const { monaco, fakeEditor, setDiagnosticsOptions } = fakeMonaco();
    renderHook(() =>
      useJsonSchemaForBody(monaco, fakeEditor, {
        modelUri: 'inmemory://x.body',
        schemaId: 'sch-1',
        schemaText: '{not json',
      }),
    );
    // setDiagnosticsOptions is called once to clear, with no entry for sch-1.
    expect(setDiagnosticsOptions).toHaveBeenCalledTimes(1);
    const arg = setDiagnosticsOptions.mock.calls[0][0];
    expect((arg.schemas ?? []).find((s) => s.uri === 'sch-1')).toBeUndefined();
  });

  it('removes the schema on unmount', () => {
    const { monaco, fakeEditor, getOpts } = fakeMonaco();
    const { unmount } = renderHook(() =>
      useJsonSchemaForBody(monaco, fakeEditor, {
        modelUri: 'inmemory://x.body',
        schemaId: 'sch-1',
        schemaText: '{"type":"object"}',
      }),
    );
    expect(getOpts().schemas).toHaveLength(1);
    unmount();
    expect(getOpts().schemas).toEqual([]);
  });

  it('replaces an existing entry under the same schemaId', () => {
    const { monaco, fakeEditor, getOpts } = fakeMonaco();
    const { rerender } = renderHook(
      ({ text }) =>
        useJsonSchemaForBody(monaco, fakeEditor, {
          modelUri: 'inmemory://x.body',
          schemaId: 'sch-1',
          schemaText: text,
        }),
      { initialProps: { text: '{"type":"object"}' } },
    );
    rerender({ text: '{"type":"string"}' });
    const entries = getOpts().schemas?.filter((s) => s.uri === 'sch-1');
    expect(entries).toHaveLength(1);
    expect(entries![0].schema).toEqual({ type: 'string' });
  });
});
