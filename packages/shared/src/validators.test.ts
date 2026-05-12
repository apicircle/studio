import { describe, expect, it } from 'vitest';
import {
  validateAwsRegion,
  validateEnvVarName,
  validateHttpHeaderName,
  validateJsonPath,
  validateJsonString,
  validateMockPath,
  validatePRTitle,
  validatePlanName,
  validatePositiveDuration,
  validateRegex,
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

describe('validateHttpHeaderName', () => {
  it.each(['Authorization', 'X-Trace-Id', 'Content-Type', "X-Custom!#$%&'*+-.^_`|~", 'a1'])(
    'accepts %s',
    (v) => {
      expect(validateHttpHeaderName(v).ok).toBe(true);
    },
  );
  it.each(['', '   ', 'has space', 'has:colon', 'has(paren)', 'with\ttab'])('rejects %j', (v) => {
    expect(validateHttpHeaderName(v).ok).toBe(false);
  });
});

describe('validateRegex', () => {
  it('accepts a valid pattern', () => {
    expect(validateRegex('^[a-z]+$').ok).toBe(true);
    expect(validateRegex('foo', 'i').ok).toBe(true);
  });
  it('rejects an unclosed group', () => {
    expect(validateRegex('(unclosed').ok).toBe(false);
  });
  it('rejects an empty regex', () => {
    expect(validateRegex('').ok).toBe(false);
  });
});

describe('validateJsonPath', () => {
  it.each(['$', '$.foo', '$.foo.bar', '$.items[0]', '$.items[*].name', "$.a['x'].b"])(
    'accepts %s',
    (v) => {
      expect(validateJsonPath(v).ok).toBe(true);
    },
  );
  it.each(['', 'foo', '$.items[bad', '$[', '$.items[0'])('rejects %j', (v) => {
    expect(validateJsonPath(v).ok).toBe(false);
  });
});

describe('validatePositiveDuration', () => {
  it('accepts 0 and positive integers', () => {
    expect(validatePositiveDuration(0).ok).toBe(true);
    expect(validatePositiveDuration(1).ok).toBe(true);
    expect(validatePositiveDuration(15000).ok).toBe(true);
  });
  it('accepts numeric strings', () => {
    expect(validatePositiveDuration('500').ok).toBe(true);
  });
  it('rejects negatives, fractions, and non-numbers', () => {
    expect(validatePositiveDuration(-1).ok).toBe(false);
    expect(validatePositiveDuration(1.5).ok).toBe(false);
    expect(validatePositiveDuration('abc').ok).toBe(false);
    expect(validatePositiveDuration(Number.NaN).ok).toBe(false);
  });
});
