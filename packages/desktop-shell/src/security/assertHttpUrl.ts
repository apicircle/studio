// Only http(s) URLs are safe to hand to shell.openExternal — anything else
// can be a registered OS protocol handler (smb:, ms-msdt:, file:, etc.) and
// becomes an RCE vector when the renderer or workspace data is compromised.
// Shared by the OAuth2 bridge (authorize URLs) and the main-process
// window-open handler.
export function assertHttpUrl(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192) {
    throw new Error(`${label} must be a non-empty string under 8192 chars`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${label} must use https: or http: (got ${parsed.protocol})`);
  }
  // http: is only allowed for explicit localhost dev IdPs — everywhere else
  // we require https: so a malicious workspace can't downgrade transports.
  if (parsed.protocol === 'http:') {
    const host = parsed.hostname;
    const isLoopback =
      host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
    if (!isLoopback) {
      throw new Error(`${label} http: is only permitted for localhost (got ${host})`);
    }
  }
  return parsed.toString();
}
