// Lint-staged configuration.
//
// We use a *function* config (rather than the simpler globs map) for one
// specific reason: type-aware ESLint has to load the entire TypeScript
// project graph on every invocation. Running it once per chunk of staged
// files (lint-staged's default behaviour, with chunks driven by Windows
// ARG_MAX) means N parallel ESLint workers each holding 1-2 GB of project
// memory — easy OOM on a developer machine.
//
// Returning a single `eslint --cache --fix .` command for any TS/TSX
// change collapses that to one worker that benefits from the on-disk
// cache for unchanged files. Prettier stays per-file because it's cheap
// and order-independent.

export default (stagedFiles) => {
  const tasks = [];

  const tsFiles = stagedFiles.filter((f) => /\.(ts|tsx)$/.test(f));
  if (tsFiles.length > 0) {
    // Single ESLint pass over the whole repo. The cache makes re-runs of
    // unchanged files near-free; the fix output is staged automatically by
    // lint-staged when the listed files were modified.
    tasks.push('pnpm exec eslint --cache --fix .');
  }

  const prettierFiles = stagedFiles.filter((f) => /\.(ts|tsx|json|md|css|yml|yaml)$/.test(f));
  if (prettierFiles.length > 0) {
    // Prettier per file is fine — it doesn't load a project graph.
    tasks.push(
      `pnpm exec prettier --write ${prettierFiles.map((f) => JSON.stringify(f)).join(' ')}`,
    );
  }

  return tasks;
};
