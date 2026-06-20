#!/usr/bin/env bash
# Thin wrapper around the Node CI runner (scripts/ci-local/run-ci.mjs).
# Use on macOS / Linux; forwards all arguments through to the orchestrator.
#
#   ./scripts/ci-local/run-ci.sh --list
#   ./scripts/ci-local/run-ci.sh --only ci,vscode
#   ./scripts/ci-local/run-ci.sh --include-live-github
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$HERE/run-ci.mjs" "$@"
