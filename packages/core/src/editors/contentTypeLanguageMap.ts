// Maps Content-Type → Monaco language id for syntax highlighting +
// language services (JSON validation, etc). Pure module — no Monaco
// import here so the helper is usable in non-browser contexts (e.g.
// the mock server's response shaping).

export type MonacoLanguage = 'json' | 'xml' | 'html' | 'graphql' | 'javascript' | 'plaintext';

const CONTENT_TYPE_LANGUAGE_MAP: Readonly<Record<string, MonacoLanguage>> = {
  'application/json': 'json',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'text/html': 'html',
  'application/graphql': 'graphql',
  'application/javascript': 'javascript',
  'text/javascript': 'javascript',
  'text/plain': 'plaintext',
};

export function normalizeContentType(contentType?: string): string {
  if (!contentType) return '';
  return contentType.toLowerCase().split(';')[0]?.trim() ?? '';
}

export function getLanguageFromContentType(contentType?: string): MonacoLanguage {
  const normalized = normalizeContentType(contentType);
  if (!normalized) return 'plaintext';
  const direct = CONTENT_TYPE_LANGUAGE_MAP[normalized];
  if (direct) return direct;
  // +json / +xml suffixes per RFC 6838.
  if (normalized.endsWith('+json')) return 'json';
  if (normalized.endsWith('+xml')) return 'xml';
  return 'plaintext';
}

/**
 * Map a workspace BodyType to its Monaco language. Used by the editor
 * to set the right syntax highlighter even before Content-Type lands.
 */
export function getLanguageFromBodyType(
  bodyType: 'none' | 'json' | 'text' | 'urlencoded' | 'form-data' | 'binary' | 'xml' | 'graphql',
): MonacoLanguage {
  switch (bodyType) {
    case 'json':
      return 'json';
    case 'xml':
      return 'xml';
    case 'graphql':
      return 'graphql';
    case 'text':
    case 'urlencoded':
    case 'form-data':
    case 'binary':
    case 'none':
      return 'plaintext';
  }
}

export const supportedContentTypeLanguageMap = CONTENT_TYPE_LANGUAGE_MAP;
