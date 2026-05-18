# Authentication

APICircle Studio supports 17 auth schemes spanning shared-secret, signing-based, challenge-response, and OAuth2 flows. This document is the source of truth for what's implemented, where signing happens, what each grant requires from the host, and which gaps still exist.

> **Architecture summary**: signing primitives live in `@apicircle/core/auth/*` and are pure functions (browser-safe — no Node-only modules). `applyAuth` in `@apicircle/core/request/applyAuth.ts` wires the per-request auth into outgoing headers. `executeRequest` drives challenge-response retries (Digest 401, NTLM 3-way). OAuth2 callback flows route through a host-specific bridge (Electron localhost server in desktop, popup-window + BroadcastChannel in web).

---

## Implemented auth types

| Type                        | Token Acquisition                               | Refresh                      | Wire-Format Helper                     | Tests                                                            |
| --------------------------- | ----------------------------------------------- | ---------------------------- | -------------------------------------- | ---------------------------------------------------------------- |
| `none`                      | n/a                                             | n/a                          | n/a                                    | ✓                                                                |
| `inherit`                   | resolved upstream                               | n/a                          | n/a                                    | ✓                                                                |
| `bearer`                    | manual paste                                    | n/a                          | `applyAuth`                            | ✓                                                                |
| `basic`                     | manual paste                                    | n/a                          | `applyAuth` (UTF-8 base64)             | ✓                                                                |
| `api-key`                   | manual paste                                    | n/a                          | `applyAuth` (header / query / cookie)  | ✓                                                                |
| `custom-header`             | manual paste                                    | n/a                          | `applyAuth`                            | ✓                                                                |
| `oauth2-client-credentials` | `runClientCredentials` (token endpoint POST)    | `refreshToken`               | `applyAuth` (Bearer/DPoP)              | ✓ E2E vs mock IdP                                                |
| `oauth2-auth-code`          | browser redirect → `exchangeAuthCode`           | `refreshToken`               | `applyAuth` (Bearer/DPoP)              | ✓ E2E vs mock IdP                                                |
| `oauth2-pkce`               | PKCE-bound redirect → `exchangePkce`            | `refreshToken`               | `applyAuth` (Bearer/DPoP)              | ✓ E2E + RFC 7636 §4.6 vector                                     |
| `oauth2-password`           | `runRopc` (POST /token)                         | `refreshToken`               | `applyAuth` (Bearer/DPoP)              | ✓ E2E vs mock IdP                                                |
| `oauth2-implicit`           | browser redirect with fragment                  | n/a (no refresh per spec)    | `applyAuth` (Bearer)                   | ✓ Bridge + protocol                                              |
| `oauth2-device`             | `requestDeviceAuthorization` + `pollDeviceFlow` | n/a                          | `applyAuth` (Bearer)                   | ✓ E2E + slow_down/expired_token                                  |
| `aws-sigv4`                 | sign at apply-time                              | per-request                  | `applyAwsSigV4` (canonical+hmac chain) | ✓ inc. URI normalization, body-shapes, content-sha256            |
| `digest`                    | challenge-response (401 retry)                  | per-request (nonce rotation) | `buildDigestAuthHeader`                | ✓ RFC 2617 + RFC 7616 vectors + FIPS 180-4 SHA-512/256 NIST CAVS |
| `ntlm`                      | 3-way handshake (401 retry)                     | per-request                  | `buildNtlmType*`                       | ✓ Type-1/2/3 + MsvAvTimestamp + MIC ([MS-NLMP] §3.1.5.1.2)       |
| `hawk`                      | sign at apply-time                              | per-request                  | `buildHawkAuthHeader`                  | ✓ Mozilla README MAC vector + payload-hash reference vector      |
| `jwt-bearer`                | sign at apply-time (HS/RS/ES)                   | per-request                  | `signJwt`                              | ✓ HS round-trip + RS/ES asymmetric                               |

---

## Host requirements

| Host                                                           | Web (browser)                     | Desktop (Electron)              | CLI                                                |
| -------------------------------------------------------------- | --------------------------------- | ------------------------------- | -------------------------------------------------- |
| Shared-secret types (bearer / basic / api-key / custom-header) | ✓                                 | ✓                               | ✓                                                  |
| Signing types (SigV4 / Hawk / JWT)                             | ✓                                 | ✓                               | ✓                                                  |
| Challenge types (Digest / NTLM)                                | ✓ (browser fetch quirks for NTLM) | ✓                               | ✓                                                  |
| OAuth2 — client credentials / ROPC / refresh                   | ✓                                 | ✓                               | ✓                                                  |
| OAuth2 — auth-code / PKCE / implicit                           | ✓ via popup + BroadcastChannel    | ✓ via localhost callback server | ✗ (CLI flows defer to desktop or manual paste)     |
| OAuth2 — device flow                                           | ✓                                 | ✓                               | ✓ (terminal can show user_code + verification_uri) |

### Web popup mechanics

- The web build registers `apps/web/public/oauth-callback.html` as a static page. The IdP must be configured with `<deploy-origin>/oauth-callback.html` as a registered redirect URI.
- The popup reads `?code=…` (auth-code / PKCE) or `#access_token=…` (implicit) from `window.location`, posts the parsed payload over a `BroadcastChannel('apicircle-oauth-<state>')`, then closes itself.
- Falls back to `localStorage` ping when `BroadcastChannel` is unavailable (older browsers / privacy modes).

### Desktop callback server

- `apps/desktop/src/main/oauth2Server.ts` runs a Node http listener on 127.0.0.1 (loopback only).
- Port-finder walks `preferred..preferred+9` for collision recovery.
- Implicit-grant fragments are handled via a relay HTML page that promotes `location.hash` to query params on a self-redirect (browsers strip fragments before sending the URL to the server).

