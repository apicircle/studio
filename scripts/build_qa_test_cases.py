"""Build APICircle Studio Manual Test Cases workbooks (web + desktop).

Produces two files:
  docs/qa/web-app-manual-test-cases.xlsx
  docs/qa/desktop-app-manual-test-cases.xlsx

Each test entry is tagged with which platform(s) it applies to.
"""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.formatting.rule import CellIsRule
from openpyxl.worksheet.datavalidation import DataValidation

OUT_DIR = r"C:/Local Development/APICircle/studio/docs/qa"

FONT_NAME = "Arial"
HEADER_FILL = PatternFill("solid", start_color="4F46E5")
HEADER_FONT = Font(name=FONT_NAME, bold=True, color="FFFFFF", size=11)
TITLE_FONT = Font(name=FONT_NAME, bold=True, color="FFFFFF", size=14)
SECTION_FILL = PatternFill("solid", start_color="6D28D9")
SECTION_FONT = Font(name=FONT_NAME, bold=True, color="FFFFFF", size=12)
BASE_FONT = Font(name=FONT_NAME, size=10)
BOLD_FONT = Font(name=FONT_NAME, bold=True, size=10)
WRAP = Alignment(wrap_text=True, vertical="top", horizontal="left")
CENTER = Alignment(wrap_text=True, vertical="center", horizontal="center")
THIN = Side(border_style="thin", color="D1D5DB")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

PRIORITY_HIGH_FILL = PatternFill("solid", start_color="FEE2E2")
PRIORITY_MED_FILL = PatternFill("solid", start_color="FEF3C7")
PRIORITY_LOW_FILL = PatternFill("solid", start_color="DCFCE7")

PASS_FILL = PatternFill("solid", start_color="BBF7D0")
FAIL_FILL = PatternFill("solid", start_color="FECACA")
BLOCKED_FILL = PatternFill("solid", start_color="FED7AA")
NOT_RUN_FILL = PatternFill("solid", start_color="E5E7EB")
SKIPPED_FILL = PatternFill("solid", start_color="DBEAFE")

# Modules used across both platforms; some are platform-specific.
MODULES = [
    ("WS", "Workspace Management"),
    ("CR", "Collections & Requests"),
    ("RE", "Request Editor"),
    ("BE", "Body Editor"),
    ("AU", "Authentication"),
    ("O2", "OAuth2 Flows"),
    ("VR", "Variables & Environments"),
    ("RP", "Response Panel"),
    ("SC", "Pre-request Scripts & Tests"),
    ("HS", "History"),
    ("CO", "Cookies"),
    ("MK", "Mock Servers"),
    ("ST", "Settings & Theming"),
    ("IE", "Import / Export"),
    ("GT", "Git Integration"),
    ("GQ", "GraphQL"),
    ("AS", "Assertions & Execution Plans"),
    ("DC", "Documentation Viewer"),
    ("SE", "Search & Marketplace"),
    ("KB", "Keyboard Shortcuts"),
    ("AL", "Accessibility"),
    ("NW", "Network Conditions"),
    ("PE", "Performance"),
    ("SY", "Security"),
    ("CC", "Cross-Cutting UX"),
    # Platform-specific top-level modules
    ("WB", "Web-Specific (Browser)"),
    ("DS", "Desktop-Specific (Electron)"),
    ("CL", "CLI"),
]
MODULE_NAME = dict(MODULES)

# Tests are tuples:
# (platforms_set, mod_code, sub_feature, test_type, title, pre, steps, data, expected, priority)
TESTS = []
BOTH = ("web", "desktop")
WEB = ("web",)
DESK = ("desktop",)


def t(plats, mod, sub, ttype, title, pre, steps, data, expected, prio="Medium"):
    TESTS.append((set(plats), mod, sub, ttype, title, pre, steps, data, expected, prio))


# =====================================================================
# WORKSPACE MANAGEMENT (WS)
# =====================================================================
t(BOTH, "WS", "Create", "Functional",
  "Create a new local workspace",
  "App is launched; no workspace active.",
  "1. Open Workspace switcher.\n2. Click 'Create new workspace'.\n3. Enter name 'QA-Smoke-WS' and confirm.",
  "Name: QA-Smoke-WS",
  "Workspace 'QA-Smoke-WS' is created and becomes active; explorer shows zero collections; top bar shows the workspace name.",
  "High")

t(BOTH, "WS", "Create", "Negative",
  "Reject blank workspace name",
  "Create workspace dialog is open.",
  "1. Leave name empty.\n2. Click Create.",
  "Name: (empty)",
  "Create button is disabled or validation error 'Workspace name is required' is shown; no workspace is created.",
  "Medium")

t(BOTH, "WS", "Create", "Edge Case",
  "Workspace name supports unicode and emoji",
  "Create workspace dialog open.",
  "1. Enter name 'Café 🚀 测试 αβγ'.\n2. Confirm.",
  "Name: Café 🚀 测试 αβγ",
  "Workspace is created and the unicode/emoji name renders correctly in switcher, top bar, and persisted state.",
  "Low")

t(BOTH, "WS", "Create", "Edge Case",
  "Workspace name max length",
  "Create dialog open.",
  "1. Paste a 256-character name.\n2. Confirm.",
  "256-char name",
  "Either name is accepted and truncated to the documented limit, or a clear validation error appears; UI does not break layout.",
  "Low")

t(BOTH, "WS", "Switcher", "Functional",
  "Switch between two workspaces",
  "Workspaces 'A' and 'B' exist.",
  "1. Open switcher.\n2. Select 'B'.\n3. Wait for hydrate.",
  "Two workspaces",
  "Active workspace changes to B; explorer, environments, history all reflect B's data; top bar updates.",
  "High")

t(BOTH, "WS", "Switcher", "Functional",
  "Recent workspaces persist across restart",
  "User has opened 3 workspaces this session.",
  "1. Restart the app.\n2. Open switcher.",
  "Three workspaces",
  "All 3 workspaces are listed in last-opened order; the last-active workspace is restored automatically.",
  "High")

t(BOTH, "WS", "Delete", "Functional",
  "Delete workspace requires confirmation",
  "Workspace 'Disposable' active.",
  "1. Workspace settings → Delete workspace.\n2. Observe confirm dialog.\n3. Click Cancel.",
  "Disposable workspace",
  "Destructive confirm dialog shown; on cancel, workspace remains.",
  "High")

t(BOTH, "WS", "Delete", "Functional",
  "Confirm deletion removes workspace from registry",
  "Workspace 'Disposable' active.",
  "1. Trigger delete.\n2. Confirm.",
  "Disposable workspace",
  "Workspace removed; app switches to another or empty state; deletion persists across restart.",
  "High")

t(BOTH, "WS", "Link to Git", "Functional",
  "Link workspace to a GitHub repo",
  "Workspace unlinked; user has GitHub account.",
  "1. Click 'Link to Git'.\n2. Authorize GitHub OAuth.\n3. Pick / create repo.\n4. Confirm.",
  "Repo: test-owner/qa-link",
  "Workspace links; a working branch is created on the remote; Push/Pull enabled; status badge 'Linked'.",
  "High")

t(BOTH, "WS", "Link to Git", "Negative",
  "OAuth scope denial blocks linking",
  "Workspace unlinked.",
  "1. Begin link flow.\n2. On GitHub consent, click Cancel.",
  "—",
  "Toast 'GitHub authorization was cancelled'; workspace remains unlinked; no working branch created.",
  "Medium")

t(BOTH, "WS", "Link to Git", "Negative",
  "GitHub token revoked surfaces re-auth prompt",
  "Workspace linked; user revoked token on github.com.",
  "1. Click Push.",
  "—",
  "App detects 401; prompts user to re-authorize; push aborted; no data lost.",
  "High")

t(BOTH, "WS", "Push", "Functional",
  "Push edits to working branch",
  "Workspace linked; user modified ≥1 request.",
  "1. Click Push.\n2. Wait for completion.",
  "Modified request",
  "Commit pushed to working branch; commit metadata contains app version + timestamp; sync snapshot updates; UI returns to idle.",
  "High")

t(BOTH, "WS", "Push", "Edge Case",
  "Push with no local changes is a no-op",
  "Workspace linked; no edits.",
  "1. Click Push.",
  "—",
  "Push completes silently or shows 'No changes to push'; no new commit is created.",
  "Medium")

t(BOTH, "WS", "Pull", "Functional",
  "Pull updates from remote",
  "Working branch updated remotely.",
  "1. Click Pull.",
  "Remote commit on working branch",
  "Latest changes applied; sync snapshot updates; UI reflects new collections/envs.",
  "High")

t(BOTH, "WS", "Refresh", "Functional",
  "Refresh detects retired branch (PR merged)",
  "Working branch merged & deleted on remote.",
  "1. Click Refresh.",
  "—",
  "App detects retirement; prompts user to create new branch or switch to main; retired branch recorded.",
  "High")

t(BOTH, "WS", "Reset", "Functional",
  "Reset workspace discards local edits",
  "Workspace has uncommitted edits.",
  "1. Workspace settings → Reset to last sync.\n2. Confirm.",
  "—",
  "Local edits discarded; workspace returns to last-synced state; history preserved (local-only).",
  "High")

t(BOTH, "WS", "Offline", "Functional",
  "Create offline workspace has no git affordances",
  "Switcher open.",
  "1. Choose 'Create offline workspace'.\n2. Name 'Local-Only'.",
  "—",
  "Workspace created; Push/Pull buttons hidden/disabled; 'Link to Git' option still available; data persists in IndexedDB only.",
  "Medium")

t(BOTH, "WS", "Hydrate", "Functional",
  "Passphrase prompt for workspace with secrets",
  "Workspace has ≥1 secret variable; new session.",
  "1. Open the workspace.\n2. Enter correct passphrase.",
  "Correct passphrase",
  "Passphrase modal shown; on correct entry, secrets decrypt; UI proceeds.",
  "High")

t(BOTH, "WS", "Hydrate", "Negative",
  "Wrong passphrase keeps secrets locked",
  "Workspace has secrets + passphrase.",
  "1. Enter incorrect passphrase.\n2. Submit.",
  "Wrong passphrase",
  "Error 'Incorrect passphrase' displayed; secrets stay encrypted; user can retry or proceed with secrets unavailable.",
  "High")

t(BOTH, "WS", "Hydrate", "Edge Case",
  "Skip passphrase keeps workspace usable for non-secret data",
  "Workspace has secrets + passphrase.",
  "1. Dismiss passphrase modal.",
  "—",
  "Workspace loads; UI clearly marks secret-dependent rows (Auth/Vault) as locked; non-secret operations continue normally.",
  "Medium")

# Web-specific workspace
t(WEB, "WS", "Multi-Tab", "Edge Case",
  "Two browser tabs open the same workspace",
  "Workspace loaded in Tab A.",
  "1. Open Tab B with same URL.\n2. Edit a request in Tab A.\n3. Refresh Tab B.",
  "Two tabs, one workspace",
  "Tab B reflects Tab A's persisted edits after refresh; no data corruption from IndexedDB races; last-write wins on rapid concurrent edits in same field.",
  "High")

t(WEB, "WS", "Refresh", "Functional",
  "Browser refresh preserves workspace state",
  "Workspace has unpushed local edits.",
  "1. Press F5 (or Ctrl/Cmd+R).",
  "—",
  "Workspace re-hydrates with all local edits intact; active request and tab preserved.",
  "High")

t(WEB, "WS", "Refresh", "Edge Case",
  "Refresh during in-flight request",
  "Send long-running request.",
  "1. While 'Sending…' is shown, press F5.",
  "—",
  "Request is aborted by reload; on hydrate, no half-saved history entry corrupts state; request can be re-sent.",
  "Medium")

t(WEB, "WS", "Quota", "Edge Case",
  "IndexedDB quota near full surfaces warning",
  "Browser storage quota nearly used (use DevTools to simulate).",
  "1. Try to add a large attachment / response.",
  "Quota-limited storage",
  "Friendly error toast 'Storage limit reached'; user is offered guidance (clear history, export, etc.); app does not silently lose data.",
  "Medium")

t(WEB, "WS", "Storage", "Edge Case",
  "Private/incognito session - limited persistence",
  "Open app in incognito window.",
  "1. Create workspace.\n2. Close window.\n3. Re-open in same incognito session.",
  "Incognito mode",
  "Workspace persists for the session; user is warned (or it just works) that data clears with window close; no crash.",
  "Low")

t(WEB, "WS", "Browser Nav", "Edge Case",
  "Browser back button does not navigate away unexpectedly",
  "User on workspace view.",
  "1. Press browser Back.",
  "—",
  "Either an in-app navigation occurs (panel/route history) or the user is prompted before unloading; no silent loss of unsaved edits.",
  "Medium")

# Desktop-specific workspace
t(DESK, "WS", "App Quit", "Functional",
  "App quit with unsaved edits prompts user",
  "Workspace has unpushed local edits.",
  "1. Cmd/Alt+F4 (Quit).",
  "Unpushed edits",
  "Confirmation dialog warns about unsaved local changes; on cancel, app stays open; on quit, edits are persisted to IndexedDB and recoverable on next launch.",
  "High")

t(DESK, "WS", "Crash Recovery", "Functional",
  "Force-quit recovers state on next launch",
  "Workspace has local edits.",
  "1. Force-kill app (Activity Monitor / Task Manager).\n2. Re-launch.",
  "—",
  "Re-launched app restores last workspace + edits from IndexedDB; no corruption; banner may inform of unclean shutdown.",
  "High")

t(DESK, "WS", "MCP Path", "Functional",
  "MCP config path is shown in settings",
  "Desktop app open.",
  "1. Settings → MCP / AI Clients.",
  "—",
  "Config snippet displayed with the OS-conventional path (e.g., ~/Library/Application Support/Claude on macOS); copy-to-clipboard works.",
  "Medium")

# =====================================================================
# COLLECTIONS & REQUESTS (CR)
# =====================================================================
t(BOTH, "CR", "Collection", "Functional",
  "Create collection at root",
  "Workspace open.",
  "1. Editor sidebar → + Add → Collection.\n2. Name 'Smoke Suite'.",
  "—",
  "Collection added at root, selected, empty; rename input auto-focused on initial create.",
  "High")

t(BOTH, "CR", "Collection", "Functional",
  "Rename collection inline",
  "Collection 'Old' exists.",
  "1. Double-click → enter 'New'.\n2. Press Enter.",
  "—",
  "Name updates in tree; open request tabs reflect new collection name in breadcrumbs.",
  "Medium")

t(BOTH, "CR", "Collection", "Edge Case",
  "Duplicate collection name allowed at different levels",
  "Collection 'Users' under root exists.",
  "1. Create another collection named 'Users' under a folder.",
  "—",
  "Both exist independently; tree shows full path on hover or breadcrumbs to disambiguate.",
  "Low")

t(BOTH, "CR", "Collection", "Functional",
  "Delete empty collection",
  "Empty collection 'Trash' exists.",
  "1. Right-click → Delete.\n2. Confirm.",
  "—",
  "Removed from tree; no orphans.",
  "Medium")

t(BOTH, "CR", "Collection", "Functional",
  "Delete collection with children cascades",
  "Collection with 2 folders + 5 requests.",
  "1. Right-click → Delete.\n2. Read warning.\n3. Confirm.",
  "Collection with children",
  "Confirm message mentions child counts; on confirm, all descendants removed; tree updates; history entries pointing to deleted IDs remain readable but unlinked.",
  "High")

t(BOTH, "CR", "Folder", "Functional",
  "Create folder under collection",
  "Collection 'API v1' exists.",
  "1. Right-click → Add folder.\n2. Name 'Users'.",
  "—",
  "Folder added; expand/collapse works.",
  "High")

t(BOTH, "CR", "Folder", "Edge Case",
  "Nested folders to depth 5",
  "Collection exists.",
  "1. Create folders A → B → C → D → E.",
  "5-level nesting",
  "All levels render; indents visually distinct; expand/collapse at each level works.",
  "Low")

t(BOTH, "CR", "Request", "Functional",
  "Create new request via Ctrl+N",
  "Editor panel focused; collection selected.",
  "1. Press Ctrl/Cmd+N.",
  "—",
  "GET 'Untitled Request' added under selection; editor opens with URL bar focused.",
  "High")

