# Privacy Policy

**Effective date:** 2026-05-23
**Version:** 1.0
**Applies to:** the hosted API Circle Studio web build at
**`studio.apicircle.dev`** (the "Site").

This Privacy Policy explains how the Site handles your information. It
**does not** cover the desktop application, the `@apicircle/*` npm
packages, the CLI, or any self-hosted deployment of the codebase — those
distributions run on your own machine or your own infrastructure and are
governed by your local environment.

---

## 1. Summary

- The Site is a **static web application** served by GitHub Pages.
- It is a **client-only** app: your workspaces, requests, environments,
  history, and secrets are stored locally in your browser's IndexedDB
  and never sent to any API Circle server (there is no API Circle
  server).
- The Site does not use cookies for tracking, does not run analytics,
  and does not embed third-party advertising or marketing pixels.
- Three categories of network traffic leave your browser when you use
  the Site, and you control all of them: requests to **GitHub** (for
  the Community section and, if you choose, to sync workspaces),
  requests to **whatever HTTP endpoints you yourself send from the
  app**, and requests to **GitHub Pages** to load the Site assets.

If those defaults are acceptable to you, you can stop reading. The rest
of this document is the detail.

---

## 2. Who is responsible

The Site is operated by the maintainer of the API Circle Studio open-
source project (the "Maintainer"). The Maintainer can be contacted at:

> **apicircle365@gmail.com**

There is no corporate entity, no employees, and no third-party
processor acting on the Maintainer's behalf in the operation of the
Site.

---

## 3. What the Site stores in your browser

