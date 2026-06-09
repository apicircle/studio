import { describe, it, expect } from 'vitest';
import type { Environment } from '@apicircle/shared';
import { serializeEnvironmentToYaml, parseEnvironmentFromYaml, EnvYamlParseError } from './envYaml';

function env(over: Partial<Environment> = {}): Environment {
  return {
    name: 'production',
    variables: [],
    ...over,
  };
}

describe('serializeEnvironmentToYaml', () => {
  it('emits name and variables list', () => {
    const yaml = serializeEnvironmentToYaml(
      env({
        variables: [
          { key: 'base_url', value: 'https://api.example.com', encrypted: false },
          { key: 'api_version', value: 'v1', encrypted: false },
        ],
      }),
    );
    expect(yaml).toContain('name: production');
    expect(yaml).toContain('base_url');
    expect(yaml).toContain('https://api.example.com');
    expect(yaml).toContain('api_version');
  });

  it('includes the header comment explaining encrypted vars', () => {
    const yaml = serializeEnvironmentToYaml(env());
    expect(yaml).toMatch(/APICircle Environment/);
    expect(yaml).toMatch(/Encrypted variables/);
  });

  it('omits encrypted field for plaintext variables', () => {
    const yaml = serializeEnvironmentToYaml(
      env({
        variables: [{ key: 'k', value: 'v', encrypted: false }],
      }),
    );
    expect(yaml).not.toContain('encrypted: false');
  });

  it('emits encrypted flag and secretKeyId for encrypted variables', () => {
    const yaml = serializeEnvironmentToYaml(
      env({
        variables: [
          { key: 'api_key', value: 'enc:v1:abc:xyz', encrypted: true, secretKeyId: 'ck_test' },
        ],
      }),
    );
    expect(yaml).toContain('encrypted: true');
    expect(yaml).toContain('secretKeyId: ck_test');
    expect(yaml).toContain('enc:v1:abc:xyz');
  });
});

describe('parseEnvironmentFromYaml', () => {
  it('round-trips an empty env', () => {
    const original = env();
    const { environment } = parseEnvironmentFromYaml(serializeEnvironmentToYaml(original));
    expect(environment.name).toBe('production');
    expect(environment.variables).toEqual([]);
  });

  it('round-trips an env with plaintext variables', () => {
    const original = env({
      variables: [
        { key: 'base_url', value: 'https://x.com', encrypted: false },
        { key: 'version', value: 'v1', encrypted: false },
      ],
    });
    const { environment } = parseEnvironmentFromYaml(serializeEnvironmentToYaml(original));
    expect(environment.variables).toHaveLength(2);
    expect(environment.variables[0]).toEqual({
      key: 'base_url',
      value: 'https://x.com',
      encrypted: false,
    });
  });

  it('round-trips an env with encrypted variables', () => {
    const original = env({
      variables: [
        { key: 'api_key', value: 'enc:v1:abc:xyz', encrypted: true, secretKeyId: 'ck_test' },
      ],
    });
    const { environment } = parseEnvironmentFromYaml(serializeEnvironmentToYaml(original));
    expect(environment.variables[0].encrypted).toBe(true);
    expect(environment.variables[0].secretKeyId).toBe('ck_test');
    expect(environment.variables[0].value).toBe('enc:v1:abc:xyz');
  });

  it('throws EnvYamlParseError on invalid YAML', () => {
    expect(() => parseEnvironmentFromYaml(':: !! not yaml ')).toThrow(EnvYamlParseError);
  });

  it('throws when name is missing', () => {
    expect(() => parseEnvironmentFromYaml('variables: []')).toThrow(/name/);
  });

  it('throws when root is not a mapping', () => {
    expect(() => parseEnvironmentFromYaml('- a\n- b')).toThrow(/Document root/);
  });

  it('warns but tolerates malformed variable rows', () => {
    const { environment, warnings } = parseEnvironmentFromYaml(
      'name: x\nvariables:\n  - junk\n  - { key: A, value: B }',
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(environment.variables).toHaveLength(1);
    expect(environment.variables[0].key).toBe('A');
  });

  it('defaults missing value to empty string', () => {
    const { environment } = parseEnvironmentFromYaml('name: x\nvariables:\n  - { key: K }');
    expect(environment.variables[0].value).toBe('');
  });

  it('defaults encrypted to false when absent', () => {
    const { environment } = parseEnvironmentFromYaml(
      'name: x\nvariables:\n  - { key: K, value: V }',
    );
    expect(environment.variables[0].encrypted).toBe(false);
  });
});
