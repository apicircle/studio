import * as vscode from 'vscode';
import { buildReleaseEntry, parseSemver } from '@apicircle/core';
import type { ReleaseVersion } from '@apicircle/shared';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { ApicircleFsProvider } from '../fs/apicircleFsProvider';

// =============================================================================
// Release-ledger commands (synced.releases.self).
//
// These drive the read-only `releases.yaml` view's CodeLens actions and the
// Link Workspaces sidebar:
//
//   • apicircle.openReleaseHistory  — open releases.yaml for the active ws
//   • apicircle.publishRelease      — cut a new version (QuickPick bump + notes)
//   • apicircle.deprecateRelease    — soft signal (confirm)
//   • apicircle.withdrawRelease     — hard signal (typed confirm)
//
// Publishing computes the SHA-256 snapshot via the core `buildReleaseEntry`
// (async), then routes the resulting entry through the pure `release.publish`
// patch so the same `applyMutation` reducers the UI / CLI / MCP use stay the
// single source of truth. Tagging on GitHub + marketplace topics are NOT here
// — those are network operations handled by the Desktop Git surfaces.
// =============================================================================

export interface ReleaseActionsDeps {
  bridge: VsCodeBridge;
  fsProvider: ApicircleFsProvider;
}

/** `apicircle.openReleaseHistory` — open the active workspace's release ledger. */
export async function openReleaseHistoryCommand(deps: ReleaseActionsDeps): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active API Circle workspace.');
    return;
  }
  const uri = ApicircleFsProvider.releasesUri(active.workspace.id);
  await vscode.commands.executeCommand('vscode.open', uri);
}

/** `apicircle.publishRelease` — cut a new release of the active workspace. */
export async function publishReleaseCommand(deps: ReleaseActionsDeps): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active API Circle workspace.');
    return;
  }
  const state = await active.read();
  const ledger = state.synced.releases.self;
  const existing = new Set((ledger?.versions ?? []).map((v) => v.version));

  const version = await pickNewVersion(ledger?.currentVersion ?? null, existing);
  if (!version) return;

  const notes = await vscode.window.showInputBox({
    prompt: `Release notes for v${version} (markdown, optional)`,
    placeHolder: 'Summary of what changed in this version',
  });
  // `undefined` = user pressed Esc → cancel; empty string = published with no notes.
  if (notes === undefined) return;

  const confirm = await vscode.window.showInformationMessage(
    `Publish v${version}? This appends the version to releases.self and bumps currentVersion. Push your working branch to share it.`,
    { modal: true },
    'Publish',
  );
  if (confirm !== 'Publish') return;

  let entry: ReleaseVersion;
  try {
    entry = await buildReleaseEntry(state.synced, { version, notes });
  } catch (e) {
    await vscode.window.showErrorMessage(
      `Could not build release: ${e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }
  try {
    await active.apply({ kind: 'release.publish', entry });
  } catch (e) {
    await vscode.window.showErrorMessage(
      `Publish failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }
  refreshReleasesDoc(deps, active.workspace.id);
  await vscode.commands.executeCommand(
    'vscode.open',
    ApicircleFsProvider.releasesUri(active.workspace.id),
  );
  await vscode.window.showInformationMessage(`Published v${version}.`);
}

