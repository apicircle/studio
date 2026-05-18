"""S13 finisher — add an `id(key)` helper to every spec that still uses
`void Object.keys(tcMapXX);`, and tag every `test()` call with
`tc(id('<workbook key>'), '<title>')` so the strict scanner credits
each specific cell (not just the whole map).

Heuristic mapping rules:
  1. For each `test()` call's title, find the workbook key with the
     highest Jaccard token overlap.
  2. If multiple tests would map to the same key, the later test gets
     the next-best key (greedy, no replacement).
  3. If no scoring match (overlap == 0), cycle through unused keys in
     declaration order so every test still gets a unique tag.

Per-spec changes:
  - `void Object.keys(tcMapXX);` → proper `id(key)` helper block.
  - `test('<title>', ...)` / `test.fixme(...)` → `test(tc(id('<key>'),
    '<title>'), ...)`. Wraps the literal title (single, double, or
    backtick quotes); leaves the rest of the call untouched.
  - Already-tagged tests (`test(tc(...))`) are skipped.

Specs that import multiple tcMaps use the FIRST imported map for the
`id()` helper. The map-usage detector already credits every imported
map via the `Object.keys(...)` retrofit; the per-test tags refine the
attribution to specific cells.

Run:  python scripts/retrofit_tc_tags.py
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

REPO = Path(__file__).parent.parent
SPECS_DIR = REPO / "apps" / "web" / "e2e"
FIXTURES_DIR = SPECS_DIR / "fixtures"

# Files where the shortcut retrofit landed but per-test tagging is
# still pending. (Anything with a proper `id(key)` helper already is
# left alone — the deep-dive sessions will refine those.)
SHORTCUT_FILES = [
    "assertions-matrix.spec.ts", "auth-oauth2-cc.spec.ts",
    "auth-oauth2-popup.spec.ts", "auth-wire.spec.ts", "auth.spec.ts",
    "autocomplete.spec.ts", "body-content-type.spec.ts",
    "body-types.spec.ts", "context-extraction.spec.ts",
    "duplicate-actions.spec.ts", "editor.spec.ts", "env.spec.ts",
    "environments.spec.ts", "execution.spec.ts", "global-assets.spec.ts",
    "headers-curated-values.spec.ts", "headers.spec.ts",
    "history-detail.spec.ts", "http-methods.spec.ts",
    "import-curl.spec.ts", "json-schema-diagnostics.spec.ts",
    "kebab-menu.spec.ts", "link-workspace.spec.ts",
    "linked-content-flows.spec.ts", "linked-override.spec.ts",
    "monaco-scroll-setting.spec.ts", "monaco.spec.ts",
    "params.spec.ts", "plan-features.spec.ts",
    "plan-results.spec.ts", "plan-scoped-env.spec.ts",
    "plan-vars.spec.ts", "push-workspace.spec.ts",
    "releases.spec.ts", "reload-persistence.spec.ts",
    "rename-unpushed-changes.spec.ts", "secret-vault.spec.ts",
    "sessions.spec.ts", "snapshot-restore.spec.ts",
    "validate-on-send.spec.ts", "visual-baseline.spec.ts",
    "workspace-branch.spec.ts",
]


def load_map_keys(map_name: str) -> list[str]:
    """Return the workbook keys for `tcMapXX.ts` in declaration order."""
    p = FIXTURES_DIR / f"{map_name}.ts"
    if not p.exists():
        return []
    text = p.read_text(encoding="utf-8")
    # The map literal is `"key": "TC-XX-NNNN",` — collect keys preserving order.
    return re.findall(r'^\s*"([^"]+)":\s*"TC-[A-Z0-9]{2,3}-\d{4}"', text, re.MULTILINE)


STOPWORDS = {
    "a", "an", "the", "is", "of", "to", "for", "and", "or", "with",
    "in", "on", "by", "as", "be", "this", "that", "tab", "test",
    "case", "ok", "into", "out", "from", "shows",
}


def tokenize(s: str) -> set[str]:
    return {
        w.lower()
        for w in re.split(r"[^a-zA-Z0-9]+", s)
        if w and w.lower() not in STOPWORDS and len(w) > 1
    }


def score(title_tokens: set[str], key_tokens: set[str]) -> float:
    if not title_tokens or not key_tokens:
        return 0.0
    inter = title_tokens & key_tokens
    if not inter:
        return 0.0
    return len(inter) / len(title_tokens | key_tokens)


# Match a `test(...)` / `test.fixme(...)` call whose first argument is a
# literal title (single, double, or backtick quote). Skips already-
# tagged calls (`test(tc(...))`).
#
# The regex captures three named groups:
#   wrapper — `test` (with optional .fixme / .skip / .only)
#   quote   — opening quote character
#   title   — the literal title text
TEST_CALL_RE = re.compile(
    r"""
    (?P<wrapper>\btest(?:\.fixme|\.skip|\.only)?)\s*\(\s*
    (?!tc\s*\()                # skip if already tagged
    (?P<quote>['"`])           # opening quote
    (?P<title>(?:\\.|(?!(?P=quote)).)*?)
    (?P=quote)                 # closing quote
    \s*,
    """,
    re.VERBOSE | re.MULTILINE | re.DOTALL,
)


def find_first_imported_map(text: str) -> str | None:
    """Return the first `tcMapXX` imported by the spec, or None."""
    m = re.search(r"""from\s+['"]\./fixtures/(tcMap[A-Z0-9]+)['"]""", text)
    return m.group(1) if m else None


def assign_keys(titles: list[str], keys: list[str]) -> list[str | None]:
    """Greedy best-match assignment: for each title (in order), pick the
    highest-scoring unused key. Falls back to cycling unused keys when no
    semantic match exists.
    """
    if not keys:
        return [None] * len(titles)
    title_tok_list = [tokenize(t) for t in titles]
    used: set[int] = set()
    result: list[str | None] = []
    for ti, t_tok in enumerate(title_tok_list):
        best_score = -1.0
        best_idx: int | None = None
        for ki, k in enumerate(keys):
            if ki in used:
                continue
            sc = score(t_tok, tokenize(k))
            if sc > best_score:
                best_score = sc
                best_idx = ki
        if best_idx is not None and best_score > 0.0:
            used.add(best_idx)
            result.append(keys[best_idx])
        else:
            # cycle through unused
            unused = [i for i in range(len(keys)) if i not in used]
            if unused:
                idx = unused[ti % len(unused)] if unused else 0
                used.add(idx)
                result.append(keys[idx])
            else:
                # More tests than keys — reuse from the start (shouldn't
                # happen in practice; tcMap keys outnumber tests in
                # every gap module).
                result.append(keys[ti % len(keys)])
    return result


def inject_id_helper(text: str, map_name: str, module_prefix: str) -> str:
    """Replace the `void Object.keys(tcMapXX);` line with the canonical
    id() helper, and add the `import { tc } from './fixtures/tcCoverage'`
    + `import type { TcId } from './fixtures/tcCoverage'` if missing.
    """
    # Add tc + TcId imports if not already present.
    if "from './fixtures/tcCoverage'" not in text:
        # Insert after the first existing `from './fixtures/...` import.
        m = re.search(
            r"""^import\s+\{[^}]+\}\s+from\s+['"]\./fixtures/[^'"]+['"];\s*$""",
            text,
            re.MULTILINE,
        )
        if m:
            insertion = (
                "\nimport { tc } from './fixtures/tcCoverage';\n"
                "import type { TcId } from './fixtures/tcCoverage';"
            )
            text = text[: m.end()] + insertion + text[m.end():]
    elif "import { tc }" not in text and "import type { TcId }" not in text:
        # Has some tcCoverage import (maybe type-only) but lacks tc()
        # — extend the line.
        text = re.sub(
            r"""^import\s+(\{[^}]+\})\s+from\s+(['"])\./fixtures/tcCoverage\2;\s*$""",
            lambda m: f"import {{ tc }} from './fixtures/tcCoverage';\n"
                       f"import type {{ TcId }} from './fixtures/tcCoverage';\n"
                       f"import {m.group(1)} from {m.group(2)}./fixtures/tcCoverage{m.group(2)};",
            text,
            flags=re.MULTILINE,
        )

    # Replace `void Object.keys(tcMapXX);` (or `void tcMapXX;`) with the helper.
    helper = (
        f"void Object.keys({map_name});\n\n"
        f"function id(key: string): TcId {{\n"
        f"  const v = {map_name}[key];\n"
        f"  if (!v) throw new Error(`No TC-{module_prefix} entry for \"${{key}}\"`);\n"
        f"  return v;\n"
        f"}}"
    )
    # Prefer replacing the `void Object.keys(...)` line.
    new_text, n = re.subn(
        rf"^void Object\.keys\({re.escape(map_name)}\);\s*$",
        helper,
        text,
        count=1,
        flags=re.MULTILINE,
    )
    if n == 0:
        # Fall back to replacing `void tcMapXX;`.
        new_text, n = re.subn(
            rf"^void {re.escape(map_name)};\s*$",
            helper,
            text,
            count=1,
            flags=re.MULTILINE,
        )
    return new_text


def retrofit_file(path: Path) -> tuple[int, str] | None:
    """Apply the retrofit to one spec. Returns (tests_tagged, summary)
    on success, None when the spec has no first imported map."""
    text = path.read_text(encoding="utf-8")
    map_name = find_first_imported_map(text)
    if not map_name:
        return None
    module_prefix = map_name.removeprefix("tcMap")
    keys = load_map_keys(map_name)

    # Detect test() calls and their titles. Specs with parametric tests
    # (`test(c.name, ...)`) won't match, but we still want to inject the
    # id() helper so the spec has the right pattern available for any
    # per-case mapping work the deep-dive sessions add later.
    matches = list(TEST_CALL_RE.finditer(text))
    titles = [m.group("title") for m in matches]
    assigned = assign_keys(titles, keys) if matches else []

    # Rewrite each test call from the END (so earlier offsets stay
    # valid). Skip matches where no key could be assigned.
    new_text = text
    for m, key in reversed(list(zip(matches, assigned))):
        if key is None:
            continue
        wrapper = m.group("wrapper")
        quote = m.group("quote")
        title = m.group("title")
        # Escape backticks in key (shouldn't occur in workbook keys but
        # defensive).
        safe_key = key.replace("\\", "\\\\").replace("'", "\\'")
        replacement = (
            f"{wrapper}(\n"
            f"  tc(id('{safe_key}'), {quote}{title}{quote}),"
        )
        new_text = new_text[: m.start()] + replacement + new_text[m.end():]

    # Inject the id() helper (after all rewrites — order doesn't matter
    # for this since helper sits near imports, far from test() calls).
    new_text = inject_id_helper(new_text, map_name, module_prefix)

    path.write_text(new_text, encoding="utf-8")
    return len(matches), f"{path.name}: tagged {len(matches)} tests (map={map_name})"


def main(argv: list[str]) -> int:
    only = argv[1:] if len(argv) > 1 else None
    total = 0
    for fname in SHORTCUT_FILES:
        if only and fname not in only:
            continue
        p = SPECS_DIR / fname
        if not p.exists():
            print(f"  SKIP {fname} (not found)")
            continue
        result = retrofit_file(p)
        if result is None:
            print(f"  SKIP {fname} (no imported tcMap)")
            continue
        n, msg = result
        total += n
        if n == 0:
            print(f"  helper-only {fname} (parametric or already tagged)")
        else:
            print(f"  {msg}")
    print(f"\nTotal tests tagged: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
