# Migration guide — workspace storage relocations

The Git-tracked workspace document has moved twice since 1.0.0. Both are
**hard cutovers** — newer versions do not read the old layout.

## Layout history

```
# Layout 1 — ≤ 1.0.8 (root workspace.json)
repo-root/
├── workspace.json              ← synced doc at repo root
└── .apicircle/
    └── attachments/<slotId>

# Layout 2 — 1.0.9 (flat .apicircle/)
repo-root/
└── .apicircle/
    ├── workspace.json          ← moved into dotfolder
    └── attachments/<slotId>

# Layout 3 — 1.1.0+ (per-id subdirectories, current)
repo-root/
└── .apicircle/
    ├── registry.json                      ← workspace index (new)
    └── workspace-<id>/
        ├── workspace.json                 ← per-id subdirectory
        └── attachments/<slotId>           ← attachments moved alongside
```

**Layout 3 is the current format.** The desktop app, VS Code extension, and Lens-owned CLI/MCP automation
VS Code extension all resolve workspace paths via `registry.json` →
`workspace-<id>/workspace.json`.

---

## Who needs to migrate

- **Layout 1** (root `workspace.json`) — repos created before 1.0.9.
- **Layout 2** (flat `.apicircle/workspace.json`) — repos created with 1.0.9.
- **Template forks or example repos** forked from either era.

You do **not** need to migrate if:

- Your workspace is **desktop-only** (not connected to a GitHub repo) — the
  desktop app manages the on-disk layout under `~/.apicircle/workspace-<id>/`
  automatically.
- Your repo already has `.apicircle/registry.json` and
  `.apicircle/workspace-<id>/workspace.json` — you are on Layout 3.

---

## Option A — Re-push from the desktop app (recommended)

The simplest path. The desktop app writes Layout 3 automatically on push,
regardless of what layout the repo currently has.

1. Open the **desktop app** (1.1.0 or later).
2. Connect it to your workspace repo via **Link to Git** if not already
   connected.
3. **Push** the workspace. The push writes the per-id layout to the working
   branch.
4. Merge the PR (or fast-forward the branch) to land the new layout on your
   base branch.
5. **Delete stale files** from the repo — they are no longer read by any
   surface:

   ```bash
   # If migrating from Layout 1 (root workspace.json)
   git rm workspace.json

   # If migrating from Layout 2 (flat .apicircle/workspace.json)
   git rm .apicircle/workspace.json

   # If attachments were at the old flat location
   git rm -r .apicircle/attachments/ 2>/dev/null

   git commit -m "chore: remove stale workspace files (migrated to per-id layout)"
   git push
   ```

---

## Option B — Manual file move

### From Layout 1 (root workspace.json → Layout 3)

```bash
# Read the workspace id from the document
WSID=$(python3 -c "import json; print(json.load(open('workspace.json'))['workspaceId'])" 2>/dev/null \
  || node -e "console.log(JSON.parse(require('fs').readFileSync('workspace.json','utf8')).workspaceId)")

# Create the per-id directory structure
mkdir -p ".apicircle/workspace-$WSID/attachments"

# Move the workspace document
mv workspace.json ".apicircle/workspace-$WSID/workspace.json"

# Move attachments if they exist at the old location
if [ -d ".apicircle/attachments" ]; then
  mv .apicircle/attachments/* ".apicircle/workspace-$WSID/attachments/" 2>/dev/null
  rmdir .apicircle/attachments 2>/dev/null
fi

# Create the registry index
cat > .apicircle/registry.json << EOF
{"activeWorkspaceId":"$WSID","workspaces":[{"id":"$WSID"}]}
EOF

git add .apicircle
git rm workspace.json 2>/dev/null
git commit -m "chore: migrate workspace to per-id layout (1.1.0)"
git push
```

### From Layout 2 (flat .apicircle/workspace.json → Layout 3)

```bash
# Read the workspace id
WSID=$(python3 -c "import json; print(json.load(open('.apicircle/workspace.json'))['workspaceId'])" 2>/dev/null \
  || node -e "console.log(JSON.parse(require('fs').readFileSync('.apicircle/workspace.json','utf8')).workspaceId)")

# Create the per-id directory structure
mkdir -p ".apicircle/workspace-$WSID/attachments"

# Move the workspace document into the subdirectory
mv .apicircle/workspace.json ".apicircle/workspace-$WSID/workspace.json"

# Move attachments if they exist at the flat location
if [ -d ".apicircle/attachments" ]; then
  mv .apicircle/attachments/* ".apicircle/workspace-$WSID/attachments/" 2>/dev/null
  rmdir .apicircle/attachments 2>/dev/null
fi

# Create the registry index
cat > .apicircle/registry.json << EOF
{"activeWorkspaceId":"$WSID","workspaces":[{"id":"$WSID"}]}
EOF

git add .apicircle
git commit -m "chore: migrate workspace to per-id layout (1.1.0)"
git push
```

---

## Option C — Export and re-import (fresh start)

If your workspace has drifted or you want a clean slate, you can export
individual folders from the old workspace and import them into a new one.
This works from **any** layout version.

### Export from the old workspace

**From the UI (any build):**

1. Open the workspace in the desktop app or web app.
2. For each folder you want to keep: click the folder kebab menu (⋮) →
   **Export as JSON**. This produces a portable `.apicircle.json` file
   containing the folder's requests, environments, and dependencies.
3. To export environments separately: go to the **Environments** sidebar →
   kebab menu → **Export as JSON**.

**From headless automation:**

Studio no longer publishes the old `@apicircle/cli` package. Use API Circle
Lens for current import/export automation against the same Git-backed
`.apicircle` workspace.

### Import into a new workspace

**From the UI:**

1. Create a new workspace (or open an existing one on 1.1.0+).
2. Use the **Import** button and select the `.apicircle.json` file(s).
3. If the export contained encrypted secret rows, the importer will prompt
   you to provide secret values (or skip them).

**From headless automation:**

Use API Circle Lens for current CLI import flows. Studio's migration path stays
the UI import/export workflow plus the shared `.apicircle` workspace format.

---

## What about the desktop's local data?

The desktop app stores per-device runtime data (history, mock runtime state,
UI state, decrypted secrets) in **`WorkspaceLocal`**, which lives in
IndexedDB and the on-disk mirror at `~/.apicircle/workspace-<id>/`. This
data is **not** affected by the Git layout change — it stays on your machine
and is never committed to the repo.

---

## Verifying the migration

After migrating, confirm the current layout:

```bash
# The registry should exist
cat .apicircle/registry.json

# The synced doc should be in a per-id subdirectory
# (replace <id> with your workspace id from the registry)
ls .apicircle/workspace-*/workspace.json

# Old locations should be gone
test -f workspace.json && echo "WARNING: stale root workspace.json" || echo "OK — no root file"
test -f .apicircle/workspace.json && echo "WARNING: stale flat workspace.json" || echo "OK — no flat file"
test -d .apicircle/attachments && echo "WARNING: stale flat attachments/" || echo "OK — no flat attachments"
```

Open the workspace in the desktop app or, for MCP automation, open the same repo in API Circle Lens to
confirm it loads correctly:

```bash
apicircle-lens mcp --repo .
```
