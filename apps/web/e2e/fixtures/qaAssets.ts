// Bridge from the manual-test fixture library at
// `e2e/qa/runner/fixtures/` into Playwright specs. Use this in any
// automation that exercises a case where a human tester would pick a
// seeded body / binary / schema / import file. Reusing these means a
// failure in automation reproduces what the manual run sees.
//
// The fixture files are produced by `e2e/qa/runner/fixtures_seed.py`
// (run once, idempotent). The catalog is `e2e/qa/runner/fixtures/
// CATALOG.md`.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const QA_FIXTURES_ROOT = resolve(__dirname, '../../../../e2e/qa/runner/fixtures');

function p(rel: string): string {
  return resolve(QA_FIXTURES_ROOT, rel);
}

/**
 * Map of named manual-test fixtures → absolute paths. Specs reference
 * these by symbolic name so a rename in the seed script does NOT silently
 * break automation (the import here would fail-fast).
 */
export const qaAssetPaths = {
  bodies: {
    sampleJson: p('bodies/sample.json'),
    sampleDeepJson: p('bodies/sample-deep.json'),
    sampleUnicodeJson: p('bodies/sample-unicode.json'),
    sampleXml: p('bodies/sample.xml'),
    sampleHtml: p('bodies/sample.html'),
    sampleTxt: p('bodies/sample.txt'),
    sampleUtf16Le: p('bodies/sample-utf16-le.txt'),
    sampleUtf16Be: p('bodies/sample-utf16-be.txt'),
    sampleIso88591: p('bodies/sample-iso8859-1.txt'),
    injectionCrlf: p('bodies/injection-crlf.txt'),
    large100kb: p('bodies/large-100kb.json'),
    huge1mb: p('bodies/huge-1mb.json'),
    invalidUnquotedKey: p('bodies/invalid-unquoted-key.json'),
    invalidTrailingComma: p('bodies/invalid-trailing-comma.json'),
    invalidNan: p('bodies/invalid-nan.json'),
  },
  binary: {
    samplePng: p('binary/sample.png'),
    samplePdf: p('binary/sample.pdf'),
    sample1kb: p('binary/sample-1kb.bin'),
    sample10kb: p('binary/sample-10kb.bin'),
    empty: p('binary/empty.bin'),
    unicodeFilename: p('binary/测试-文件.bin'),
  },
  imports: {
    postmanV21Simple: p('import/postman-v21-simple.json'),
    postmanV21Auth: p('import/postman-v21-auth.json'),
    postmanEnvironment: p('import/postman-environment.json'),
    openapi3Simple: p('import/openapi-3-simple.yaml'),
    openapi3Circular: p('import/openapi-3-circular.yaml'),
    insomniaV4: p('import/insomnia-v4.json'),
    sampleHar: p('import/sample.har'),
  },
  curl: {
    simple: p('curl/simple.txt'),
    postJson: p('curl/post-json.txt'),
    multipart: p('curl/multipart.txt'),
    multiline: p('curl/multiline.txt'),
    urlencoded: p('curl/urlencoded.txt'),
  },
  schemas: {
    user: p('schemas/user.schema.json'),
    team: p('schemas/team.schema.json'),
    tree: p('schemas/tree.schema.json'),
    composition: p('schemas/composition.schema.json'),
  },
  workspaces: {
    empty: p('workspaces/empty-ws.json'),
    seeded: p('workspaces/seeded-ws.json'),
  },
  oauth: {
    mockIdpConfig: p('oauth/mock-idp-config.json'),
  },
  git: {
    twoDeviceInit: p('git/two-device-init.sh'),
  },
} as const;

/** Read a seeded text fixture (UTF-8). */
export function readQaText(absPath: string): string {
  return readFileSync(absPath, 'utf-8');
}

/** Read a seeded binary fixture. */
export function readQaBytes(absPath: string): Buffer {
  return readFileSync(absPath);
}

/**
 * Load a fixture as a Playwright FileChooser-compatible object so it can
 * be passed to `fileInput.setInputFiles({...})` without re-reading disk
 * inside the test.
 */
export function asPlaywrightFile(
  absPath: string,
  mimeType: string,
  rename?: string,
): { name: string; mimeType: string; buffer: Buffer } {
  const buffer = readFileSync(absPath);
  const fallbackName = absPath.replace(/.*[\\/]/, '');
  return { name: rename ?? fallbackName, mimeType, buffer };
}
