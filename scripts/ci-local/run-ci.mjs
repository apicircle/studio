#!/usr/bin/env node
// @ts-check
/**
 * Local CI runner for API Circle Studio.
 *
 * Reproduces the full GitHub Actions validation matrix on a developer machine
 * so you can catch regressions before pushing. Each "stage" is a faithful
 * mirror of one workflow under `.github/workflows/`:
 *
 *   stage         mirrors workflow      file
 *   ─────────────────────────────────────────────────────────────────────
 *   setup         (pre-steps)           install + build
 *   ci            CI                    .github/workflows/ci.yml
 *   vscode        VS Code extension     .github/workflows/vscode.yml
 *   e2e           E2E                   .github/workflows/e2e.yml
 *   codeql        CodeQL                .github/workflows/codeql.yml
 *   live-github   e2e-live-github       .github/workflows/e2e-live-github.yml
 *
 * Environment is read from `.test.env` (+ optional `.secrets.env`) — see
 * scripts/ci-local/.test.env.example and scripts/ci-local/README.md.
 *
 * Quick start:
 *   node scripts/ci-local/run-ci.mjs --list           # show the plan
 *   node scripts/ci-local/run-ci.mjs                   # run the default matrix
 *   node scripts/ci-local/run-ci.mjs --only ci,vscode  # subset
 *   pnpm ci:local -- --only e2e                         # via package.json
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');
const RESULTS_DIR = join(SCRIPT_DIR, 'results');

const HOST =
  process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'ubuntu';
const HOST_IS_LINUX = process.platform === 'linux';

// ── tiny ANSI helpers ────────────────────────────────────────────────────────
const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => paint('1', s);
const dim = (s) => paint('2', s);
const red = (s) => paint('31', s);
const green = (s) => paint('32', s);
const yellow = (s) => paint('33', s);
const blue = (s) => paint('34', s);
const cyan = (s) => paint('36', s);

const STATUS = {
  PASS: green('PASS'),
  FAIL: red('FAIL'),
  WARN: yellow('WARN'),
  SKIP: dim('SKIP'),
  DRY: cyan('DRY '),
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. CLI args
// ─────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = {
    help: false,
    list: false,
    dryRun: false,
    bail: false,
    only: /** @type {string[]} */ ([]),
    skip: /** @type {string[]} */ ([]),
    envFiles: /** @type {string[]} */ ([]),
    noInstall: false,
    noBuild: false,
    noFrozen: false,
    noDesktop: false,
    noCrossBrowser: false,
    includeVisual: false,
    includeCodeql: false,
    includeLiveGithub: false,
    includeVscodeE2e: false,
    strictCoverage: false,
    forceEnv: false,
    spec: '',
    grep: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];
    switch (arg) {
      case '-h':
      case '--help':
        a.help = true;
        break;
      case '--list':
        a.list = true;
        break;
      case '--dry-run':
        a.dryRun = true;
        break;
      case '--bail':
        a.bail = true;
        break;
      case '--only':
        a.only.push(...splitList(next()));
        break;
      case '--skip':
        a.skip.push(...splitList(next()));
        break;
      case '--env-file':
        a.envFiles.push(next());
        break;
      case '--no-install':
        a.noInstall = true;
        break;
      case '--no-build':
        a.noBuild = true;
        break;
      case '--no-frozen':
        a.noFrozen = true;
        break;
      case '--no-desktop':
        a.noDesktop = true;
        break;
      case '--no-cross-browser':
        a.noCrossBrowser = true;
        break;
      case '--include-visual':
        a.includeVisual = true;
        break;
      case '--include-codeql':
        a.includeCodeql = true;
        break;
      case '--include-live-github':
        a.includeLiveGithub = true;
        break;
      case '--include-vscode-e2e':
        a.includeVscodeE2e = true;
        break;
      case '--strict-coverage':
        a.strictCoverage = true;
        break;
      case '--force-env':
        a.forceEnv = true;
        break;
      case '--spec':
        a.spec = requireValue('--spec', next());
        break;
      case '--grep':
        a.grep = requireValue('--grep', next());
        break;
      default:
        console.error(red(`Unknown option: ${arg}`));
        console.error(`Run ${bold('node scripts/ci-local/run-ci.mjs --help')} for usage.`);
        process.exit(2);
    }
  }
  return a;
}

const splitList = (v) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function requireValue(flag, v) {
  if (v === undefined) {
    console.error(red(`Missing value for ${flag}`));
    process.exit(2);
  }
  return v;
}

