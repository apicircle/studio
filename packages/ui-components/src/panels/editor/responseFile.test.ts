import { describe, expect, it } from 'vitest';
import { responseFileExtension, responseFileName } from './responseFile';

describe('responseFileExtension', () => {
  it.each([
    ['json', undefined, 'json'],
    ['binary', 'application/pdf', 'bin'],
    ['text', 'application/xml', 'xml'],
    ['text', 'text/HTML; charset=utf-8', 'html'],
    ['text', 'text/csv', 'csv'],
    ['text', 'application/javascript', 'js'],
    ['text', 'application/x-yaml', 'yaml'],
    ['text', 'text/plain', 'txt'],
    ['text', undefined, 'txt'],
  ] as const)('%s with %s is .%s', (kind, contentType, extension) => {
    expect(responseFileExtension(kind, contentType)).toBe(extension);
  });
});

describe('responseFileName', () => {
  it('takes the last part of the path', () => {
    expect(responseFileName('https://api.test/v1/users', 'json', 'application/json')).toBe(
      'users.json',
    );
  });

  it('keeps an extension the name already has, once', () => {
    expect(responseFileName('https://api.test/export/report.CSV', 'text', 'text/csv')).toBe(
      'report.CSV',
    );
  });

  it('takes the host when the path is the root, and decodes and cleans the name', () => {
    expect(responseFileName('https://api.test/', 'text', 'text/plain')).toBe('api.test.txt');
    expect(responseFileName('https://api.test/files/my%20file%3F', 'text', undefined)).toBe(
      'my_file.txt',
    );
  });

  it('falls back to "response" for what it cannot read as a name', () => {
    // A template that never resolved is not a URL at all.
    expect(responseFileName('{{BASE}}/users', 'json', undefined)).toBe('response.json');
    // A broken escape cannot be decoded.
    expect(responseFileName('https://api.test/%E0%A4%A', 'json', undefined)).toBe('response.json');
    // A name of dots alone cleans away to nothing.
    expect(responseFileName('https://api.test/..._', 'json', undefined)).toBe('response.json');
  });
});
