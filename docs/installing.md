# Installing APICircle Studio (Early Access)

> ⚠️ **Early Access — the desktop builds are not code-signed.**
> APICircle Studio is a pre-launch, self-funded project. Code signing requires
> paid certificates that renew every year — an Apple Developer Program
> membership for macOS and an EV code-signing certificate for Windows — and we
> have not been able to purchase them yet. Until we can, the desktop binaries
> ship **unsigned**, so the first launch (and each auto-update) triggers an OS
> security warning. **Nothing is wrong with the download** — this page walks
> through the one-time "allow" step on each platform.

Download the installer for your OS from the latest release at
**<https://github.com/apicircle/studio/releases/latest>**.

---

## macOS (`.dmg`)

1. Open the downloaded `.dmg` and drag **APICircle Studio** into your
   `/Applications` folder.
2. The first time you double-click the app, Gatekeeper will say:
   > _"APICircle Studio" cannot be opened because the developer cannot be verified._
3. Click **Cancel**.
4. Open **System Settings → Privacy & Security**, scroll to the
   _Security_ section, and click **Open Anyway** next to the
   APICircle Studio entry. (On older macOS: System Preferences → Security & Privacy → General.)
5. Re-launch the app. macOS will ask one more time — click **Open**.

After that, the app launches normally. Auto-updates land silently in the
background; the same "Open Anyway" approval is needed once per update
until we ship signed binaries.

## Windows (`.exe` installer)

1. Run the downloaded `APICircle Studio-<version>-win-x64.exe`.
2. Windows SmartScreen will show:
   > _Windows protected your PC._
3. Click **More info**, then **Run anyway**.
4. Follow the installer prompts.

Auto-updates download silently; when you click **Restart to install** in
the in-app banner, Windows may show the same warning again for the
update installer — repeat the _More info → Run anyway_ step.

## Linux (`.AppImage` / `.deb`)

- **AppImage**: `chmod +x APICircle Studio-<version>-linux-x86_64.AppImage`,
  then double-click or run from a terminal.
- **deb**: `sudo dpkg -i apicircle-studio_<version>_amd64.deb` (or use
  your package manager).

Linux does not enforce code-signing the same way; no extra approval is
needed.

---

## What's Early Access?

- The desktop binaries are **unsigned** until the project can fund
  code-signing certificates — the OS warning above is expected, not a sign
  of a tampered or unsafe download. Builds are produced in the open by this
  repository's GitHub Actions.
- We may ship breaking changes between minor releases until v1.0.
- Workspace data is stored locally and (optionally) synced via Git, so
  you keep ownership of your data even if the app changes.
- Auto-update will replace the app binary in place; your workspace is
  unaffected.

If you have questions or run into issues, please file an issue at
<https://github.com/apicircle/studio/issues>.