t(BOTH, "CR", "Request", "Functional",
  "Duplicate request copies all fields",
  "Request fully configured (body, headers, auth, scripts, tests).",
  "1. Right-click → Duplicate.",
  "—",
  "New '<name> (copy)' created with every field cloned; original unmodified.",
  "Medium")

t(BOTH, "CR", "Request", "Functional",
  "Delete request keeps history readable",
  "Request 'Get User' has prior runs.",
  "1. Delete request → Confirm.",
  "—",
  "Request removed from tree; History panel still shows old runs (URL, method) for audit.",
  "Medium")

t(BOTH, "CR", "Reorder", "Functional",
  "Drag request between folders",
  "Folders A, B; request R in A.",
  "1. Drag R from A → drop on B.",
  "—",
  "R now under B; A no longer holds it; order persists after refresh/push.",
  "Medium")

t(BOTH, "CR", "Reorder", "Functional",
  "Reorder requests within folder",
  "Folder with R1, R2, R3.",
  "1. Drag R3 above R1.",
  "—",
  "Order: R3, R1, R2; persists after push/pull.",
  "Medium")

t(BOTH, "CR", "Search", "Functional",
  "Filter tree by name substring",
  "Many requests in tree.",
  "1. Type 'login' in explorer search.",
  "Filter: login",
  "Only matching folders/requests show; matches highlighted; clearing search restores full tree.",
  "Medium")

t(BOTH, "CR", "Search", "Edge Case",
  "Search is case-insensitive",
  "Request named 'GetUser' exists.",
  "1. Search 'getuser'.",
  "—",
  "Matches found regardless of casing.",
  "Low")

# =====================================================================
# REQUEST EDITOR (RE)
# =====================================================================
t(BOTH, "RE", "URL Bar", "Functional",
  "Send simple GET",
  "Empty request open.",
  "1. Enter https://httpbin.org/get.\n2. Click Send.",
  "URL: https://httpbin.org/get",
  "200 status; response body shows JSON; time/size populated.",
  "High")

t(BOTH, "RE", "URL Bar", "Functional",
  "Variable interpolation in URL",
  "Env: baseUrl=https://httpbin.org",
  "1. URL: '{{baseUrl}}/get'.\n2. Hover variable.\n3. Send.",
  "{{baseUrl}}/get",
  "Hover popover shows resolved value; on Send returns 200.",
  "High")

t(BOTH, "RE", "URL Bar", "Negative",
  "Undefined variable resolves to empty",
  "No env active.",
  "1. URL: 'https://{{missing}}.example.com'.\n2. Send.",
  "—",
  "URL becomes 'https://.example.com'; request fails with clear network error; user is not silently stuck.",
  "Medium")

t(BOTH, "RE", "URL Bar", "Edge Case",
  "Very long URL > 2KB",
  "—",
  "1. Paste a 4KB URL into URL bar.\n2. Send.",
  "4KB URL",
  "Editor handles it without freezing; server may reject — error surfaces in response panel.",
  "Low")

t(BOTH, "RE", "URL Bar", "Edge Case",
  "URL with non-ASCII path",
  "—",
  "1. URL: 'https://httpbin.org/anything/测试'.\n2. Send.",
  "—",
  "Path is percent-encoded automatically on send; response 200.",
  "Medium")

t(BOTH, "RE", "Method", "Functional",
  "Switch method GET → POST",
  "Request is GET.",
  "1. Open method dropdown.\n2. Select POST.",
  "—",
  "Method updates; Body tab becomes prominent; default body type is 'none' if previously unset.",
  "High")

t(BOTH, "RE", "Method", "Functional",
  "All supported methods present",
  "Method dropdown open.",
  "1. Inspect list.",
  "—",
  "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS all available.",
  "Medium")

t(BOTH, "RE", "Params", "Functional",
  "Add query param updates URL bar",
  "URL: https://httpbin.org/get",
  "1. Params tab → add name=alice.\n2. Inspect URL bar.",
  "—",
  "URL shows '?name=alice'; Send echoes the param in response.",
  "High")

t(BOTH, "RE", "Params", "Functional",
  "Toggle-disable a param removes it",
  "Two params: name=alice, age=30 enabled.",
  "1. Uncheck 'age'.",
  "—",
  "Outgoing URL has only 'name=alice'; UI shows greyed-out 'age' row.",
  "Medium")

t(BOTH, "RE", "Params", "Functional",
  "URL paste populates Params tab",
  "Params empty.",
  "1. Paste 'https://api.test/items?status=open&limit=10'.",
  "—",
  "Params tab now has two rows: status=open, limit=10; URL bar shows path only in synced state.",
  "Medium")

t(BOTH, "RE", "Params", "Edge Case",
  "Duplicate param keys preserved",
  "—",
  "1. Add foo=1, foo=2.\n2. Send to httpbin.org/get.",
  "—",
  "Both values transmitted (URL: ?foo=1&foo=2); response echoes both.",
  "Low")

t(BOTH, "RE", "Headers", "Functional",
  "Add custom header",
  "Request open.",
  "1. Headers → add X-Trace-Id=abc123.\n2. Send.",
  "—",
  "Header sent; httpbin response echoes it.",
  "High")

t(BOTH, "RE", "Headers", "Functional",
  "Header autocomplete suggests standard names",
  "Headers row focused.",
  "1. Type 'auth' in key.",
  "—",
  "Dropdown shows Authorization, Authentication-Info, etc.",
  "Low")

t(BOTH, "RE", "Headers", "Edge Case",
  "Header value supports variable interpolation",
  "Env: token=abc",
  "1. Add Authorization: 'Bearer {{token}}'.\n2. Send.",
  "—",
  "Resolved header sent: 'Bearer abc'.",
  "Medium")

t(BOTH, "RE", "Send", "Functional",
  "Send via Ctrl+Enter",
  "Valid URL; cursor anywhere.",
  "1. Press Ctrl/Cmd+Enter.",
  "—",
  "Request sent regardless of focus.",
  "High")

t(BOTH, "RE", "Send", "Functional",
  "Cancel in-flight request",
  "Slow endpoint.",
  "1. Send to a 30s-delay endpoint.\n2. Click Cancel while 'Sending…'.",
  "Slow endpoint",
  "Request aborts; response panel shows 'Cancelled' state; no partial body committed.",
  "Medium")

t(BOTH, "RE", "Tabs", "UX/UI",
  "Editor remembers active sub-tab per request",
  "Request A: Body tab open. Request B exists.",
  "1. Open B (any tab).\n2. Open A again.",
  "—",
  "A re-opens on Body tab (per-request memory) or the globally remembered tab — behavior should be consistent and predictable.",
  "Low")

t(BOTH, "RE", "Path Params", "Functional",
  "URL with :id placeholder offers path params editor",
  "—",
  "1. URL: 'https://api.test/users/:id'.",
  "—",
  "Path Params section appears with row id=''; setting id=42 produces final URL '…/users/42' on send.",
  "Medium")

# Web-specific
t(WEB, "RE", "Browser Zoom", "Compatibility",
  "Browser Ctrl++ zoom does not break layout",
  "App open.",
  "1. Press Ctrl/Cmd++ several times.",
  "—",
  "Layout reflows gracefully; no clipped panels or unreachable buttons; reset via Ctrl/Cmd+0.",
  "Medium")

t(WEB, "RE", "Tab Title", "UX/UI",
  "Browser tab title reflects active workspace",
  "Workspace 'Smoke' active.",
  "1. Switch workspace to 'Production'.",
  "—",
  "Tab title updates to reflect current workspace name (e.g., 'Production · APICircle').",
  "Low")

# Desktop-specific
t(DESK, "RE", "Native Menu", "Functional",
  "Cut/Copy/Paste from native Edit menu work in inputs",
  "Editor focused on a text input.",
  "1. Type text.\n2. Use Edit menu Cut/Copy/Paste.",
  "—",
  "Native Edit menu items operate on the focused input; same as Cmd/Ctrl+X/C/V.",
  "Medium")

t(DESK, "RE", "Window Title", "UX/UI",
  "App window title reflects active workspace",
  "Workspace 'Smoke' active.",
  "1. Switch to 'Production'.",
  "—",
  "Window title updates; on macOS the dock tooltip updates too.",
  "Low")

# =====================================================================
# BODY EDITOR (BE)
# =====================================================================
t(BOTH, "BE", "Type", "Functional",
  "GET default body type is none",
  "New GET request created.",
  "1. Open Body tab.",
  "—",
  "Body picker defaults to 'none'; no editor surface beyond picker.",
  "Medium")

t(BOTH, "BE", "Form Data", "Functional",
  "Submit form-data text field",
  "POST httpbin.org/post; body type form-data.",
  "1. Row username=alice.\n2. Send.",
  "—",
  "Multipart body sent; response.form.username = alice; Content-Type auto-set.",
  "High")

t(BOTH, "BE", "Form Data", "Functional",
  "Upload file in form-data",
  "POST; form-data.",
  "1. Add row of type File.\n2. Pick 1KB text file.\n3. Send.",
  "1KB text file",
  "File uploaded; response.files entry present; attachment persisted in IndexedDB; re-opening request retains the file ref.",
  "High")

t(BOTH, "BE", "Form Data", "Edge Case",
  "Upload large file (50 MB)",
  "—",
  "1. Pick 50 MB file.\n2. Send.",
  "50 MB file",
  "Either uploads successfully or surfaces a clear size-limit error; UI does not freeze.",
  "Medium")

t(BOTH, "BE", "URL-encoded", "Functional",
  "Submit x-www-form-urlencoded",
  "POST; type x-www-form-urlencoded.",
  "1. a=1, b=hello.\n2. Send.",
  "—",
  "Body 'a=1&b=hello' sent; Content-Type: application/x-www-form-urlencoded.",
  "High")

t(BOTH, "BE", "Raw JSON", "Functional",
  "Submit JSON body",
  "POST; raw → JSON.",
  "1. Paste {\"name\":\"alice\"}.\n2. Send.",
  "—",
  "application/json sent; httpbin parses the object; editor pretty-prints.",
  "High")

t(BOTH, "BE", "Raw JSON", "Negative",
  "Invalid JSON shows inline error",
  "Body raw JSON.",
  "1. Type '{\"a\": }'.",
  "—",
  "Monaco shows syntax-error squiggle; Send still works (server response visible).",
  "Medium")

t(BOTH, "BE", "Raw JSON", "Edge Case",
  "JSON Schema validation highlights errors",
  "Body has bodySchemaId set; body must conform.",
  "1. Type a JSON that violates the schema.",
  "—",
  "Editor marks the violating field with a description; user is not blocked from sending.",
  "Low")

t(BOTH, "BE", "Raw XML", "Functional",
  "Submit XML body",
  "POST; raw → XML.",
  "1. <root><x>1</x></root>.\n2. Send.",
  "—",
  "Content-Type application/xml; body sent verbatim.",
  "Medium")

t(BOTH, "BE", "Raw HTML", "Functional",
  "Submit HTML body",
  "POST; raw → HTML.",
  "1. <p>hello</p>.\n2. Send.",
  "—",
  "Content-Type text/html; body sent verbatim.",
  "Low")

t(BOTH, "BE", "Raw Text", "Functional",
  "Submit plain text",
  "POST; raw → text.",
  "1. 'hello world'.\n2. Send.",
  "—",
  "Content-Type text/plain; body sent.",
  "Low")

t(BOTH, "BE", "Binary", "Functional",
  "Upload binary file",
  "POST; binary.",
  "1. Pick 10KB PNG.\n2. Send.",
  "10KB PNG",
  "Body sent with bytes; Content-Type from extension; server response confirms.",
  "Medium")

t(BOTH, "BE", "GraphQL", "Functional",
  "Send simple GraphQL query",
  "POST to GraphQL endpoint; type GraphQL.",
  "1. Query: { user(id:1){ name } }.\n2. Send.",
  "—",
  "Body wraps as {\"query\":\"…\"}; Content-Type application/json; response returned.",
  "High")

t(BOTH, "BE", "GraphQL", "Functional",
  "Variables panel sent alongside query",
  "Query uses $id.",
  "1. Variables: {\"id\":\"1\"}.\n2. Send.",
  "—",
  "Body has both query and variables; response includes data for id=1.",
  "Medium")

t(BOTH, "BE", "Type Switch", "Edge Case",
  "Switching body type clears incompatible content",
  "Raw JSON has content.",
  "1. Switch to none.\n2. Switch back to raw JSON.",
  "—",
  "Switching away clears content (or stashes per design); switching back yields an empty editor.",
  "Low")

# Web-specific
t(WEB, "BE", "File Upload", "Compatibility",
  "Browser file picker only (no drag-drop from OS guaranteed)",
  "Body form-data file row.",
  "1. Click Choose File.",
  "—",
  "Browser-native file picker opens; selected file is stored as attachment.",
  "Medium")

t(WEB, "BE", "File Upload", "Edge Case",
  "Drag-drop file from OS onto file input",
  "Body form-data file row.",
  "1. Drag a file from Desktop onto the row's file area.",
  "—",
  "File is captured via standard browser drop event; equivalent to picker.",
  "Medium")

# Desktop-specific
t(DESK, "BE", "File Upload", "Functional",
  "Native open dialog for file selection",
  "Body form-data file row.",
  "1. Click Choose File.",
  "—",
  "OS-native open dialog appears; default folder remembered between sessions.",
  "Medium")

t(DESK, "BE", "Drag-Drop", "Functional",
  "Drag file from Finder/Explorer attaches",
  "Body form-data row.",
  "1. Drag a file from OS onto the row.",
  "—",
  "File is attached; works identically to picker.",
  "Medium")

# =====================================================================
# AUTH (AU)
# =====================================================================
t(BOTH, "AU", "Picker", "Functional",
  "All supported auth types listed",
  "Auth tab open.",
  "1. Open type dropdown.",
  "—",
  "None, Inherit, Basic, Bearer, API Key, OAuth1, OAuth2 grants, Digest, NTLM, Hawk, AWS SigV4, JWT Bearer, ASAP, EdgeGrid (Akamai) visible.",
  "Medium")

t(BOTH, "AU", "Bearer", "Functional",
  "Bearer token in Authorization header",
  "GET httpbin.org/bearer; Bearer auth.",
  "1. Token 'abc.def.ghi'.\n2. Send.",
  "—",
  "Authorization: Bearer abc.def.ghi sent; httpbin response shows authenticated=true.",
  "High")

t(BOTH, "AU", "Bearer", "Security",
  "Bearer token masked in UI",
  "Auth tab.",
  "1. Enter long token.\n2. Switch tabs and return.",
  "—",
  "Token field is masked by default; reveal toggle available; never shown in plaintext in tooltips.",
  "Medium")

t(BOTH, "AU", "Basic", "Functional",
  "Basic auth base64-encodes credentials",
  "httpbin.org/basic-auth/user/pass.",
  "1. user=user, password=pass.\n2. Send.",
  "—",
  "Authorization: Basic dXNlcjpwYXNz; 200 response.",
  "High")

t(BOTH, "AU", "API Key", "Functional",
  "API Key in header",
  "Auth API Key; placement header.",
  "1. X-Api-Key=secret-123.\n2. Send to httpbin.org/headers.",
  "—",
  "Header X-Api-Key:secret-123 included; response echoes it.",
  "High")

t(BOTH, "AU", "API Key", "Functional",
  "API Key in query string",
  "Placement: query.",
  "1. api_key=abc.\n2. Send.",
  "—",
  "URL has '?api_key=abc'; Params tab does not show this row (auth-managed).",
  "Medium")

t(BOTH, "AU", "Digest", "Functional",
  "Digest completes challenge-response",
  "Endpoint requires Digest.",
  "1. Set user/pass.\n2. Send.",
  "Valid digest creds",
  "First 401 triggers nonce-based retry; final 200 displayed; user does not see the first 401.",
  "High")

t(BOTH, "AU", "Digest", "Edge Case",
  "Digest stale=true rotates nonce",
  "Server returns 401 stale=true.",
  "1. Trigger nonce rotation.",
  "—",
  "Client retries with new nonce; succeeds.",
  "Low")

t(BOTH, "AU", "NTLM", "Functional",
  "NTLM 3-way handshake",
  "NTLM endpoint; user/pass/domain.",
  "1. Send.",
  "—",
  "Negotiate → Challenge → Authenticate handshake completes; MIC computed; final 200.",
  "High")

