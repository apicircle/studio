import * as vscode from 'vscode';
import type { VsCodeBridge } from '../host/vscodeBridge';

// =============================================================================
// Hover provider for apicircle-environment YAML documents.
//
// Hovering on a variable `key:` line shows:
//   • Resolution source (this env / global context / linked-override / secret slot)
//   • For encrypted variables: the bound `secretKeyId` slot
//   • Cross-env conflicts (same key in higher-priority envs that will mask)
//
// Gap C — replaces the prior "no hover" experience. The Set Active / Delete
// CodeLens (environmentCodeLens.ts) plus this hover round out the env IDE
// surface for Phase 2.
// =============================================================================

const KEY_LINE_RE = /^(\s*-\s*)?key:\s*([A-Za-z0-9_.-]+)\s*$/;

export class EnvironmentHoverProvider implements vscode.HoverProvider {
  constructor(private readonly bridge: VsCodeBridge) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
  ): Promise<vscode.Hover | undefined> {
    if (document.uri.scheme !== 'apicircle') return undefined;
    if (!document.uri.path.endsWith('.env.yaml')) return undefined;

    const lineText = document.lineAt(position.line).text;
    const m = KEY_LINE_RE.exec(lineText);
    if (!m) return undefined;
    const key = m[2];

    // Figure out which env this document represents.
    const envName = findEnvName(document);
    if (!envName) return undefined;

    const surface = this.bridge.activeWorkspace();
    if (!surface) return undefined;
    const state = await surface.read();

    const env = state.synced.environments.items[envName];
    if (!env) return undefined;
    const variable = env.variables.find((v) => v.key === key);
    if (!variable) return undefined;

    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**\`${key}\`** *(in env \`${envName}\`)*\n\n`);

    if (variable.encrypted) {
      const slotId = variable.secretKeyId ?? '(unbound)';
      md.appendMarkdown(`🔒 **Encrypted** · secret slot \`${slotId}\`\n\n`);
      const secretKeys = state.synced.secretKeys ?? {};
      const slot = slotId !== '(unbound)' ? secretKeys[slotId] : undefined;
      if (slot) {
        md.appendMarkdown(`Slot label: \`${slot.label}\`\n\n`);
      } else if (slotId !== '(unbound)') {
        md.appendMarkdown(`⚠️ Slot id not found in \`secretKeys\` — vault entry missing.\n\n`);
      }
    } else {
      md.appendMarkdown(`📝 Plaintext value: \`${truncate(variable.value, 80)}\`\n\n`);
    }

    // Source: this env, plus mask warnings. priorityOrder holds EnvPriorityRef —
    // we only consider local refs here; linked refs are masked-by-default in
    // Phase 2 (linked env resolution lands with Phase 8).
    const priority = state.synced.environments.priorityOrder ?? [];
    const localPriority = priority
      .filter((p): p is Extract<typeof p, { kind: 'local' }> => p.kind === 'local')
      .map((p) => p.name);
    const masks: string[] = [];
    for (const candidate of localPriority) {
      if (candidate === envName) break;
      const other = state.synced.environments.items[candidate];
      if (other?.variables.find((v) => v.key === key)) {
        masks.push(candidate);
      }
    }
    if (masks.length > 0) {
      md.appendMarkdown(
        `⚠️ **Masked** at request-send time by higher-priority env(s): ${masks
          .map((n) => `\`${n}\``)
          .join(', ')}.\n\n`,
      );
    } else {
      const isActive = state.synced.environments.activeName === envName;
      const inPriority = localPriority.includes(envName);
      if (isActive) {
        md.appendMarkdown(`✅ Resolved from this env (active environment).\n\n`);
      } else if (inPriority) {
        md.appendMarkdown(`✅ Resolved from this env (in priority order, not masked).\n\n`);
      } else {
        md.appendMarkdown(
          `ℹ️ This env is not in the active priority order — value is **not** resolved at request-send time.\n\n`,
        );
      }
    }

    md.isTrusted = true;
    return new vscode.Hover(md, document.lineAt(position.line).range);
  }
}

function findEnvName(document: vscode.TextDocument): string | undefined {
  for (let i = 0; i < document.lineCount; i++) {
    const m = /^name:\s*(.+)$/.exec(document.lineAt(i).text);
    if (m) return m[1].trim();
  }
  return undefined;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1) + '…';
}
