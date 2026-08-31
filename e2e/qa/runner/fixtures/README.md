# Test fixtures

This directory holds reusable files that test cases need: importable
collections (Postman, OpenAPI, Insomnia, HAR), request bodies (JSON,
XML, binary, huge), JSON Schemas (with $refs of varying depths),
seeded workspaces, cURL command samples, and helper scripts for
multi-device git scenarios.

## Layout

| Folder        | Purpose                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| `import/`     | Source files for Import / Export round-trip tests (Postman v2.1, OpenAPI 3, Insomnia v4, HAR).                 |
| `bodies/`     | Request body samples — JSON / XML / HTML / text / unicode / encodings / large / huge / invalid.                |
| `binary/`     | Real binary fixtures — PNG, PDF, fixed-size .bin, empty, unicode-named.                                        |
| `schemas/`    | JSON Schemas for body-validation tests, including circular and external `$ref` patterns.                       |
| `workspaces/` | Seeded `workspace.json` files consumed by `FileBackedWorkspaceProvider` for workspace restore and disk-mirror tests. |
| `curl/`       | cURL command strings for the cURL-import tests.                                                                |
| `oauth/`      | Mock IdP config (consumed by the in-repo mock IdP harness).                                                    |
| `git/`        | Helper scripts for two-device git-conflict simulations.                                                        |

## Generated vs hand-crafted

The fixtures in this directory are produced by [`../fixtures_seed.py`](../fixtures_seed.py).

To rebuild from scratch:

```bash
cd e2e/qa/runner
python fixtures_seed.py
```

`CATALOG.md` is regenerated at the end of every seed run and is the
ground-truth listing of what exists.

## Adding new fixtures during a test run

If a test row needs a fixture that doesn't exist yet, **create it
during the run** under the appropriate sub-folder. The naming
convention is:

```
fixtures/<category>/<TC-ID-or-descriptive-name>.<ext>
```

Examples that Cowork might create on demand:

- `fixtures/bodies/TC-BE-0017-large-array.json`
- `fixtures/schemas/TC-JS-0009-five-level-ref.schema.json`
- `fixtures/import/TC-IE-0042-postman-with-ntlm.json`
- `fixtures/binary/TC-BE-0024-locked-on-windows.bin`
- `fixtures/oauth/TC-OI-0013-okta-tenant.json`

Two rules for any new fixture:

1. Make it **minimal but valid** for the format. Don't ship 100 KB
   when 200 bytes will do.
2. Add a one-line comment (where the format allows) explaining which
   test rows depend on it, so future readers can prune safely.

## Do not commit secrets

Real OAuth client secrets, real API tokens, and real customer data
must never land here. For OAuth IdP tests, use either:

- the in-repo mock IdP at `packages/core/test/fixtures/mockIdp.ts`, or
- a per-tester `~/.apicircle-qa-secrets.env` file referenced from the
  results workbook's Notes column.

If a row genuinely needs real third-party credentials and none are
available in the current run, mark it **`Blocked`** with the reason
`"Needs <provider> tenant creds in fixtures/oauth/"`.