t(BOTH, "AU", "Hawk", "Functional",
  "Hawk MAC accepted",
  "Hawk-protected endpoint.",
  "1. Set hawkId/hawkKey.\n2. Send.",
  "—",
  "Authorization: Hawk … header sent; server verifies; 200.",
  "Medium")

t(BOTH, "AU", "AWS SigV4", "Functional",
  "Sign GET",
  "AWS-signed endpoint.",
  "1. Set creds + region + service.\n2. Send.",
  "AWS creds",
  "Authorization 'AWS4-HMAC-SHA256 Credential=…'; x-amz-date present; signing canonicalizes correctly.",
  "High")

t(BOTH, "AU", "AWS SigV4", "Functional",
  "Sign POST with body",
  "POST with JSON body.",
  "1. Send.",
  "—",
  "x-amz-content-sha256 reflects SHA256(body); verifies server-side.",
  "Medium")

t(BOTH, "AU", "JWT", "Functional",
  "JWT signed with HS256",
  "Auth JWT, alg HS256, secret set.",
  "1. Configure claims iss/sub/exp.\n2. Send.",
  "—",
  "Authorization: Bearer <jwt>; signature verifies with same secret; payload matches.",
  "Medium")

t(BOTH, "AU", "JWT", "Functional",
  "JWT signed with RS256",
  "Alg RS256; PEM private key.",
  "1. Configure claims.\n2. Send.",
  "RS256 PEM key",
  "JWT verifies with matching public key.",
  "Medium")

t(BOTH, "AU", "JWT", "Negative",
  "Expired JWT exp claim still sent (user decides)",
  "exp in the past.",
  "1. Send.",
  "—",
  "Token sent unchanged; server returns 401; client does not silently 'fix' the JWT.",
  "Low")

t(BOTH, "AU", "Inherit", "Functional",
  "Folder Bearer inherited by request",
  "Folder Bearer; child Inherit.",
  "1. Send child.",
  "—",
  "Folder's Bearer applied; Authorization present.",
  "High")

t(BOTH, "AU", "Inherit", "Functional",
  "Request override beats folder",
  "Folder Bearer; child Basic.",
  "1. Send child.",
  "—",
  "Basic auth used; folder Bearer ignored.",
  "High")

t(BOTH, "AU", "ASAP", "Functional",
  "ASAP token attached to request",
  "ASAP issuer/audience/key configured.",
  "1. Send.",
  "—",
  "Authorization: Bearer <asap-jwt> sent; verifies against public key.",
  "Low")

t(BOTH, "AU", "EdgeGrid", "Functional",
  "Akamai EdgeGrid signing",
  "Client token/secret/access token set.",
  "1. Send.",
  "—",
  "Authorization header with signed nonce-based scheme; server accepts.",
  "Low")

# =====================================================================
# OAUTH2 (O2)
# =====================================================================
t(BOTH, "O2", "Client Credentials", "Functional",
  "Acquire token via client_credentials",
  "Mock IdP available; clientId/secret set.",
  "1. Click 'Get token'.",
  "Valid creds",
  "POST /token returns access_token; stored with expiresAt/obtainedScope; UI 'Token acquired'.",
  "High")

t(BOTH, "O2", "Password", "Functional",
  "Resource Owner Password grant",
  "Grant=password; user/pass.",
  "1. Get token.",
  "—",
  "POST /token grant_type=password; access_token returned.",
  "Medium")

t(BOTH, "O2", "Device Code", "Functional",
  "Device flow polls token endpoint",
  "Grant=device_code; authorize in second tab.",
  "1. Get token.\n2. Approve.",
  "—",
  "user_code shown; polling interval respected; access_token stored on approval.",
  "Medium")

t(BOTH, "O2", "PKCE", "Functional",
  "Auth code + PKCE for public client",
  "No client secret; PKCE enabled.",
  "1. Get token.",
  "—",
  "code_verifier 43–128 chars; code_challenge S256; token exchange includes verifier; succeeds.",
  "High")

t(BOTH, "O2", "Refresh", "Functional",
  "Manual token refresh",
  "Token with refresh_token present.",
  "1. Click 'Refresh token'.",
  "—",
  "POST /token grant_type=refresh_token; new access_token; expiresAt updated.",
  "High")

t(BOTH, "O2", "Auto-Refresh", "Functional",
  "Send auto-refreshes expired token",
  "Token expired; refresh_token present.",
  "1. Send a request using this auth.",
  "—",
  "Token refreshed transparently; outgoing request uses fresh token.",
  "High")

t(BOTH, "O2", "Clear", "Functional",
  "Clear token forces re-auth",
  "Token present.",
  "1. Clear token.\n2. Send.",
  "—",
  "Token removed; send prompts re-auth or fails with auth error.",
  "Medium")

t(BOTH, "O2", "State", "Security",
  "State mismatch rejected",
  "Auth code in progress.",
  "1. Replace state with garbage.",
  "—",
  "Callback rejected; toast 'State mismatch'; no token stored.",
  "High")

t(BOTH, "O2", "Redirect URI", "Negative",
  "Redirect URI mismatch surfaces error",
  "Misconfigured URI in IdP.",
  "1. Get token.",
  "—",
  "IdP error displayed clearly; no token stored.",
  "Medium")

t(BOTH, "O2", "Private Key JWT", "Functional",
  "client_assertion JWT auth",
  "client_credentials; private key set.",
  "1. Get token.",
  "—",
  "Token request includes client_assertion; succeeds.",
  "Low")

t(BOTH, "O2", "Scope", "Edge Case",
  "obtainedScope differs from requested",
  "Request 'read write'; IdP grants only 'read'.",
  "1. Get token.",
  "—",
  "Stored obtainedScope is 'read'; UI exposes the granted scope (warning if narrower than requested).",
  "Low")

# Web-specific OAuth2
t(WEB, "O2", "Popup", "Functional",
  "Auth code flow via popup window",
  "Web build; auth_code grant.",
  "1. Click Get token.\n2. Approve in popup.",
  "—",
  "Popup loads authorize URL; on redirect to oauth-callback.html, BroadcastChannel relays code to main tab; access_token stored; popup auto-closes.",
  "High")

t(WEB, "O2", "Popup", "Negative",
  "Popup blocked → user is informed",
  "Browser popup blocker active.",
  "1. Click Get token.",
  "—",
  "Error: 'Popup blocked. Allow popups for this site and try again.'; flow does not silently fail.",
  "High")

t(WEB, "O2", "BroadcastChannel", "Functional",
  "BroadcastChannel relay delivers code",
  "Auth code flow.",
  "1. Approve in popup.\n2. Observe main tab.",
  "—",
  "Main tab receives 'oauth-callback' message keyed by state; popup closes itself; no localStorage write (prevents leaking to other tabs).",
  "High")

t(WEB, "O2", "postMessage Fallback", "Functional",
  "postMessage fallback when BroadcastChannel unavailable",
  "Browser without BroadcastChannel (legacy).",
  "1. Approve in popup.",
  "—",
  "Popup falls back to window.opener.postMessage with targetOrigin = location.origin; main tab still receives code.",
  "Medium")

t(WEB, "O2", "Cross-Origin", "Security",
  "Popup with wrong opener origin is rejected",
  "Malicious site frames the popup.",
  "1. Simulate cross-origin opener.",
  "—",
  "Main tab listener verifies origin = location.origin and ignores foreign messages; no token stored.",
  "High")

t(WEB, "O2", "Auth Code", "Functional",
  "Authorization code grant end-to-end (web)",
  "Mock IdP reachable.",
  "1. Get token via popup.\n2. Approve.",
  "—",
  "access_token + refresh_token (if any) stored; UI updates immediately after popup closes.",
  "High")

t(WEB, "O2", "Implicit", "Functional",
  "Implicit grant returns token in fragment",
  "Grant=implicit.",
  "1. Get token in popup.",
  "—",
  "Token extracted from URL fragment by oauth-callback.html; relayed; no refresh_token; stored.",
  "Medium")

t(WEB, "O2", "Multiple", "Edge Case",
  "Two OAuth flows simultaneously (different requests)",
  "Two requests with different OAuth configs.",
  "1. Start flow A.\n2. Before A completes, start flow B.",
  "—",
  "Each callback routed to its originating request via state key; tokens stored on correct requests; no cross-talk.",
  "Medium")

t(WEB, "O2", "Callback Page", "Security",
  "oauth-callback.html does not log token in DOM",
  "—",
  "1. Approve in popup.\n2. Inspect oauth-callback.html DOM.",
  "—",
  "Page does not write access_token to DOM that could be screen-scraped; shows generic success and self-closes quickly.",
  "Medium")

# Desktop-specific OAuth2
t(DESK, "O2", "Callback Server", "Functional",
  "Auth code flow via localhost callback server",
  "Desktop build; auth code grant.",
  "1. Click Get token.\n2. Approve in OS default browser.",
  "—",
  "Local HTTP server starts on free port; browser redirects there; code captured; access_token stored; server stops.",
  "High")

t(DESK, "O2", "Port", "Edge Case",
  "Port conflict cycles to next free port",
  "Another process occupies typical port.",
  "1. Get token.",
  "—",
  "App detects conflict, picks next free port; redirect URI rebuilt accordingly; flow succeeds.",
  "High")

t(DESK, "O2", "Browser Launch", "Functional",
  "OS default browser opens authorize URL",
  "—",
  "1. Get token.",
  "—",
  "shell.openExternal opens default browser; no in-app webview; URL displays IdP authorize page.",
  "High")

t(DESK, "O2", "Server Lifecycle", "Functional",
  "Callback server stops after one capture",
  "Token acquired.",
  "1. Get token successfully.\n2. Check localhost:<port>.",
  "—",
  "Server closed after callback; port freed; next flow starts a fresh server.",
  "Medium")

t(DESK, "O2", "Server Lifecycle", "Negative",
  "Cancelled flow shuts down server",
  "Flow started but not approved.",
  "1. Get token.\n2. Click Cancel in app (or close browser tab).",
  "—",
  "App tears down the server within ~5–10s of cancel; port freed; no orphan listener.",
  "Medium")

t(DESK, "O2", "Bind", "Security",
  "Callback server binds only to 127.0.0.1",
  "—",
  "1. Inspect listening sockets via OS tools.",
  "—",
  "Server bound to 127.0.0.1 (not 0.0.0.0); not reachable from LAN.",
  "High")

t(DESK, "O2", "Multiple", "Edge Case",
  "Concurrent OAuth flows on different requests",
  "Two requests starting OAuth in quick succession.",
  "1. Start A.\n2. Start B before A completes.",
  "—",
  "Each gets its own port; callbacks routed to correct request via state; no port collision.",
  "Medium")

t(DESK, "O2", "Fragment Relay", "Functional",
  "Implicit grant fragment is relayed via callback server",
  "Implicit grant.",
  "1. Get token.\n2. Approve.",
  "—",
  "Browser redirects with token in fragment; callback page reads fragment via JS and POSTs to server; token captured.",
  "Medium")

# =====================================================================
# VARIABLES & ENVIRONMENTS (VR)
# =====================================================================
t(BOTH, "VR", "Env", "Functional",
  "Create new environment",
  "Workspace open.",
  "1. Environments → + new → 'Dev'.",
  "—",
  "Env created; empty vars; selectable from picker.",
  "High")

t(BOTH, "VR", "Env", "Functional",
  "Activate env from dropdown",
  "Envs 'Dev', 'Prod' exist.",
  "1. Pick 'Prod' in env picker.",
  "—",
  "Active env switches to Prod; {{vars}} now resolve to Prod values.",
  "High")

t(BOTH, "VR", "Env", "Functional",
  "Duplicate env clones all vars",
  "Env 'Dev' has 5 vars.",
  "1. Duplicate Dev.",
  "—",
  "'Dev (copy)' has identical 5 vars; original unchanged.",
  "Medium")

t(BOTH, "VR", "Env", "Functional",
  "Delete env with confirm",
  "Env 'Old' exists.",
  "1. Delete Old → Confirm.",
  "—",
  "Env removed; if active, falls back to no env or next priority.",
  "Medium")

t(BOTH, "VR", "Var", "Functional",
  "Add plaintext variable",
  "Env active.",
  "1. Add baseUrl=https://dev.api.test.",
  "—",
  "Variable saves; {{baseUrl}} resolves correctly in URL/body/headers.",
  "High")

t(BOTH, "VR", "Var", "Functional",
  "Add secret variable masks input",
  "Env open.",
  "1. Add row, type=secret, value=topsecret.",
  "—",
  "Field masked; on focus shows actual value; persisted encrypted; never pushed to git.",
  "High")

t(BOTH, "VR", "Var", "Functional",
  "Variable autocomplete in URL",
  "Env baseUrl set.",
  "1. URL bar: type '{{ba'.",
  "—",
  "Popup shows 'baseUrl'; selection completes the token.",
  "Medium")

t(BOTH, "VR", "Var", "Edge Case",
  "Variable name with special chars rejected/escaped",
  "—",
  "1. Try to add var named '{{evil}}'.",
  "—",
  "Either name is rejected with clear message, or stored as literal; never causes runaway resolution.",
  "Low")

t(BOTH, "VR", "Scope", "Functional",
  "Request-context var overrides env",
  "Env x=env; pre-request: pm.variables.set('x','req').",
  "1. Body uses {{x}}; Send.",
  "—",
  "Body resolves to 'req'.",
  "Medium")

t(BOTH, "VR", "Scope", "Functional",
  "Workspace var fallback",
  "Workspace var 'app'='studio'; no env var.",
  "1. Reference {{app}} in header.",
  "—",
  "Resolves to 'studio'.",
  "Medium")

t(BOTH, "VR", "Linked Env", "UX/UI",
  "Drag-reorder linked env priority",
  "1 local + 2 linked envs.",
  "1. Drag link #2 above #1.",
  "—",
  "Order persists; resolution follows new order.",
  "Low")

t(BOTH, "VR", "Resolution", "Edge Case",
  "Circular reference does not infinite-loop",
  "Var a='{{b}}'; b='{{a}}'.",
  "1. Reference {{a}} in URL.\n2. Send.",
  "—",
  "Resolution terminates after a safe depth limit; result is left as a literal or empty string; no app freeze.",
  "Medium")

# Web-specific
t(WEB, "VR", "Encryption", "Security",
  "Secrets encrypted with passphrase-derived AES-GCM",
  "Workspace has secrets + passphrase.",
  "1. Inspect IndexedDB.",
  "—",
  "Secret values stored as 'enc:v1:<iv>:<ciphertext>'; no plaintext secret bytes; master key stored as JWK.",
  "High")

t(WEB, "VR", "Encryption", "Negative",
  "Master JWK present in IndexedDB (web limitation)",
  "Web build with passphrase set.",
  "1. Inspect IndexedDB master key entry.",
  "—",
  "JWK is present in plaintext (a known web-app limitation since no OS keystore); secrets remain encrypted at rest via the wrapped key — this risk should be disclosed in docs/UI.",
  "Medium")

t(WEB, "VR", "Passphrase", "Functional",
  "Change passphrase re-wraps all secrets",
  "Workspace with secrets + passphrase.",
  "1. Settings → change passphrase (old + new).",
  "—",
  "Secrets re-encrypted under new key; old passphrase no longer decrypts.",
  "High")

# Desktop-specific
t(DESK, "VR", "Encryption", "Security",
  "Master JWK wrapped via OS keychain (safeStorage)",
  "Desktop build.",
  "1. Read master JWK entry from IndexedDB.",
  "—",
  "Entry is a ciphertext blob wrapped by Electron safeStorage; cannot be decrypted off-machine.",
  "High")

t(DESK, "VR", "Portability", "Edge Case",
  "Copying IndexedDB to another machine fails to decrypt",
  "Two machines.",
  "1. Copy workspace store from machine A to machine B.\n2. Open on B.",
  "—",
  "Secrets cannot be decrypted on B (wrapping key bound to A's OS user); plaintext vars still readable.",
  "High")

t(DESK, "VR", "Keychain", "Functional",
  "First write prompts OS keychain access (macOS)",
  "macOS desktop.",
  "1. Save first secret.",
  "—",
  "macOS prompts for keychain access (if not previously granted); subsequent writes silent.",
  "Medium")