function printHelp() {
  console.log(`
${bold('API Circle Studio — local CI runner')}

Mirrors the GitHub Actions workflows (CI, VS Code extension, E2E, CodeQL,
e2e-live-github) so the full validation matrix can be run locally.

${bold('Usage')}
  node scripts/ci-local/run-ci.mjs [options]
  pnpm ci:local -- [options]

${bold('Stages')}  (default run = setup, ci, vscode, e2e)
  setup         pnpm install + pnpm build (pre-steps)
  ci            ci.yml          typecheck, lint, format, unit+coverage, build, bundle budget
  vscode        vscode.yml      typecheck, lint, unit, build, bundle budget, knip [+ cross-host E2E]
  e2e           e2e.yml         chromium suite, coverage, cross-browser smoke, desktop Electron suite
  codeql        codeql.yml      CodeQL static analysis            ${dim('(opt-in; needs codeql CLI)')}
  live-github   e2e-live-github live GitHub suite                 ${dim('(opt-in; ⚠ creates/deletes real repos)')}

${bold('Options')}
  --list                 Print the resolved plan (stages, steps, env) and exit
  --dry-run              Print each command without executing it
  --only <a,b>           Run only these stages (forces opt-in stages on)
  --skip <a,b>           Skip these stages
  --bail                 Stop at the first hard failure (default: run all, report at end)
  --env-file <path>      Load an extra env file (repeatable)
  --force-env            Let env files override variables already set in the shell
  --no-install           Skip pnpm install
  --no-build             Skip the top-level pnpm build
  --no-frozen            Use 'pnpm install' instead of '--frozen-lockfile'
  --no-desktop           Skip the desktop Electron E2E sub-suite (within e2e)
  --no-cross-browser     Skip the Firefox/WebKit @smoke sub-suite (within e2e)
  --include-visual       Run the visual-baseline project (off by default)
  --include-codeql       Run the CodeQL stage
  --include-live-github  Run the live-GitHub stage  ${dim('(⚠ destructive)')}
  --include-vscode-e2e   Run the VS Code cross-host E2E smoke (downloads VS Code)
  --strict-coverage      Treat the E2E coverage gate as a hard failure (default: warn)
  --spec <pattern>       Run only Playwright spec files matching <pattern> (e2e / live-github)
  --grep <title>         Run only Playwright tests whose title matches <title>
  -h, --help             Show this help

${bold('Target a specific test file')}  (Playwright e2e / live-github — reuses .test.env)
  node scripts/ci-local/run-ci.mjs --only live-github --spec 06-release-update-flow --no-install --no-build
  node scripts/ci-local/run-ci.mjs --only e2e --spec auth.spec.ts --no-install --no-build
  node scripts/ci-local/run-ci.mjs --only e2e --grep "Bearer token" --no-install --no-build
  ${dim('# scopes e2e to the chromium suite + live-github to its suite (skips')}
  ${dim('# cross-browser / visual / desktop / coverage). For a desktop or unit')}
  ${dim('# single file, use the direct playwright / vitest command.')}

${bold('Environment')}  (see scripts/ci-local/.test.env.example)
  Auto-loaded if present: scripts/ci-local/.test.env, scripts/ci-local/.secrets.env,
  ${dim('<repo>/.test.env, <repo>/.secrets.env')}
  CI_PLATFORM=windows|mac|ubuntu   declare the host (controls xvfb wrapping on Linux)
  RUN_LIVE_GITHUB / RUN_CODEQL / RUN_VSCODE_E2E / RUN_VISUAL = 0|1
  RUN_DESKTOP_E2E / RUN_CROSS_BROWSER = 0|1   (default 1)
`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. env file loading (tiny dotenv)
// ─────────────────────────────────────────────────────────────────────────────
/** @returns {Record<string,string>} */
function parseEnvFile(text) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const withoutExport = line.startsWith('export ') ? line.slice(7) : line;
    const eq = withoutExport.indexOf('=');
    if (eq === -1) continue;
    const key = withoutExport.slice(0, eq).trim();
    let val = withoutExport.slice(eq + 1).trim();
    // Strip surrounding quotes; leave inner content intact.
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

function loadEnv(args) {
  const candidates = [
    join(SCRIPT_DIR, '.test.env'),
    join(SCRIPT_DIR, '.secrets.env'),
    join(REPO_ROOT, '.test.env'),
    join(REPO_ROOT, '.secrets.env'),
    ...args.envFiles.map((p) => resolve(process.cwd(), p)),
  ];
  const loaded = [];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const map = parseEnvFile(readFileSync(file, 'utf8'));
    let applied = 0;
    for (const [k, v] of Object.entries(map)) {
      const exists = process.env[k] != null && process.env[k] !== '';
      if (exists && !args.forceEnv) continue;
      process.env[k] = v;
      applied += 1;
    }
    loaded.push({ file, keys: Object.keys(map).length, applied });
  }
  return loaded;
}

const boolEnv = (name, dflt) => {
  const v = process.env[name];
  if (v == null || v === '') return dflt;
  const t = v.toLowerCase();
  return t === '1' || t === 'true' || t === 'yes' || t === 'on';
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. platform / external-tool detection
// ─────────────────────────────────────────────────────────────────────────────
function resolvePlatform() {
  const raw = (process.env.CI_PLATFORM || '').toLowerCase().trim();
  const map = {
    windows: 'windows',
    win: 'windows',
    win32: 'windows',
    mac: 'mac',
    macos: 'mac',
    osx: 'mac',
    darwin: 'mac',
    ubuntu: 'ubuntu',
    linux: 'ubuntu',
  };
  const declared = map[raw] || null;
  return { declared, effective: declared || HOST };
}

let _xvfb = /** @type {boolean|null} */ (null);
function hasXvfb() {
  if (_xvfb !== null) return _xvfb;
  if (!HOST_IS_LINUX) return (_xvfb = false);
  const r = spawnSync('xvfb-run', ['--help'], { shell: true, stdio: 'ignore' });
  return (_xvfb = r.status === 0 || r.status === 1); // --help may exit 1 on some builds
}

/** Wrap a command in xvfb-run when running on a real Linux host. */
function xvfb(cmd) {
  return HOST_IS_LINUX && hasXvfb() ? `xvfb-run -a ${cmd}` : cmd;
}

function hasCodeql() {
  const r = spawnSync('codeql', ['version', '--format=terse'], { shell: true, stdio: 'ignore' });
  return r.status === 0;
}

const playwrightInstall = (extra = '') => {
  const withDeps = HOST_IS_LINUX ? '--with-deps ' : '';
  const tail = extra ? ` ${extra}` : '';
  return `pnpm --filter @apicircle/e2e-web exec playwright install ${withDeps}chromium chromium-headless-shell${tail}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. command runner
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {string} cmd
 * @param {{cwd?: string, env?: Record<string,string>}} [opts]
 * @returns {Promise<number>}
 */
function run(cmd, opts = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, {
      cwd: opts.cwd || REPO_ROOT,
      env: { ...process.env, ...(opts.env || {}) },
      shell: true,
      stdio: 'inherit',
    });
    child.on('error', (err) => {
      console.error(red(`  spawn error: ${err.message}`));
      resolveRun(1);
    });
    child.on('close', (code) => resolveRun(code == null ? 1 : code));
  });
}

const fmtMs = (ms) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

// ─────────────────────────────────────────────────────────────────────────────
// 5. function steps (the non-shell checks CI does inline)
// ─────────────────────────────────────────────────────────────────────────────
/** Web bundle-size budget — mirrors ci.yml's gzip+wc check using zlib. */
function webBundleBudget() {
  const assets = join(REPO_ROOT, 'apps', 'web', 'dist', 'assets');
  if (!existsSync(assets)) {
    return {
      ok: false,
      soft: true,
      message: 'apps/web/dist/assets not found — build the web app first',
    };
  }
  const files = readdirSync(assets);
  const js = files.filter((f) => /^index-.*\.js$/.test(f));
  const css = files.filter((f) => /^index-.*\.css$/.test(f));
  if (js.length === 0 && css.length === 0) {
    return { ok: false, soft: true, message: 'no index-*.js / index-*.css bundles found' };
  }
  const gz = (list) =>
    list.reduce((sum, f) => sum + gzipSync(readFileSync(join(assets, f))).length, 0);
  const JS_MAX = 1024 * 1024; // 1 MB
  const CSS_MAX = 30 * 1024; // 30 KB
  const jsGz = gz(js);
  const cssGz = gz(css);
  console.log(`  JS  gzip: ${kb(jsGz)}  ${dim(`(budget ${kb(JS_MAX)})`)}`);
  console.log(`  CSS gzip: ${kb(cssGz)}  ${dim(`(budget ${kb(CSS_MAX)})`)}`);
  const overJs = js.length > 0 && jsGz > JS_MAX;
  const overCss = css.length > 0 && cssGz > CSS_MAX;
  if (overJs) console.log(red(`  ✗ JS bundle exceeds 1 MB gzipped (${jsGz} bytes)`));
  if (overCss) console.log(red(`  ✗ CSS bundle exceeds 30 KB gzipped (${cssGz} bytes)`));
  return { ok: !overJs && !overCss, message: `JS ${kb(jsGz)} / CSS ${kb(cssGz)}` };
}

/** Validate the live-GitHub secret/var contract (mirrors the workflow guard). */
function liveGithubCredsCheck() {
  const missing = [];
  if (process.env.APICIRCLE_E2E_LIVE_GITHUB !== '1') missing.push('APICIRCLE_E2E_LIVE_GITHUB=1');
  if (!process.env.APICIRCLE_E2E_BOT_OWNER?.trim()) missing.push('APICIRCLE_E2E_BOT_OWNER');
  if (!process.env.APICIRCLE_E2E_GITHUB_PAT?.trim())
    missing.push('APICIRCLE_E2E_GITHUB_PAT (repo + delete_repo)');
  if (!process.env.APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED?.trim())
    missing.push('APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED (repo)');
  if (missing.length) {
    return { ok: false, message: `missing live-GitHub env: ${missing.join(', ')}` };
  }
  return { ok: true, message: `bot owner: ${process.env.APICIRCLE_E2E_BOT_OWNER}` };
}

/** CodeQL stage — best effort against a locally installed CodeQL CLI. */
async function codeqlAnalyze(dryRun) {
  if (!hasCodeql()) {
    return {
      ok: true,
      skipped: true,
      message: 'codeql CLI not found on PATH — install from github.com/github/codeql-cli-binaries',
    };
  }
  const dbDir = join(RESULTS_DIR, 'codeql', 'db');
  const sarif = join(RESULTS_DIR, 'codeql', 'results.sarif');
  const configPath = join(RESULTS_DIR, 'codeql', 'codeql-config.yml');
  if (!dryRun) {
    mkdirSync(join(RESULTS_DIR, 'codeql'), { recursive: true });
    // Mirror the path scoping from codeql.yml so the DB doesn't balloon with
    // node_modules / dist / build artifacts.
    writeFileSync(
      configPath,
      [
        'paths:',
        '  - apps',
        '  - packages',
        '  - scripts',
        '  - e2e',
        'paths-ignore:',
        "  - '**/node_modules'",
        "  - '**/dist'",
        "  - '**/build'",
        "  - '**/coverage'",
        "  - '**/.turbo'",
        "  - '**/playwright-report'",
        "  - '**/test-results'",
        "  - 'docs/qa/results'",
        "  - 'apps/desktop/release'",
        "  - '**/*.min.js'",
        "  - '**/*.d.ts'",
        '',
      ].join('\n'),
    );
  }
  const createCmd = `codeql database create "${dbDir}" --language=javascript-typescript --source-root=. --overwrite --codescanning-config="${configPath}"`;
  const analyzeCmd = `codeql database analyze "${dbDir}" codeql/javascript-queries:codeql-suites/javascript-security-and-quality.qls --format=sarif-latest --output="${sarif}" --download`;
  if (dryRun) {
    console.log(`  ${dim('$')} ${createCmd}`);
    console.log(`  ${dim('$')} ${analyzeCmd}`);
    return { ok: true, dry: true };
  }
  let code = await run(createCmd);
  if (code !== 0) return { ok: false, message: 'codeql database create failed' };
  code = await run(analyzeCmd);
  if (code !== 0) return { ok: false, message: 'codeql database analyze failed' };
  return { ok: true, message: `SARIF → ${sarif}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. stage / step definitions
// ─────────────────────────────────────────────────────────────────────────────
const STAGE_KEYS = ['setup', 'ci', 'vscode', 'e2e', 'codeql', 'live-github'];

/** Playwright positional/grep filter args from --spec / --grep (empty when unset). */
function pwFilter(t) {
  let s = '';
  if (t.spec) s += ` "${t.spec}"`;
  if (t.grep) s += ` -g "${t.grep}"`;
  return s;
}

/**
 * Build the ordered step list for a stage given the resolved toggles.
 * Each step: { name, cmd?, fn?, env?, soft?, cwd? }
 *   - cmd: shell command string
 *   - fn:  async () => { ok, skipped?, soft?, message?, dry? }
 *   - soft: a failure is recorded as WARN, not FAIL
 */
function buildSteps(stage, t) {
  switch (stage) {
    case 'setup':
      return [
        !t.noInstall && {
          name: 'pnpm install',
          cmd: t.noFrozen ? 'pnpm install' : 'pnpm install --frozen-lockfile',
        },
        !t.noBuild && { name: 'pnpm build', cmd: 'pnpm build' },
      ].filter(Boolean);

    case 'ci':
      return [
        { name: 'Typecheck (pnpm -r check)', cmd: 'pnpm -r check' },
        { name: 'Lint (eslint)', cmd: 'pnpm lint' },
        { name: 'Format check (prettier)', cmd: 'pnpm format:check' },
        { name: 'Unit + integration tests w/ coverage', cmd: 'pnpm test:coverage' },
        { name: 'Build', cmd: 'pnpm build' },
        { name: 'Web bundle-size budget', fn: () => webBundleBudget() },
        t.commitlint && {
          name: 'Conventional commits (vs origin/main)',
          cmd: 'pnpm dlx @commitlint/cli --from origin/main --to HEAD',
          soft: true,
        },
      ].filter(Boolean);

    case 'vscode': {
      const steps = [
        { name: 'Typecheck vscode', cmd: 'pnpm --filter apicircle-vscode check' },
        { name: 'Typecheck e2e-vscode', cmd: 'pnpm --filter @apicircle/e2e-vscode check' },
        { name: 'Lint vscode', cmd: 'pnpm --filter apicircle-vscode lint' },
        { name: 'Unit + integration tests', cmd: 'pnpm --filter apicircle-vscode test' },
        { name: 'Build extension bundle', cmd: 'pnpm --filter apicircle-vscode build' },
        { name: 'Bundle-size budget (vscode)', cmd: 'node scripts/check-vscode-bundle.mjs' },
        {
          name: 'Dead-code scan (knip)',
          cmd: 'pnpm dlx knip --workspace apps/vscode --workspace e2e/vscode --no-progress',
        },
      ];
      if (t.vscodeE2e) {
        steps.push({ name: 'Build e2e-vscode', cmd: 'pnpm --filter @apicircle/e2e-vscode build' });
        for (const version of ['stable', 'insiders']) {
          steps.push({
            name: `Cross-host E2E smoke (${version})`,
            cmd: xvfb('pnpm --filter @apicircle/e2e-vscode test:e2e'),
            env: { VSCODE_TEST_VERSION: version },
          });
        }
      }
      return steps;
    }

    case 'e2e': {
      const ciEnv = { CI: '1' };
      const filtering = Boolean(t.spec || t.grep);
      const pwf = pwFilter(t);
      const steps = [
        { name: 'Build web workspace packages', cmd: 'pnpm --filter @apicircle/web... build' },
        { name: 'Install Playwright Chromium', cmd: playwrightInstall() },
        {
          name: 'Playwright chromium suite',
          cmd: `pnpm --filter @apicircle/e2e-web exec playwright test --project=chromium${pwf}`,
          env: ciEnv,
        },
      ];
      // A --spec/--grep filter targets individual files: run the chromium
      // suite only and skip the cross-browser / visual / desktop sweeps + the
      // full-suite coverage gate. Those would error with "no tests found" for a
      // chromium-scoped file, and coverage attribution is meaningless for one.
      if (!filtering) {
        steps.push({
          name: 'E2E strict coverage report',
          fn: (dry) => coverageReport(t, dry),
          soft: !t.strictCoverage,
        });
      }
      if (t.crossBrowser && !filtering) {
        steps.push({
          name: 'Install Playwright Firefox + WebKit',
          cmd: playwrightInstall('firefox webkit'),
        });
        steps.push({
          name: 'Cross-browser smoke (firefox)',
          cmd: 'pnpm --filter @apicircle/e2e-web exec playwright test --project=firefox-smoke',
          env: ciEnv,
        });
        steps.push({
          name: 'Cross-browser smoke (webkit)',
          cmd: 'pnpm --filter @apicircle/e2e-web exec playwright test --project=webkit-smoke',
          env: ciEnv,
        });
      }
      if (t.visual && !filtering) {
        steps.push({
          name: 'Visual baseline (chromium)',
          cmd: 'pnpm --filter @apicircle/e2e-web exec playwright test --project=visual-baseline',
          env: ciEnv,
          soft: true, // Linux baselines aren't committed; treat diffs as a warning locally.
        });
      }
      if (t.desktop && !filtering) {
        steps.push({ name: 'Build desktop main', cmd: 'pnpm --filter @apicircle/desktop build' });
        steps.push({
          name: 'Desktop Electron E2E suite',
          cmd: xvfb('pnpm test:e2e:desktop'),
          env: ciEnv,
        });
      }
      return steps;
    }

    case 'codeql':
      return [{ name: 'CodeQL analysis', fn: (dry) => codeqlAnalyze(dry) }];

    case 'live-github': {
      const filtering = Boolean(t.spec || t.grep);
      const pwf = pwFilter(t);
      const sweepEnv = {
        APICIRCLE_E2E_BOT_OWNER: process.env.APICIRCLE_E2E_BOT_OWNER || '',
        APICIRCLE_E2E_GITHUB_PAT: process.env.APICIRCLE_E2E_GITHUB_PAT || '',
      };
      const steps = [
        { name: 'Validate live-GitHub credentials', fn: () => liveGithubCredsCheck() },
        { name: 'Install Playwright Chromium', cmd: playwrightInstall() },
      ];
      // Skip the orphan sweep on a targeted run — it's an extra rate-limited
      // GitHub API round-trip unrelated to the spec under test.
      if (!filtering) {
        steps.push({
          name: 'Sweep orphan repos (>12h old)',
          cmd: 'node scripts/live-github/sweep-orphans.mjs',
          env: sweepEnv,
          soft: true,
        });
      }
      steps.push({
        name: 'Live-GitHub suite (chromium-live-github)',
        cmd: `pnpm --filter @apicircle/e2e-web exec playwright test --project=chromium-live-github${pwf}`,
        env: { CI: '1', APICIRCLE_E2E_LIVE_GITHUB: '1' },
      });
      return steps;
    }

    default:
      return [];
  }
}

/** E2E strict coverage report — mirrors the merge job's coverage gate. */
async function coverageReport(t, dryRun) {
  const py = pythonExe();
  const results = 'e2e/web/test-results.json';
  if (!existsSync(join(REPO_ROOT, results))) {
    return {
      ok: !t.strictCoverage,
      soft: !t.strictCoverage,
      message: `${results} not found (did the chromium suite run with CI=1?)`,
    };
  }
  if (!py) {
    return {
      ok: !t.strictCoverage,
      soft: !t.strictCoverage,
      message: 'python not found on PATH — skipping coverage attribution',
    };
  }
  const cmd = `${py} scripts/e2e_coverage_report.py --strict --json --from-results=${results} --fail-under=20`;
  if (dryRun) {
    console.log(`  ${dim('$')} ${py} -m pip install --quiet openpyxl`);
    console.log(`  ${dim('$')} ${cmd}`);
    return { ok: true, dry: true };
  }
  // openpyxl is required to read the workbook fixtures; install is best effort.
  await run(`${py} -m pip install --quiet openpyxl`);
  const code = await run(cmd);
  if (code !== 0) {
    return {
      ok: !t.strictCoverage,
      soft: !t.strictCoverage,
      message: 'coverage gate failed (see output above)',
    };
  }
  return { ok: true, message: 'coverage gate passed' };
}

let _python = /** @type {string|null|undefined} */ (undefined);
function pythonExe() {
  if (_python !== undefined) return _python;
  for (const exe of HOST === 'windows' ? ['python', 'python3', 'py'] : ['python3', 'python']) {
    const r = spawnSync(exe, ['--version'], { shell: true, stdio: 'ignore' });
    if (r.status === 0) return (_python = exe);
  }
  return (_python = null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }

  const loadedEnv = loadEnv(args);
  const platform = resolvePlatform();

  // Resolve toggles (CLI flags override env file values).
  const toggles = {
    noInstall: args.noInstall,
    noBuild: args.noBuild,
    noFrozen: args.noFrozen,
    desktop: !args.noDesktop && boolEnv('RUN_DESKTOP_E2E', true),
    crossBrowser: !args.noCrossBrowser && boolEnv('RUN_CROSS_BROWSER', true),
    visual: args.includeVisual || boolEnv('RUN_VISUAL', false),
    vscodeE2e: args.includeVscodeE2e || boolEnv('RUN_VSCODE_E2E', false),
    codeql: args.includeCodeql || boolEnv('RUN_CODEQL', false),
    liveGithub: args.includeLiveGithub || boolEnv('RUN_LIVE_GITHUB', false),
    commitlint: boolEnv('RUN_COMMITLINT', false),
    strictCoverage: args.strictCoverage || boolEnv('STRICT_COVERAGE', false),
    spec: args.spec || '',
    grep: args.grep || '',
  };

  // Validate --only / --skip.
  for (const k of [...args.only, ...args.skip]) {
    if (!STAGE_KEYS.includes(k)) {
      console.error(red(`Unknown stage: ${k}`));
      console.error(`Valid stages: ${STAGE_KEYS.join(', ')}`);
      return 2;
    }
  }

  // Stage selection.
  let selected;
  if (args.only.length) {
    selected = STAGE_KEYS.filter((k) => args.only.includes(k));
  } else {
    selected = STAGE_KEYS.filter((k) => {
      if (k === 'codeql') return toggles.codeql;
      if (k === 'live-github') return toggles.liveGithub;
      if (k === 'setup') return !(toggles.noInstall && toggles.noBuild);
      return true;
    });
  }
  selected = selected.filter((k) => !args.skip.includes(k));

  // ── banner ──
  console.log(bold('\n━━━ API Circle Studio — local CI runner ━━━\n'));
  console.log(`  repo root      ${dim(REPO_ROOT)}`);
  console.log(
    `  host OS        ${HOST}${platform.declared && platform.declared !== HOST ? red(`  (CI_PLATFORM=${platform.declared} mismatches host!)`) : ''}`,
  );
  console.log(`  CI_PLATFORM    ${platform.declared || dim('(auto → ' + HOST + ')')}`);
  if (HOST_IS_LINUX)
    console.log(
      `  xvfb-run       ${hasXvfb() ? green('available') : yellow('not found (Electron/VS Code E2E need a display)')}`,
    );
  if (loadedEnv.length) {
    for (const e of loadedEnv) {
      console.log(`  env file       ${dim(e.file)} ${dim(`(${e.applied}/${e.keys} applied)`)}`);
    }
  } else {
    console.log(`  env file       ${dim('none found (.test.env / .secrets.env)')}`);
  }
  console.log(`  stages         ${bold(selected.join(', ') || '(none)')}`);
  console.log(
    `  e2e sub-suites ${dim(
      toggles.spec || toggles.grep
        ? 'chromium only (filtered run — cross-browser / visual / desktop skipped)'
        : `desktop=${toggles.desktop} cross-browser=${toggles.crossBrowser} visual=${toggles.visual}`,
    )}`,
  );
  if (toggles.spec || toggles.grep) {
    const bits = [];
    if (toggles.spec) bits.push(`spec="${toggles.spec}"`);
    if (toggles.grep) bits.push(`grep="${toggles.grep}"`);
    console.log(`  test filter    ${cyan(bits.join('  '))}`);
    if (!selected.some((k) => k === 'e2e' || k === 'live-github')) {
      console.log(
        yellow(
          '\n  ⚠ --spec/--grep only affect the e2e / live-github Playwright suites,\n' +
            '    but neither is selected — the filter will have no effect.',
        ),
      );
    }
  }
  if (platform.declared && platform.declared !== HOST) {
    console.log(
      yellow(
        `\n  ⚠ CI_PLATFORM is "${platform.declared}" but this machine is "${HOST}". Native suites\n` +
          `    (desktop Electron, VS Code cross-host) run on the real host OS regardless.`,
      ),
    );
  }
  if (selected.includes('live-github')) {
    console.log(
      red('\n  ⚠ live-github is enabled — it CREATES and DELETES real GitHub repositories\n') +
        red('    under the bot account. Make sure APICIRCLE_E2E_BOT_OWNER is a throwaway bot.'),
    );
  }

  if (args.list) {
    console.log(bold('\nPlan:'));
    for (const stage of selected) {
      console.log(`\n  ${bold(stage)}`);
      for (const step of buildSteps(stage, toggles)) {
        const tag = step.soft ? dim(' (soft)') : '';
        const kind = step.fn ? dim(' [check]') : '';
        console.log(`    • ${step.name}${kind}${tag}`);
        if (step.cmd) console.log(`        ${dim('$ ' + step.cmd)}`);
      }
    }
    console.log(
      dim('\n(drop --list to execute; use --dry-run to print every command without running)\n'),
    );
    return 0;
  }

  if (selected.length === 0) {
    console.log(yellow('\nNo stages selected. Nothing to do.'));
    return 0;
  }

  // ── execute ──
  /** @type {Array<{stage:string, step:string, status:string, ms:number, detail:string}>} */
  const results = [];
  let hardFailed = false;

  for (const stage of selected) {
    console.log(bold(`\n┏━━ stage: ${stage} ${'━'.repeat(Math.max(0, 40 - stage.length))}`));
    const steps = buildSteps(stage, toggles);
    let stageAborted = false;

    for (const step of steps) {
      if (stageAborted) {
        results.push({
          stage,
          step: step.name,
          status: 'SKIP',
          ms: 0,
          detail: 'earlier step failed',
        });
        console.log(`\n  ${STATUS.SKIP} ${step.name} ${dim('(earlier step failed)')}`);
        continue;
      }

      console.log(`\n  ${blue('▶')} ${bold(step.name)}`);
      if (step.cmd) console.log(`  ${dim('$ ' + step.cmd)}`);
      const started = Date.now();

      let status = 'PASS';
      let detail = '';

      if (args.dryRun) {
        if (step.fn) await step.fn(true);
        status = 'DRY';
      } else if (step.fn) {
        const res = await step.fn(false);
        detail = res?.message || '';
        if (res?.skipped) status = 'SKIP';
        else if (res?.dry) status = 'DRY';
        else if (res?.ok) status = 'PASS';
        else status = res?.soft || step.soft ? 'WARN' : 'FAIL';
        if (detail) console.log(`  ${dim(detail)}`);
      } else {
        const code = await run(step.cmd, { env: step.env, cwd: step.cwd });
        if (code === 0) status = 'PASS';
        else status = step.soft ? 'WARN' : 'FAIL';
        detail = code === 0 ? '' : `exit ${code}`;
      }

      const ms = Date.now() - started;
      results.push({ stage, step: step.name, status, ms, detail });

      const label =
        status === 'PASS'
          ? STATUS.PASS
          : status === 'WARN'
            ? STATUS.WARN
            : status === 'SKIP'
              ? STATUS.SKIP
              : status === 'DRY'
                ? STATUS.DRY
                : STATUS.FAIL;
      console.log(`  ${label} ${step.name} ${dim(fmtMs(ms))}${detail ? dim(' — ' + detail) : ''}`);

      if (status === 'FAIL') {
        hardFailed = true;
        stageAborted = true; // CI stops a job's remaining steps on a failed step.
        if (args.bail) {
          console.log(red('\n--bail set — stopping at first failure.'));
          await report(results, selected, toggles, platform);
          return 1;
        }
      }
    }
  }

  const ok = await report(results, selected, toggles, platform);
  return ok && !hardFailed ? 0 : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. summary + report
// ─────────────────────────────────────────────────────────────────────────────
async function report(results, selected, toggles, platform) {
  console.log(bold('\n\n━━━ Summary ━━━\n'));
  const pad = (s, n) => String(s).padEnd(n);
  const counts = { PASS: 0, FAIL: 0, WARN: 0, SKIP: 0, DRY: 0 };
  for (const r of results) {
    counts[r.status] = (counts[r.status] || 0) + 1;
    const label =
      r.status === 'PASS'
        ? STATUS.PASS
        : r.status === 'WARN'
          ? STATUS.WARN
          : r.status === 'SKIP'
            ? STATUS.SKIP
            : r.status === 'DRY'
              ? STATUS.DRY
              : STATUS.FAIL;
    console.log(
      `  ${label}  ${pad(r.stage, 12)} ${pad(r.step, 44)} ${dim(pad(fmtMs(r.ms), 7))}${r.detail ? dim('  ' + r.detail) : ''}`,
    );
  }
  console.log(
    `\n  ${green(counts.PASS + ' passed')}  ${counts.FAIL ? red(counts.FAIL + ' failed') : dim('0 failed')}  ${counts.WARN ? yellow(counts.WARN + ' warned') : dim('0 warned')}  ${dim(counts.SKIP + ' skipped')}${counts.DRY ? dim('  ' + counts.DRY + ' dry') : ''}`,
  );

  // Persist machine + human readable reports.
  try {
    mkdirSync(RESULTS_DIR, { recursive: true });
    const stamp = new Date().toISOString();
    const payload = { stamp, host: HOST, platform, toggles, counts, results };
    writeFileSync(join(RESULTS_DIR, 'last-run.json'), JSON.stringify(payload, null, 2));
    const md = [
      `# Local CI run — ${stamp}`,
      '',
      `- Host: \`${HOST}\`  ·  CI_PLATFORM: \`${platform.declared || 'auto'}\``,
      `- Stages: ${selected.join(', ')}`,
      `- ${counts.PASS} passed · ${counts.FAIL} failed · ${counts.WARN} warned · ${counts.SKIP} skipped`,
      '',
      '| Status | Stage | Step | Time | Detail |',
      '| --- | --- | --- | --- | --- |',
      ...results.map(
        (r) => `| ${r.status} | ${r.stage} | ${r.step} | ${fmtMs(r.ms)} | ${r.detail || ''} |`,
      ),
      '',
    ].join('\n');
    writeFileSync(join(RESULTS_DIR, 'last-run.md'), md);
    console.log(dim(`\n  report → scripts/ci-local/results/last-run.{json,md}`));
  } catch (err) {
    console.log(yellow(`  (could not write report: ${err.message})`));
  }

  return counts.FAIL === 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(red(`\nFatal: ${err?.stack || err}`));
    process.exit(1);
  });
