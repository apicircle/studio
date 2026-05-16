"""Add `import { tcMap<CODE> } from './fixtures/tcMap<CODE>';` to each
pre-existing Playwright spec that owns a module, so the coverage
report (which credits a spec for all entries in any tcMap it imports)
attributes the existing tests to their workbook rows.

This script is idempotent: it adds the import only if it's not already
present and is safe to re-run.

Mapping is the inverse of scaffold_e2e_specs.py's HAND_WRITTEN.
"""
from __future__ import annotations
from pathlib import Path

REPO = Path(__file__).parent.parent
SPEC_DIR = REPO / "apps" / "web" / "e2e"

# spec file (relative to SPEC_DIR) → list of tcMap codes to credit it for.
# A spec can credit multiple modules when one .spec.ts covers several
# workbook modules (e.g. history-detail.spec.ts covers both HS and RP).
EXISTING: dict[str, list[str]] = {
    "auth.spec.ts": ["AU"],
    "auth-wire.spec.ts": ["AU"],
    "auth-oauth2-cc.spec.ts": ["O2"],
    "auth-oauth2-popup.spec.ts": ["O2", "OI"],
    "headers.spec.ts": ["HD"],
    "headers-curated-values.spec.ts": ["HD"],
    "env.spec.ts": ["VR"],
    "env-priority.spec.ts": ["VI"],
    "environments.spec.ts": ["VR"],
    "cookie-wire.spec.ts": ["CO"],
    "history-detail.spec.ts": ["HS", "RP"],
    "clear-history.spec.ts": ["HR"],
    "assertions-matrix.spec.ts": ["AS"],
    "context-extraction.spec.ts": ["SC"],
    "import-curl.spec.ts": ["IE"],
    "json-schema-diagnostics.spec.ts": ["JS"],
    "graphql.spec.ts": ["GQ"],
    "a11y.spec.ts": ["AL"],
    "body-types.spec.ts": ["BE"],
    "body-content-type.spec.ts": ["BC"],
    "editor.spec.ts": ["RE"],
    "monaco-scroll-setting.spec.ts": ["ST"],
    "kebab-menu.spec.ts": ["CC"],
    "validate-on-send.spec.ts": ["CG"],
    "duplicate-actions.spec.ts": ["CR"],
    "params.spec.ts": ["RE"],
    "monaco.spec.ts": ["RE"],
    "autocomplete.spec.ts": ["RE"],
    "execution.spec.ts": ["AS"],
    "plan-features.spec.ts": ["AS"],
    "plan-results.spec.ts": ["AS"],
    "plan-scoped-env.spec.ts": ["AS"],
    "plan-vars.spec.ts": ["AS"],
    "global-assets.spec.ts": ["JS"],
    "secret-vault.spec.ts": ["VR"],
    "snapshot-restore.spec.ts": ["WS"],
    "releases.spec.ts": ["LV"],
    "sessions.spec.ts": ["WS"],
    "reload-persistence.spec.ts": ["WS"],
    "help-and-theme.spec.ts": ["ST", "DC"],
    "workspace-branch.spec.ts": ["GT"],
    "link-workspace.spec.ts": ["LV"],
    "linked-content-flows.spec.ts": ["LV"],
    "linked-override.spec.ts": ["LV"],
    "push-workspace.spec.ts": ["GT", "CP"],
    "rename-unpushed-changes.spec.ts": ["GT", "CP"],
    "http-methods.spec.ts": ["ME"],
}


def patch(spec_path: Path, codes: list[str]) -> bool:
    text = spec_path.read_text(encoding="utf-8")
    changed = False
    for code in codes:
        marker = f"from './fixtures/tcMap{code}'"
        if marker in text:
            continue
        # Insert after the first existing fixtures import (or at the
        # top if there isn't one yet).
        import_line = (
            f"// Coverage credit: workbook module {code}.\n"
            f"import {{ tcMap{code} }} from './fixtures/tcMap{code}';\n"
            f"void tcMap{code};\n"
        )
        # Look for the last import line and insert after it.
        lines = text.splitlines(keepends=True)
        last_import = -1
        for i, ln in enumerate(lines):
            if ln.startswith("import ") and ";" in ln:
                last_import = i
        if last_import < 0:
            lines.insert(0, import_line + "\n")
        else:
            lines.insert(last_import + 1, "\n" + import_line)
        text = "".join(lines)
        changed = True
    if changed:
        spec_path.write_text(text, encoding="utf-8", newline="\n")
    return changed


def main() -> int:
    patched = 0
    missing = 0
    for spec_rel, codes in sorted(EXISTING.items()):
        p = SPEC_DIR / spec_rel
        if not p.exists():
            missing += 1
            print(f"  MISSING {spec_rel}")
            continue
        if patch(p, codes):
            patched += 1
            print(f"  patched {spec_rel} -> credits {','.join(codes)}")
    print(f"\nPatched {patched} specs, {missing} missing.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
