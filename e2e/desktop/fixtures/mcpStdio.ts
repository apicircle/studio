import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

// Minimal MCP / JSON-RPC stdio client driven from inside Playwright. We
// don't use `@modelcontextprotocol/sdk`'s client to keep the test layer
// independent of the SDK version the server happens to ship with — the
// tests want to be wire-faithful, not framework-faithful.
//
// Protocol: stdin/stdout speak newline-delimited JSON-RPC 2.0 frames
// (one JSON object per line). The server is started under `node` so
// the spawn cost is bounded and the process is a vanilla child of
// the Playwright runner.

const REPO_ROOT = path.resolve(__dirname, '../../../');
// The MCP server is spawned via tsx (TypeScript executor) because the
// workspace sibling packages (@apicircle/shared, etc.) export TS source
// as their main entry. The compiled dist/bin/mcp-server.cjs marks them
// as `external`, so plain `node` would crash on `require()` of .ts files.
// tsx handles the transpilation on the fly.
//
// On a cold CI runner, tsx's first boot can take 15-25s while it compiles
// the full @apicircle/* tree. The init() timeout is set to 30s to absorb
// this. Subsequent spawns in the same runner hit tsx's module cache and
// start in <2s.
const DEFAULT_BIN = path.resolve(REPO_ROOT, 'packages/mcp-server/src/bin/mcp-server.ts');
const TSX_BIN = path.resolve(
  REPO_ROOT,
  process.platform === 'win32'
    ? 'apps/desktop/node_modules/.bin/tsx.CMD'
    : 'apps/desktop/node_modules/.bin/tsx',
);

export interface SpawnMcpOptions {
  /** Workspace directory passed via --workspace. Defaults to a fresh tmpdir. */
  workspaceDir?: string;
  /** Drop --workspace entirely (test the cwd-fallback boot path). */
  noWorkspaceFlag?: boolean;
  /** Pass --workspace with an empty value. */
  emptyWorkspaceFlag?: boolean;
  /** Override APICIRCLE_WORKSPACE env var. */
  workspaceEnv?: string;
  /** Extra command-line args. */
  extraArgs?: readonly string[];
  /** Extra env vars merged into process.env. */
  env?: Record<string, string>;
  /** Override the bin path (e.g. to run the source via tsx). */
  bin?: string;
  /** Working directory of the spawned process. */
  cwd?: string;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpClient {
  /** Underlying child handle — useful for asserting exit codes. */
  proc: ChildProcessWithoutNullStreams;
  /** Workspace dir the server is rooted at (whether created here or supplied). */
  workspaceDir: string;
  /** Send a JSON-RPC `initialize` + `notifications/initialized` handshake. */
  init: () => Promise<JsonRpcResponse>;
  /** Send a JSON-RPC request and await its matching response by id. */
  call: <T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs?: number,
  ) => Promise<JsonRpcResponse<T>>;
  /** Send a JSON-RPC notification (no response expected). */
  notify: (method: string, params?: unknown) => void;
  /** Send a raw line — useful for malformed-frame tests. */
  rawWrite: (line: string) => void;
  /** Resolve once the next stdout line lands (with the line). */
  awaitStdout: (timeoutMs?: number) => Promise<string>;
  /** All stdout lines captured so far. */
  stdoutLines: () => string[];
  /** All stderr text captured so far. */
  stderrText: () => string;
  /** Send SIGINT or SIGTERM and wait for exit. Resolves to exit code. */
  shutdown: (signal?: 'SIGTERM' | 'SIGINT') => Promise<number>;
  /** Close stdin to trigger graceful shutdown. Resolves to exit code. */
  closeStdin: () => Promise<number>;
}

let nextId = 1;