When you use the Site, the following data is created and stored
**locally in your browser** (IndexedDB and, in limited cases, the
browser's standard storage APIs):

| Data                                               | Where                      | Sent off-device?                             |
| -------------------------------------------------- | -------------------------- | -------------------------------------------- |
| Workspaces (collections, environments, mocks)      | IndexedDB                  | No — unless you sync to GitHub               |
| Request history (URLs, headers, response data)     | IndexedDB                  | No                                           |
| Secrets (encrypted with your workspace passphrase) | IndexedDB                  | No                                           |
| GitHub session (Personal Access Token, if set)     | IndexedDB                  | Sent only to GitHub, when you trigger a sync |
| UI preferences (theme, panel layout, font)         | IndexedDB / `localStorage` | No                                           |
| Community stats cache (counters from GitHub)       | IndexedDB, 6-hour TTL      | No                                           |

You can clear all of this at any time by clearing site data for
`studio.apicircle.dev` in your browser settings. No copy is retained
anywhere else by the Maintainer.

---

## 4. What the Site sends over the network

### 4.1 Loading the Site

When your browser loads `studio.apicircle.dev`, the request is served
by **GitHub Pages** (operated by GitHub, Inc.). GitHub's own logging
and infrastructure processes apply. See
[GitHub's Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)
for what GitHub does with that data.

### 4.2 Community section

When you open Settings → Community, the Site makes a small number of
unauthenticated requests to `api.github.com` to display project
statistics (stars, contributors, latest release, open pull requests).
These requests are sent from your browser directly to GitHub. The
Maintainer does not receive a copy and does not log them. Results are
cached locally for 6 hours.

### 4.3 GitHub sync (optional)

If you configure a GitHub Personal Access Token and ask the Site to
push or pull a workspace, the Site uses that token to talk to
`api.github.com` and `github.com` directly from your browser. The
token and the workspace contents are sent **only to GitHub**. The
Maintainer never receives or stores them.

### 4.4 Requests you compose

The whole purpose of the Site is to let you compose and send HTTP
requests. When you click **Send**, the Site issues the request from
your browser to whatever endpoint you specified. The Maintainer is
not a party to that connection, does not proxy it, and does not log
it. Where the request goes, what it contains, and how the destination
treats it are entirely under your control.

---

## 5. What the Site does not do

The Site does **not**:

- Set tracking cookies or use third-party analytics
  (no Google Analytics, Plausible, PostHog, Segment, etc.).
- Embed advertising, marketing pixels, or social-media trackers.
- Sell, share, or rent any data — there is no data to sell.
- Collect telemetry, crash reports, or usage events back to the
  Maintainer.
- Authenticate you against any service operated by the Maintainer.
  There is no API Circle login.

---

## 6. Cookies and similar technologies

The Site does not set first-party cookies for tracking. GitHub Pages,
as the host, may set technical cookies necessary to serve the Site;
these are covered by GitHub's policies linked above.

`localStorage` and IndexedDB are used to store the workspace data
described in §3. These are local-only storage APIs; the data they hold
never leaves your browser unless you explicitly trigger an action
(e.g. a GitHub sync) that sends it elsewhere.

---

## 7. Data retention

- **Local data:** retained in your browser until you clear it. The
  Site does not have a remote copy.
- **Maintainer's email inbox:** if you write to
  `apicircle365@gmail.com` (for support, a security report, or any
  other reason), the Maintainer retains that correspondence for as
  long as is reasonably necessary to handle the topic, and then
  deletes it. Email is processed by Google's Gmail service under
  Google's privacy terms.

The Maintainer does not maintain any other database of user data
related to the Site.

---

## 8. Children

The Site is a developer tool and is not directed at children. The
Maintainer does not knowingly collect any personal data from anyone,
including children under 13 (or the equivalent minimum age in your
jurisdiction). If you believe a child has provided personal data via
the email contact above, please write to
`apicircle365@gmail.com` and it will be deleted.

---

## 9. Your rights

Because the Site does not hold a server-side copy of your data, the
Maintainer cannot provide most rights-based requests (access,
rectification, erasure, portability) against any remote dataset —
there isn't one. You hold the only copy, in your browser.

For data you sent to the Maintainer by email (see §7), you may:

- Request a copy of any correspondence on file.
- Request that the Maintainer delete that correspondence.
- Withdraw any consent you previously gave.

Email `apicircle365@gmail.com` to exercise these rights. If you believe
your rights under applicable data-protection law (such as GDPR in the
EU/UK, or the CCPA in California) have not been respected, you may
lodge a complaint with your local supervisory authority.

---

## 10. International users

The Site is served globally by GitHub Pages and is therefore
accessible from any country in which GitHub provides service. The
Maintainer is an individual; there is no controller establishment in
the EU/UK or any other jurisdiction. By using the Site, you
understand that any email correspondence with the Maintainer may be
processed in the country where the Maintainer is located and where
Google operates its Gmail infrastructure.

---

## 11. Third-party services we route to

The following third parties may receive data from your browser when
you use the Site, **at your direction**:

| Service               | When data flows to them                                         |
| --------------------- | --------------------------------------------------------------- |
| GitHub Pages          | On every page load, to serve the static Site assets.            |
| GitHub API            | When the Community section loads, or when you sync a workspace. |
| Endpoints you send to | Whenever you click **Send** in the request editor.              |
| Gmail (Google)        | Only if you email the Maintainer.                               |

Each of these has its own privacy policy. The Maintainer has no
contractual control over how they process the data.

---

## 12. Security

The Maintainer takes reasonable steps to protect the Site:

- Workspace passphrase-protected secrets are encrypted at rest in the
  browser (AES-GCM via the WebCrypto API) before being persisted to
  IndexedDB.
- The Site is served over HTTPS by GitHub Pages.
- Source code is open and auditable at the project's public
  repository.

No system is perfectly secure. If you discover a vulnerability,
please follow the [Security Policy](SECURITY.md) and report it
privately to `apicircle365@gmail.com`.

---

## 13. Changes to this policy

This policy may be updated as the Site evolves. Material changes
will be reflected in:

- An updated **Effective date** and **Version** at the top of this
  document.
- A note in the project [`CHANGELOG.md`](CHANGELOG.md).

Continued use of the Site after an update constitutes acceptance of
the revised policy.

---

## 14. Contact

For any question about this policy, or about how the Site handles
information:

> **apicircle365@gmail.com**
