/**
 * Where people write to us, and the `mailto:` links the apps ship for it.
 *
 * These live in `shared` because two packages that cannot import each other
 * must agree on them to the character: `ui-components` renders the links, and
 * `desktop-shell` decides which links the Electron main process may hand to the
 * operating system. A desktop build opens exactly the URLs spelled here and no
 * other `mailto:` — see `isContactMailto`.
 *
 * Each URL is written the way `new URL(url).href` spells it (tested), because
 * that is the form Electron reports when a link is pressed.
 */

/** The address a person can write to. */
export const CONTACT_EMAIL = 'contact@apicircle.dev';

/** An empty message to {@link CONTACT_EMAIL}. */
export const CONTACT_MAILTO_URL = `mailto:${CONTACT_EMAIL}`;

/** The subject the Help Center's "Open an issue" link starts a message with. */
export const HELP_FEEDBACK_SUBJECT = 'API Circle: issue report';

/** A message to {@link CONTACT_EMAIL} that reports an issue, subject filled in. */
export const HELP_FEEDBACK_MAILTO_URL = `${CONTACT_MAILTO_URL}?subject=${encodeURIComponent(HELP_FEEDBACK_SUBJECT)}`;

/** Every `mailto:` link the apps ship. */
export const CONTACT_MAILTO_URLS: readonly string[] = Object.freeze([
  CONTACT_MAILTO_URL,
  HELP_FEEDBACK_MAILTO_URL,
]);
