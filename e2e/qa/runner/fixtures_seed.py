"""Seed common test fixtures used by Cowork while executing the manual
test plan. Run once at the start of a test run:

    python fixtures_seed.py

This produces deterministic, minimal-but-valid fixtures for the cases
that show up most often in the test plan. Cowork is free to (and
should) create additional fixtures on demand under fixtures/<category>/
when a specific test needs something more elaborate.

All paths are relative to this script's parent directory
(e2e/qa/runner/fixtures/).
"""
from __future__ import annotations
import base64
import datetime as dt
import io
import json
import os
import struct
import sys
import zlib
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"


def _safe_print(msg: str) -> None:
    """Print to stdout, surviving non-UTF-8 consoles (Windows cp1252)."""
    enc = sys.stdout.encoding or "utf-8"
    try:
        sys.stdout.write(msg + "\n")
    except UnicodeEncodeError:
        sys.stdout.write(msg.encode(enc, errors="backslashreplace").decode(enc) + "\n")


def write_text(rel: str, content: str) -> None:
    p = FIXTURES / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8", newline="\n")
    _safe_print(f"  wrote {p}")


def write_bytes(rel: str, content: bytes) -> None:
    p = FIXTURES / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(content)
    _safe_print(f"  wrote {p}")


def write_json(rel: str, obj) -> None:
    write_text(rel, json.dumps(obj, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------------
# Import fixtures: Postman, OpenAPI, Insomnia, HAR
# ---------------------------------------------------------------------
def seed_imports() -> None:
    print("[imports]")

    # Postman v2.1 - simple
    postman_simple = {
        "info": {
            "_postman_id": "11111111-2222-3333-4444-555555555555",
            "name": "Sample Postman v2.1 Simple",
            "schema":
                "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        "item": [
            {
                "name": "Get user",
                "request": {
                    "method": "GET",
                    "header": [{"key": "Accept", "value": "application/json"}],
                    "url": {
                        "raw": "https://httpbin.org/get?id=1",
                        "protocol": "https",
                        "host": ["httpbin", "org"],
                        "path": ["get"],
                        "query": [{"key": "id", "value": "1"}],
                    },
                },
            },
            {
                "name": "Create user",
                "request": {
                    "method": "POST",
                    "header": [{"key": "Content-Type", "value": "application/json"}],
                    "body": {
                        "mode": "raw",
                        "raw": "{\"name\":\"alice\"}",
                        "options": {"raw": {"language": "json"}},
                    },
                    "url": {
                        "raw": "https://httpbin.org/post",
                        "protocol": "https",
                        "host": ["httpbin", "org"],
                        "path": ["post"],
                    },
                },
            },
        ],
    }
    write_json("import/postman-v21-simple.json", postman_simple)

    # Postman v2.1 - all auths
    postman_auth = {
        "info": {
            "name": "Postman v2.1 - Auth Variants",
            "schema":
                "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        "auth": {"type": "bearer", "bearer": [{"key": "token", "value": "{{token}}"}]},
        "item": [
            {
                "name": "Bearer",
                "request": {
                    "method": "GET",
                    "url": "https://httpbin.org/bearer",
                    "auth": {"type": "bearer",
                              "bearer": [{"key": "token", "value": "abc"}]},
                },
            },
            {
                "name": "Basic",
                "request": {
                    "method": "GET",
                    "url": "https://httpbin.org/basic-auth/user/pass",
                    "auth": {
                        "type": "basic",
                        "basic": [
                            {"key": "username", "value": "user"},
                            {"key": "password", "value": "pass"},
                        ],
                    },
                },
            },
            {
                "name": "API Key (header)",
                "request": {
                    "method": "GET",
                    "url": "https://httpbin.org/headers",
                    "auth": {
                        "type": "apikey",
                        "apikey": [
                            {"key": "key", "value": "X-Api-Key"},
                            {"key": "value", "value": "secret-123"},
                            {"key": "in", "value": "header"},
                        ],
                    },
                },
            },
        ],
        "variable": [{"key": "token", "value": "abc"}],
    }
    write_json("import/postman-v21-auth.json", postman_auth)

    # Postman environment
    postman_env = {
        "id": "env-fixture",
        "name": "Dev",
        "values": [
            {"key": "baseUrl", "value": "https://httpbin.org", "enabled": True},
            {"key": "token", "value": "abc.def.ghi", "type": "secret", "enabled": True},
        ],
        "_postman_variable_scope": "environment",
    }
    write_json("import/postman-environment.json", postman_env)

    # OpenAPI 3.0 - simple
    openapi_yaml = """openapi: 3.0.3
info:
  title: Sample API
  version: 1.0.0
servers:
  - url: https://httpbin.org
paths:
  /get:
    get:
      summary: Echo GET
      parameters:
        - in: query
          name: id
          schema: { type: string }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/User' }
  /post:
    post:
      summary: Echo POST
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/User' }
      responses:
        '200': { description: OK }
components:
  schemas:
    User:
      type: object
      required: [name]
      properties:
        id: { type: integer }
        name: { type: string }
"""
    write_text("import/openapi-3-simple.yaml", openapi_yaml)

    # OpenAPI - circular ref
    openapi_circular = """openapi: 3.0.3
info: { title: Tree, version: 0.1.0 }
paths:
  /node:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Node' }
components:
  schemas:
    Node:
      type: object
      properties:
        name: { type: string }
        children:
          type: array
          items: { $ref: '#/components/schemas/Node' }
"""
    write_text("import/openapi-3-circular.yaml", openapi_circular)

    # Insomnia v4
    insomnia = {
        "_type": "export",
        "__export_format": 4,
        "__export_date": "2026-05-14T00:00:00.000Z",
        "__export_source": "insomnia.desktop.app:v8.0.0",
        "resources": [
            {
                "_id": "wrk_1",
                "_type": "workspace",
                "name": "Sample Insomnia",
                "scope": "collection",
            },
            {
                "_id": "req_1",
                "parentId": "wrk_1",
                "_type": "request",
                "name": "Get",
                "method": "GET",
                "url": "https://httpbin.org/get",
                "headers": [{"name": "Accept", "value": "application/json"}],
            },
            {
                "_id": "env_1",
                "parentId": "wrk_1",
                "_type": "environment",
                "name": "Base",
                "data": {"baseUrl": "https://httpbin.org"},
            },
        ],
    }
    write_json("import/insomnia-v4.json", insomnia)

    # HAR
    har = {
        "log": {
            "version": "1.2",
            "creator": {"name": "fixtures_seed", "version": "1.0"},
            "entries": [
                {
                    "startedDateTime": "2026-05-14T12:00:00.000Z",
                    "time": 12,
                    "request": {
                        "method": "GET",
                        "url": "https://httpbin.org/get?x=1",
                        "httpVersion": "HTTP/1.1",
                        "cookies": [],
                        "headers": [
                            {"name": "Accept", "value": "application/json"}
                        ],
                        "queryString": [{"name": "x", "value": "1"}],
                        "headersSize": -1,
                        "bodySize": 0,
                    },
                    "response": {
                        "status": 200,
                        "statusText": "OK",
                        "httpVersion": "HTTP/1.1",
                        "cookies": [],
                        "headers": [
                            {"name": "Content-Type", "value": "application/json"}
                        ],
                        "content": {
                            "size": 0, "mimeType": "application/json",
                            "text": "{\"ok\":true}",
                        },
                        "redirectURL": "", "headersSize": -1, "bodySize": 0,
                    },
                    "cache": {}, "timings": {"send": 0, "wait": 12, "receive": 0},
                }
            ],
        }
    }
    write_json("import/sample.har", har)


# ---------------------------------------------------------------------
# cURL fixtures
# ---------------------------------------------------------------------
def seed_curl() -> None:
    print("[curl]")
    write_text(
        "curl/simple.txt",
        "curl -X GET https://httpbin.org/get -H 'Accept: application/json'\n",
    )
    write_text(
        "curl/post-json.txt",
        ("curl -X POST https://httpbin.org/post "
         "-H 'Content-Type: application/json' "
         "-d '{\"name\":\"alice\"}'\n"),
    )
    write_text(
        "curl/multipart.txt",
        ("curl -X POST https://httpbin.org/post "
         "-F 'username=alice' -F 'file=@./fixtures/binary/sample.txt'\n"),
    )
    write_text(
        "curl/multiline.txt",
        ("curl -X POST https://httpbin.org/post \\\n"
         "  -H 'Authorization: Bearer abc' \\\n"
         "  -H 'Content-Type: application/json' \\\n"
         "  -d '{\"x\":1}'\n"),
    )
    write_text(
        "curl/urlencoded.txt",
        ("curl -X POST https://httpbin.org/post "
         "--data-urlencode 'q=hello world' --data-urlencode 'b=1&2'\n"),
    )


# ---------------------------------------------------------------------
# Body content fixtures
# ---------------------------------------------------------------------
def seed_bodies() -> None:
    print("[bodies]")
    write_json("bodies/sample.json", {"name": "alice", "age": 30, "tags": ["a", "b"]})
    write_json(
        "bodies/sample-deep.json",
        {"a": {"b": {"c": {"d": {"e": {"f": {"g": {"h": {"i": {"j": 1}}}}}}}}}},
    )
    write_text(
        "bodies/sample.xml",
        "<?xml version='1.0' encoding='UTF-8'?>\n<user><name>alice</name></user>\n",
    )
    write_text(
        "bodies/sample.html",
        "<!doctype html><html><body><p>hello</p></body></html>\n",
    )
    write_text("bodies/sample.txt", "hello world\n")
    write_text("bodies/sample-unicode.json",
               json.dumps({"测试": "🚀", "name": "café"}, ensure_ascii=False, indent=2))

    # UTF-16 LE with BOM
    write_bytes(
        "bodies/sample-utf16-le.txt",
        b"\xff\xfe" + "Hello, UTF-16!\n".encode("utf-16-le"),
    )
    # UTF-16 BE with BOM
    write_bytes(
        "bodies/sample-utf16-be.txt",
        b"\xfe\xff" + "Hello, UTF-16 BE!\n".encode("utf-16-be"),
    )
    # ISO-8859-1
    write_bytes("bodies/sample-iso8859-1.txt", "café\n".encode("iso-8859-1"))

    # CRLF-injection probe (must be rejected by the app)
    write_text(
        "bodies/injection-crlf.txt",
        "value1\r\nX-Injected: oops\r\nmore\n",
    )

    # Large JSON: ~100 KB
    big = {"items": [{"id": i, "name": f"item-{i}"} for i in range(2000)]}
    write_json("bodies/large-100kb.json", big)

    # Huge JSON: ~1 MB (generated lazily)
    huge = {"items": [
        {"id": i, "name": f"item-{i}",
         "blurb": "lorem ipsum dolor sit amet " * 4}
        for i in range(8000)
    ]}
    write_json("bodies/huge-1mb.json", huge)

    # Unquoted key (universally invalid per RFC 8259)
    write_text("bodies/invalid-unquoted-key.json", '{x: 1}\n')
    # Trailing comma (invalid)
    write_text("bodies/invalid-trailing-comma.json", '{"x": 1,}\n')
    # NaN literal (invalid per RFC 8259 but accepted by some lenient parsers)
    write_text("bodies/invalid-nan.json", '{"x": NaN}\n')


# ---------------------------------------------------------------------
# Binary fixtures: a real 8x8 red PNG, a tiny PDF
# ---------------------------------------------------------------------
def _png_8x8_red() -> bytes:
    """Hand-rolled 8x8 red PNG (no external deps)."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0)  # 8x8, 8-bit, RGB
    raw = b""
    for _ in range(8):
        raw += b"\x00" + (b"\xff\x00\x00" * 8)  # filter byte + RGB
    idat = zlib.compress(raw, 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def _minimal_pdf() -> bytes:
    """Minimal one-page PDF that opens in a viewer."""
    return (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f \n"
        b"0000000010 00000 n \n0000000053 00000 n \n0000000100 00000 n \n"
        b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n160\n%%EOF\n"
    )


def seed_binary() -> None:
    print("[binary]")
    write_bytes("binary/sample.png", _png_8x8_red())
    write_bytes("binary/sample.pdf", _minimal_pdf())
    # 1 KB of zeros (deterministic)
    write_bytes("binary/sample-1kb.bin", b"\x00" * 1024)
    # 10 KB filled with a recognizable byte pattern
    write_bytes("binary/sample-10kb.bin", b"\xab\xcd" * 5120)
    # Empty file
    write_bytes("binary/empty.bin", b"")
    # Unicode filename (Windows OK with UTF-8)
    write_bytes("binary/测试-文件.bin", b"unicode-filename-content")


# ---------------------------------------------------------------------
# JSON Schemas (for body validation tests)
# ---------------------------------------------------------------------
def seed_schemas() -> None:
    print("[schemas]")
    write_json("schemas/user.schema.json", {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "title": "User",
        "type": "object",
        "required": ["id", "name"],
        "properties": {
            "id": {"type": "integer", "minimum": 1},
            "name": {"type": "string", "minLength": 1, "maxLength": 100},
            "email": {"type": "string", "format": "email"},
        },
        "additionalProperties": False,
    })
    write_json("schemas/team.schema.json", {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "title": "Team",
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "lead": {"$ref": "user.schema.json"},      # external $ref (medium-depth)
            "members": {
                "type": "array",
                "items": {"$ref": "user.schema.json"},
            },
        },
    })
    # Circular schema (tree node)
    write_json("schemas/tree.schema.json", {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "title": "TreeNode",
        "definitions": {
            "Node": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "children": {
                        "type": "array",
                        "items": {"$ref": "#/definitions/Node"},
                    },
                },
            },
        },
        "$ref": "#/definitions/Node",
    })
    # AllOf / oneOf composition
    write_json("schemas/composition.schema.json", {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "title": "Animal",
        "oneOf": [
            {"$ref": "#/definitions/Dog"},
            {"$ref": "#/definitions/Cat"},
        ],
        "definitions": {
            "Dog": {"type": "object",
                     "required": ["bark"],
                     "properties": {"bark": {"type": "string"}}},
            "Cat": {"type": "object",
                     "required": ["meow"],
                     "properties": {"meow": {"type": "string"}}},
        },
    })


# ---------------------------------------------------------------------
# Workspace seeds (file-backed shape consumed by FileBackedWorkspaceProvider)
# ---------------------------------------------------------------------
def seed_workspaces() -> None:
    print("[workspaces]")
    empty = {
        "schemaVersion": 1,
        "id": "ws-empty",
        "name": "Empty Workspace",
        "collections": {"items": {}, "folders": {}, "requests": {}, "tree": []},
        "environments": {"items": {}, "activeName": None, "priorityOrder": []},
        "executionPlans": {},
        "mockServers": {},
        "linkedWorkspaces": {},
        "linkedOverrides": {"requests": {}, "environmentVars": {}},
        "globalAssets": {"schemas": {}, "graphql": {}},
        "secretKeys": {},
        "releases": {"self": None, "perLink": {}},
    }
    write_json("workspaces/empty-ws.json", empty)

    seeded = {
        "schemaVersion": 1,
        "id": "ws-seeded",
        "name": "Seeded Workspace",
        "collections": {
            "items": {"c1": {"id": "c1", "name": "API v1"}},
            "folders": {
                "f1": {"id": "f1", "name": "Users", "collectionId": "c1"},
            },
            "requests": {
                "r1": {
                    "id": "r1", "name": "Get user", "method": "GET",
                    "url": "https://httpbin.org/get?id={{id}}",
                    "folderId": "f1", "collectionId": "c1",
                    "headers": [{"key": "Accept", "value": "application/json",
                                  "enabled": True}],
                    "auth": {"type": "inherit"},
                    "body": {"type": "none"},
                },
                "r2": {
                    "id": "r2", "name": "Create user", "method": "POST",
                    "url": "https://httpbin.org/post",
                    "folderId": "f1", "collectionId": "c1",
                    "headers": [{"key": "Content-Type", "value": "application/json",
                                  "enabled": True}],
                    "auth": {"type": "bearer",
                              "bearer": {"token": "{{token}}"}},
                    "body": {"type": "raw", "raw": "{\"name\":\"alice\"}",
                              "rawLanguage": "json"},
                },
            },
            "tree": [{"id": "c1", "type": "collection",
                       "children": [{"id": "f1", "type": "folder",
                                       "children": [
                                           {"id": "r1", "type": "request"},
                                           {"id": "r2", "type": "request"},
                                       ]}]}],
        },
        "environments": {
            "items": {
                "Dev": {"name": "Dev",
                          "variables": [
                              {"key": "baseUrl",
                               "value": "https://httpbin.org",
                               "secret": False},
                              {"key": "id", "value": "1", "secret": False},
                              {"key": "token",
                               "value": "abc.def.ghi", "secret": False},
                          ]},
                "Prod": {"name": "Prod",
                          "variables": [
                              {"key": "baseUrl",
                               "value": "https://api.example.com",
                               "secret": False},
                              {"key": "id", "value": "42",
                               "secret": False},
                          ]},
            },
            "activeName": "Dev",
            "priorityOrder": ["Dev", "Prod"],
        },
        "executionPlans": {
            "p1": {
                "id": "p1", "name": "Smoke",
                "steps": [
                    {"requestId": "r1", "enabled": True},
                    {"requestId": "r2", "enabled": True},
                ],
                "envPriorityOrder": ["Dev"],
            }
        },
        "mockServers": {
            "m1": {
                "id": "m1", "name": "Users Mock",
                "endpoints": [{
                    "id": "e1", "method": "GET", "path": "/users/:id",
                    "responses": [{
                        "id": "rsp1", "status": 200,
                        "headers": [{"key": "Content-Type",
                                      "value": "application/json"}],
                        "body": "{\"id\":\"{id}\",\"name\":\"alice\"}",
                    }],
                }],
            }
        },
        "linkedWorkspaces": {},
        "linkedOverrides": {"requests": {}, "environmentVars": {}},
        "globalAssets": {
            "schemas": {
                "sUser": {"id": "sUser", "name": "User",
                           "content": json.dumps({
                               "type": "object",
                               "required": ["name"],
                               "properties": {"id": {"type": "integer"},
                                              "name": {"type": "string"}},
                           })}
            },
            "graphql": {},
        },
        "secretKeys": {},
        "releases": {"self": None, "perLink": {}},
    }
    write_json("workspaces/seeded-ws.json", seeded)


# ---------------------------------------------------------------------
# Git fixtures (small init script — Cowork runs it for git tests)
# ---------------------------------------------------------------------
def seed_git_helpers() -> None:
    print("[git]")
    write_text("git/two-device-init.sh",
        "#!/usr/bin/env bash\n"
        "# Initialize two disposable worktrees on a bare repo to simulate\n"
        "# two devices for git-conflict tests. Usage: ./two-device-init.sh <name>\n"
        "set -euo pipefail\n"
        "NAME=${1:-conflict-demo}\n"
        "ROOT=$(mktemp -d)/${NAME}\n"
        "mkdir -p \"$ROOT\"\n"
        "cd \"$ROOT\"\n"
        "git init --bare bare.git\n"
        "git clone bare.git device-a\n"
        "git clone bare.git device-b\n"
        "cd device-a\n"
        "echo '{\"schemaVersion\":1,\"id\":\"ws\",\"name\":\"Demo\"}' > workspace.json\n"
        "git add workspace.json\n"
        "git -c user.email=a@example.com -c user.name='Device A' \\\n"
        "    commit -m 'init'\n"
        "git push origin master 2>/dev/null || git push origin main\n"
        "cd ../device-b\n"
        "git pull --rebase\n"
        "echo \"Two-device worktree created at: $ROOT\"\n"
    )


# ---------------------------------------------------------------------
# OAuth IdP mock config (consumed by the in-repo mock IdP harness)
# ---------------------------------------------------------------------
def seed_oauth() -> None:
    print("[oauth]")
    write_json("oauth/mock-idp-config.json", {
        "issuer": "https://mock-idp.local",
        "authorizationEndpoint": "http://localhost:5176/_mock/oauth/authorize",
        "tokenEndpoint": "http://localhost:5176/_mock/oauth/token",
        "deviceAuthorizationEndpoint": "http://localhost:5176/_mock/oauth/device",
        "clients": {
            "test-confidential": {"clientSecret": "shh",
                                    "grants": ["client_credentials",
                                               "authorization_code", "password",
                                               "refresh_token"]},
            "test-public-pkce": {"grants": ["authorization_code"], "pkce": True},
        },
        "users": [{"username": "alice", "password": "wonder"}],
        "scopes": ["read", "write", "admin"],
    })


# ---------------------------------------------------------------------
# Catalog file - so Cowork can discover what's seeded
# ---------------------------------------------------------------------
def write_catalog() -> None:
    print("[catalog]")
    rows = []
    for root, _, files in os.walk(FIXTURES):
        for name in sorted(files):
            if name == "README.md":
                continue
            rel = os.path.relpath(os.path.join(root, name), FIXTURES).replace("\\", "/")
            size = os.path.getsize(os.path.join(root, name))
            rows.append((rel, size))
    rows.sort()
    md = ["# Fixtures catalog",
          "",
          "Generated by `fixtures_seed.py`. Do not hand-edit this file; rerun the",
          "seed script to refresh.",
          "",
          f"Generated at: {dt.datetime.now().isoformat(timespec='seconds')}",
          "",
          "| Path | Size (bytes) |",
          "|---|---:|"]
    for rel, size in rows:
        md.append(f"| `{rel}` | {size} |")
    write_text("CATALOG.md", "\n".join(md) + "\n")


def main() -> int:
    print(f"Seeding fixtures under {FIXTURES} ...")
    FIXTURES.mkdir(parents=True, exist_ok=True)
    seed_imports()
    seed_curl()
    seed_bodies()
    seed_binary()
    seed_schemas()
    seed_workspaces()
    seed_git_helpers()
    seed_oauth()
    write_catalog()
    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
