import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { spawn } from 'node:child_process';

// Spawn the `apicircle` CLI binary in a controlled subprocess and capture
// stdout / stderr / exit code. The CLI is shipped as a tsup CJS bundle
// at `packages/cli/dist/index.cjs`; we run it under `node` so the
// behaviour is platform-uniform (PowerShell, bash, cmd all just call
// node behind the scenes).

const REPO_ROOT = path.resolve(__dirname, '../../../..');
// Spawn the TS source via `tsx` rather than the compiled
// `packages/cli/dist/index.cjs`. The compiled bin marks workspace
// siblings as `external`, so raw Node `require()` resolves to .ts
// source files and crashes. tsx handles TS transpilation on the fly.
// Production-binary builds (`scripts/release/buildBinaries.mjs`) bundle
// everything for the shipped CLI; tests use the TS source directly.
const DEFAULT_BIN = path.resolve(REPO_ROOT, 'packages/cli/src/index.ts');
const TSX_BIN = path.resolve(
  REPO_ROOT,
  process.platform === 'win32'
    ? 'apps/desktop/node_modules/.bin/tsx.CMD'
    : 'apps/desktop/node_modules/.bin/tsx',
);

export interface CliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CliRunOptions {
  /** Args after the bin (e.g. `['--help']`). */
  args: readonly string[];
  /** Working directory; defaults to a fresh tmpdir. */
  cwd?: string;
  /** Env overrides merged into process.env. */
  env?: Record<string, string>;
  /** Hard kill after this many ms. */
  timeoutMs?: number;
  /** Optional stdin payload (e.g. for `apicircle import - <ws>`). */
  stdin?: string;
  /** Override bin path. */
  bin?: string;
}

export function makeTmpDir(prefix = 'apicircle-cli-e2e-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Run the CLI to completion. Resolves with `{ stdout, stderr, exitCode }`.
 * Non-zero exit codes do NOT reject — the test assertion does.
 */
export function runCli(opts: CliRunOptions): Promise<CliRunResult> {
  const bin = opts.bin ?? DEFAULT_BIN;
  if (!fs.existsSync(bin)) {
    return Promise.reject(
      new Error(
        `apicircle CLI bin not found at ${bin}. ` +
          `Run \`pnpm --filter @apicircle/cli build\` first.`,
      ),
    );
  }
  return new Promise((resolve) => {
    const isTsEntry = bin.endsWith('.ts');
    const useShell = process.platform === 'win32';
    const baseCmd = isTsEntry ? TSX_BIN : process.execPath;
    const baseArgs = [bin, ...opts.args];
    const q = (s: string): string => (useShell && /\s/.test(s) ? `"${s}"` : s);
    const proc = spawn(useShell ? q(baseCmd) : baseCmd, useShell ? baseArgs.map(q) : baseArgs, {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: useShell,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
    proc.stderr.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
    }, opts.timeoutMs ?? 15_000);
    proc.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
    if (opts.stdin !== undefined) proc.stdin.write(opts.stdin);
    proc.stdin.end();
  });
}

/**
 * Spawn the CLI without waiting for exit — useful for `apicircle mock`
 * which only exits on SIGINT. Tests call `kill()` and then await the
 * exit promise to assert clean shutdown.
 */
export interface LongRunningCli {
  proc: ReturnType<typeof spawn>;
  stdout: () => string;
  stderr: () => string;
  /** Resolves when the process exits with the final exit code. */
  exited: Promise<number>;
  kill: (signal?: NodeJS.Signals) => void;
}

export function startCli(opts: CliRunOptions): LongRunningCli {
  const bin = opts.bin ?? DEFAULT_BIN;
  if (!fs.existsSync(bin)) {
    throw new Error(
      `apicircle CLI bin not found at ${bin}. ` +
        `Run \`pnpm --filter @apicircle/cli build\` first.`,
    );
  }
  const isTsEntry = bin.endsWith('.ts');
  const useShell = process.platform === 'win32';
  const baseCmd = isTsEntry ? TSX_BIN : process.execPath;
  const baseArgs = [bin, ...opts.args];
  const q = (s: string): string => (useShell && /\s/.test(s) ? `"${s}"` : s);
  const proc = spawn(useShell ? q(baseCmd) : baseCmd, useShell ? baseArgs.map(q) : baseArgs, {
    cwd: opts.cwd ?? process.cwd(),
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: useShell,
  });
  let stdout = '';
  let stderr = '';
  proc.stdout!.on('data', (c: Buffer) => {
    stdout += c.toString('utf8');
  });
  proc.stderr!.on('data', (c: Buffer) => {
    stderr += c.toString('utf8');
  });
  const exited = new Promise<number>((resolve) => {
    proc.once('exit', (code) => resolve(code ?? 0));
  });
  return {
    proc,
    stdout: () => stdout,
    stderr: () => stderr,
    exited,
    kill: (signal = 'SIGINT') => {
      try {
        proc.kill(signal);
      } catch {
        // Already dead.
      }
    },
  };
}
