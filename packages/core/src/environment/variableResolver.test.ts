import { describe, expect, it } from 'vitest';
import {
  buildScope,
  lookup,
  resolveString,
  resolveStringMap,
  type ResolutionScope,
} from './variableResolver';

const emptyScope = (overrides: Partial<ResolutionScope> = {}): ResolutionScope => ({
  contextVars: {},
  activeEnv: {},
  priorityEnvs: [],
  secrets: {},
  ...overrides,
});

describe('lookup', () => {
  it('returns context vars before active env', () => {
    expect(lookup(emptyScope({ contextVars: { X: 'ctx' }, activeEnv: { X: 'env' } }), 'X')).toBe(
      'ctx',
    );
  });

  it('returns active env when context lacks it', () => {
    expect(lookup(emptyScope({ activeEnv: { Y: 'env' } }), 'Y')).toBe('env');
  });

  it('falls through priority envs in order', () => {
    expect(
      lookup(
        emptyScope({
          priorityEnvs: [{ Z: 'first' }, { Z: 'second' }],
        }),
        'Z',
      ),
    ).toBe('first');
  });

  it('returns secrets last', () => {
    expect(lookup(emptyScope({ secrets: { TOKEN: 'sec' } }), 'TOKEN')).toBe('sec');
  });

  it('returns undefined for unknown names', () => {
    expect(lookup(emptyScope(), 'NOPE')).toBeUndefined();
  });

  it('respects own-property semantics — does not leak prototype', () => {
    expect(lookup(emptyScope(), 'toString')).toBeUndefined();
    expect(
      lookup(emptyScope({ activeEnv: { __proto__: 'leak' as unknown as never } }), 'toString'),
    ).toBeUndefined();
  });
});

describe('resolveString', () => {
  it('replaces a simple placeholder', () => {
    expect(
      resolveString('hello {{NAME}}', emptyScope({ activeEnv: { NAME: 'world' } })).value,
    ).toBe('hello world');
  });

  it('handles multiple placeholders', () => {
    expect(
      resolveString('{{A}}-{{B}}-{{A}}', emptyScope({ activeEnv: { A: '1', B: '2' } })).value,
    ).toBe('1-2-1');
  });

  it('tolerates whitespace inside braces', () => {
    expect(resolveString('{{  NAME  }}', emptyScope({ activeEnv: { NAME: 'ok' } })).value).toBe(
      'ok',
    );
  });

  it('leaves unknown placeholders verbatim and reports them as missing', () => {
    const r = resolveString('a {{X}} b {{Y}}', emptyScope({ activeEnv: { X: '1' } }));
    expect(r.value).toBe('a 1 b {{Y}}');
    expect(r.missing).toEqual(['Y']);
  });

  it('deduplicates the missing list', () => {
    const r = resolveString('{{X}} {{X}}', emptyScope());
    expect(r.missing).toEqual(['X']);
  });

  it('respects context > env > priority > secrets', () => {
    const scope: ResolutionScope = {
      contextVars: { K: 'ctx' },
      activeEnv: { K: 'env' },
      priorityEnvs: [{ K: 'pri' }],
      secrets: { K: 'sec' },
    };
    expect(resolveString('{{K}}', scope).value).toBe('ctx');
    expect(resolveString('{{K}}', { ...scope, contextVars: {} }).value).toBe('env');
    expect(resolveString('{{K}}', { ...scope, contextVars: {}, activeEnv: {} }).value).toBe('pri');
    expect(
      resolveString('{{K}}', {
        contextVars: {},
        activeEnv: {},
        priorityEnvs: [],
        secrets: { K: 'sec' },
      }).value,
    ).toBe('sec');
  });

  it('does not match malformed placeholders', () => {
    expect(resolveString('{NAME}', emptyScope({ activeEnv: { NAME: 'x' } })).value).toBe('{NAME}');
    expect(resolveString('{{1NAME}}', emptyScope()).value).toBe('{{1NAME}}');
    expect(resolveString('{{NAME', emptyScope({ activeEnv: { NAME: 'x' } })).value).toBe('{{NAME');
  });

  it('does not recursively resolve placeholders introduced by substitution', () => {
    // Resolving {{A}} → "{{B}}" must NOT then resolve {{B}}. Otherwise a
    // crafted env can build a substitution loop.
    expect(
      resolveString('{{A}}', emptyScope({ activeEnv: { A: '{{B}}', B: 'never-seen' } })).value,
    ).toBe('{{B}}');
  });
});

describe('resolveStringMap', () => {
  it('resolves both keys and values', () => {
    const r = resolveStringMap(
      { '{{HEADER_NAME}}': 'Bearer {{TOKEN}}' },
      emptyScope({ activeEnv: { HEADER_NAME: 'X-Auth', TOKEN: 'abc' } }),
    );
    expect(r.result).toEqual({ 'X-Auth': 'Bearer abc' });
    expect(r.missing).toEqual([]);
  });

  it('aggregates missing names across keys and values', () => {
    const r = resolveStringMap({ '{{K1}}': '{{K2}}' }, emptyScope());
    expect(r.missing.sort()).toEqual(['K1', 'K2']);
  });
});

describe('buildScope', () => {
  it('drops empty-key context vars', () => {
    const scope = buildScope({
      contextVars: [
        { key: '', value: 'ignored' },
        { key: 'A', value: '1' },
      ],
      environments: {},
      activeEnvName: null,
      priorityOrder: [],
    });
    expect(scope.contextVars).toEqual({ A: '1' });
  });

  it('picks the active env from the environments map', () => {
    const scope = buildScope({
      contextVars: [],
      environments: { dev: { K: 'dev' }, prod: { K: 'prod' } },
      activeEnvName: 'dev',
      priorityOrder: [],
    });
    expect(scope.activeEnv).toEqual({ K: 'dev' });
  });

  it('builds priorityEnvs in the requested order, excluding the active env', () => {
    const scope = buildScope({
      contextVars: [],
      environments: {
        dev: { D: 'd' },
        staging: { S: 's' },
        prod: { P: 'p' },
      },
      activeEnvName: 'dev',
      priorityOrder: ['dev', 'staging', 'prod'],
    });
    expect(scope.priorityEnvs).toEqual([{ S: 's' }, { P: 'p' }]);
  });

  it('treats unknown env names in priorityOrder as empty layers', () => {
    const scope = buildScope({
      contextVars: [],
      environments: { dev: { K: 'd' } },
      activeEnvName: null,
      priorityOrder: ['dev', 'missing'],
    });
    expect(scope.priorityEnvs).toEqual([{ K: 'd' }, {}]);
  });

  it('returns empty activeEnv when no active env is set', () => {
    const scope = buildScope({
      contextVars: [],
      environments: { dev: { K: 'd' } },
      activeEnvName: null,
      priorityOrder: [],
    });
    expect(scope.activeEnv).toEqual({});
  });

  it('passes through secrets verbatim', () => {
    const scope = buildScope({
      contextVars: [],
      environments: {},
      activeEnvName: null,
      priorityOrder: [],
      secrets: { TOKEN: 'abc' },
    });
    expect(scope.secrets).toEqual({ TOKEN: 'abc' });
  });
});