/** `apicircle.deprecateRelease` — soft-deprecate a published version. */
export async function deprecateReleaseCommand(
  deps: ReleaseActionsDeps,
  arg?: { version?: string },
): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active API Circle workspace.');
    return;
  }
  const version =
    arg?.version ??
    (await pickVersion(deps, 'Deprecate which version?', (v) => !v.deprecated, 'to deprecate'));
  if (!version) return;

  const confirm = await vscode.window.showWarningMessage(
    `Deprecate v${version}? Consumers see a warning but the version stays installable.`,
    { modal: true },
    'Deprecate',
  );
  if (confirm !== 'Deprecate') return;

  try {
    await active.apply({ kind: 'release.deprecate', version });
  } catch (e) {
    await vscode.window.showErrorMessage(
      `Deprecate failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }
  refreshReleasesDoc(deps, active.workspace.id);
  await vscode.window.showInformationMessage(`Deprecated v${version}.`);
}

/** `apicircle.withdrawRelease` — hard-withdraw (yank) a published version. */
export async function withdrawReleaseCommand(
  deps: ReleaseActionsDeps,
  arg?: { version?: string },
): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active API Circle workspace.');
    return;
  }
  const version =
    arg?.version ??
    (await pickVersion(deps, 'Withdraw which version?', (v) => !v.yanked, 'to withdraw'));
  if (!version) return;

  // Typed confirmation — withdrawing signals the version is broken / unsafe.
  const typed = await vscode.window.showInputBox({
    prompt: `Type "WITHDRAW v${version}" to confirm — consumers will be warned to move off this version.`,
    placeHolder: `WITHDRAW v${version}`,
    validateInput: (v) =>
      v.trim() === `WITHDRAW v${version}` ? null : `Type exactly: WITHDRAW v${version}`,
  });
  if (typed?.trim() !== `WITHDRAW v${version}`) return;

  try {
    await active.apply({ kind: 'release.yank', version });
  } catch (e) {
    await vscode.window.showErrorMessage(
      `Withdraw failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }
  refreshReleasesDoc(deps, active.workspace.id);
  await vscode.window.showInformationMessage(`Withdrew v${version}.`);
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/** Re-render the open releases.yaml so the CodeLens + content reflect the write. */
function refreshReleasesDoc(deps: ReleaseActionsDeps, workspaceId: string): void {
  deps.fsProvider.fireChangedExternal(ApicircleFsProvider.releasesUri(workspaceId));
}

/**
 * Pick the version to publish: offer semver bumps off the current version
 * (patch / minor / major) plus a Custom… escape hatch, or go straight to a
 * prefilled input when nothing's published yet. Validates semver + rejects a
 * duplicate.
 */
async function pickNewVersion(
  currentVersion: string | null,
  existing: Set<string>,
): Promise<string | undefined> {
  const cur = currentVersion ? parseSemver(currentVersion) : null;
  if (cur) {
    const patch = `${cur.major}.${cur.minor}.${cur.patch + 1}`;
    const minor = `${cur.major}.${cur.minor + 1}.0`;
    const major = `${cur.major + 1}.0.0`;
    const picked = await vscode.window.showQuickPick(
      [
        { label: `$(arrow-small-up) patch → ${patch}`, value: patch },
        { label: `$(arrow-up) minor → ${minor}`, value: minor },
        { label: `$(rocket) major → ${major}`, value: major },
        { label: '$(edit) Custom…', value: null },
      ],
      { placeHolder: `Current is v${currentVersion}. Pick the next version.` },
    );
    if (!picked) return undefined;
    if (picked.value) return picked.value;
  }
  return promptCustomVersion(cur ? '' : '0.1.0', existing);
}

async function promptCustomVersion(
  initial: string,
  existing: Set<string>,
): Promise<string | undefined> {
  const input = await vscode.window.showInputBox({
    prompt: 'Version (semver)',
    placeHolder: '1.2.0',
    value: initial,
    validateInput: (v) => {
      const t = v.trim();
      if (t.length === 0) return 'Enter a version';
      if (!parseSemver(t)) return 'Must be valid semver (e.g. 1.2.0)';
      if (existing.has(t)) return `v${t} is already published`;
      return null;
    },
  });
  return input?.trim() || undefined;
}

/**
 * QuickPick over the ledger's versions, filtered by `predicate` (e.g. only
 * not-yet-deprecated versions). Returns the chosen version string.
 */
async function pickVersion(
  deps: ReleaseActionsDeps,
  placeHolder: string,
  predicate: (v: ReleaseVersion) => boolean,
  verb: string,
): Promise<string | undefined> {
  const active = deps.bridge.activeWorkspace();
  if (!active) return undefined;
  const state = await active.read();
  const versions = (state.synced.releases.self?.versions ?? []).filter(predicate);
  if (versions.length === 0) {
    await vscode.window.showInformationMessage(`No published versions ${verb}.`);
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    versions
      .slice()
      .reverse()
      .map((v) => ({
        label: `v${v.version}`,
        description: [v.deprecated ? 'deprecated' : '', v.yanked ? 'withdrawn' : '']
          .filter(Boolean)
          .join(' · '),
        value: v.version,
      })),
    { placeHolder },
  );
  return picked?.value;
}