export async function spawnMcpServer(opts: SpawnMcpOptions = {}): Promise<McpClient> {
  const workspaceDir =
    opts.workspaceDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'apicircle-mcp-e2e-'));
  const bin = opts.bin ?? DEFAULT_BIN;
  if (!fs.existsSync(bin)) {
    throw new Error(`MCP server entry not found at ${bin}.`);
  }
  // Spawn either `tsx <bin>` (default — runs the TS source) or `node
  // <bin>` (if the caller passed a custom .cjs/.js bin). We detect by
  // file extension. On Windows the tsx binary is installed as a
  // `.CMD` wrapper which needs `shell: true` to execute — and once
  // shell is true, every argument with a space must be quoted by the
  // caller. We quote command + args defensively here.
  const isTsEntry = bin.endsWith('.ts');
  const useShell = process.platform === 'win32';
  const baseCmd = isTsEntry ? TSX_BIN : process.execPath;
  const baseArgs = [bin];
  if (!opts.noWorkspaceFlag) {
    if (opts.emptyWorkspaceFlag) {
      baseArgs.push('--workspace', '');
    } else if (!opts.workspaceEnv) {
      baseArgs.push('--workspace', workspaceDir);
    }
  }
  baseArgs.push(...(opts.extraArgs ?? []));
  const quoteForShell = (s: string): string => (useShell && /\s/.test(s) ? `"${s}"` : s);
  const command = useShell ? quoteForShell(baseCmd) : baseCmd;
  const args = useShell ? baseArgs.map(quoteForShell) : baseArgs;
  const proc = spawn(command, args, {
    cwd: opts.cwd ?? workspaceDir,
    env: {
      ...process.env,
      ...(opts.workspaceEnv ? { APICIRCLE_WORKSPACE: opts.workspaceEnv } : {}),
      ...(opts.env ?? {}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: useShell,
  });

  const stdoutLines: string[] = [];
  const stderrChunks: string[] = [];
  let stdoutBuffer = '';
  let spawnError: Error | null = null;
  const pendingByLine: Array<(line: string) => void> = [];
  const pendingByResponse = new Map<number | string, (resp: JsonRpcResponse) => void>();

  proc.on('error', (err) => {
    spawnError = err;
    for (const [id, cb] of pendingByResponse) {
      pendingByResponse.delete(id);
      cb({ jsonrpc: '2.0', id, error: { code: -32603, message: `spawn error: ${err.message}` } });
    }
  });

  proc.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf8');
    let idx: number;
    while ((idx = stdoutBuffer.indexOf('\n')) !== -1) {
      const raw = stdoutBuffer.slice(0, idx).replace(/\r$/, '');
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
      if (raw.length === 0) continue;
      stdoutLines.push(raw);
      const waiter = pendingByLine.shift();
      if (waiter) waiter(raw);
      tryDeliverResponse(raw);
    }
  });
  proc.stderr.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk.toString('utf8'));
  });

  function tryDeliverResponse(line: string): void {
    let parsed: JsonRpcResponse | undefined;
    try {
      parsed = JSON.parse(line) as JsonRpcResponse;
    } catch {
      // Non-JSON line on stdout — protocol violation, but the test
      // will surface it through `stdoutLines()` if needed.
      return;
    }
    if (!parsed || parsed.jsonrpc !== '2.0' || parsed.id === undefined) return;
    const cb = pendingByResponse.get(parsed.id);
    if (cb) {
      pendingByResponse.delete(parsed.id);
      cb(parsed);
    }
  }

  const exited = new Promise<number>((resolve) => {
    proc.once('exit', (code) => resolve(code ?? 0));
  });

  function rawWrite(line: string): void {
    proc.stdin.write(line.endsWith('\n') ? line : `${line}\n`);
  }

  function call<T>(
    method: string,
    params?: unknown,
    timeoutMs = 10_000,
  ): Promise<JsonRpcResponse<T>> {
    const id = nextId++;
    const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise<JsonRpcResponse<T>>((resolve, reject) => {
      const t = setTimeout(() => {
        pendingByResponse.delete(id);
        const stderr = stderrChunks.join('').slice(-500);
        const detail = spawnError
          ? `spawn error: ${spawnError.message}`
          : stderr
            ? `stderr: ${stderr}`
            : 'no stderr output';
        reject(new Error(`MCP call timed out: ${method} (id=${id})\n${detail}`));
      }, timeoutMs);
      pendingByResponse.set(id, (resp) => {
        clearTimeout(t);
        resolve(resp as JsonRpcResponse<T>);
      });
      rawWrite(frame);
    });
  }

  function notify(method: string, params?: unknown): void {
    rawWrite(JSON.stringify({ jsonrpc: '2.0', method, params }));
  }

  async function init(): Promise<JsonRpcResponse> {
    // First-boot under tsx can take 5-15s on cold cache (Windows). Give
    // initialize a generous budget; subsequent calls fall back to the
    // 10s default.
    const resp = await call(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: { roots: { listChanged: true } },
        clientInfo: { name: 'apicircle-e2e-client', version: '0.0.1' },
      },
      30_000,
    );
    notify('notifications/initialized', {});
    return resp;
  }

  function awaitStdout(timeoutMs = 5_000): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => {
        const i = pendingByLine.indexOf(waiter);
        if (i >= 0) pendingByLine.splice(i, 1);
        reject(new Error('awaitStdout timed out'));
      }, timeoutMs);
      const waiter = (line: string): void => {
        clearTimeout(t);
        resolve(line);
      };
      pendingByLine.push(waiter);
    });
  }

  async function shutdown(signal: 'SIGTERM' | 'SIGINT' = 'SIGTERM'): Promise<number> {
    if (proc.exitCode !== null) return proc.exitCode;
    try {
      proc.kill(signal);
    } catch {
      // Already dead.
    }
    const code = await Promise.race([
      exited,
      new Promise<number>((r) => setTimeout(() => r(-1), 5_000)),
    ]);
    return code;
  }

  async function closeStdin(): Promise<number> {
    proc.stdin.end();
    const code = await Promise.race([
      exited,
      new Promise<number>((r) => setTimeout(() => r(-1), 5_000)),
    ]);
    return code;
  }

  return {
    proc,
    workspaceDir,
    init,
    call,
    notify,
    rawWrite,
    awaitStdout,
    stdoutLines: () => [...stdoutLines],
    stderrText: () => stderrChunks.join(''),
    shutdown,
    closeStdin,
  };
}
