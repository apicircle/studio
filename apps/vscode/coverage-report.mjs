/* global console */
import data from './coverage/coverage-summary.json' with { type: 'json' };

const rows = [];
for (const [file, stats] of Object.entries(data)) {
  if (file === 'total') continue;
  const norm = file.split('\\').join('/');
  if (!norm.includes('apps/vscode/src')) continue;
  const lines = stats.lines;
  if (lines.total < 20) continue;
  rows.push({
    file: norm.replace(/.*apps\/vscode\/src\//, ''),
    pct: lines.pct,
    uncovered: lines.total - lines.covered,
    total: lines.total,
    branches: stats.branches.pct,
    functions: stats.functions.pct,
  });
}
rows.sort((a, b) => b.uncovered - a.uncovered);
console.log('File'.padEnd(60), 'Lines%', 'Br%', 'Fn%', 'Uncov', 'Total');
for (const r of rows.slice(0, 60)) {
  console.log(
    r.file.padEnd(60),
    String(r.pct).padStart(6),
    String(r.branches).padStart(5),
    String(r.functions).padStart(5),
    String(r.uncovered).padStart(5),
    String(r.total).padStart(5),
  );
}
