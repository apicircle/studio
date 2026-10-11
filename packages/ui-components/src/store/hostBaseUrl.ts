import type { GitHostKind } from '@apicircle/git';

/**
 * The server address a host's session is connected to, per host.
 *
 * One table answers three questions the connect form used to answer the same
 * way for every host, with one optional field: whether the host has an address
 * to ask for at all, whether the session can work without it, and what the
 * value looks like. Read off the clients rather than guessed:
 *
 *   * **GitHub** — none. github.com is the only GitHub this connects to.
 *   * **GitLab** — optional. gitlab.com when blank; a self-managed GitLab is
 *     reached at its own `/api/v4`.
 *   * **Bitbucket** — optional, and blank for everyone: the client speaks
 *     Bitbucket Cloud's API only.
 *   * **Azure DevOps** — required. Its client builds
 *     `/{project}/_apis/git/repositories/{repo}` against a base URL that
 *     carries the ORGANISATION, so with no URL every call addresses nothing.
 *
 * The address is asked for once, on the session form, and recorded on the
 * session (`GitHostSession.apiBaseUrl`): the token was verified against that
 * server, so that server is the only one it is sent to.
 */
export interface HostBaseUrlField {
  /** The field's visible label, and its accessible name. */
  label: string;
  /** What a value looks like, shown while the field is empty. */
  placeholder: string;
  /** One line under the field: who fills it in, and what blank means. */
  hint: string;
  /** The host cannot be reached without it. */
  required: boolean;
}

export const HOST_BASE_URL_FIELD: Record<GitHostKind, HostBaseUrlField | null> = {
  github: null,
  gitlab: {
    label: 'API base URL',
    placeholder: 'https://gitlab.example.com/api/v4',
    hint: 'Only for a self-managed GitLab. Leave blank for gitlab.com.',
    required: false,
  },
  bitbucket: {
    label: 'API base URL',
    placeholder: 'https://api.bitbucket.org/2.0',
    hint: 'Leave blank for Bitbucket Cloud.',
    required: false,
  },
  'azure-devops': {
    label: 'Organisation URL',
    placeholder: 'https://dev.azure.com/your-org',
    hint: 'The address of your Azure DevOps organisation. Its projects and repos are listed from it.',
    required: true,
  },
};

export type ParsedHostBaseUrl =
  | { ok: true; baseUrl: string | undefined }
  | { ok: false; error: string };

/** Without its trailing slashes, so a join never doubles one up. */
function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

/** True when `host` needs an address and `value` does not hold one. */
export function isHostBaseUrlMissing(host: GitHostKind, value: string): boolean {
  return HOST_BASE_URL_FIELD[host]?.required === true && value.trim().length === 0;
}

/**
 * Parse what was typed into `host`'s address field.
 *
 * `baseUrl: undefined` means the host's public address. A host with no field
 * always parses to that, whatever `value` holds: the form keeps what was typed
 * per host, and this is the second lock on a URL typed for one host reaching
 * another host's token.
 */
export function parseHostBaseUrl(host: GitHostKind, value: string): ParsedHostBaseUrl {
  const field = HOST_BASE_URL_FIELD[host];
  if (!field) return { ok: true, baseUrl: undefined };

  const trimmed = trimTrailingSlashes(value.trim());
  if (!trimmed) {
    return field.required
      ? { ok: false, error: `Enter the ${field.label}, like ${field.placeholder}` }
      : { ok: true, baseUrl: undefined };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: `Enter a full URL, like ${field.placeholder}` };
  }
  // `new URL('localhost:3000')` parses, with `localhost:` as its scheme.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: `Enter a full URL, like ${field.placeholder}` };
  }
  // The one address that is right for nobody: Azure DevOps Services with no
  // organisation after it. A server of one's own may keep its collection in the
  // hostname, so only dev.azure.com is held to a path. (`URL` lower-cases the
  // hostname.)
  if (host === 'azure-devops' && url.hostname === 'dev.azure.com' && url.pathname === '/') {
    return { ok: false, error: `Add your organisation to the URL, like ${field.placeholder}` };
  }
  return { ok: true, baseUrl: trimmed };
}