# =====================================================================
# RESPONSE PANEL (RP)
# =====================================================================
t(BOTH, "RP", "Status", "Functional",
  "200 OK badge",
  "GET 200 success.",
  "1. Send.",
  "—",
  "Status 200 with positive badge; time in ms; size in KB/MB.",
  "High")

t(BOTH, "RP", "Status", "Functional",
  "Non-2xx red badge",
  "404 endpoint.",
  "1. Send.",
  "—",
  "404 with red badge; body still rendered.",
  "Medium")

t(BOTH, "RP", "Body Viewer", "Functional",
  "Pretty/Raw/Preview toggle",
  "JSON response present.",
  "1. Toggle Pretty/Raw/Preview.",
  "—",
  "Pretty pretty-prints; Raw shows minified; Preview applies syntax highlighting.",
  "High")

t(BOTH, "RP", "Body Viewer", "Edge Case",
  "Very large response shows preview cap notice",
  "Response > 1 MB.",
  "1. Send to large endpoint.",
  "—",
  "Preview capped; banner offers Download; viewer remains responsive.",
  "Medium")

t(BOTH, "RP", "Headers", "Functional",
  "Response headers tab",
  "Response with multiple headers.",
  "1. Open Headers tab.",
  "—",
  "Key-value table; copy-to-clipboard works; case preserved.",
  "Medium")

t(BOTH, "RP", "Cookies", "Functional",
  "Set-Cookie populates jar",
  "Endpoint returns Set-Cookie.",
  "1. Send.\n2. Cookies tab.",
  "—",
  "New cookie listed with domain/path/expiry.",
  "High")

t(BOTH, "RP", "Transformations", "Functional",
  "TOON/YAML/CSV savings badges for JSON",
  "JSON response.",
  "1. View size hints area.",
  "—",
  "Badges show percent reduction vs minified JSON for each format.",
  "Medium")

t(BOTH, "RP", "Transformations", "Functional",
  "Switch to YAML preview",
  "JSON response.",
  "1. Click 'as YAML'.",
  "—",
  "Body shows YAML; switch back to JSON works.",
  "Low")

t(BOTH, "RP", "Transformations", "Edge Case",
  "Savings computed vs minified JSON (not pretty)",
  "Response with pretty-printed JSON.",
  "1. View badges.",
  "—",
  "Savings computed against minifiedBytes (NOT pretty-printed); banner does not inflate savings.",
  "Medium")

t(BOTH, "RP", "Download", "Functional",
  "Download response body",
  "Any response.",
  "1. Click Download.",
  "—",
  "File save flow opens (browser download in web / native dialog in desktop); bytes match.",
  "Medium")

t(BOTH, "RP", "Snapshots", "Functional",
  "Timeline picker for prior responses",
  "Multiple runs of same request.",
  "1. Click timeline → pick older run.",
  "—",
  "Body viewer swaps to that run; status/time/size update; toggle between snapshots is smooth.",
  "Medium")

t(BOTH, "RP", "Error", "Negative",
  "Network error renders error state",
  "Endpoint unreachable.",
  "1. Send to non-routable host.",
  "—",
  "Response panel shows error message (not blank); guidance offered (check URL/network).",
  "High")

t(BOTH, "RP", "Render", "Security",
  "HTML response rendered safely",
  "Response Content-Type: text/html with <script>alert(1)</script>.",
  "1. Send.\n2. Switch to Preview.",
  "—",
  "Script does NOT execute; preview renders in sandboxed iframe or escaped text; no XSS in our app.",
  "High")

# Web-specific
t(WEB, "RP", "CORS", "Negative",
  "Cross-origin request without CORS surfaces error",
  "Endpoint without CORS headers.",
  "1. Send to cross-origin endpoint.",
  "—",
  "Browser blocks; clear error 'CORS or network failure' shown in response panel with actionable guidance (use desktop, set CORS, or use proxy).",
  "High")

t(WEB, "RP", "Mixed Content", "Negative",
  "HTTP request from HTTPS app warns",
  "App on https origin; send to http://endpoint.",
  "1. Send.",
  "—",
  "Browser blocks or warns; app surfaces a clear message; user can retry on https.",
  "High")

# Desktop-specific
t(DESK, "RP", "CORS Bypass", "Functional",
  "Cross-origin endpoint without CORS works in desktop",
  "Same endpoint that fails in web.",
  "1. Send from desktop.",
  "—",
  "Request succeeds (no browser CORS enforcement); response rendered.",
  "Medium")

# =====================================================================
# SCRIPTS & TESTS (SC)
# =====================================================================
t(BOTH, "SC", "Pre-request", "Functional",
  "pm.variables.set persists across send",
  "Script: pm.variables.set('token','xyz')",
  "1. Body uses {{token}}.\n2. Send.",
  "—",
  "Body contains 'xyz'.",
  "High")

t(BOTH, "SC", "Pre-request", "Negative",
  "Runtime error aborts send",
  "Script: throw new Error('boom')",
  "1. Send.",
  "—",
  "Error toast/panel surfaces; HTTP request NOT sent.",
  "High")

t(BOTH, "SC", "Console", "Functional",
  "console.log appears in script console",
  "Script: console.log('hello')",
  "1. Send.\n2. Open script console.",
  "—",
  "'hello' line appears with timestamp.",
  "Medium")

t(BOTH, "SC", "Sandbox", "Security",
  "Pre-request script cannot access window globals",
  "Script: window.foo = 1",
  "1. Send.",
  "—",
  "Script runs in isolated sandbox; cannot leak to host window; no global namespace pollution.",
  "High")

t(BOTH, "SC", "Tests", "Functional",
  "Add status==200 assertion",
  "Tests tab.",
  "1. Add status==200.\n2. Send to 200 endpoint.",
  "—",
  "Assertion passes; green row; 1/1 passed.",
  "High")

t(BOTH, "SC", "Tests", "Functional",
  "Add JSON path assertion",
  "Response {\"id\":42}.",
  "1. Add body.id == 42.\n2. Send.",
  "—",
  "Passes; actual=42, expected=42.",
  "High")

t(BOTH, "SC", "Tests", "Negative",
  "Failing assertion shows red",
  "Response 404.",
  "1. Add status==200.\n2. Send.",
  "—",
  "Assertion fails; red row; 0/1.",
  "Medium")

t(BOTH, "SC", "Tests", "Functional",
  "Regex 'matches' operator",
  "Response body.email = 'a@b.com'.",
  "1. Assertion body.email matches '^[^@]+@[^@]+$'.\n2. Send.",
  "—",
  "Passes.",
  "Medium")

t(BOTH, "SC", "Tests", "Edge Case",
  "Assertion on missing JSON path",
  "Response: {\"a\":1}; assertion body.b == 2.",
  "1. Send.",
  "—",
  "Assertion fails gracefully; no runtime exception; actual is reported as undefined/null.",
  "Medium")

t(BOTH, "SC", "Tests", "Edge Case",
  "Duration assertion",
  "responseTime lt 1000",
  "1. Send to typical endpoint.",
  "—",
  "Assertion passes if response within 1s; reports actual ms.",
  "Low")

# =====================================================================
# HISTORY (HS)
# =====================================================================
t(BOTH, "HS", "Log", "Functional",
  "Each send creates a history entry",
  "History panel open.",
  "1. Send 3 requests.",
  "—",
  "3 entries; newest first; method/URL/status/time visible.",
  "High")

t(BOTH, "HS", "Buckets", "UX/UI",
  "Date buckets",
  "Runs across multiple days.",
  "1. Open history.",
  "—",
  "Today, Yesterday, Last 7 days, etc. groupings.",
  "Medium")

t(BOTH, "HS", "Filter", "Functional",
  "Filter by status range",
  "Mixed 2xx/4xx/5xx.",
  "1. Apply 4xx filter.",
  "—",
  "Only 4xx entries; counts update.",
  "Medium")

t(BOTH, "HS", "Filter", "Functional",
  "Filter by method",
  "Mixed methods.",
  "1. Filter POST.",
  "—",
  "Only POST entries.",
  "Low")

t(BOTH, "HS", "Filter", "Functional",
  "Filter by URL substring",
  "—",
  "1. Search 'users' in history.",
  "—",
  "Only entries with 'users' in URL.",
  "Low")

t(BOTH, "HS", "Replay", "Functional",
  "Replay restores request state",
  "A run with body/headers.",
  "1. Click Replay.",
  "—",
  "Editor opens with that state; user can edit and re-send.",
  "Medium")

t(BOTH, "HS", "Delete", "Functional",
  "Delete single run",
  "Run exists.",
  "1. Delete → Confirm.",
  "—",
  "Removed; storage freed.",
  "Low")

t(BOTH, "HS", "Clear", "Functional",
  "Clear all history",
  "Many runs.",
  "1. Clear history → Confirm.",
  "—",
  "All entries removed; empty state shown.",
  "Medium")

t(BOTH, "HS", "Persistence", "Functional",
  "History survives app/page reload",
  "5 runs in session.",
  "1. Reload (page/app).",
  "—",
  "All 5 visible; metadata intact.",
  "Medium")

t(BOTH, "HS", "Performance", "Performance",
  "Many history entries (1000) remain navigable",
  "Inject 1000 runs.",
  "1. Open history.\n2. Scroll/filter.",
  "—",
  "List renders without freezing (virtualization or pagination); scrolling stays smooth.",
  "Medium")

# =====================================================================
# COOKIES (CO)
# =====================================================================
t(BOTH, "CO", "Auto-populate", "Functional",
  "Set-Cookie stored in jar",
  "Response with Set-Cookie: a=1.",
  "1. Send.\n2. Cookie manager.",
  "—",
  "Cookie a=1 listed under domain.",
  "High")

t(BOTH, "CO", "Auto-send", "Functional",
  "Stored cookies sent on next matching request",
  "Cookie a=1 for example.com.",
  "1. Send another request to example.com.",
  "—",
  "Outgoing request includes 'Cookie: a=1'.",
  "High")

t(BOTH, "CO", "Expiry", "Edge Case",
  "Expired cookies not sent",
  "Cookie with Expires=past.",
  "1. Send.",
  "—",
  "Not included; UI may show as expired.",
  "Medium")

t(BOTH, "CO", "Manual", "Functional",
  "User adds cookie manually",
  "Cookie manager open.",
  "1. Add example.com tk=abc.",
  "—",
  "Persisted; sent on next example.com request.",
  "Medium")

t(BOTH, "CO", "Manual", "Functional",
  "Edit cookie value",
  "Cookie tk=abc.",
  "1. Edit value → 'xyz'.",
  "—",
  "Updated; next send uses new value.",
  "Low")

t(BOTH, "CO", "Clear", "Functional",
  "Clear domain cookies",
  "Multiple cookies for example.com.",
  "1. Clear all for example.com.",
  "—",
  "All removed; other domains unaffected.",
  "Medium")

t(BOTH, "CO", "Path", "Edge Case",
  "Path matching: subpaths get parent cookies",
  "Cookie path=/api.",
  "1. Send to /api/v1.",
  "—",
  "Cookie included.",
  "Low")

# Web-specific
t(WEB, "CO", "Third-Party", "Compatibility",
  "Browser blocks third-party cookies",
  "Cross-origin request setting cookies.",
  "1. Send.",
  "—",
  "Depending on browser settings, cookie may not be stored; app does not assume success; user can switch to desktop where browser cookie isolation does not apply.",
  "Medium")

# =====================================================================
# MOCK SERVERS (MK)
# =====================================================================
t(BOTH, "MK", "Definition", "Functional",
  "Create mock server",
  "Mocks panel open.",
  "1. Create mock → name 'Users API'.",
  "—",
  "Entry in list; edit page opens.",
  "High")

t(BOTH, "MK", "Endpoint", "Functional",
  "Add GET /users/:id endpoint",
  "Mock open.",
  "1. Add endpoint; 200 JSON {\"id\":1,\"name\":\"alice\"}.",
  "—",
  "Saved; visible in endpoint list.",
  "High")

t(BOTH, "MK", "Endpoint", "Edge Case",
  "Path with :param and {param} both supported",
  "—",
  "1. Add /users/:id and /items/{id}.",
  "—",
  "Both syntaxes accepted; runtime matches correctly (desktop).",
  "Low")

t(BOTH, "MK", "Response", "Functional",
  "Multiple responses with selector",
  "Endpoint has 2 responses with matching rules.",
  "1. Add 200 for header X=A; 400 for header X=B.",
  "—",
  "Both responses saved; runtime picks based on request match (desktop).",
  "Medium")

t(BOTH, "MK", "Spec Import", "Functional",
  "Import OpenAPI generates endpoints",
  "OpenAPI YAML available.",
  "1. Import spec.",
  "—",
  "Endpoints + stub responses generated; user can refine.",
  "Medium")

t(BOTH, "MK", "Delete", "Functional",
  "Delete mock server",
  "Mock exists.",
  "1. Delete → Confirm.",
  "—",
  "Removed.",
  "Medium")

t(BOTH, "MK", "Duplicate", "Functional",
  "Duplicate mock",
  "Mock with 3 endpoints.",
  "1. Duplicate.",
  "—",
  "Copy with same endpoints; runtime independent.",
  "Low")

# Web-specific
t(WEB, "MK", "Runtime", "Negative",
  "Start button disabled on web",
  "Web build; mock defined.",
  "1. Mocks panel → inspect Start button.",
  "—",
  "Start/Stop buttons disabled with tooltip 'Available in desktop app'; definitions still editable.",
  "High")

t(WEB, "MK", "Runtime", "Edge Case",
  "Web users can export CLI command to run mock externally",
  "Mock defined.",
  "1. Mock menu → 'Copy CLI command'.",
  "—",
  "Clipboard has command like 'apicircle mock <workspace>'; documentation link present.",
  "Low")

# Desktop-specific
t(DESK, "MK", "Runtime", "Functional",
  "Start mock server",
  "Mock with 1 endpoint.",
  "1. Click Start.",
  "—",
  "Server starts on free port; status 'Running' with port; logs panel opens.",
  "High")

t(DESK, "MK", "Runtime", "Functional",
  "GET /users/:id returns defined response",
  "Mock running on port X.",
  "1. GET http://localhost:X/users/1.",
  "—",
  "200 with defined body; logs show received request.",
  "High")

t(DESK, "MK", "Runtime", "Functional",
  "Stop mock server",
  "Mock running.",
  "1. Click Stop.",
  "—",
  "Server stops; port freed; status 'Stopped'.",
  "Medium")

t(DESK, "MK", "Runtime", "Functional",
  "Multiple mocks running simultaneously",
  "2 mocks defined.",
  "1. Start both.",
  "—",
  "Each binds to its own port; both reachable; logs separated.",
  "Medium")

t(DESK, "MK", "Runtime", "Edge Case",
  "Port conflict on start picks next free port",
  "Default port occupied.",
  "1. Start mock.",
  "—",
  "App tries next free port; status shows new port.",
  "Medium")

t(DESK, "MK", "Runtime", "Functional",
  "Quitting app stops all running mocks",
  "Mock running.",
  "1. Quit app.",
  "—",
  "On graceful quit, all mock processes are stopped; ports freed; no orphan processes after quit.",
  "High")

t(DESK, "MK", "Runtime", "Edge Case",
  "Renderer reload preserves running mocks",
  "Mock running.",
  "1. View → Reload (or Cmd+R).",
  "—",
  "Mock keeps running (main-process owned); UI re-attaches and shows correct status.",
  "Medium")

t(DESK, "MK", "Logs", "Functional",
  "Request logs show in panel",
  "Mock running.",
  "1. Hit the mock with a request.",
  "—",
  "Log row appears with timestamp/method/path/status.",
  "Medium")

t(DESK, "MK", "Logs", "Edge Case",
  "Long-running mock log buffer caps memory",
  "Mock receives 10,000 requests.",
  "1. Send many requests.",
  "—",
  "UI keeps a ring buffer (or paginates); memory remains bounded.",
  "Low")

# =====================================================================
# SETTINGS & THEMING (ST)
# =====================================================================
t(BOTH, "ST", "Theme", "Functional",
  "Switch dark to light",
  "Active theme dark.",
  "1. Settings → Appearance → 'workbench-light'.",
  "—",
  "UI re-themes; Monaco follows; no reload needed.",
  "High")

