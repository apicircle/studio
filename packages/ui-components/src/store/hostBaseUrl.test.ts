import { describe, expect, it } from 'vitest';
import { GIT_HOST_KINDS, type GitHostKind } from '@apicircle/git';
import { HOST_BASE_URL_FIELD, isHostBaseUrlMissing, parseHostBaseUrl } from './hostBaseUrl';

// The connect form asked every host but GitHub for one optional "API base URL".
// That was untrue for Azure DevOps, whose organisation is in that URL and
// nowhere else, and it said nothing about what a value looks like.

describe('HOST_BASE_URL_FIELD', () => {
  it('asks GitHub for nothing, GitLab and Bitbucket optionally, and Azure DevOps always', () => {
    const shape = Object.fromEntries(
      GIT_HOST_KINDS.map((host) => {
        const field = HOST_BASE_URL_FIELD[host];
        return [host, field ? (field.required ? 'required' : 'optional') : 'none'];
      }),
    );
    expect(shape).toEqual({
      github: 'none',
      gitlab: 'optional',
      bitbucket: 'optional',
      'azure-devops': 'required',
    });
  });

  it('shows an example that is itself a value the field accepts', () => {
    for (const host of GIT_HOST_KINDS) {
      const field = HOST_BASE_URL_FIELD[host];
      if (!field) continue;
      expect(parseHostBaseUrl(host, field.placeholder)).toEqual({
        ok: true,
        baseUrl: field.placeholder,
      });
    }
  });

  it('names the Azure DevOps field for what goes in it', () => {
    expect(HOST_BASE_URL_FIELD['azure-devops']?.label).toBe('Organisation URL');
    expect(HOST_BASE_URL_FIELD['azure-devops']?.placeholder).toBe('https://dev.azure.com/your-org');
  });
});

describe('isHostBaseUrlMissing', () => {
  it('is true only for a host that needs an address and has none', () => {
    expect(isHostBaseUrlMissing('azure-devops', '')).toBe(true);
    expect(isHostBaseUrlMissing('azure-devops', '   ')).toBe(true);
    expect(isHostBaseUrlMissing('azure-devops', 'https://dev.azure.com/acme')).toBe(false);
    expect(isHostBaseUrlMissing('gitlab', '')).toBe(false);
    expect(isHostBaseUrlMissing('bitbucket', '')).toBe(false);
    expect(isHostBaseUrlMissing('github', '')).toBe(false);
  });
});

describe('parseHostBaseUrl', () => {
  it('reads blank as the public host where the address is optional', () => {
    expect(parseHostBaseUrl('gitlab', '')).toEqual({ ok: true, baseUrl: undefined });
    expect(parseHostBaseUrl('bitbucket', '   ')).toEqual({ ok: true, baseUrl: undefined });
  });

  it('refuses blank where the host cannot be reached without one', () => {
    const refused = {
      ok: false,
      error: 'Enter the Organisation URL, like https://dev.azure.com/your-org',
    };
    expect(parseHostBaseUrl('azure-devops', '  ')).toEqual(refused);
    // Nothing but slashes is nothing.
    expect(parseHostBaseUrl('azure-devops', '///')).toEqual(refused);
  });

  it('never returns an address for a host that has no field', () => {
    // The second lock on a URL typed for one host reaching another's token.
    expect(parseHostBaseUrl('github', 'https://gitlab.example.com/api/v4')).toEqual({
      ok: true,
      baseUrl: undefined,
    });
  });

  it('trims whitespace and trailing slashes, and keeps the rest as typed', () => {
    expect(parseHostBaseUrl('gitlab', '  https://gl.acme.dev/api/v4//  ')).toEqual({
      ok: true,
      baseUrl: 'https://gl.acme.dev/api/v4',
    });
    // A GitLab served under a sub-path keeps it.
    expect(parseHostBaseUrl('gitlab', 'https://acme.dev/gitlab/api/v4')).toEqual({
      ok: true,
      baseUrl: 'https://acme.dev/gitlab/api/v4',
    });
    // A loopback address over http is what a test host is.
    expect(parseHostBaseUrl('bitbucket', 'http://127.0.0.1:4010/bitbucket/2.0')).toEqual({
      ok: true,
      baseUrl: 'http://127.0.0.1:4010/bitbucket/2.0',
    });
  });

  it.each<[GitHostKind, string]>([
    ['gitlab', 'gitlab.example.com/api/v4'],
    ['gitlab', 'not a url'],
    // Parses, with `localhost:` as its scheme.
    ['gitlab', 'localhost:3000'],
    ['bitbucket', 'ftp://bitbucket.example.com'],
    ['azure-devops', 'dev.azure.com/acme'],
    ['azure-devops', 'acme'],
  ])('refuses %s "%s" as not a full URL, with the example', (host, value) => {
    expect(parseHostBaseUrl(host, value)).toEqual({
      ok: false,
      error: `Enter a full URL, like ${HOST_BASE_URL_FIELD[host]!.placeholder}`,
    });
  });

  it('refuses dev.azure.com with no organisation after it', () => {
    const refused = {
      ok: false,
      error: 'Add your organisation to the URL, like https://dev.azure.com/your-org',
    };
    expect(parseHostBaseUrl('azure-devops', 'https://dev.azure.com')).toEqual(refused);
    expect(parseHostBaseUrl('azure-devops', 'https://DEV.azure.com//')).toEqual(refused);
  });

  it('accepts an Azure DevOps organisation, and a server that keeps none in its path', () => {
    expect(parseHostBaseUrl('azure-devops', 'https://dev.azure.com/acme/')).toEqual({
      ok: true,
      baseUrl: 'https://dev.azure.com/acme',
    });
    expect(parseHostBaseUrl('azure-devops', 'https://acme.visualstudio.com')).toEqual({
      ok: true,
      baseUrl: 'https://acme.visualstudio.com',
    });
    expect(parseHostBaseUrl('azure-devops', 'https://tfs.acme.dev/DefaultCollection')).toEqual({
      ok: true,
      baseUrl: 'https://tfs.acme.dev/DefaultCollection',
    });
  });
});
