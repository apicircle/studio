import { describe, expect, it } from 'vitest';
import { CONTACT_MAILTO_URL, HELP_FEEDBACK_MAILTO_URL } from '@apicircle/shared';
import { assertOpenableUrl, isContactMailto } from './contactMailto';

describe('isContactMailto', () => {
  it('accepts the links the apps ship', () => {
    expect(isContactMailto(CONTACT_MAILTO_URL)).toBe(true);
    expect(isContactMailto(HELP_FEEDBACK_MAILTO_URL)).toBe(true);
  });

  it('refuses a message to anybody else', () => {
    expect(isContactMailto('mailto:someone@example.com')).toBe(false);
    expect(isContactMailto(`${CONTACT_MAILTO_URL}.evil.example`)).toBe(false);
  });

  it('refuses a shipped link with anything added to it', () => {
    // A recipient, a body or an attachment in the query is how a link to our
    // own address would carry somebody else's data, or reach somebody else.
    expect(isContactMailto(`${CONTACT_MAILTO_URL}?cc=someone@example.com`)).toBe(false);
    expect(isContactMailto(`${HELP_FEEDBACK_MAILTO_URL}&body=secrets`)).toBe(false);
    expect(isContactMailto(`${HELP_FEEDBACK_MAILTO_URL}&bcc=someone@example.com`)).toBe(false);
    expect(isContactMailto(`${CONTACT_MAILTO_URL}?subject=Another%20subject`)).toBe(false);
  });

  it('refuses another spelling of the same address', () => {
    expect(isContactMailto(CONTACT_MAILTO_URL.toUpperCase())).toBe(false);
    expect(isContactMailto(` ${CONTACT_MAILTO_URL}`)).toBe(false);
  });

  it('refuses other schemes and non-strings', () => {
    expect(isContactMailto('https://apicircle.dev/')).toBe(false);
    expect(isContactMailto('ms-msdt:/id')).toBe(false);
    expect(isContactMailto('')).toBe(false);
    expect(isContactMailto(undefined)).toBe(false);
    expect(isContactMailto([CONTACT_MAILTO_URL])).toBe(false);
  });
});

describe('assertOpenableUrl', () => {
  it('returns a contact link exactly as it was given', () => {
    expect(assertOpenableUrl(CONTACT_MAILTO_URL, 'url')).toBe(CONTACT_MAILTO_URL);
    expect(assertOpenableUrl(HELP_FEEDBACK_MAILTO_URL, 'url')).toBe(HELP_FEEDBACK_MAILTO_URL);
  });

  it('holds everything else to the http(s) rule', () => {
    expect(assertOpenableUrl('https://apicircle.dev/docs', 'url')).toBe(
      'https://apicircle.dev/docs',
    );
    expect(() => assertOpenableUrl('mailto:someone@example.com', 'url')).toThrow(
      /must use https: or http:/,
    );
    expect(() => assertOpenableUrl(`${HELP_FEEDBACK_MAILTO_URL}&body=secrets`, 'url')).toThrow(
      /must use https: or http:/,
    );
    expect(() => assertOpenableUrl('ms-msdt:/id', 'url')).toThrow(/must use https: or http:/);
    expect(() => assertOpenableUrl(42, 'url')).toThrow(/non-empty string/);
  });
});