t(BOTH, "ST", "Theme", "A11y",
  "High-contrast theme meets WCAG 2.1",
  "—",
  "1. Select high-contrast theme.",
  "—",
  "Text/background ≥7:1 contrast; focus rings clearly visible.",
  "Medium")

t(BOTH, "ST", "Font", "Functional",
  "Change code font",
  "Settings open.",
  "1. Pick JetBrains Mono.",
  "—",
  "Monaco font updates immediately; sans font unaffected.",
  "Low")

t(BOTH, "ST", "Font Size", "Functional",
  "Increase UI text size",
  "Default 100%.",
  "1. Ctrl/Cmd+Shift+= ×3.",
  "—",
  "Scales to ~115%; persists across sessions.",
  "Medium")

t(BOTH, "ST", "Font Size", "Functional",
  "Reset UI text size",
  "—",
  "1. Ctrl/Cmd+Shift+0.",
  "—",
  "Resets to 100%.",
  "Low")

t(BOTH, "ST", "Workspace-scoped", "Functional",
  "Theme persists per workspace",
  "Workspaces A and B.",
  "1. Dark in A.\n2. Light in B.\n3. Back to A.",
  "—",
  "Each workspace remembers its theme independently.",
  "Medium")

# Web-specific
t(WEB, "ST", "Browser Zoom", "Compatibility",
  "Browser Ctrl++ vs app font size do not double-apply",
  "—",
  "1. Browser zoom 125% + app size 110%.",
  "—",
  "Reasonable cumulative scale; layout remains usable.",
  "Low")

# Desktop-specific
t(DESK, "ST", "Auto-update", "Functional",
  "Settings show current update channel",
  "Settings → Updates.",
  "1. Open the section.",
  "—",
  "Channel (stable/beta if available) and current version are shown; Check now button present.",
  "Medium")

# =====================================================================
# IMPORT / EXPORT (IE)
# =====================================================================
t(BOTH, "IE", "Postman", "Functional",
  "Import Postman v2.1 collection",
  "Postman v2.1 JSON.",
  "1. Import → choose file.",
  "—",
  "Folders/requests imported; URLs/methods/headers/body/auth (compatible) preserved; summary lists counts + warnings.",
  "High")

t(BOTH, "IE", "Postman", "Edge Case",
  "Unsupported auth falls back gracefully",
  "Postman collection with exotic auth.",
  "1. Import.",
  "—",
  "Auth downgraded to 'none' or 'inherit' with explicit warning; import does not fail entirely.",
  "Medium")

t(BOTH, "IE", "cURL", "Functional",
  "Paste cURL creates request",
  "Editor open.",
  "1. Paste 'curl -X POST -H Content-Type:application/json -d {…} https://api.test/x'.",
  "—",
  "Request created: POST, header, body; can be sent immediately.",
  "High")

t(BOTH, "IE", "cURL", "Edge Case",
  "Multi-line cURL with backslash continuations",
  "—",
  "1. Paste cURL with several \\-continued lines.",
  "—",
  "Parsed correctly; all flags preserved.",
  "Low")

t(BOTH, "IE", "Insomnia", "Functional",
  "Import Insomnia export",
  "Insomnia JSON.",
  "1. Import.",
  "—",
  "Requests/envs imported.",
  "Medium")

t(BOTH, "IE", "Export", "Functional",
  "Export workspace JSON",
  "Workspace has data.",
  "1. Export → JSON.",
  "—",
  "Valid WorkspaceSynced JSON saved; secrets excluded.",
  "Medium")

t(BOTH, "IE", "Copy cURL", "Functional",
  "Copy request as cURL",
  "Request configured.",
  "1. Copy as cURL.",
  "—",
  "Clipboard has working cURL; pasting in terminal sends the same request.",
  "Medium")

t(BOTH, "IE", "Export", "Security",
  "Exported JSON omits secret values",
  "Workspace has secret var 'token'.",
  "1. Export.",
  "—",
  "JSON contains the var name but value is empty or [SECRET]; never plaintext.",
  "High")

# Web-specific
t(WEB, "IE", "Download", "Functional",
  "Export triggers browser download",
  "—",
  "1. Export workspace.",
  "—",
  "Browser download bar shows file; saved to default Downloads folder.",
  "Medium")

t(WEB, "IE", "Upload", "Functional",
  "Import uses browser file picker",
  "—",
  "1. Import → file picker.",
  "—",
  "Picker opens; selected file content is read in-memory.",
  "Medium")

# Desktop-specific
t(DESK, "IE", "Native Dialog", "Functional",
  "Import uses native open dialog",
  "—",
  "1. Import.",
  "—",
  "OS dialog with filters for .json/.yaml; default folder remembered.",
  "Medium")

t(DESK, "IE", "Native Dialog", "Functional",
  "Export uses native save dialog",
  "—",
  "1. Export.",
  "—",
  "OS dialog; user picks location; default name suggested.",
  "Medium")

# =====================================================================
# GIT INTEGRATION (GT)
# =====================================================================
t(BOTH, "GT", "Push Conflict", "Negative",
  "Concurrent push fails second push",
  "Two devices push same branch.",
  "1. Device A push.\n2. Device B push without pull.",
  "—",
  "B fails 'remote has changes'; user prompted to pull and merge.",
  "High")

t(BOTH, "GT", "Three-way", "Functional",
  "Auto-merge non-conflicting edits",
  "Local: URL changed. Remote: headers changed (same request).",
  "1. Pull.",
  "—",
  "Both edits merged; final request has both new URL and headers.",
  "High")

t(BOTH, "GT", "Three-way", "Functional",
  "Conflict on same field surfaces resolution UI",
  "Local URL=A; remote URL=B.",
  "1. Pull.",
  "—",
  "Conflict modal lists conflicting fields; user picks theirs/mine/manual; resolution committed.",
  "High")

t(BOTH, "GT", "Branch", "Functional",
  "Switch working branch reloads synced doc",
  "Workspace on branch X.",
  "1. Switch to Y.",
  "—",
  "Local synced replaced with Y's content; local edits warned about (stash/discard).",
  "Medium")

t(BOTH, "GT", "Retired", "Functional",
  "Cleanup prompt after PR merge",
  "PR merged; branch deleted.",
  "1. Refresh.",
  "—",
  "Prompt offers: new branch from main, or abandon changes.",
  "Medium")

t(BOTH, "GT", "Commit Author", "Functional",
  "Commit author matches OAuthed user",
  "—",
  "1. Push.\n2. Inspect commit on GitHub.",
  "—",
  "Author email/name match GitHub OAuth profile.",
  "Low")

t(BOTH, "GT", "Network", "Negative",
  "Push during offline shows clear error",
  "Network disabled.",
  "1. Push.",
  "—",
  "Toast 'Network unavailable. Try again later.'; local edits preserved.",
  "High")

t(BOTH, "GT", "PR Capability", "Functional",
  "Create PR button visible when capability detected",
  "Repo with PR permission for the OAuth scope.",
  "1. After push, look for Create PR button.",
  "—",
  "Button visible; click opens GitHub compose page (web/external browser).",
  "Medium")

t(BOTH, "GT", "Pull Race", "Edge Case",
  "Pull while local edits being typed",
  "Active editing in body field.",
  "1. Click Pull while typing.",
  "—",
  "App pauses pull or warns about unsaved keystrokes; no data lost.",
  "Medium")

# =====================================================================
# GRAPHQL (GQ)
# =====================================================================
t(BOTH, "GQ", "Introspect", "Functional",
  "Fetch schema",
  "GraphQL endpoint reachable.",
  "1. Body → GraphQL.\n2. Fetch Schema.",
  "—",
  "Schema saved to globalAssets; completions enabled.",
  "High")

t(BOTH, "GQ", "Completions", "Functional",
  "Field autocomplete uses schema",
  "Schema fetched.",
  "1. Type 'query { us' in editor.",
  "—",
  "Suggestions include 'user' from loaded schema.",
  "Medium")

t(BOTH, "GQ", "Variables", "Functional",
  "Variables sent with query",
  "Query: query($id:ID!){ user(id:$id){ name } }",
  "1. Variables: {\"id\":\"1\"}.\n2. Send.",
  "—",
  "Body has both query and variables; resolved server-side.",
  "Medium")

t(BOTH, "GQ", "Schema Reuse", "Functional",
  "Stored schema reused after reload",
  "Workspace reopened.",
  "1. Open GraphQL request.",
  "—",
  "Completions work without re-fetch; schema persisted in synced state.",
  "Low")

t(BOTH, "GQ", "Introspect", "Negative",
  "Introspection disabled on server",
  "Server returns 400 on introspection.",
  "1. Fetch Schema.",
  "—",
  "Error 'Introspection not allowed'; user can upload schema manually if supported.",
  "Medium")

# =====================================================================
# ASSERTIONS & PLANS (AS)
# =====================================================================
t(BOTH, "AS", "Plan Create", "Functional",
  "Create execution plan with 3 steps",
  "Workspace has 3+ requests.",
  "1. Execution panel → New plan.\n2. Add 3 steps.",
  "—",
  "Plan saved; order set; each step shows source request.",
  "High")

t(BOTH, "AS", "Plan Run", "Functional",
  "Run plan sequentially",
  "Plan with 3 steps.",
  "1. Run.",
  "—",
  "Each step runs in order; aggregate progress; per-step pass/fail visible.",
  "High")

t(BOTH, "AS", "Plan Run", "Functional",
  "Disabled step is skipped",
  "Step 2 disabled.",
  "1. Run.",
  "—",
  "Step 2 marked skipped; 1 and 3 run; skip count separated from pass/fail.",
  "Medium")

t(BOTH, "AS", "Plan Run", "Functional",
  "Stop on first failure",
  "Option enabled; step 2 fails.",
  "1. Run.",
  "—",
  "Step 1 passes; 2 fails; remaining steps 'not run'; summary reflects.",
  "Medium")

t(BOTH, "AS", "Plan Report", "Functional",
  "Per-step results in panel",
  "Run completed.",
  "1. Expand a step.",
  "—",
  "Shows request, response, assertion details.",
  "Medium")

t(BOTH, "AS", "Plan Reorder", "Functional",
  "Drag-reorder plan steps",
  "Plan with 4 steps.",
  "1. Drag step 4 to position 1.",
  "—",
  "Order updates; persists.",
  "Medium")

t(BOTH, "AS", "Plan Env", "Functional",
  "Plan-level env priority override",
  "Plan with env priority different from workspace default.",
  "1. Run.",
  "—",
  "Variable resolution honors plan's env priority order.",
  "Medium")

t(BOTH, "AS", "Plan Loop", "Edge Case",
  "Plan with same step twice",
  "Plan adds Request R as steps 1 and 3.",
  "1. Run.",
  "—",
  "Both executions tracked separately; each gets its own run history entry.",
  "Low")

# =====================================================================
# DOCUMENTATION (DC)
# =====================================================================
t(BOTH, "DC", "Help", "Functional",
  "Search a topic",
  "Help panel.",
  "1. Search 'oauth'.",
  "—",
  "Matching topics surface; Markdown content renders.",
  "Medium")

t(BOTH, "DC", "Help", "Security",
  "Markdown sanitized against XSS",
  "Topic with crafted Markdown injecting <script>.",
  "1. Open the topic.",
  "—",
  "Script tags stripped/escaped; renders as text; no script execution.",
  "High")

t(BOTH, "DC", "Request Docs", "Functional",
  "Request Docs tab renders Markdown",
  "Request with docs '# Hi\\n- bullet'.",
  "1. Open Docs tab.",
  "—",
  "Heading and bullet render with proper HTML.",
  "Medium")

t(BOTH, "DC", "External Links", "UX/UI",
  "External help links open externally",
  "Help links to https://...",
  "1. Click an external link.",
  "—",
  "Web: opens new tab. Desktop: opens OS browser via shell.openExternal.",
  "Medium")

# =====================================================================
# SEARCH (SE)
# =====================================================================
t(BOTH, "SE", "Marketplace", "Functional",
  "Search returns public workspaces",
  "Marketplace reachable.",
  "1. Search 'stripe'.",
  "—",
  "Matching public workspaces listed.",
  "Low")

t(BOTH, "SE", "Marketplace", "Functional",
  "Link a public workspace",
  "Result open.",
  "1. Add to workspace.",
  "—",
  "Linked workspace appears in sidebar; collections become referenceable; consumer overrides allowed.",
  "Medium")

t(BOTH, "SE", "Marketplace", "Negative",
  "Empty marketplace results",
  "Search for nonexistent term.",
  "1. Search 'xyzzy'.",
  "—",
  "Empty-state message with suggested searches.",
  "Low")

# =====================================================================
# KEYBOARD SHORTCUTS (KB)
# =====================================================================
t(BOTH, "KB", "Send", "Functional",
  "Ctrl/Cmd+Enter sends",
  "Request open.",
  "1. Anywhere in editor, press shortcut.",
  "—",
  "Request sent regardless of focused element.",
  "High")

t(BOTH, "KB", "Panels", "Functional",
  "Ctrl/Cmd+1..9 switches panels",
  "—",
  "1. Press 1, 3, 7.",
  "—",
  "Panel changes accordingly; while typing in inputs, shortcut is suppressed.",
  "Medium")

t(BOTH, "KB", "Vault", "Functional",
  "Ctrl/Cmd+K opens Vault tab",
  "Any panel.",
  "1. Press shortcut.",
  "—",
  "Right dock opens Vault.",
  "Low")

t(BOTH, "KB", "Refresh", "Functional",
  "Ctrl/Cmd+Shift+R refreshes workspace",
  "Linked workspace.",
  "1. Press shortcut.",
  "—",
  "Refresh action runs; does NOT reload the page/window.",
  "Medium")

t(BOTH, "KB", "Font Size", "Functional",
  "Ctrl/Cmd+Shift+= increases UI size",
  "—",
  "1. Press 3×.",
  "—",
  "UI scales up; reset via Ctrl/Cmd+Shift+0.",
  "Low")

t(BOTH, "KB", "New Request", "Functional",
  "Ctrl/Cmd+N creates new request in Editor",
  "Editor panel focused.",
  "1. Press shortcut.",
  "—",
  "New request created under selected folder.",
  "Medium")

# Web-specific
t(WEB, "KB", "Conflict", "Compatibility",
  "Ctrl+R reloads browser (not workspace)",
  "App open.",
  "1. Press Ctrl/Cmd+R.",
  "—",
  "Browser reloads (expected); user uses Ctrl+Shift+R for workspace refresh — clearly documented.",
  "Medium")

t(WEB, "KB", "Conflict", "Compatibility",
  "Ctrl+W closes tab (browser default)",
  "App open.",
  "1. Press Ctrl/Cmd+W.",
  "—",
  "Browser closes the tab; user warned about unsaved changes (if any) per browser/extension behavior.",
  "Medium")

t(WEB, "KB", "Conflict", "Compatibility",
  "Ctrl+F opens browser Find",
  "App open.",
  "1. Press Ctrl/Cmd+F.",
  "—",
  "Browser-native Find bar opens; in-app search uses its own shortcut (documented).",
  "Low")

t(WEB, "KB", "Conflict", "Compatibility",
  "Ctrl+P opens browser Print",
  "App open.",
  "1. Press Ctrl/Cmd+P.",
  "—",
  "Browser Print dialog opens (does not break app); user may need to dismiss to return.",
  "Low")

# Desktop-specific
t(DESK, "KB", "Native Menu", "Functional",
  "Native menu accelerators match in-app shortcuts",
  "—",
  "1. Inspect File / Edit menus.",
  "—",
  "Menu items show accelerators (e.g., New Request Ctrl/Cmd+N); pressing them triggers the same action.",
  "Medium")

t(DESK, "KB", "Reload", "Functional",
  "View → Reload re-renders without losing state",
  "—",
  "1. View → Reload.",
  "—",
  "Renderer reloads; IndexedDB state preserved; running mocks survive (main-process owned).",
  "Medium")

t(DESK, "KB", "DevTools", "Functional",
  "View → Toggle Developer Tools",
  "—",
  "1. Cmd/Ctrl+Alt+I (or menu).",
  "—",
  "DevTools panel toggles open/closed.",
  "Low")

