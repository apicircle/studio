import { describe, expect, it } from 'vitest';
import type { Folder, RequestAuth } from '@apicircle/shared';
import { resolveInheritedAuth } from './resolveInheritedAuth';

const NONE: RequestAuth = { type: 'none' };
const INHERIT: RequestAuth = { type: 'inherit' };
const BEARER: RequestAuth = { type: 'bearer', token: 'parent-tok' };
const BASIC: RequestAuth = { type: 'basic', username: 'u', password: 'p' };

const folder = (id: string, parentId: string | null, auth?: RequestAuth): Folder => ({
  id,
  name: id,
  parentId,
  auth,
});

describe('resolveInheritedAuth', () => {
  it('returns the request auth unchanged when not inherit', () => {
    expect(
      resolveInheritedAuth({
        requestAuth: BEARER,
        folderId: null,
        folders: {},
      }),
    ).toEqual(BEARER);
  });

  it('inherit + no folder = none', () => {
    expect(
      resolveInheritedAuth({
        requestAuth: INHERIT,
        folderId: null,
        folders: {},
      }),
    ).toEqual(NONE);
  });

  it('inherit + parent folder with auth = parent auth', () => {
    const folders = { f1: folder('f1', null, BEARER) };
    expect(
      resolveInheritedAuth({
        requestAuth: INHERIT,
        folderId: 'f1',
        folders,
      }),
    ).toEqual(BEARER);
  });

  it('inherit walks up past folders with no auth', () => {
    const folders = {
      child: folder('child', 'mid'),
      mid: folder('mid', 'root'),
      root: folder('root', null, BASIC),
    };
    expect(
      resolveInheritedAuth({
        requestAuth: INHERIT,
        folderId: 'child',
        folders,
      }),
    ).toEqual(BASIC);
  });

  it('inherit walks up past folders with auth.type === none', () => {
    const folders = {
      child: folder('child', 'parent', NONE),
      parent: folder('parent', null, BEARER),
    };
    expect(
      resolveInheritedAuth({
        requestAuth: INHERIT,
        folderId: 'child',
        folders,
      }),
    ).toEqual(BEARER);
  });

  it('inherit walks up past folders that themselves inherit', () => {
    const folders = {
      child: folder('child', 'parent', INHERIT),
      parent: folder('parent', null, BEARER),
    };
    expect(
      resolveInheritedAuth({
        requestAuth: INHERIT,
        folderId: 'child',
        folders,
      }),
    ).toEqual(BEARER);
  });

  it('inherit with no auth anywhere up the chain = none', () => {
    const folders = {
      a: folder('a', 'b'),
      b: folder('b', null),
    };
    expect(
      resolveInheritedAuth({
        requestAuth: INHERIT,
        folderId: 'a',
        folders,
      }),
    ).toEqual(NONE);
  });

  it('uses the nearest folder, not the deepest one', () => {
    const folders = {
      child: folder('child', 'parent', BEARER),
      parent: folder('parent', null, BASIC),
    };
    expect(
      resolveInheritedAuth({
        requestAuth: INHERIT,
        folderId: 'child',
        folders,
      }),
    ).toEqual(BEARER);
  });

  it('defends against parentId cycles', () => {
    const folders = {
      a: folder('a', 'b'),
      b: folder('b', 'a'),
    };
    expect(
      resolveInheritedAuth({
        requestAuth: INHERIT,
        folderId: 'a',
        folders,
      }),
    ).toEqual(NONE);
  });

  it('inherits api-key auth with addTo=header (the X-API-Key folder-auth bug)', () => {
    // Regression: a folder set to inject `X-API-Key` as a request header
    // must propagate to descendants whose request auth is `inherit`. The
    // resolver returning the api-key auth unchanged is what enables
    // `applyAuth` to set the header on the wire.
    const apiKeyAuth: RequestAuth = {
      type: 'api-key',
      key: 'X-API-Key',
      value: 'secret-123',
      addTo: 'header',
    };
    const folders = { f1: folder('f1', null, apiKeyAuth) };
    expect(
      resolveInheritedAuth({
        requestAuth: INHERIT,
        folderId: 'f1',
        folders,
      }),
    ).toEqual(apiKeyAuth);
  });

  it('inherits api-key auth with addTo=cookie (cookie auth via api-key path)', () => {
    const apiKeyCookie: RequestAuth = {
      type: 'api-key',
      key: 'session',
      value: 'abc',
      addTo: 'cookie',
    };
    const folders = { f1: folder('f1', null, apiKeyCookie) };
    expect(
      resolveInheritedAuth({
        requestAuth: INHERIT,
        folderId: 'f1',
        folders,
      }),
    ).toEqual(apiKeyCookie);
  });

  it('inherits api-key auth with addTo=query', () => {
    const apiKeyQuery: RequestAuth = {
      type: 'api-key',
      key: 'apiKey',
      value: 'q-val',
      addTo: 'query',
    };
    const folders = { f1: folder('f1', null, apiKeyQuery) };
    expect(
      resolveInheritedAuth({
        requestAuth: INHERIT,
        folderId: 'f1',
        folders,
      }),
    ).toEqual(apiKeyQuery);
  });
});
