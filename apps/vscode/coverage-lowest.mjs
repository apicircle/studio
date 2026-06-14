/* global console */
import data from './coverage/coverage-summary.json' with { type: 'json' };
const rows = [];
for (const [file, stats] of Object.entries(data)) {
  if (file === 'total') continue;
  const norm = file.split('\\').join('/');
  if (!norm.includes('apps/vscode/src')) continue;
  if (stats.lines.total < 10) continue;
  rows.push({
    file: norm.replace(/.*apps\/vscode\/src\//, ''),
    pct: stats.lines.pct,
    uncovered: stats.lines.total - stats.lines.covered,
    total: stats.lines.total,
  });
}
rows.sort((a, b) => a.pct - b.pct);
console.log('Bottom 25 files by line% (excluding <10-line files)');
for (const r of rows.slice(0, 25)) {
  console.log(
    r.file.padEnd(60),
    String(r.pct).padStart(6),
    String(r.uncovered).padStart(5),
    String(r.total).padStart(5),
  );
}