t(DESK, "KB", "Quit", "Functional",
  "Cmd+Q (mac) / Alt+F4 (win/linux) quits",
  "—",
  "1. Press OS quit shortcut.",
  "—",
  "App quits cleanly; unsaved-edit prompt if applicable.",
  "Medium")

# =====================================================================
# ACCESSIBILITY (AL)
# =====================================================================
t(BOTH, "AL", "Tab Order", "A11y",
  "Tab order is logical",
  "Editor open.",
  "1. Tab through controls.",
  "—",
  "Focus moves Method → URL → Send → sub-tabs → editor surfaces; no focus traps.",
  "High")

t(BOTH, "AL", "Focus Ring", "A11y",
  "Visible focus indicator on all interactive elements",
  "—",
  "1. Tab to each.",
  "—",
  "Focus ring (var(--purple)) clearly visible; ≥3:1 contrast with background.",
  "High")

t(BOTH, "AL", "Screen Reader", "A11y",
  "Buttons announce purpose",
  "Screen reader on.",
  "1. Audit Send/Save/Delete buttons.",
  "—",
  "Each announces clearly; state changes (e.g., 'Sending…') are announced.",
  "Medium")

t(BOTH, "AL", "Color Independence", "A11y",
  "Status not conveyed by color alone",
  "Test results mixed pass/fail.",
  "1. Inspect Tests panel.",
  "—",
  "Pass/Fail conveyed by icon AND color; readable for color-blind users.",
  "Medium")

t(BOTH, "AL", "Reduced Motion", "A11y",
  "Respects prefers-reduced-motion",
  "OS setting on.",
  "1. Trigger panel slide-in / toast animations.",
  "—",
  "Animations are reduced or removed; functionality preserved.",
  "Low")

t(BOTH, "AL", "Keyboard Only", "A11y",
  "Full app navigable without mouse",
  "No mouse.",
  "1. Create workspace, add request, set body, send.",
  "—",
  "All flows reachable via keyboard; no mouse-only actions.",
  "High")

t(BOTH, "AL", "ARIA", "A11y",
  "ARIA roles match semantics",
  "—",
  "1. Inspect with a11y devtools.",
  "—",
  "Roles align with usage (role='button', 'navigation', 'region'); no incorrect roles.",
  "Medium")

t(BOTH, "AL", "Contrast", "A11y",
  "Default theme meets WCAG AA contrast",
  "Default theme.",
  "1. Run contrast checker.",
  "—",
  "All text/UI passes AA; AAA where critical (forms, errors).",
  "Medium")

# =====================================================================
# NETWORK CONDITIONS (NW)
# =====================================================================
t(BOTH, "NW", "Timeout", "Negative",
  "Default request timeout",
  "Endpoint that never responds.",
  "1. Send.",
  "—",
  "After timeout (e.g., 30s), error 'Request timeout'; not silent hang.",
  "High")

t(BOTH, "NW", "Slow", "Edge Case",
  "Slow response (10s)",
  "Endpoint with 10s delay.",
  "1. Send.",
  "—",
  "Spinner remains active; response renders correctly when received.",
  "Medium")

t(BOTH, "NW", "DNS", "Negative",
  "Unresolvable hostname",
  "—",
  "1. Send to 'https://this-does-not-resolve.example'.",
  "—",
  "Clear error 'DNS resolution failed'; user offered guidance.",
  "Medium")

t(BOTH, "NW", "Connection", "Negative",
  "Connection refused",
  "Local port not listening.",
  "1. Send to http://localhost:9999.",
  "—",
  "Clear error 'Connection refused'.",
  "Medium")

t(BOTH, "NW", "TLS", "Negative",
  "Self-signed TLS certificate",
  "Endpoint with self-signed cert.",
  "1. Send.",
  "—",
  "Error reported with cert details; option to allow once (if implemented) or guidance.",
  "Medium")

t(BOTH, "NW", "Redirect", "Functional",
  "HTTP 302 followed transparently",
  "Endpoint that 302→200.",
  "1. Send.",
  "—",
  "Final 200 response shown; redirect chain optionally inspectable.",
  "Medium")

t(BOTH, "NW", "Redirect", "Edge Case",
  "Redirect loop terminated",
  "Endpoint loops 301→301.",
  "1. Send.",
  "—",
  "Loop detected; error after N redirects.",
  "Low")

t(BOTH, "NW", "Streaming", "Functional",
  "Chunked response streamed",
  "Endpoint sends chunked transfer-encoding.",
  "1. Send.",
  "—",
  "Body appears progressively or after full receive; size reported correctly.",
  "Low")

# Web-specific
t(WEB, "NW", "CORS Preflight", "Functional",
  "Preflight OPTIONS handled by browser",
  "Endpoint requiring CORS.",
  "1. Send POST with custom header.",
  "—",
  "Browser sends OPTIONS first; if allowed, real request goes through; otherwise CORS error in response panel.",
  "Medium")

t(WEB, "NW", "Offline", "Negative",
  "Browser offline mode",
  "DevTools: offline.",
  "1. Send.",
  "—",
  "Error 'Network unavailable'; clear messaging.",
  "Medium")

# Desktop-specific
t(DESK, "NW", "Wi-Fi", "Edge Case",
  "Wi-Fi switch during in-flight request",
  "Send long request.",
  "1. While sending, switch Wi-Fi network.",
  "—",
  "Request fails (or completes if same network); error is clear; app does not crash.",
  "Medium")

t(DESK, "NW", "Sleep", "Edge Case",
  "OS sleep during in-flight request",
  "—",
  "1. Send.\n2. Put OS to sleep.\n3. Wake.",
  "—",
  "On wake, request either failed cleanly with timeout, or completed if connection survived; UI accurately reflects state.",
  "Low")

# =====================================================================
# PERFORMANCE (PE)
# =====================================================================
t(BOTH, "PE", "Large Workspace", "Performance",
  "Workspace with 500 requests opens in < 3s",
  "Workspace with 500 requests across 50 folders.",
  "1. Open the workspace.",
  "—",
  "Hydrate + first paint < 3 s on baseline machine; tree scrolling smooth.",
  "Medium")

t(BOTH, "PE", "Large Response", "Performance",
  "10 MB response renders without freezing",
  "Endpoint returning 10 MB JSON.",
  "1. Send.",
  "—",
  "Preview cap kicks in; viewer remains responsive; Download offered; UI does not freeze.",
  "Medium")

t(BOTH, "PE", "Many Vars", "Performance",
  "Env with 1000 variables loads fast",
  "Env with 1000 vars.",
  "1. Open Variables panel.",
  "—",
  "Panel opens < 1s; filtering is responsive.",
  "Low")

t(BOTH, "PE", "Many Attachments", "Performance",
  "Workspace with 50 file attachments",
  "—",
  "1. Open workspace.",
  "—",
  "Hydrate doesn't load attachment blobs eagerly; they load on demand.",
  "Low")

t(BOTH, "PE", "Debounce", "Performance",
  "Rapid keystrokes don't thrash IndexedDB",
  "Body editor.",
  "1. Type 100 keystrokes quickly.",
  "—",
  "Disk writes coalesced via 250ms debounce; final state intact.",
  "Medium")

t(BOTH, "PE", "Workspace Switch", "Performance",
  "Switching workspaces < 1s",
  "Two normal-sized workspaces.",
  "1. Switch A → B.",
  "—",
  "Switch completes < 1s; no UI freeze.",
  "Medium")

# =====================================================================
# SECURITY (SY)
# =====================================================================
t(BOTH, "SY", "XSS", "Security",
  "Response Preview safe for malicious HTML",
  "Response with <script>alert(1)</script>.",
  "1. Send.\n2. Switch to Preview.",
  "—",
  "Script does not execute; rendered in sandboxed iframe or escaped.",
  "High")

t(BOTH, "SY", "XSS", "Security",
  "Variable values not interpreted as HTML",
  "Var v='<img onerror=alert(1) src=x>'.",
  "1. Insert {{v}} into a UI label/tooltip.",
  "—",
  "Rendered as text; no script execution.",
  "High")

t(BOTH, "SY", "Secrets", "Security",
  "Secrets not in plaintext history",
  "Request uses Bearer {{token}} with secret token.",
  "1. Send.\n2. Inspect history entry.",
  "—",
  "Resolved Authorization header is redacted in history view (masked); raw token never persisted to history.",
  "High")

t(BOTH, "SY", "Secrets", "Security",
  "Secrets redacted in CLI logs",
  "Pre-request: console.log(pm.variables.get('token'))",
  "1. Send; check console.",
  "—",
  "Token value redacted or masked in console output.",
  "Medium")

t(BOTH, "SY", "Imports", "Security",
  "Imported file paths sanitized",
  "Malicious Postman v2.1 with path traversal in name '../../etc/passwd'.",
  "1. Import.",
  "—",
  "Name treated as literal; no file system access; no directory traversal.",
  "High")

t(BOTH, "SY", "URL", "Security",
  "javascript: URL blocked",
  "—",
  "1. URL: 'javascript:alert(1)'.\n2. Send.",
  "—",
  "Send is blocked with clear message; no script execution.",
  "High")

t(BOTH, "SY", "Network", "Security",
  "Sending to file://, intranet by user is logged but allowed",
  "URL: 'file:///etc/hosts'.",
  "1. Send.",
  "—",
  "Either blocked with rationale, or attempted with no auto-bypass of CORS; web context applies browser policy; desktop may allow.",
  "Medium")

t(BOTH, "SY", "Headers", "Security",
  "Authorization header value masked in 'Copy as cURL' UI preview",
  "Auth Bearer token.",
  "1. Open 'Copy as cURL' preview.",
  "—",
  "UI preview shows token masked (full value still on clipboard); user warned the clipboard contains secret.",
  "Medium")

# Web-specific
t(WEB, "SY", "CSP", "Security",
  "Content Security Policy enforced",
  "Page loaded.",
  "1. Inspect response headers / meta.",
  "—",
  "CSP allows connect-src 'self' https: http: ws: wss: blob: data:; no unsafe-inline/eval (or only with rationale).",
  "Medium")

t(WEB, "SY", "Iframe", "Security",
  "App refuses to be framed by third parties",
  "Third-party site iframes the app.",
  "1. Attempt to embed.",
  "—",
  "X-Frame-Options or frame-ancestors CSP blocks embedding.",
  "Medium")

# Desktop-specific
t(DESK, "SY", "IPC", "Security",
  "IPC from untrusted sender rejected",
  "Renderer harness calls a privileged channel from non-file:// origin.",
  "1. Attempt the call.",
  "—",
  "Main rejects (assertTrustedSender); no privileged action executes.",
  "High")

t(DESK, "SY", "Bind", "Security",
  "OAuth2 server binds 127.0.0.1 only",
  "—",
  "1. Inspect listening interfaces.",
  "—",
  "Binds to 127.0.0.1 (not 0.0.0.0); cannot be reached from LAN.",
  "High")

t(DESK, "SY", "Code Signing", "Security",
  "First launch warning on signed build",
  "Fresh download.",
  "1. Launch.",
  "—",
  "Gatekeeper (mac) / SmartScreen (win) prompt is informational; app launches without bypass; if unsigned, warning is clear.",
  "Medium")

# =====================================================================
# CROSS-CUTTING UX (CC)
# =====================================================================
t(BOTH, "CC", "Toasts", "Functional",
  "Success toast on successful push",
  "Linked workspace.",
  "1. Push.",
  "—",
  "Toast 'Workspace pushed' ~5s; dismissible.",
  "Medium")

t(BOTH, "CC", "Toasts", "Functional",
  "Error toast on network failure",
  "Network off.",
  "1. Send.",
  "—",
  "Toast describes error with actionable hint.",
  "High")

t(BOTH, "CC", "Toasts", "UX/UI",
  "Stacked toasts dismiss independently",
  "—",
  "1. Trigger 3 toasts quickly.",
  "—",
  "Stacked; each dismissible; auto-dismiss timers independent.",
  "Low")

t(BOTH, "CC", "Confirm", "UX/UI",
  "Destructive confirm uses red button",
  "Delete collection.",
  "1. Trigger delete.",
  "—",
  "Clear title, consequence text, red destructive button, Cancel default.",
  "High")

t(BOTH, "CC", "Modal", "Functional",
  "Esc closes non-critical modal",
  "Import modal.",
  "1. Press Esc.",
  "—",
  "Closes; focus returns to trigger.",
  "Medium")

t(BOTH, "CC", "Modal", "UX/UI",
  "Backdrop click does NOT close destructive modals",
  "Delete confirm.",
  "1. Click outside.",
  "—",
  "Modal remains; only Cancel/Confirm dismiss.",
  "Medium")

t(BOTH, "CC", "DnD", "Functional",
  "Drag-reorder env priority",
  "3 envs.",
  "1. Drag row 3 to position 1.",
  "—",
  "Order updates; persists.",
  "Medium")

t(BOTH, "CC", "Persistence", "Performance",
  "250ms debounce coalesces edits",
  "Body editor.",
  "1. Type 10 keystrokes <250ms.",
  "—",
  "1 IndexedDB write; final state matches typed.",
  "Medium")

t(BOTH, "CC", "Error Recovery", "Negative",
  "Corrupted workspace.json shows recovery UI",
  "Manually corrupt workspace.",
  "1. Reopen.",
  "—",
  "Recovery screen with parse error and options (reset, restore from git, contact); no crash.",
  "High")

t(BOTH, "CC", "Empty States", "UX/UI",
  "Empty workspace shows helpful guidance",
  "New empty workspace.",
  "1. Look at editor sidebar.",
  "—",
  "Empty-state message + 'Create your first request' CTA; not blank.",
  "Medium")

t(BOTH, "CC", "Empty States", "UX/UI",
  "Empty history shows helpful guidance",
  "—",
  "1. Open History on fresh workspace.",
  "—",
  "Empty state explains 'No runs yet — send a request to see history here'.",
  "Low")

t(BOTH, "CC", "Empty States", "UX/UI",
  "Empty mocks shows CTA",
  "—",
  "1. Open Mocks on fresh workspace.",
  "—",
  "Empty state with 'Create your first mock' CTA.",
  "Low")

# =====================================================================
# WEB-SPECIFIC MODULE (WB)
# =====================================================================
t(WEB, "WB", "Multi-Tab", "Edge Case",
  "Open same workspace in 2 tabs concurrently",
  "Tab A has workspace open.",
  "1. Open Tab B on same URL/workspace.\n2. Edit in A.\n3. Refresh B.",
  "—",
  "B reflects A's edits after refresh; no IndexedDB corruption; conflict (same field edited in both within debounce window) last-write-wins.",
  "High")

t(WEB, "WB", "Multi-Tab", "Edge Case",
  "Two tabs editing same request — last-write-wins",
  "Both tabs have request R open.",
  "1. In A, type 'foo' in body.\n2. In B, type 'bar' in body.\n3. Wait for debounce flush.",
  "—",
  "IndexedDB ends in a deterministic state (one tab's last keystroke wins); no JSON corruption.",
  "Medium")

t(WEB, "WB", "Tab Close", "Edge Case",
  "Closing tab with unsaved edits",
  "Active tab has unpushed edits.",
  "1. Close tab.",
  "—",
  "Edits persisted to IndexedDB; on reopen, edits restored; browser beforeunload warning is optional (some browsers ignore unless user typed).",
  "Medium")

t(WEB, "WB", "Refresh", "Functional",
  "F5 reload preserves in-progress request input",
  "Body field has content.",
  "1. Press F5.",
  "—",
  "Body content survives (saved via debounce); active request reopens.",
  "Medium")

t(WEB, "WB", "Refresh", "Edge Case",
  "Hard reload (Ctrl+Shift+R) preserves IndexedDB",
  "—",
  "1. Press Ctrl+Shift+R.",
  "—",
  "Service worker / cache cleared but IndexedDB intact; workspace re-hydrates.",
  "Medium")

t(WEB, "WB", "Browser Compat", "Compatibility",
  "Smoke test on Chrome",
  "Chrome latest.",
  "1. Run smoke flow: create workspace, add request, send.",
  "—",
  "All features work; no console errors.",
  "High")

t(WEB, "WB", "Browser Compat", "Compatibility",
  "Smoke test on Firefox",
  "Firefox latest.",
  "1. Run smoke flow.",
  "—",
  "All features work; minor browser-specific affordances acceptable.",
  "High")

