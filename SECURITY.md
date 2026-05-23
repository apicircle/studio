# Security Policy

Thanks for helping keep API Circle Studio and the people who use it safe.

## Supported versions

API Circle Studio is in its early `1.0.x` line. Only the **latest published
version** in each distribution channel receives security fixes:

| Channel               | Supported                                    |
| --------------------- | -------------------------------------------- |
| `@apicircle/*` on npm | Latest `1.0.x` only                          |
| Desktop installers    | Latest GitHub release                        |
| Hosted web build      | The current deploy at `studio.apicircle.dev` |

Older versions will not receive backports. If you are running an older
release and believe you have found a vulnerability, please first confirm
it reproduces against the latest version.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security reports.**

Email security reports to:

> **apicircle365@gmail.com**

If possible, encrypt sensitive details. Include:

- A clear description of the vulnerability and its impact.
- Steps to reproduce, ideally with a minimal proof of concept.
- The version, channel (npm / desktop / web), and operating system you
  tested against.
- Any logs, stack traces, or screenshots that help triage.
- Whether you intend to publish details, and on what timeline.

## What to expect

This is a solo-maintained project. Best-effort response targets:

| Stage                               | Target                   |
| ----------------------------------- | ------------------------ |
| Acknowledgement of your report      | Within 5 business days   |
| Initial triage + severity estimate  | Within 10 business days  |
| Status update if a fix is in flight | At least every 14 days   |
| Public advisory after a fix ships   | Within 7 days of release |

If the timeline above slips for any reason, you will be told. If you do
not hear back within the acknowledgement window, please resend the email
in case it was filtered.

## Coordinated disclosure

We follow a **coordinated disclosure** model. Once a vulnerability has
been triaged, we ask reporters to hold public details for up to
**90 days** from acknowledgement, or until a fix has been released —
whichever comes first. We will work with you on a coordinated
disclosure date and credit you in the advisory unless you prefer to
remain anonymous.

If a vulnerability is being actively exploited or has been independently
disclosed, the timeline collapses to "as fast as we can ship a fix" and
the embargo is void.

## Out of scope

The following are not in scope for this policy:

- **Issues in third-party dependencies** that have not yet been picked
  up by an `@apicircle/*` release. Please report those to the upstream
  project. We will track their fixes via our normal dependency-update
  process.
- **Vulnerabilities that require a malicious workspace file the user
  has explicitly imported from an untrusted source.** Workspace files
  are user-controlled JSON; treat them like any other file you would
  open from the internet. We will still review reports of this kind,
  but they may be classified as defense-in-depth rather than
  vulnerabilities.
- **Brute-forcing a user's workspace passphrase or PAT** when those
  secrets are stored in the app's encrypted store. The user is
  responsible for choosing a strong passphrase; the encryption
  parameters are documented in the codebase.
- **Issues in the user's own GitHub repository, GitHub PAT, or hosting
  provider.** API Circle Studio does not operate any server-side state;
  these surfaces are outside our control.
- **Reports generated solely by automated scanners** without a
  demonstrated, reproducible impact.

## Safe-harbour for good-faith research

We will not pursue legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, data
  destruction, and service disruption.
- Report findings privately as described above and give a reasonable
  window for a fix before disclosing publicly.
- Only test against installations they own or have explicit permission
  to test.

Thank you for helping make API Circle Studio safer.
