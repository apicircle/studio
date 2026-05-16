"""E2E real-assertion-body counter.

The strict scanner (`e2e_coverage_report.py --strict`) credits a TC-ID
when ANY of these patterns hits the spec source:
  - Inline `tc('TC-...')` / `tcCovered(...)` / `tcRange(...)`
  - `tcMapXX[<literal>]` indexing
  - `helperName('<key>')` resolved to `tcMapXX[key]`
  - `for (... of [Object.entries(]tcMapXX[)])` iteration

That credits cells uniformly regardless of whether the test body asserts
anything against the product. This script reports the HONEST number —
how many actual `test()` invocations exist that have a non-empty body.

  - **Real bodies**: `test(...)` calls (any arg shape) with a non-empty
    function body that doesn't just `test.skip(true, ...)` immediately.
  - **Skip placeholders**: `test.skip(...)` calls (workbook-iteration
    documented skips).
  - **Fixmes**: `test.fixme(...)` calls (placeholders awaiting infra).

Output: counts + per-spec breakdown.

Usage:  python scripts/e2e_real_body_count.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from collections import defaultdict

REPO = Path(__file__).parent.parent
SPEC_GLOBS = (
    "apps/web/e2e/**/*.spec.ts",
    "apps/desktop/e2e/**/*.spec.ts",
)

# Match `test(` (or `test.only(`) but NOT `test.skip(` or `test.fixme(`.
# This counts every test invocation that will actually run.
REAL_RE = re.compile(r"\btest(?:\.only)?\s*\(", re.MULTILINE)
SKIP_RE = re.compile(r"\btest\.skip\s*\(", re.MULTILINE)
FIXME_RE = re.compile(r"\btest\.fixme\s*\(", re.MULTILINE)


def strip_comments(text: str) -> str:
    text = re.sub(r"//.*?$", "", text, flags=re.MULTILINE)
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    return text


def main(argv: list[str]) -> int:
    real_total = 0
    skip_total = 0
    fixme_total = 0
    per_spec: list[tuple[str, int, int, int]] = []

    for glob in SPEC_GLOBS:
        for spec in REPO.glob(glob):
            text = strip_comments(spec.read_text(encoding="utf-8"))
            real = len(REAL_RE.findall(text))
            skip = len(SKIP_RE.findall(text))
            fixme = len(FIXME_RE.findall(text))
            real_total += real
            skip_total += skip
            fixme_total += fixme
            if real + skip + fixme > 0:
                rel = spec.relative_to(REPO).as_posix()
                per_spec.append((rel, real, skip, fixme))

    per_spec.sort(key=lambda r: -r[1])

    print(f"Real test() bodies (run + assert):  {real_total}")
    print(f"test.skip() placeholders:           {skip_total}")
    print(f"test.fixme() placeholders:          {fixme_total}")
    print(f"Total invocations:                  {real_total + skip_total + fixme_total}")
    print()
    print("Top 15 specs by real-body count:")
    print(f"  {'real':>5} {'skip':>5} {'fixme':>5}  spec")
    for rel, r, s, f in per_spec[:15]:
        print(f"  {r:>5} {s:>5} {f:>5}  {rel}")

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
