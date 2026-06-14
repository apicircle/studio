import type * as vscode from 'vscode';

const SCHEME = 'apicircle';

export type UriEntityKind =
  | 'request'
  | 'folder'
  | 'response'
  | 'environment'
  | 'plan'
  | 'mock'
  | 'endpoint'
  | 'link'
  | 'releases';

/**
 * Determine the entity kind from an `apicircle://` URI using the path
 * prefix — `/requests/`, `/folders/`, `/mocks/`, etc. — instead of the
 * file extension. Returns `null` for non-apicircle URIs or unrecognised
 * paths.
 */
export function uriEntityKind(uri: vscode.Uri): UriEntityKind | null {
  if (uri.scheme !== SCHEME) return null;
  const p = uri.path;
  const slashIdx = p.indexOf('/', 1);
  const first = slashIdx === -1 ? p.slice(1) : p.slice(1, slashIdx);

  switch (first) {
    case 'requests':
      return 'request';
    case 'folders':
      return 'folder';
    case 'responses':
    case 'history':
      return 'response';
    case 'environments':
      return 'environment';
    case 'plans':
      return 'plan';
    case 'links':
      return 'link';
    case 'releases':
      return 'releases';
    case 'mocks': {
      const segments = p.split('/').filter(Boolean);
      return segments.length >= 3 ? 'endpoint' : 'mock';
    }
    case 'linked': {
      const query = new URLSearchParams(uri.query || '');
      return query.get('kind') === 'folder' ? 'folder' : 'request';
    }
    default:
      return null;
  }
}
