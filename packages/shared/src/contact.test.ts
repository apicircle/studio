import { describe, expect, it } from 'vitest';
import {
  CONTACT_EMAIL,
  CONTACT_MAILTO_URL,
  CONTACT_MAILTO_URLS,
  HELP_FEEDBACK_MAILTO_URL,
  HELP_FEEDBACK_SUBJECT,
} from './contact';

describe('contact links', () => {
  it('addresses every link to the contact address and nobody else', () => {
    for (const url of CONTACT_MAILTO_URLS) {
      const parsed = new URL(url);
      expect(parsed.protocol).toBe('mailto:');
      expect(parsed.pathname).toBe(CONTACT_EMAIL);
      // `to`, `cc` and `bcc` in the query would add recipients.
      expect([...parsed.searchParams.keys()].filter((key) => key !== 'subject')).toEqual([]);
    }
  });

  it('spells every link the way the URL parser does', () => {
    // Electron reports a pressed link in this form, and the desktop builds
    // compare it to these strings exactly.
    for (const url of CONTACT_MAILTO_URLS) expect(new URL(url).href).toBe(url);
  });

  it('starts the issue report with its subject', () => {
    expect(new URL(HELP_FEEDBACK_MAILTO_URL).searchParams.get('subject')).toBe(
      HELP_FEEDBACK_SUBJECT,
    );
    expect(new URL(CONTACT_MAILTO_URL).search).toBe('');
  });

  it('lists the two links it ships, and cannot be extended at runtime', () => {
    expect(CONTACT_MAILTO_URLS).toEqual([CONTACT_MAILTO_URL, HELP_FEEDBACK_MAILTO_URL]);
    expect(Object.isFrozen(CONTACT_MAILTO_URLS)).toBe(true);
  });
});
