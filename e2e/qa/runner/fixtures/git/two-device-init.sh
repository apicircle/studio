#!/usr/bin/env bash
# Initialize two disposable worktrees on a bare repo to simulate
# two devices for git-conflict tests. Usage: ./two-device-init.sh <name>
set -euo pipefail
NAME=${1:-conflict-demo}
ROOT=$(mktemp -d)/${NAME}
mkdir -p "$ROOT"
cd "$ROOT"
git init --bare bare.git
git clone bare.git device-a
git clone bare.git device-b
cd device-a
echo '{"schemaVersion":1,"id":"ws","name":"Demo"}' > workspace.json
git add workspace.json
git -c user.email=a@example.com -c user.name='Device A' \
    commit -m 'init'
git push origin master 2>/dev/null || git push origin main
cd ../device-b
git pull --rebase
echo "Two-device worktree created at: $ROOT"