---

## Token storage

- `accessToken`, `refreshToken`, `expiresAt`, and `obtainedScope` live on the `RequestAuth` payload (one record per request).
- **Tokens are workspace-local — they're written to the same Git-pushed JSON as the rest of `RequestAuth`.** This is a deliberate decision: tokens belong to the workspace, and the only way to scope them per-user is via the existing secret-vault mechanism. If you want per-user tokens, reference an env var (`{{MY_TOKEN}}`) instead of pasting the token directly.

---

## Auto-refresh

`applyAuth` checks `expiresAt < Date.now() + refreshLeewayMs` (default 60 s) before injecting the bearer token. When the token is expiring AND a `refreshToken` is on file:

1. POSTs to the IdP's token endpoint with `grant_type=refresh_token`.
2. Hands the refreshed token to the optional `onTokenRefreshed` callback so the store can persist the new state.
3. Falls through silently if the refresh fails — the user gets a 401 that surfaces the staleness via the auth panel.

Implicit grants don't have refresh tokens (per RFC 6749 §4.2) so they skip auto-refresh.

---

## Known limitations

These are honest gaps documented for follow-up; none block the core flows.

1. **NTLM TCP affinity**: `fetch` doesn't guarantee the same socket across the 3-way handshake. Most servers tolerate this via HTTP/2 multiplexing or session cookies, but strict IIS / kerberos-only configs reject. Workaround: route NTLM through the desktop bridge with a node http-keep-alive agent (P-future).

2. **Digest `auth-int` for streaming / unsupported bodies**: `coerceEntityBody` throws a clear error when the body shape isn't `string | Uint8Array | ArrayBuffer | Blob` (e.g. `FormData` / `ReadableStream`). Auth-int requires the EXACT bytes the server sees; the engine won't silently hash an empty body. Workaround: serialize streaming bodies before sending.

3. **AWS SigV4 doesn't support multi-region S3 with virtual-hosted-style bucket DNS auto-detection**. Caller specifies `region` + `service` explicitly.

4. **Playwright UI specs only cover client-credentials & ROPC flows**. Auth-code / PKCE / implicit involve popup-window choreography that's tested at the protocol layer (`packages/core/src/auth/oauth2/e2e.test.ts` against an in-process mock IdP) but not yet through end-to-end Playwright.

5. **NTLM session signing / sealing** (NTLMSSP_NEGOTIATE_SIGN, NEGOTIATE_SEAL) is out of scope — TLS handles confidentiality for HTTP NTLM in practice. Add if a strict-policy customer needs it.

6. **OAuth2 with non-JSON token responses**: RFC 6749 §5.1 mandates JSON; some legacy IdPs return form-encoded. We surface a clear `invalid_response` error in that case rather than parsing both shapes.

7. **OAuth2 state HMAC binding is opt-in**: `generateOAuth2State()` defaults to a plain UUID nonce; pass a `context` argument to bind the state to `${clientId}:${redirectUri}` via HMAC-SHA-256. Closure-scoped state already prevents standard CSRF; the HMAC variant is defense-in-depth for stateless server flows.

---

## Test coverage

- **Core unit tests**: 510 (digest, NTLM, hawk, sigv4, jwt, oauth2 grants + PKCE + fetchToken + integration), including:
  - NIST CAVS SHA-512/256 vectors (`packages/core/src/auth/_sha512_256.test.ts`).
  - NTLM MIC computation against re-derived expected MAC (`packages/core/src/auth/ntlm.test.ts`).
  - Mozilla Hawk README MAC vector + payload-hash reference vector.
- **OAuth2 e2e**: 6 grants exercised against in-process mock IdP (`packages/core/src/auth/oauth2/e2e.test.ts`).
- **Auth panel UI**: WebBridge / DesktopBridge factory + state generator + HMAC-bound state validator (`packages/ui-components/src/auth/oauth2Bridge.test.ts`).
- **Desktop callback server**: 8 integration tests against real Node http (`apps/desktop/src/main/oauth2Server.test.ts`).
- **applyAuth / executeRequest**: Digest stale=true rotation, NTLM Type-3, JWT failure warnings, auto-refresh, all 9 sync auth types.

Run them all:

```sh
# from repo root
pnpm vitest run --no-coverage
```

---

## Reference vectors

| Helper                                                 | RFC vector                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `md5`                                                  | RFC 1321 §A.5                                                                                           |
| `md4`                                                  | RFC 1320 §A.5                                                                                           |
| `hmacMd5`                                              | RFC 2202 §2 (tests 1, 2, 6)                                                                             |
| `sha512_256`                                           | NIST CAVS / FIPS 180-4 §C.6 ("abc", empty, 112-byte multi-block)                                        |
| `parseDigestChallenge` + `buildDigestAuthHeader` (MD5) | RFC 2617 §3.5 worked example                                                                            |
| `buildDigestAuthHeader` (SHA-256)                      | RFC 7616 §3.9.1                                                                                         |
| `buildDigestAuthHeader` (SHA-512-256)                  | RFC 7616 §3.5.1 (FIPS 180-4 SHA-512/256)                                                                |
| `computeCodeChallenge` (S256)                          | RFC 7636 §4.6                                                                                           |
| `buildHawkAuthHeader` MAC                              | Mozilla Hawk README worked example                                                                      |
| `buildHawkAuthHeader` payload-hash                     | mozilla/hawk `Crypto.calculatePayloadHash` reference vector                                             |
| `buildNtlmType3Authenticate` MIC                       | re-derived from inputs per [MS-NLMP] §3.1.5.1.2                                                         |
| `applyAwsSigV4`                                        | AWS docs S3 GET-object credentials (self-snapshot signature; S3 PUT requires additional signed headers) |