t(WEB, "WB", "Browser Compat", "Compatibility",
  "Smoke test on Safari",
  "Safari latest (macOS).",
  "1. Run smoke flow.",
  "—",
  "All features work; popup-based OAuth functions correctly; BroadcastChannel works.",
  "High")

t(WEB, "WB", "Browser Compat", "Compatibility",
  "Smoke test on Edge",
  "Edge latest.",
  "1. Run smoke flow.",
  "—",
  "All features work.",
  "High")

t(WEB, "WB", "Privacy Mode", "Compatibility",
  "Incognito / Private mode",
  "Open app in private window.",
  "1. Create workspace.\n2. Send a request.\n3. Close window.",
  "—",
  "Works for the session; data clears on window close; user is informed if relevant.",
  "Medium")

t(WEB, "WB", "Quota", "Edge Case",
  "IndexedDB quota exceeded",
  "Fill IndexedDB near limit.",
  "1. Try saving a large attachment.",
  "—",
  "QuotaExceededError handled with clear toast; user is offered to clear history/attachments.",
  "High")

t(WEB, "WB", "Service Worker", "Functional",
  "Service worker (if registered) doesn't break OAuth callback",
  "—",
  "1. Run OAuth flow.",
  "—",
  "Service worker passes through /oauth-callback.html without caching auth params.",
  "Medium")

t(WEB, "WB", "Mixed Content", "Security",
  "HTTPS app refuses to send http://localhost in some browsers",
  "App on https://....",
  "1. URL: http://localhost:3000/x.\n2. Send.",
  "—",
  "Modern browsers allow http://localhost as a secure context exception; otherwise clear error.",
  "Medium")

t(WEB, "WB", "Browser Back", "Edge Case",
  "Back button after deep navigation",
  "Navigated through panels.",
  "1. Press browser Back.",
  "—",
  "Either in-app back (panel history) or browser leaves the app with beforeunload prompt if unsaved.",
  "Medium")

t(WEB, "WB", "Bookmark", "Functional",
  "Bookmark URL re-opens same view",
  "User on Editor panel.",
  "1. Bookmark URL.\n2. Open bookmark fresh.",
  "—",
  "Same view opens (panel state respected if reflected in URL); fallback graceful.",
  "Low")

t(WEB, "WB", "DevTools", "Compatibility",
  "DevTools open does not break app",
  "—",
  "1. F12.",
  "—",
  "DevTools opens; no exceptions; performance hit acceptable.",
  "Low")

t(WEB, "WB", "Clipboard", "Functional",
  "Clipboard read/write (Copy as cURL)",
  "HTTPS context.",
  "1. Click Copy as cURL.",
  "—",
  "navigator.clipboard.writeText succeeds; toast confirms.",
  "Medium")

t(WEB, "WB", "Clipboard", "Negative",
  "Clipboard denied in non-secure context",
  "HTTP context (rare).",
  "1. Click Copy as cURL.",
  "—",
  "Falls back to manual select-and-copy with a clear message.",
  "Low")

t(WEB, "WB", "Popup", "Negative",
  "OAuth popup blocked",
  "Popup blocker on.",
  "1. Click Get token.",
  "—",
  "Clear error 'Popup blocked'; instructions to allow popups for this site.",
  "High")

t(WEB, "WB", "Third-Party Cookies", "Compatibility",
  "Strict third-party cookie blocking",
  "Browser strict mode.",
  "1. Send to endpoint that sets cross-origin cookie.",
  "—",
  "Cookie may not be stored due to browser policy; app does not break; user can switch to desktop.",
  "Medium")

t(WEB, "WB", "Storage Events", "Edge Case",
  "localStorage change does not leak auth across tabs",
  "—",
  "1. Trigger any localStorage write.\n2. Observe other tabs.",
  "—",
  "OAuth callback explicitly avoids localStorage to prevent storage-event token leakage to sibling tabs.",
  "High")

t(WEB, "WB", "Inactive Tab", "Performance",
  "Inactive tab throttled by browser",
  "Long-running request in background tab.",
  "1. Switch away.",
  "—",
  "Request completes when tab regains focus or via browser-permitted background timers; UI updates correctly on return.",
  "Low")

t(WEB, "WB", "Geolocation/Notifications", "Compatibility",
  "App does not unnecessarily request OS permissions",
  "—",
  "1. Open app first time.",
  "—",
  "No notification/geolocation/microphone permission prompt unless feature explicitly requires.",
  "Low")

t(WEB, "WB", "PWA", "Compatibility",
  "Install as PWA (if supported)",
  "Chrome/Edge.",
  "1. Use 'Install app' if offered.",
  "—",
  "Installs as PWA; standalone window works equivalently to in-browser.",
  "Low")

t(WEB, "WB", "URL Scheme", "Security",
  "Browser blocks dangerous URL schemes",
  "—",
  "1. URL: 'data:text/html,<script>'.",
  "—",
  "Either explicitly blocked or browser refuses to load via fetch; no XSS in app.",
  "Medium")

t(WEB, "WB", "CORS Tunnel", "Functional",
  "Vite dev proxy works (/_mock and /_gh-oauth)",
  "Dev build.",
  "1. Use mocks proxied path.",
  "—",
  "Proxy forwards correctly; cookies preserved for GH OAuth.",
  "Low")

t(WEB, "WB", "Visibility", "Edge Case",
  "Tab hidden during OAuth callback popup",
  "Main tab in background.",
  "1. Approve popup.",
  "—",
  "BroadcastChannel delivers regardless of visibility; main tab updates upon focus.",
  "Medium")

# =====================================================================
# DESKTOP-SPECIFIC MODULE (DS)
# =====================================================================
t(DESK, "DS", "Auto-Update", "Functional",
  "Update check on startup",
  "Fresh launch.",
  "1. Launch app.",
  "—",
  "Background check ~5s after launch; if update available, IPC 'apicircle:update:available' fires; no blocking dialog at startup.",
  "Medium")

t(DESK, "DS", "Auto-Update", "Functional",
  "Update available banner appears",
  "Newer version released.",
  "1. Launch and wait.",
  "—",
  "Banner/Notification 'Update available' visible in UI; click 'Apply' triggers quitAndInstall after explicit confirmation.",
  "High")

t(DESK, "DS", "Auto-Update", "Functional",
  "Check Now button works",
  "Settings → Updates.",
  "1. Click Check Now.",
  "—",
  "Immediate check; status indicator updates; result toast 'Up to date' or 'Update available'.",
  "Medium")

t(DESK, "DS", "Auto-Update", "Negative",
  "Update check during offline",
  "Network off.",
  "1. Check Now.",
  "—",
  "Error 'Could not check for updates' with retry option; app keeps running.",
  "Medium")

t(DESK, "DS", "Auto-Update", "Security",
  "Update signature failure aborts apply",
  "Tampered update package.",
  "1. Apply update.",
  "—",
  "Signature verification fails; install aborts; user informed; current version intact.",
  "High")

t(DESK, "DS", "Native Menu", "Functional",
  "File menu: New / Import / Export work",
  "—",
  "1. Use each menu item.",
  "—",
  "Triggers the same flow as in-app buttons; accelerators displayed.",
  "Medium")

t(DESK, "DS", "Native Menu", "Functional",
  "Edit menu: Cut/Copy/Paste/Undo/Redo",
  "Text input focused.",
  "1. Use each menu item.",
  "—",
  "Native behavior on text input; works as expected.",
  "Medium")

t(DESK, "DS", "Native Menu", "Functional",
  "View menu: Reload / Toggle DevTools / Zoom",
  "—",
  "1. Use each.",
  "—",
  "Reload preserves state; DevTools toggles; Zoom adjusts UI scale.",
  "Medium")

t(DESK, "DS", "Native Menu", "Functional",
  "Window menu: Minimize / Zoom / Close",
  "—",
  "1. Use each.",
  "—",
  "Standard window behaviors; macOS native fullscreen via green button works.",
  "Low")

t(DESK, "DS", "Native Menu", "Functional",
  "Help menu: About / Docs / Report Issue",
  "—",
  "1. Use each.",
  "—",
  "About shows version & links; Docs opens external; Report Issue opens GitHub issues or feedback form.",
  "Low")

t(DESK, "DS", "Window State", "Functional",
  "Window bounds persist across restart",
  "Resize to 1200×800 at (200,200).",
  "1. Quit and re-open.",
  "—",
  "Window restores same bounds; saved to userData/window.json.",
  "Medium")

t(DESK, "DS", "Window State", "Edge Case",
  "Monitor disconnect clamps window onscreen",
  "Window on secondary monitor.",
  "1. Disconnect monitor.\n2. Relaunch.",
  "—",
  "Window opens on primary monitor; no off-screen invisible window.",
  "Medium")

t(DESK, "DS", "Window State", "Functional",
  "Fullscreen state persists",
  "—",
  "1. Enter fullscreen, quit, relaunch.",
  "—",
  "Reopens in fullscreen (if implemented) or remembers prior windowed bounds.",
  "Low")

t(DESK, "DS", "App Quit", "Functional",
  "Cmd+Q quits cleanly",
  "macOS.",
  "1. Press Cmd+Q.",
  "—",
  "All windows close; main process exits; running mocks stopped.",
  "Medium")

t(DESK, "DS", "App Quit", "Functional",
  "Alt+F4 quits cleanly (Win/Linux)",
  "—",
  "1. Press Alt+F4.",
  "—",
  "App quits; mocks stopped.",
  "Medium")

t(DESK, "DS", "macOS Dock", "Functional",
  "macOS dock click reopens window",
  "App running with window closed.",
  "1. Click dock icon.",
  "—",
  "Window reopens (or new window created); state restored.",
  "Low")

t(DESK, "DS", "macOS Menu Bar", "Functional",
  "macOS menu bar persists when window closed",
  "—",
  "1. Close window via red button (not Quit).",
  "—",
  "Menu bar remains; app still 'running'; Cmd+N creates new window.",
  "Low")

t(DESK, "DS", "Single Instance", "Functional",
  "Second launch focuses existing window",
  "App running.",
  "1. Launch the app again.",
  "—",
  "Existing instance is focused; no second instance created.",
  "Medium")

t(DESK, "DS", "Code Signing", "Compatibility",
  "macOS Gatekeeper first-launch",
  "Fresh signed build.",
  "1. Open app.",
  "—",
  "Optional Gatekeeper prompt; on approve, app launches; subsequent launches direct.",
  "Medium")

t(DESK, "DS", "Code Signing", "Compatibility",
  "Windows SmartScreen first-launch",
  "Fresh signed installer.",
  "1. Open installer.",
  "—",
  "SmartScreen prompt resolved by signed cert; install proceeds without 'Unknown publisher'.",
  "Medium")

t(DESK, "DS", "Linux", "Compatibility",
  "AppImage / deb runs",
  "Linux distro.",
  "1. Run AppImage or install deb.",
  "—",
  "App launches; desktop entry created; icon and name correct.",
  "Low")

t(DESK, "DS", "IPC Security", "Security",
  "Renderer cannot call privileged IPC from sub-frame",
  "Crafted renderer scenario.",
  "1. Trigger call from non-file:// origin.",
  "—",
  "assertTrustedSender rejects; main does not invoke privileged code.",
  "High")

t(DESK, "DS", "Native Secret", "Functional",
  "First write prompts OS for keychain access",
  "macOS first secret.",
  "1. Save a secret.",
  "—",
  "Keychain access prompt; on allow, write succeeds; subsequent silent.",
  "Medium")

t(DESK, "DS", "Native Secret", "Negative",
  "OS keychain unavailable falls back to passphrase",
  "Headless / locked keychain.",
  "1. Save a secret.",
  "—",
  "Fallback path used (PBKDF2 passphrase); user is informed; data still protected.",
  "Medium")

t(DESK, "DS", "Mock Manager", "Functional",
  "Renderer reload doesn't kill mocks",
  "Mock running.",
  "1. Cmd/Ctrl+R or View → Reload.",
  "—",
  "Mock keeps running; UI reattaches to existing mock manager state.",
  "Medium")

t(DESK, "DS", "MCP Bridge", "Functional",
  "MCP config snippet copy",
  "Settings → MCP.",
  "1. Click Copy config snippet.",
  "—",
  "Clipboard has JSON snippet with conventional path and proper args.",
  "Medium")

t(DESK, "DS", "MCP Bridge", "Functional",
  "MCP config path shown per OS convention",
  "macOS/Win/Linux.",
  "1. Open MCP settings.",
  "—",
  "Path shown matches OS convention (e.g., ~/Library/Application Support/Claude on mac).",
  "Low")

t(DESK, "DS", "First Run", "UX/UI",
  "First-run wizard appears",
  "Fresh install.",
  "1. Launch.",
  "—",
  "Welcome / first-run flow appears (if implemented); user can skip to empty state.",
  "Low")

t(DESK, "DS", "Crash", "Negative",
  "Force kill and recover",
  "Active workspace.",
  "1. Force-kill app.\n2. Relaunch.",
  "—",
  "App reopens; last workspace restored; no corruption.",
  "High")

t(DESK, "DS", "Power", "Edge Case",
  "OS sleep during long mock run",
  "Mock running.",
  "1. Put OS to sleep 10 min.\n2. Wake.",
  "—",
  "Mock either survives or restarts cleanly; UI accurately shows status.",
  "Low")

t(DESK, "DS", "Network", "Edge Case",
  "Wi-Fi switch during push",
  "Push in progress.",
  "1. Switch network mid-push.",
  "—",
  "Push fails or retries; user is informed; local edits preserved.",
  "Medium")

t(DESK, "DS", "Storage", "Functional",
  "User data directory location",
  "—",
  "1. Settings or About → app data path.",
  "—",
  "Path displayed; opens in OS file manager via 'Open folder' link.",
  "Low")

t(DESK, "DS", "Window", "Functional",
  "Window auto-hide menu bar respected on Windows",
  "Windows desktop.",
  "1. Press Alt to reveal menu bar.",
  "—",
  "Menu bar appears on Alt; hides automatically as designed.",
  "Low")

# =====================================================================
# CLI (CL) — desktop only (CLI typically installed alongside desktop)
# =====================================================================
t(DESK, "CL", "Help", "Functional",
  "apicircle --help prints usage",
  "CLI installed.",
  "1. Run 'apicircle --help'.",
  "—",
  "Usage and commands (mock, mcp, import) listed; exit 0.",
  "Medium")

t(DESK, "CL", "Mock", "Functional",
  "apicircle mock starts server",
  "Workspace folder with mock defined.",
  "1. Run 'apicircle mock ./workspace.json'.",
  "—",
  "Server starts on configured port; logs to stdout; Ctrl+C cleanly stops.",
  "High")

t(DESK, "CL", "Mock", "Edge Case",
  "Port already in use",
  "—",
  "1. Run twice with same port.",
  "—",
  "Second run errors with clear message and exit non-zero.",
  "Medium")

t(DESK, "CL", "Import", "Functional",
  "apicircle import OpenAPI",
  "Local workspace; spec.yaml.",
  "1. Run 'apicircle import ./spec.yaml ./workspace'.",
  "—",
  "workspace.json updated; summary printed; non-zero exit on schema error.",
  "Medium")

t(DESK, "CL", "MCP", "Functional",
  "apicircle mcp serves stdio MCP",
  "—",
  "1. Run 'apicircle mcp ./workspace'.",
  "—",
  "Reads stdio MCP messages; responds to handshake.",
  "Low")

t(DESK, "CL", "Secrets", "Functional",
  "Env var decrypts secrets at runtime",
  "Encrypted workspace.",
  "1. APICIRCLE_VAULT_SECRET_KEY=… apicircle mock ./workspace",
  "—",
  "Secrets decrypted; CLI does not log raw secret material.",
  "High")

t(DESK, "CL", "Validation", "Negative",
  "Invalid workspace path",
  "—",
  "1. 'apicircle mock ./missing'.",
  "—",
  "Clear error message; exit 1.",
  "Low")

t(DESK, "CL", "Logs", "Functional",
  "Mock request/response logs are structured",
  "Mock running.",
  "1. Hit mock with curl.",
  "—",
  "Each log line has timestamp, method, path, status, duration.",
  "Low")

# =====================================================================
# Done with test data
# =====================================================================

PLATFORM_TITLES = {
    "web": "APICircle Studio — Web App Manual Test Cases",
    "desktop": "APICircle Studio — Desktop App Manual Test Cases",
}

