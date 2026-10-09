import { CONTACT_MAILTO_URLS } from '@apicircle/shared';
import { assertHttpUrl } from './assertHttpUrl';

/**
 * Whether `value` is one of the `mailto:` links the apps ship, to the character.
 *
 * `assertHttpUrl` refuses every scheme but http(s), because anything else can be
 * a registered OS protocol handler. A message to our own contact address is the
 * one exception a window-open handler makes, and it is made by exact match
 * rather than by scheme: a `mailto:` to any other address, or with a recipient,
 * a body or an attachment added, is not one of these strings and is refused
 * like any other non-http(s) link. The list is compile-time data in the main
 * process, so nothing a page renders can add to it.
 */
export function isContactMailto(value: unknown): value is string {
  return typeof value === 'string' && CONTACT_MAILTO_URLS.includes(value);
}

/**
 * The URL a window-open handler may hand to `shell.openExternal`: one of the
 * contact links above as it is, or else whatever `assertHttpUrl` accepts.
 * Throws for everything else, as `assertHttpUrl` does.
 */
export function assertOpenableUrl(value: unknown, label: string): string {
  return isContactMailto(value) ? value : assertHttpUrl(value, label);
}
