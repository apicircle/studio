#!/usr/bin/env pwsh
# Thin wrapper around the Node CI runner (scripts/ci-local/run-ci.mjs).
# Use on Windows; forwards all arguments through to the orchestrator.
#
#   ./scripts/ci-local/run-ci.ps1 --list
#   ./scripts/ci-local/run-ci.ps1 --only ci,vscode
#   ./scripts/ci-local/run-ci.ps1 --include-live-github
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
node (Join-Path $here 'run-ci.mjs') @args
exit $LASTEXITCODE
