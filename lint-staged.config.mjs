// Lint-staged configuration.
//
// Function config so we can pass the exact staged file list to ESLint
// rather than linting the entire repo. Prettier stays per-file because
// it's cheap and order-independent.

export default (stagedFiles) => {
  const tasks = [];

  const tsFiles = stagedFiles.filter((f) => /\.(ts|tsx)$/.test(f));
  if (tsFiles.length > 0) {
    // Lint only the staged TS/TSX files. The type-aware rules still load
    // the full project graph, but limiting the file list cuts the working
    // set enough to avoid OOM on machines with ≤8 GB available heap.
    tasks.push(`pnpm exec eslint --cache --fix ${tsFiles.map((f) => JSON.stringify(f)).join(' ')}`);
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