PLATFORM_BLURBS = {
    "web": (
        "These test cases cover the APICircle Studio web build (apps/web). "
        "OAuth2 uses popup + BroadcastChannel relay. Mock-server runtime is disabled "
        "(definitions are still editable). All data is persisted in IndexedDB; "
        "secrets are encrypted via passphrase-derived AES-GCM with the master JWK "
        "stored wrapped in IndexedDB."
    ),
    "desktop": (
        "These test cases cover the APICircle Studio desktop build (Electron, apps/desktop). "
        "OAuth2 uses a localhost callback HTTP server bound to 127.0.0.1. Mock-server runtime "
        "runs in the main process. Auto-updater is enabled. Secrets are wrapped via the OS "
        "keychain (safeStorage). IPC is gated by assertTrustedSender. Window bounds persist."
    ),
}


def build_workbook(platform: str, out_path: str):
    relevant = [x for x in TESTS if platform in x[0]]
    wb = Workbook()

    # README
    ws = wb.active
    ws.title = "README"
    ws.column_dimensions["A"].width = 28
    ws.column_dimensions["B"].width = 110

    ws.merge_cells("A1:B1")
    c = ws["A1"]
    c.value = PLATFORM_TITLES[platform]
    c.font = TITLE_FONT
    c.fill = HEADER_FILL
    c.alignment = CENTER
    ws.row_dimensions[1].height = 30

    readme_rows = [
        ("Platform", platform),
        ("Document owner", "QA Engineering"),
        ("Build under test", "Fill in version before each cycle (top bar shows current)."),
        ("Test environment", "OS, browser/Electron version, network speed, vault state."),
        ("Last updated", "2026-05-14"),
        ("Total test cases", str(len(relevant))),
        ("", ""),
        ("Scope", PLATFORM_BLURBS[platform]),
        ("", ""),
        ("How to use this workbook", ""),
        ("1.", "Open the 'Test Cases' sheet. Filters are enabled on every column."),
        ("2.", "Pick a module (column B), Test Type (column D), or priority (column L) to scope your session."),
        ("3.", "For each row, follow the steps in 'Test Steps' (column G) using 'Test Data' (column H)."),
        ("4.", "Compare what you see against 'Expected Result' (column I)."),
        ("5.", "Record what you saw in 'Actual Result' (column J)."),
        ("6.", "Set 'Status' (column K) to Pass / Fail / Blocked / Skipped / Not Run."),
        ("7.", "Add 'Tester' (column M), 'Test Date' (column N), and a defect link in 'Notes' (column O) on failure."),
        ("", ""),
        ("Status values", "Pass, Fail, Blocked, Skipped, Not Run (drop-down on every row)"),
        ("Priority values", "High, Medium, Low"),
        ("Test Type values",
         "Functional, Negative, Edge Case, Security, Accessibility (A11y), "
         "Performance, Compatibility, UX/UI, Regression"),
        ("", ""),
        ("Summary dashboard", "The 'Summary' sheet auto-aggregates counts by module, priority, "
                                 "and test type via formulas. Do not edit it manually."),
        ("", ""),
        ("Adding test cases",
         "Insert new rows above the bottom; continue the sequence in column A "
         "(e.g., TC-WS-018). Keep the auto-filter range intact."),
        ("Defect tracking",
         "Use column O to link the issue tracker (GitHub Issues, Linear, etc.) for failed rows."),
    ]

    r = 2
    for label, val in readme_rows:
        ws.cell(row=r, column=1, value=label).font = BOLD_FONT
        ws.cell(row=r, column=1).alignment = WRAP
        ws.cell(row=r, column=2, value=val).font = BASE_FONT
        ws.cell(row=r, column=2).alignment = WRAP
        r += 1

    # Test Cases sheet (build first, summary references it)
    tc_ws = wb.create_sheet("Test Cases")

    headers = [
        "TC ID", "Module", "Sub-Feature", "Test Type", "Test Case Title",
        "Pre-conditions", "Test Steps (How to Execute)", "Test Data",
        "Expected Result", "Actual Result", "Status",
        "Priority", "Tester", "Test Date", "Notes / Defect ID",
    ]
    widths = [12, 24, 22, 14, 38, 30, 50, 28, 50, 30, 12, 10, 14, 12, 28]
    for col_idx, (h, w) in enumerate(zip(headers, widths), 1):
        c = tc_ws.cell(row=1, column=col_idx, value=h)
        c.font = HEADER_FONT
        c.fill = HEADER_FILL
        c.alignment = CENTER
        c.border = BORDER
        tc_ws.column_dimensions[get_column_letter(col_idx)].width = w

    tc_ws.row_dimensions[1].height = 32
    tc_ws.freeze_panes = "F2"

    counters = {m[0]: 0 for m in MODULES}

    row = 2
    for plats, mod, sub, ttype, title, pre, steps, data, expected, prio in relevant:
        counters[mod] += 1
        tc_id = f"TC-{mod}-{counters[mod]:03d}"
        values = [
            tc_id, MODULE_NAME[mod], sub, ttype, title,
            pre, steps, data, expected,
            "", "Not Run", prio, "", "", "",
        ]
        for col_idx, v in enumerate(values, 1):
            c = tc_ws.cell(row=row, column=col_idx, value=v)
            c.font = BASE_FONT
            c.alignment = WRAP
            c.border = BORDER
        tc_ws.row_dimensions[row].height = 78
        row += 1
    last_row = row - 1

    # Data validations
    status_dv = DataValidation(
        type="list", formula1='"Pass,Fail,Blocked,Skipped,Not Run"',
        allow_blank=True, errorTitle="Invalid status",
        error="Choose one of: Pass, Fail, Blocked, Skipped, Not Run",
    )
    tc_ws.add_data_validation(status_dv)
    status_dv.add(f"K2:K{last_row}")

    prio_dv = DataValidation(type="list", formula1='"High,Medium,Low"', allow_blank=True)
    tc_ws.add_data_validation(prio_dv)
    prio_dv.add(f"L2:L{last_row}")

    type_dv = DataValidation(
        type="list",
        formula1='"Functional,Negative,Edge Case,Security,A11y,Performance,Compatibility,UX/UI,Regression"',
        allow_blank=True,
    )
    tc_ws.add_data_validation(type_dv)
    type_dv.add(f"D2:D{last_row}")

    # Conditional formatting on Status
    status_range = f"K2:K{last_row}"
    for val, fill in [
        ("Pass", PASS_FILL), ("Fail", FAIL_FILL), ("Blocked", BLOCKED_FILL),
        ("Not Run", NOT_RUN_FILL), ("Skipped", SKIPPED_FILL),
    ]:
        tc_ws.conditional_formatting.add(
            status_range,
            CellIsRule(operator="equal", formula=[f'"{val}"'], fill=fill),
        )

    # Conditional formatting on Priority
    prio_range = f"L2:L{last_row}"
    for val, fill in [
        ("High", PRIORITY_HIGH_FILL),
        ("Medium", PRIORITY_MED_FILL),
        ("Low", PRIORITY_LOW_FILL),
    ]:
        tc_ws.conditional_formatting.add(
            prio_range,
            CellIsRule(operator="equal", formula=[f'"{val}"'], fill=fill),
        )

    tc_ws.auto_filter.ref = f"A1:O{last_row}"

    # Summary sheet
    sm = wb.create_sheet("Summary", 1)
    sm.column_dimensions["A"].width = 36
    for ch in "BCDEFGH":
        sm.column_dimensions[ch].width = 13

    sm.merge_cells("A1:H1")
    c = sm["A1"]
    c.value = f"Test Execution Summary — {platform.title()}"
    c.font = TITLE_FONT
    c.fill = HEADER_FILL
    c.alignment = CENTER
    sm.row_dimensions[1].height = 28

    sm_headers = ["Module", "Total", "Not Run", "Pass", "Fail", "Blocked", "Skipped", "Pass %"]
    for i, h in enumerate(sm_headers, 1):
        c = sm.cell(row=3, column=i, value=h)
        c.font = HEADER_FONT
        c.fill = HEADER_FILL
        c.alignment = CENTER
        c.border = BORDER

    # Only emit rows for modules that actually have tests on this platform
    present_modules = sorted({x[1] for x in relevant}, key=lambda m: [c for c, _ in MODULES].index(m))

    r = 4
    for mod_code in present_modules:
        mod_name = MODULE_NAME[mod_code]
        sm.cell(row=r, column=1, value=mod_name).font = BOLD_FONT
        sm.cell(row=r, column=1).alignment = WRAP
        sm.cell(row=r, column=1).border = BORDER

        sm.cell(row=r, column=2, value=f'=COUNTIF(\'Test Cases\'!B:B,"{mod_name}")')
        sm.cell(row=r, column=3, value=f'=COUNTIFS(\'Test Cases\'!B:B,"{mod_name}",\'Test Cases\'!K:K,"Not Run")')
        sm.cell(row=r, column=4, value=f'=COUNTIFS(\'Test Cases\'!B:B,"{mod_name}",\'Test Cases\'!K:K,"Pass")')
        sm.cell(row=r, column=5, value=f'=COUNTIFS(\'Test Cases\'!B:B,"{mod_name}",\'Test Cases\'!K:K,"Fail")')
        sm.cell(row=r, column=6, value=f'=COUNTIFS(\'Test Cases\'!B:B,"{mod_name}",\'Test Cases\'!K:K,"Blocked")')
        sm.cell(row=r, column=7, value=f'=COUNTIFS(\'Test Cases\'!B:B,"{mod_name}",\'Test Cases\'!K:K,"Skipped")')
        sm.cell(row=r, column=8, value=f'=IFERROR(D{r}/(D{r}+E{r}),"-")')

        for col in range(2, 9):
            cell = sm.cell(row=r, column=col)
            cell.font = BASE_FONT
            cell.alignment = CENTER
            cell.border = BORDER
            if col == 8:
                cell.number_format = "0.0%;0.0%;-"
        r += 1

    total_row = r
    sm.cell(row=total_row, column=1, value="TOTAL").font = SECTION_FONT
    sm.cell(row=total_row, column=1).fill = SECTION_FILL
    sm.cell(row=total_row, column=1).border = BORDER

    for col in range(2, 8):
        col_letter = get_column_letter(col)
        sm.cell(row=total_row, column=col,
                value=f"=SUM({col_letter}4:{col_letter}{total_row-1})")
        cell = sm.cell(row=total_row, column=col)
        cell.font = BOLD_FONT
        cell.fill = PatternFill("solid", start_color="EDE9FE")
        cell.alignment = CENTER
        cell.border = BORDER

    sm.cell(row=total_row, column=8,
            value=f"=IFERROR(D{total_row}/(D{total_row}+E{total_row}),\"-\")")
    cell = sm.cell(row=total_row, column=8)
    cell.font = BOLD_FONT
    cell.fill = PatternFill("solid", start_color="EDE9FE")
    cell.alignment = CENTER
    cell.border = BORDER
    cell.number_format = "0.0%;0.0%;-"

    # By priority
    r = total_row + 3
    sm.merge_cells(start_row=r, start_column=1, end_row=r, end_column=8)
    c = sm.cell(row=r, column=1, value="Counts by Priority")
    c.font = SECTION_FONT
    c.fill = SECTION_FILL
    c.alignment = CENTER
    sm.row_dimensions[r].height = 22
    r += 1

    for i, h in enumerate(sm_headers, 1):
        h2 = "Priority" if i == 1 else h
        c = sm.cell(row=r, column=i, value=h2)
        c.font = HEADER_FONT
        c.fill = HEADER_FILL
        c.alignment = CENTER
        c.border = BORDER
    r += 1

    for prio in ["High", "Medium", "Low"]:
        sm.cell(row=r, column=1, value=prio).font = BOLD_FONT
        sm.cell(row=r, column=1).alignment = CENTER
        sm.cell(row=r, column=1).border = BORDER
        sm.cell(row=r, column=1).fill = (
            PRIORITY_HIGH_FILL if prio == "High"
            else PRIORITY_MED_FILL if prio == "Medium"
            else PRIORITY_LOW_FILL
        )

        sm.cell(row=r, column=2, value=f'=COUNTIF(\'Test Cases\'!L:L,"{prio}")')
        sm.cell(row=r, column=3, value=f'=COUNTIFS(\'Test Cases\'!L:L,"{prio}",\'Test Cases\'!K:K,"Not Run")')
        sm.cell(row=r, column=4, value=f'=COUNTIFS(\'Test Cases\'!L:L,"{prio}",\'Test Cases\'!K:K,"Pass")')
        sm.cell(row=r, column=5, value=f'=COUNTIFS(\'Test Cases\'!L:L,"{prio}",\'Test Cases\'!K:K,"Fail")')
        sm.cell(row=r, column=6, value=f'=COUNTIFS(\'Test Cases\'!L:L,"{prio}",\'Test Cases\'!K:K,"Blocked")')
        sm.cell(row=r, column=7, value=f'=COUNTIFS(\'Test Cases\'!L:L,"{prio}",\'Test Cases\'!K:K,"Skipped")')
        sm.cell(row=r, column=8, value=f'=IFERROR(D{r}/(D{r}+E{r}),"-")')

        for col in range(2, 9):
            cell = sm.cell(row=r, column=col)
            cell.font = BASE_FONT
            cell.alignment = CENTER
            cell.border = BORDER
            if col == 8:
                cell.number_format = "0.0%;0.0%;-"
        r += 1

    # By test type
    r += 2
    sm.merge_cells(start_row=r, start_column=1, end_row=r, end_column=8)
    c = sm.cell(row=r, column=1, value="Counts by Test Type")
    c.font = SECTION_FONT
    c.fill = SECTION_FILL
    c.alignment = CENTER
    sm.row_dimensions[r].height = 22
    r += 1

    for i, h in enumerate(sm_headers, 1):
        h2 = "Test Type" if i == 1 else h
        c = sm.cell(row=r, column=i, value=h2)
        c.font = HEADER_FONT
        c.fill = HEADER_FILL
        c.alignment = CENTER
        c.border = BORDER
    r += 1

    for ttype in ["Functional", "Negative", "Edge Case", "Security", "A11y",
                  "Performance", "Compatibility", "UX/UI", "Regression"]:
        sm.cell(row=r, column=1, value=ttype).font = BOLD_FONT
        sm.cell(row=r, column=1).alignment = CENTER
        sm.cell(row=r, column=1).border = BORDER
        sm.cell(row=r, column=2, value=f'=COUNTIF(\'Test Cases\'!D:D,"{ttype}")')
        sm.cell(row=r, column=3, value=f'=COUNTIFS(\'Test Cases\'!D:D,"{ttype}",\'Test Cases\'!K:K,"Not Run")')
        sm.cell(row=r, column=4, value=f'=COUNTIFS(\'Test Cases\'!D:D,"{ttype}",\'Test Cases\'!K:K,"Pass")')
        sm.cell(row=r, column=5, value=f'=COUNTIFS(\'Test Cases\'!D:D,"{ttype}",\'Test Cases\'!K:K,"Fail")')
        sm.cell(row=r, column=6, value=f'=COUNTIFS(\'Test Cases\'!D:D,"{ttype}",\'Test Cases\'!K:K,"Blocked")')
        sm.cell(row=r, column=7, value=f'=COUNTIFS(\'Test Cases\'!D:D,"{ttype}",\'Test Cases\'!K:K,"Skipped")')
        sm.cell(row=r, column=8, value=f'=IFERROR(D{r}/(D{r}+E{r}),"-")')

        for col in range(2, 9):
            cell = sm.cell(row=r, column=col)
            cell.font = BASE_FONT
            cell.alignment = CENTER
            cell.border = BORDER
            if col == 8:
                cell.number_format = "0.0%;0.0%;-"
        r += 1

    wb.save(out_path)
    return len(relevant)


import os
os.makedirs(OUT_DIR, exist_ok=True)
web_count = build_workbook("web", os.path.join(OUT_DIR, "web-app-manual-test-cases.xlsx"))
desktop_count = build_workbook("desktop", os.path.join(OUT_DIR, "desktop-app-manual-test-cases.xlsx"))
print(f"Web file: {web_count} tests")
print(f"Desktop file: {desktop_count} tests")
print(f"Total unique entries: {len(TESTS)}")
