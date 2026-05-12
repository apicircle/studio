import { describe, expect, it } from 'vitest';
import {
  validateAwsRegion,
  validateEnvVarName,
  validateJsonString,
  validateMockPath,
  validatePRTitle,
  validatePlanName,
  validateUrl,
} from './validators';

describe('validateUrl', () => {
  it.each(['https://api.example.com', 'http://localhost:3000/path', 'https://x.y/?a=1'])(
    'accepts %s',
    (v) => {
      expect(validateUrl(v).ok).toBe(true);
    },
  );
  it('accepts pure-template URLs', () => {
    expect(validateUrl('{{BASE_URL}}/users').ok).toBe(true);
  });
  it('accepts URLs with embedded templates', () => {
    expect(validateUrl('https://api.example.com/users/{{ID}}').ok).toBe(true);
  });
  it('rejects empty + whitespace', () => {
    expect(validateUrl('').ok).toBe(false);
    expect(validateUrl('   ').ok).toBe(false);
  });
  it('rejects nonsense', () => {
    expect(validateUrl('not a url').ok).toBe(false);
  });
  it('rejects unsupported schemes', () => {
    const r = validateUrl('ftp://x.y');
    expect(r.ok).toBe(false);
  });
});

describe('validateAwsRegion', () => {
  it.each(['us-east-1', 'eu-west-3', 'ap-southeast-2', 'us-gov-west-1', 'cn-north-1'])(
    'accepts %s',
    (v) => {
      expect(validateAwsRegion(v).ok).toBe(true);
    },
  );
  it('rejects empty', () => {
    expect(validateAwsRegion('').ok).toBe(false);
  });
  it('rejects malformed', () => {
    expect(validateAwsRegion('us-eastt-1').ok).toBe(false);
    expect(validateAwsRegion('useast1').ok).toBe(false);
    expect(validateAwsRegion('us_east_1').ok).toBe(false);
  });
});

describe('validateMockPath', () => {
  it.each(['/users', '/users/:id', '/files/*', '/'])('accepts %s', (v) => {
    expect(validateMockPath(v).ok).toBe(true);
  });
  it('rejects missing leading slash', () => {
    expect(validateMockPath('users').ok).toBe(false);
  });
  it('rejects whitespace', () => {
    expect(validateMockPath('/path with space').ok).toBe(false);
  });
  it('rejects query/fragment', () => {
    expect(validateMockPath('/users?a=1').ok).toBe(false);
    expect(validateMockPath('/users#x').ok).toBe(false);
  });
});

describe('validateEnvVarName', () => {
  it.each(['BASE_URL', 'apiKey', '_internal', 'a', 'API-KEY-1'])('accepts %s', (v) => {
    expect(validateEnvVarName(v).ok).toBe(true);
  });
  it('rejects empty + spaces + braces', () => {
    expect(validateEnvVarName('').ok).toBe(false);
    expect(validateEnvVarName('foo bar').ok).toBe(false);
    expect(validateEnvVarName('{{NAME}}').ok).toBe(false);
  });
  it('rejects names starting with a digit', () => {
    expect(validateEnvVarName('1var').ok).toBe(false);
  });
});

describe('validatePlanName', () => {
  it('accepts non-empty names with spaces', () => {
    expect(validatePlanName('Smoke tests').ok).toBe(true);
  });
  it('rejects empty', () => {
    expect(validatePlanName('  ').ok).toBe(false);
  });
  it('rejects > 80 chars', () => {
    expect(validatePlanName('a'.repeat(81)).ok).toBe(false);
  });
});

describe('validatePRTitle', () => {
  it('accepts non-empty', () => {
    expect(validatePRTitle('Add feature X').ok).toBe(true);
  });
  it('rejects empty', () => {
    expect(validatePRTitle('').ok).toBe(false);
  });
  it('rejects > 256 chars', () => {
    expect(validatePRTitle('a'.repeat(257)).ok).toBe(false);
  });
});

describe('validateJsonString', () => {
  it('accepts valid JSON object', () => {
    expect(validateJsonString('{"a":1}').ok).toBe(true);
  });
  it('accepts valid JSON array', () => {
    expect(validateJsonString('[1,2]').ok).toBe(true);
  });
  it('rejects empty by default', () => {
    expect(validateJsonString('').ok).toBe(false);
  });
  it('accepts empty when allowEmpty', () => {
    expect(validateJsonString('', { allowEmpty: true }).ok).toBe(true);
  });
  it('rejects malformed JSON', () => {
    expect(validateJsonString('{').ok).toBe(false);
  });
  it('rejects non-object root when allowRoots="object"', () => {
    expect(validateJsonString('[1]', { allowRoots: 'object' }).ok).toBe(false);
    expect(validateJsonString('"x"', { allowRoots: 'object' }).ok).toBe(false);
  });
  it('rejects non-array root when allowRoots="array"', () => {
    expect(validateJsonString('{"a":1}', { allowRoots: 'array' }).ok).toBe(false);
  });
});
